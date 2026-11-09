/**
 * Entry-layer tests: load the real `src/client/entry.js` against a fake Client
 * context, and drive the registrations and the `/prompt` command.
 *
 * The point is the wiring the browser cannot show from the outside: which ids
 * are registered, and that opening the editor recovers when a global main panel
 * has cleared the right column's on-screen session (the harness behaviour the
 * audit found: `show(activePanelId === null ? selected : undefined)`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------- fakes

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

const reportCalls = []
const fromTemplateCalls = []
const requestOpenCalls = []
const openTabCalls = []
const selectPanelCalls = []
let mountedSession = 'session-1'

const MODEL = {
  makeTranslator: (dict, lang) => {
    const t = (key) => key
    t.lang = lang || 'zh'
    return t
  },
  dictFor: () => ({}),
  langOf: () => 'zh',
  routeUrl: () => 'dsh-app://app/prompt-stash/api/report',
  api: async (action, payload) => {
    reportCalls.push({ action, payload })
    return { ok: true }
  },
  store: {
    toast() {},
    set() {},
    get: () => ({ status: 'ready', library: { notes: [], templates: [] } }),
  },
  requestOpen: (request) => requestOpenCalls.push(request),
  fromTemplate: async (templateId, session, workspace) => {
    fromTemplateCalls.push({ templateId, session, workspace })
    return { id: 'n_created1', kind: 'note', title: '来自模板', body: '模板正文' }
  },
  initialDocument: () => ({ kind: 'note', title: '', body: '', tags: [], color: 'slate', dirty: false, savedAt: '' }),
  documentOf: () => ({ kind: 'note' }),
  readBody: async () => '',
  save: async () => ({}),
  load: async () => ({}),
  saveView() {},
  openFolder: async () => ({ ok: true }),
  updateMeta: async () => ({}),
  colorOf: () => '#000000',
  formatWhen: () => '',
  formatExact: () => '',
  PALETTE: [],
  groupEntries: () => [],
  filterEntries: () => [],
  colorFacets: () => [],
  tagFacets: () => [],
  scopeCounts: () => ({ all: 0, note: 0, template: 0 }),
}

globalThis.__PromptStashModel = MODEL
globalThis.__PromptStashUI = {
  createUI: () => ({
    EditorPanel: () => null,
    ArchivePanel: () => null,
    SidebarIcon: () => null,
    renderMarkdown: () => [],
    CSS: '',
  }),
}

await import('../src/client/entry.js')
assert.ok(captured !== null, 'the module loader was called')

const plugin = captured.factory((id) => {
  if (id !== 'react') throw new Error(`unexpected require(${id})`)
  return { createElement: () => null }
})

/** One slot registration as the entry made it. */
const registrations = []
const disposers = []

const services = {}

function recomposeServices() {
  services.sidebarRight = {
    mounted: { getSnapshot: () => mountedSession },
    openTab(kind) {
      openTabCalls.push(kind)
      if (mountedSession === undefined) throw new Error('no session surface is mounted')
    },
  }
  services.layout = {
    selectPanel(id) {
      selectPanelCalls.push(id)
      // The harness reports the conversation session again once no global panel
      // owns the centre; model that synchronously.
      if (id === null) mountedSession = 'session-1'
    },
    openRightbar() {},
  }
  services.commandUi = {
    register(contribution) {
      registrations.push({ slot: 'command', contribution })
      return () => {}
    },
  }
  services.sidebarRightTabs = {
    register(definition) {
      registrations.push({ slot: 'tabType', definition })
      return () => {}
    },
  }
  services.sessions = { list: { getSnapshot: () => ({ byId: { 'session-1': { title: '会话一', cwd: 'E:\\work' } } }) } }
  services.locale = { subscribe: () => () => {}, getLocale: () => ({ active: 'zh-CN' }) }
}

recomposeServices()

/** The base context every scope inherits from. */
const baseCtx = {
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  get(name) {
    return services[name]
  },
  inject(names, callback) {
    baseCtx.effect(() => callback(scopeWith(names)), 'inject')
    return () => {}
  },
  slots: {
    inject(name, callback) {
      baseCtx.effect(() => callback(), `slot:${name}`)
      return () => {}
    },
    register(options, component) {
      registrations.push({ slot: options.name, options, component })
      return () => {}
    },
  },
}

/** A Service scope: the same context plus the injected services as properties. */
function scopeWith(names) {
  const scope = Object.create(baseCtx)
  for (const name of names) scope[name] = services[name]
  return scope
}

plugin.apply(baseCtx)

