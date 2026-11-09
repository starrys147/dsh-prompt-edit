/**
 * DOM interaction tests for the Client UI.
 *
 * These mount the real components in jsdom and drive them the way a person
 * does: type, press Ctrl+S, press Ctrl+Enter, click Send, click a card. They
 * are the closest thing to a browser this environment allows (the running
 * Electron window cannot be scripted), so they exist to pin the behaviours the
 * request called out: save writes to the Host, inject REPLACES the composer
 * draft, send has no shortcut, and nothing takes focus away from the editor.
 *
 * jsdom is not a dependency of the plugin. Point `DSH_PROMPT_STASH_JSDOM` at a
 * directory containing `node_modules/jsdom`, or leave it unset and let the
 * suite skip.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hints, jsdomModules, profileModules } from './env.mjs'

const available = jsdomModules !== undefined && profileModules !== undefined

if (!available) {
  const reason = [
    jsdomModules === undefined ? hints.jsdom : '',
    profileModules === undefined ? hints.profile : '',
  ]
    .filter(Boolean)
    .join('; ')
  test('DOM interactions', { skip: reason }, () => {})
} else {
  // ---------------------------------------------------------------- environment
  const { JSDOM } = await import(pathToFileURL(join(jsdomModules, 'jsdom', 'lib', 'api.js')).href)
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:9999/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  globalThis.localStorage = window.localStorage
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Node = window.Node
  globalThis.Event = window.Event
  globalThis.KeyboardEvent = window.KeyboardEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  } catch {
    /* Node may already expose a non-configurable navigator */
  }

  const React = (await import(pathToFileURL(join(profileModules, 'react', 'index.js')).href)).default
  const ReactDOMClient = await import(pathToFileURL(join(profileModules, 'react-dom', 'client.js')).href)
  const ReactDOMTestUtils = await import(pathToFileURL(join(profileModules, 'react-dom', 'test-utils.js')).href)
  const act = ReactDOMTestUtils.act || React.act

  globalThis.__PromptStashModel = undefined
  await import('../src/client/model.js')
  await import('../src/client/ui.js')
  const M = globalThis.__PromptStashModel
  const ui = globalThis.__PromptStashUI.createUI(React)

  const h = React.createElement

  // ---------------------------------------------------------------- host stub
  const calls = []
  let libraryState = { version: 1, notes: [], templates: [], settings: {} }

  function freshLibrary() {
    const now = new Date().toISOString()
    return {
      version: 1,
      notes: [
        {
          id: 'n_alpha01',
          title: '写一个插件',
          color: '#4d6bfe',
          tags: ['开发'],
          createdAt: now,
          updatedAt: now,
          excerpt: '一个带存档的提示词编辑器',
          chars: 12,
          lines: 2,
          session: { id: 'session-1', title: '会话一' },
          workspace: { id: 'C:\\work\\project', name: 'project', path: 'C:\\work\\project' },
        },
      ],
      templates: [
        { id: 't_beta02', title: '审稿模板', color: 'rose', tags: ['模板'], createdAt: now, updatedAt: now, excerpt: '请审阅：' },
      ],
      settings: {},
    }
  }

  globalThis.fetch = async (url, init) => {
    const action = String(url).split('/prompt-stash/api/')[1] || ''
    const payload = init !== undefined && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ action, payload })
    const reply = (body) => ({ ok: true, status: 200, json: async () => body })
    if (action === 'library') return reply({ ok: true, dir: 'stash', library: libraryState })
    if (action === 'save') {
      const entry = {
        ...payload,
        id: 'n_saved01',
        updatedAt: new Date().toISOString(),
        chars: (payload.body || '').length,
        lines: 1,
        excerpt: payload.body || '',
      }
      libraryState = {
        ...libraryState,
        notes: [entry, ...(libraryState.notes || []).filter((item) => item.id !== 'n_saved01')],
      }
      return reply({ ok: true, entry, dir: 'stash', library: libraryState })
    }
    if (action === 'read') return reply({ ok: true, body: '请审阅：' })
    if (action === 'meta') return reply({ ok: true, entry: { id: 'x' }, library: libraryState })
    return reply({ ok: true })
  }

  function runtimeStub() {
    const state = { opened: [], panel: '', toasts: [] }
    const runtime = {
      state,
      translate: () => ({ t: M.makeTranslator(M.ZH), lang: 'zh' }),
      service: () => undefined,
      currentSessionId: () => 'session-1',
      describeSession: (sessionId) => ({
        session: { id: sessionId, title: '会话一', cwd: 'C:\\work\\project' },
        workspace: { id: 'C:\\work\\project', name: 'project', path: 'C:\\work\\project' },
      }),
      openEditorTab: () => {
        state.opened.push('tab')
        return true
      },
      newBlankDraft: (kind) => {
        state.opened.push('blank')
        M.requestOpen({ kind, blank: true, sessionId: 'session-1' })
        return true
      },
      newDraftFromTemplate: (templateId) => {
        state.opened.push({ template: templateId })
        return true
      },
      openDocument: (request) => {
        state.opened.push(request)
        return true
      },
      goArchive: () => {
        state.panel = 'prompt-stash'
      },
      goChat: () => {
        state.panel = 'conversation'
      },
      noteEditorMounted: () => undefined,
    }
    return runtime
  }

  /** Mount one component into its own container (one root per test). */
  async function mount(element) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = ReactDOMClient.createRoot(container)
    await act(async () => {
      root.render(element)
    })
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  /** Forget every draft the previous test left behind (memory cache included). */
  function resetDrafts() {
    M.writeLocalDraft('session-1', null)
    localStorage.clear()
    M.store.set({ toast: null, openRequest: null, status: 'idle', error: '' })
  }

  /** Dispatch a bubbling keydown, as the browser would from the focused element. */
  async function pressKey(target, key, options) {
    const event = new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...(options || {}),
    })
    await act(async () => {
      target.dispatchEvent(event)
    })
    return event
  }

  /** Type into a React-controlled input the way the browser does. */
  async function type(element, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      if (element.tagName === 'TEXTAREA') setter.call(element, value)
      else inputSetter.call(element, value)
      element.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  }

  function editorProps(overrides) {
    const inputActions = {
      calls: [],
      setDraft(text) {
        this.calls.push({ op: 'setDraft', text })
      },
      submit() {
        this.calls.push({ op: 'submit' })
      },
      persistDraft() {
        this.calls.push({ op: 'persistDraft' })
      },
      focus() {
        this.calls.push({ op: 'focus' })
      },
    }
    return {
      runtime: runtimeStub(),
      sessionId: 'session-1',
      inputActions,
      ...(overrides || {}),
    }
  }

  // ---------------------------------------------------------------- tests

  test('typing updates the draft and autosaves it locally', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const textarea = view.container.querySelector('.ps-ta')
    assert.ok(textarea, 'the editor renders a textarea')
    await type(textarea, '写点什么')
    assert.equal(textarea.value, '写点什么')
    await new Promise((done) => setTimeout(done, 450))
    const saved = JSON.parse(localStorage.getItem('dsh-prompt-stash/draft/session-1'))
    assert.equal(saved.body, '写点什么')
    await view.unmount()
  })

  test('Ctrl+Enter replaces the composer draft and never takes focus', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, '# 提示\n把这段话注入')
    textarea.focus()
    assert.equal(document.activeElement, textarea)

    const event = await pressKey(textarea, 'Enter', { ctrlKey: true })
    assert.equal(event.defaultPrevented, true, 'the shortcut must be consumed')

    const ops = props.inputActions.calls.map((call) => call.op)
    assert.deepEqual(ops.includes('setDraft'), true, 'inject replaces the draft')
    assert.equal(ops.includes('submit'), false, 'inject must not send')
    assert.equal(ops.includes('focus'), false, 'inject must not touch focus')
    const draft = props.inputActions.calls.find((call) => call.op === 'setDraft')
    assert.equal(draft.text, '# 提示\n把这段话注入')
    assert.equal(document.activeElement, textarea, 'focus stays in the editor')
    await view.unmount()
  })

  test('Ctrl+Enter on an empty draft does nothing', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const textarea = view.container.querySelector('.ps-ta')
    await pressKey(textarea, 'Enter', { ctrlKey: true })
    assert.deepEqual(props.inputActions.calls, [])
    await view.unmount()
  })

  test('Ctrl+S saves to the host route with the session and workspace attached', async () => {
    resetDrafts()
    calls.length = 0
    libraryState = freshLibrary()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const title = view.container.querySelector('.ps-ed-title')
    await type(title, '第一稿')
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, '正文内容')
    await pressKey(textarea, 's', { ctrlKey: true })
    await new Promise((done) => setTimeout(done, 30))

    const save = calls.find((call) => call.action === 'save')
    assert.ok(save, 'Ctrl+S must call the save action')
    assert.equal(save.payload.title, '第一稿')
    assert.equal(save.payload.body, '正文内容')
    assert.equal(save.payload.kind, 'note')
    assert.equal(save.payload.session.title, '会话一')
    assert.equal(save.payload.workspace.name, 'project')
    // the document now carries the id the host returned
    const status = view.container.querySelector('.ps-status')
    assert.match(status.textContent, /已保存/)
    await view.unmount()
  })

  test('the send button inserts then submits, and send has no shortcut', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, '直接发出去')

    // No shortcut: Ctrl+Enter is insert only (covered above); nothing else sends.
    await pressKey(textarea, 'Enter', { ctrlKey: true, shiftKey: true })
    assert.equal(props.inputActions.calls.some((call) => call.op === 'submit'), false)

    const send = [...view.container.querySelectorAll('button')].find((button) => button.className.includes('ps-btn-send'))
    assert.ok(send, 'the send button exists')
    assert.equal(send.getAttribute('title'), '发送')
    await act(async () => {
      send.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const ops = props.inputActions.calls.map((call) => call.op)
    assert.deepEqual(ops.slice(-3), ['setDraft', 'persistDraft', 'submit'])
    const draft = props.inputActions.calls.filter((call) => call.op === 'setDraft').pop()
    assert.equal(draft.text, '直接发出去')
    await view.unmount()
  })

  test('without a composer the editor disables insert and send', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', library: freshLibrary(), openRequest: null })
    const view = await mount(h(ui.EditorPanel, { runtime: runtimeStub(), sessionId: 'session-1' }))
    const buttons = [...view.container.querySelectorAll('button')]
    const insert = buttons.find((button) => button.textContent.includes('注入'))
    const send = buttons.find((button) => button.className.includes('ps-btn-send'))
    assert.equal(insert.disabled, true)
    assert.equal(send.disabled, true)
    await view.unmount()
  })

  test('opening a stored document from the archive targets the editor', async () => {
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'time', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const runtime = runtimeStub()
    const view = await mount(h(ui.ArchivePanel, { runtime }))
    const card = view.container.querySelector('.ps-card')
    assert.ok(card, 'the archive renders a card')
    await act(async () => {
      card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(runtime.state.opened, [{ kind: 'note', id: 'n_alpha01' }])
    await view.unmount()
  })

  test('the archive offers no delete affordance, only creation', async () => {
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'session', sortBy: 'title', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const runtime = runtimeStub()
    const view = await mount(h(ui.ArchivePanel, { runtime }))
    const buttons = [...view.container.querySelectorAll('button')]
    const labels = buttons.map((button) => `${button.textContent} ${button.getAttribute('title') || ''}`)
    assert.equal(labels.some((label) => /删除|delete|remove/iu.test(label)), false)
    assert.ok(labels.some((label) => label.includes('新建草稿')))
    assert.ok(labels.some((label) => label.includes('新建模板')))
    assert.ok(labels.some((label) => label.includes('打开存档文件夹')))

    // "new draft" asks the editor for a blank document for the current session.
    const draftButton = buttons.find((button) => button.textContent.includes('新建草稿'))
    await act(async () => {
      draftButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(runtime.state.opened.includes('blank'), true)
    const request = M.store.get().openRequest
    assert.equal(request.blank, true)
    assert.equal(request.kind, 'note')
    await view.unmount()
  })

  test('a new template from the archive opens a blank template draft', async () => {
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const runtime = runtimeStub()
    const view = await mount(h(ui.ArchivePanel, { runtime }))
    const button = [...view.container.querySelectorAll('button')].find((item) => item.textContent.includes('新建模板'))
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(M.store.get().openRequest.kind, 'template')
    await view.unmount()
  })

  test('the open-folder button reports failures instead of swallowing them', async () => {
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const action = String(url).split('/prompt-stash/api/')[1] || ''
      if (action === 'openFolder') {
        return { ok: false, status: 400, json: async () => ({ ok: false, error: { code: 'failed', message: 'explorer missing' } }) }
      }
      return realFetch(url, init)
    }
    const view = await mount(h(ui.ArchivePanel, { runtime: runtimeStub() }))
    const button = [...view.container.querySelectorAll('button')].find((item) => item.textContent.includes('打开存档文件夹'))
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await new Promise((done) => setTimeout(done, 20))
    const toast = view.container.querySelector('.ps-toast')
    assert.ok(toast, 'a failure surfaces as a toast')
    assert.match(toast.textContent, /打不开存档文件夹/)
    globalThis.fetch = realFetch
    await view.unmount()
  })

  test('a dirty draft is not replaced silently: the inline confirm gates it', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    const props = editorProps()
    const view = await mount(h(ui.EditorPanel, props))
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, '还没保存的内容')

    await act(async () => {
      M.requestOpen({ kind: 'note', id: 'n_alpha01', blank: false, sessionId: 'session-1' })
    })
    const bar = view.container.querySelector('.ps-confirm')
    assert.ok(bar, 'a dirty draft asks before being replaced')
    assert.equal(textarea.value, '还没保存的内容', 'nothing was replaced yet')

    const keep = [...bar.querySelectorAll('button')].find((button) => button.textContent.includes('继续写'))
    await act(async () => {
      keep.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(view.container.querySelector('.ps-confirm'), null, 'the bar closes on cancel')
    assert.equal(textarea.value, '还没保存的内容', 'the draft survived')

    // Ask again and accept this time; the stored body replaces it.
    await act(async () => {
      M.requestOpen({ kind: 'note', id: 'n_alpha01', blank: false, sessionId: 'session-1' })
    })
    const bar2 = view.container.querySelector('.ps-confirm')
    assert.ok(bar2)
    const open = [...bar2.querySelectorAll('button')].find((button) => button.textContent.includes('放弃并打开'))
    await act(async () => {
      open.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await new Promise((done) => setTimeout(done, 30))
    assert.equal(textarea.value, '请审阅：', 'the requested body is now in the editor')
    assert.equal(view.container.querySelector('.ps-confirm'), null)
    await view.unmount()
  })

  test('a clean draft adopts a requested document immediately', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    const view = await mount(h(ui.EditorPanel, editorProps()))
    const textarea = view.container.querySelector('.ps-ta')
    await act(async () => {
      M.requestOpen({ kind: 'note', id: 'n_alpha01', blank: false, sessionId: 'session-1' })
    })
    await new Promise((done) => setTimeout(done, 30))
    assert.equal(view.container.querySelector('.ps-confirm'), null)
    assert.equal(textarea.value, '请审阅：')
    await view.unmount()
  })

  test('two quick Ctrl+S presses produce one save, not two notes', async () => {
    resetDrafts()
    calls.length = 0
    libraryState = freshLibrary()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      await new Promise((done) => setTimeout(done, 60))
      return realFetch(url, init)
    }
    const view = await mount(h(ui.EditorPanel, editorProps()))
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, '只应保存一次')
    await pressKey(textarea, 's', { ctrlKey: true })
    await pressKey(textarea, 's', { ctrlKey: true })
    await new Promise((done) => setTimeout(done, 220))
    const saves = calls.filter((call) => call.action === 'save')
    assert.equal(saves.length, 1, 'the second press must be ignored while the first is in flight')
    globalThis.fetch = realFetch
    await view.unmount()
  })

  test('a template card mints a draft instead of opening the template', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const runtime = runtimeStub()
    const view = await mount(h(ui.ArchivePanel, { runtime }))
    const templateCard = [...view.container.querySelectorAll('.ps-card')].find((card) =>
      card.textContent.includes('审稿模板'),
    )
    assert.ok(templateCard, 'the template card is rendered')
    const button = [...templateCard.querySelectorAll('button')].find((item) => item.textContent.includes('用模板新建'))
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(runtime.state.opened, [{ template: 't_beta02' }])
    await view.unmount()
  })

  test('typing during an in-flight save is not overwritten by the save result', async () => {
    resetDrafts()
    calls.length = 0
    libraryState = freshLibrary()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const action = String(url).split('/prompt-stash/api/')[1] || ''
      if (action === 'save') await new Promise((done) => setTimeout(done, 90))
      return realFetch(url, init)
    }
    const view = await mount(h(ui.EditorPanel, editorProps()))
    const textarea = view.container.querySelector('.ps-ta')
    await type(textarea, 'A')
    await pressKey(textarea, 's', { ctrlKey: true })
    // Typed while the save request is still in flight.
    await type(textarea, 'A plus B typed during save')
    await new Promise((done) => setTimeout(done, 300))
    assert.equal(textarea.value, 'A plus B typed during save', 'the newer keystrokes survive the save')
    const localDraft = localStorage.getItem('dsh-prompt-stash/draft/session-1')
    assert.ok(localDraft !== null, 'the unsaved newer text is still kept as a draft')
    assert.equal(JSON.parse(localDraft).body, 'A plus B typed during save')
    globalThis.fetch = realFetch
    await view.unmount()
  })

  test('pressing a key on the template button does not trigger the card', async () => {
    resetDrafts()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const runtime = runtimeStub()
    const view = await mount(h(ui.ArchivePanel, { runtime }))
    const templateCard = [...view.container.querySelectorAll('.ps-card')].find((card) =>
      card.textContent.includes('审稿模板'),
    )
    const button = [...templateCard.querySelectorAll('button')].find((item) => item.textContent.includes('用模板新建'))
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => {
      button.dispatchEvent(event)
    })
    // The card's own handler must ignore keys that started on the button.
    assert.deepEqual(runtime.state.opened, [], 'the card did not open the template')
    assert.equal(event.defaultPrevented, false, 'the button key is not swallowed')
    await view.unmount()
  })

  test('the filled buttons keep readable text on their own fill', async () => {
    // Regression: '.ps-root button { color: inherit }' (0,1,1) used to beat
    // '.ps-btn-primary { color: ... }' (0,1,0), painting dark text on the dark
    // primary fill. The reset is now zero-specificity and the filled buttons are
    // pinned one level up; this asserts the winning declaration.
    resetDrafts()
    M.store.set({ status: 'ready', error: '', dir: 'stash', library: freshLibrary() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const archive = await mount(h(ui.ArchivePanel, { runtime: runtimeStub() }))
    const primary = archive.container.querySelector('.ps-btn-primary')
    assert.ok(primary, 'the primary button is rendered')
    const primaryColor = String(window.getComputedStyle(primary).color)
    assert.match(
      primaryColor,
      /label-primary-foreground|#fff|rgb(255, 255, 255)/u,
      `primary fill text colour resolved to "${primaryColor}"`,
    )
    const primaryBackground = String(window.getComputedStyle(primary).backgroundColor)
    assert.notEqual(primaryColor, primaryBackground, 'text and fill must not be the same colour')
    await archive.unmount()

    const editor = await mount(h(ui.EditorPanel, editorProps()))
    const send = editor.container.querySelector('.ps-btn-send')
    assert.ok(send, 'the send button is rendered')
    // Send is deliberately outlined rather than filled: text must contrast with
    // the surface, not with a fill.
    const sendColor = String(window.getComputedStyle(send).color)
    const sendBackground = String(window.getComputedStyle(send).backgroundColor)
    assert.notEqual(sendColor, sendBackground, 'send text must contrast with its background')
    assert.doesNotMatch(sendColor, /255, 255, 255|#fff/u, 'send is not a filled white-on-brand button')
    await editor.unmount()
  })
}