const tabType = registrations.find((item) => item.slot === 'tabType')
const bodySlot = registrations.find((item) => item.slot === 'sidebar.right.pane.tab')
const chipSlot = registrations.find((item) => item.slot === 'sidebar.right.pane.tab.title')
const railSlot = registrations.find((item) => item.slot === 'sidebar.panellist')
const mainSlot = registrations.find((item) => item.slot === 'main')
const command = registrations.find((item) => item.slot === 'command').contribution

/** The real runtime the entry injected into its slots. */
const runtime = bodySlot.options.inject('session-1').runtime

// ---------------------------------------------------------------- tests

test('the entry registers one tab type, its body and chip, the command, the rail row and the page', () => {
  assert.equal(tabType.definition.kind, 'prompt-stash')
  assert.equal(tabType.definition.id, 'prompt-stash:editor')
  assert.equal(tabType.definition.keepMounted, true)
  assert.equal(tabType.definition.guide[0].id, 'prompt-stash')
  assert.equal(typeof tabType.definition.title, 'function')

  assert.equal(bodySlot.options.key, 'prompt-stash:editor')
  assert.equal(chipSlot.options.key, 'prompt-stash:editor')
  assert.equal(railSlot.options.id, 'prompt-stash')
  assert.equal(mainSlot.options.key, 'prompt-stash')
  // The rail row addresses the page by the same id; a mismatch throws on click.
  assert.equal(railSlot.options.id, mainSlot.options.key)

  assert.equal(command.name, 'prompt')
  assert.equal(command.ui.kind, 'action')
  assert.equal(command.available(), true)
})

test('/prompt opens the editor tab when the column already has an on-screen session', () => {
  openTabCalls.length = 0
  mountedSession = 'session-1'
  command.ui.run({ sessionId: 'session-1' })
  assert.deepEqual(openTabCalls, ['prompt-stash'])
})

test('/prompt gives the conversation back and retries when a global panel owns the centre', async () => {
  openTabCalls.length = 0
  selectPanelCalls.length = 0
  mountedSession = undefined
  const attempted = command.ui.run({ sessionId: 'session-1' })
  assert.equal(attempted, undefined)
  // The centre goes back to the conversation first; the open is deferred.
  assert.deepEqual(selectPanelCalls, [null])
  assert.deepEqual(openTabCalls, [])
  await new Promise((done) => setTimeout(done, 220))
  assert.deepEqual(openTabCalls, ['prompt-stash'], 'the deferred attempt opens the tab')
})

test('a template card creates a new draft and opens that, never the template itself', async () => {
  fromTemplateCalls.length = 0
  requestOpenCalls.length = 0
  openTabCalls.length = 0
  mountedSession = 'session-1'
  const result = await runtime.newDraftFromTemplate('t_template1')
  assert.equal(result, true)
  assert.equal(fromTemplateCalls.length, 1)
  assert.equal(fromTemplateCalls[0].templateId, 't_template1')
  assert.equal(fromTemplateCalls[0].session.id, 'session-1')
  assert.equal(fromTemplateCalls[0].workspace.name, 'work')
  assert.deepEqual(requestOpenCalls.pop(), {
    kind: 'note',
    id: 'n_created1',
    blank: false,
    sessionId: 'session-1',
  })
  assert.deepEqual(openTabCalls, ['prompt-stash'])
})

test('a blank draft asks the editor for the requested kind', () => {
  requestOpenCalls.length = 0
  mountedSession = 'session-1'
  runtime.newBlankDraft('template')
  assert.deepEqual(requestOpenCalls.pop(), {
    kind: 'template',
    blank: true,
    sessionId: 'session-1',
  })
})

test('the archive-open path asks for a stored document by id', () => {
  requestOpenCalls.length = 0
  mountedSession = 'session-1'
  runtime.openDocument({ kind: 'note', id: 'n_alpha01' })
  assert.deepEqual(requestOpenCalls.pop(), {
    kind: 'note',
    id: 'n_alpha01',
    blank: false,
    sessionId: 'session-1',
  })
})

test('the browser half reports its registrations to the host', async () => {
  await new Promise((done) => setTimeout(done, 600))
  const report = reportCalls.filter((call) => call.action === 'report').pop()
  assert.ok(report, 'a report was sent')
  assert.equal(report.payload.report.tabType, 'registered')
  assert.equal(report.payload.report.command, 'registered')
  assert.equal(report.payload.report.rail, 'registered')
  assert.equal(report.payload.report.main, 'registered')
  assert.deepEqual(report.payload.report.errors, [])
})
