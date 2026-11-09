/**
 * A server-render smoke test for the Client UI.
 *
 * Not a substitute for looking at the running page: effects (timers, storage,
 * fetches) do not run under `renderToStaticMarkup`. What it does exercise is the
 * real React components, hooks, translator, grouping and prop plumbing, in a
 * Node process, with no browser and no Harness.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hints, profileModules } from './env.mjs'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      storage.set(key, String(value))
    },
    removeItem: (key) => {
      storage.delete(key)
    },
  },
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.document = { baseURI: 'http://127.0.0.1:9999/editor/', hidden: false }
globalThis.location = { href: 'http://127.0.0.1:9999/editor/' }

let React
let ReactDOMServer
if (profileModules === undefined) {
  test('client UI server render', { skip: hints.profile }, () => {})
} else {
  try {
    React = (await import(pathToFileURL(join(profileModules, 'react', 'index.js')).href)).default
    ReactDOMServer = (await import(pathToFileURL(join(profileModules, 'react-dom', 'server.js')).href)).default
  } catch (error) {
    test('client UI server render', { skip: `${hints.profile} (${error.message})` }, () => {})
  }
}

if (React !== undefined && ReactDOMServer !== undefined) {
  await import('../src/client/model.js')
  await import('../src/client/ui.js')
  const M = globalThis.__PromptStashModel
  const ui = globalThis.__PromptStashUI.createUI(React)

  /** A runtime stub with the same surface the bundle supplies. */
  function runtimeStub(overrides) {
    const t = M.makeTranslator(M.ZH)
    const state = { sessionId: 'session-1', language: 'zh', opened: [], panel: '', toasts: [] }
    const runtime = {
      state,
      translate: () => ({ t, lang: state.language }),
      service: () => undefined,
      currentSessionId: () => state.sessionId,
      describeSession: (sessionId) => ({
        session: { id: sessionId, title: '会话一', cwd: 'C:\\work\\project' },
        workspace: { id: 'C:\\work\\project', name: 'project', path: 'C:\\work\\project' },
      }),
      openEditorTab: () => {
        state.opened.push('tab')
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
      ...overrides,
    }
    return runtime
  }

  function library() {
    const now = new Date('2026-11-05T10:00:00+08:00').toISOString()
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
          session: { id: 'session-1', title: '会话一' },
          workspace: { id: 'C:\\work\\project', name: 'project', path: 'C:\\work\\project' },
        },
      ],
      templates: [
        {
          id: 't_beta02',
          title: '审稿模板',
          color: 'rose',
          tags: ['模板'],
          createdAt: now,
          updatedAt: now,
          excerpt: '请审阅：',
        },
      ],
      settings: {},
    }
  }

  /** Render one component to a static string, catching React's own warnings as failures. */
  function render(element) {
    const errors = []
    const original = console.error
    console.error = (...args) => errors.push(args.join(' '))
    try {
      const html = ReactDOMServer.renderToStaticMarkup(element)
      assert.deepEqual(errors.filter((line) => !line.includes('useLayoutEffect')), [])
      return html
    } finally {
      console.error = original
    }
  }

  test('the archive page renders its controls, groups and cards', () => {
    M.store.set({ status: 'ready', error: '', dir: 'C:\\Users\\me\\.dsh\\prompt-stash', library: library() })
    M.store.set({ view: { groupBy: 'time', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    const html = render(React.createElement(ui.ArchivePanel, { runtime: runtimeStub() }))
    assert.match(html, /提示词稿箱/)
    assert.match(html, /这里放写了一半的提示词/)
    assert.match(html, /新建草稿/)
    assert.match(html, /新建模板/)
    assert.match(html, /打开存档文件夹/)
    assert.match(html, /写一个插件/)
    assert.match(html, /审稿模板/)
    assert.match(html, /开发/)
    // grouping headers exist and carry counts
    assert.match(html, /ps-grouphead/)
    assert.match(html, /ps-card/)
    // the path is shown and the no-delete promise is stated
    assert.match(html, /prompt-stash/)
    assert.match(html, /不做删除/)
    // no delete affordance anywhere in the archive markup
    assert.doesNotMatch(html, /删除(?!，)/)
    assert.doesNotMatch(html, /delete/iu)
  })

  test('the archive honours scope, query and empty states', () => {
    M.store.set({ library: library() })
    M.store.set({ view: { groupBy: 'none', sortBy: 'title', scope: 'template', query: '', filters: { colors: [], tags: [] } } })
    let html = render(React.createElement(ui.ArchivePanel, { runtime: runtimeStub() }))
    assert.match(html, /审稿模板/)
    assert.doesNotMatch(html, /写一个插件/)

    M.store.set({ view: { groupBy: 'time', sortBy: 'updated', scope: 'all', query: '不存在的关键词', filters: { colors: [], tags: [] } } })
    html = render(React.createElement(ui.ArchivePanel, { runtime: runtimeStub() }))
    assert.match(html, /没有符合筛选条件的稿子/)

    M.store.set({ library: { version: 1, notes: [], templates: [], settings: {} } })
    M.store.set({ view: { groupBy: 'time', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } } })
    html = render(React.createElement(ui.ArchivePanel, { runtime: runtimeStub() }))
    assert.match(html, /稿箱还是空的/)
  })

  test('a failed load offers a retry instead of an empty archive', () => {
    M.store.set({ status: 'error', error: 'boom', library: { version: 1, notes: [], templates: [], settings: {} } })
    const html = render(React.createElement(ui.ArchivePanel, { runtime: runtimeStub() }))
    assert.match(html, /读不到稿箱：boom/)
    assert.match(html, /重试/)
    M.store.set({ status: 'ready', error: '' })
  })

  test('the editor renders title, body, tags and the three actions with their shortcuts', () => {
    M.store.set({ status: 'ready', error: '', library: library() })
    const received = { draft: undefined, submitted: 0 }
    const inputActions = {
      setDraft: (text) => {
        received.draft = text
      },
      submit: () => {
        received.submitted += 1
      },
      persistDraft: () => undefined,
    }
    storage.clear()
    const html = render(
      React.createElement(ui.EditorPanel, {
        runtime: runtimeStub(),
        sessionId: 'session-1',
        inputActions,
      }),
    )
    assert.match(html, /ps-editor/)
    assert.match(html, /给这一稿起个名字/)
    assert.match(html, /在这里写提示词/)
    assert.match(html, /Ctrl\+S/)
    assert.match(html, /Ctrl\+↵/)
    assert.match(html, /保存/)
    assert.match(html, /注入/)
    assert.match(html, /发送/)
    assert.match(html, /会话一/)
    // the inject and send buttons exist exactly once each, and send carries no shortcut badge
    assert.equal((html.match(/class="ps-btn ps-btn-send/gu) || []).length, 1)
    // The save button shows its shortcut; the send button must not.
    const sendButton = /<button[^>]*ps-btn-send[^>]*>([\s\S]*?)<\/button>/u.exec(html)
    assert.ok(sendButton, 'the send button is in the markup')
    assert.doesNotMatch(sendButton[1], /Ctrl/u, 'send carries no shortcut badge')
    assert.equal(received.submitted, 0, 'rendering must never send')
    assert.equal(received.draft, undefined, 'rendering must never inject')
  })

  test('the editor starts from the unsaved local draft of its session', () => {
    storage.clear()
    M.writeLocalDraft('session-9', {
      id: '',
      kind: 'note',
      title: '本地草稿',
      body: '# 还没保存',
      color: 'green',
      tags: ['临时'],
      dirty: true,
      savedAt: '',
    })
    const html = render(
      React.createElement(ui.EditorPanel, {
        runtime: runtimeStub({ currentSessionId: () => 'session-9' }),
        sessionId: 'session-9',
        inputActions: { setDraft: () => undefined, submit: () => undefined },
      }),
    )
    assert.match(html, /本地草稿/)
    assert.match(html, /还没保存/)
    assert.match(html, /临时/)
  })

  test('without a composer the editor disables insert and send instead of pretending', () => {
    storage.clear()
    const html = render(
      React.createElement(ui.EditorPanel, { runtime: runtimeStub(), sessionId: 'session-1', inputActions: undefined }),
    )
    assert.match(html, /disabled/)
    assert.match(html, /注入/)
    assert.match(html, /发送/)
  })

  test('the rail glyph scales and follows the active state', () => {
    const idle = render(React.createElement(ui.SidebarIcon, { size: 16, active: false }))
    const active = render(React.createElement(ui.SidebarIcon, { size: 28, active: true }))
    assert.match(idle, /<svg[^>]*width="16"/)
    assert.match(active, /<svg[^>]*width="28"/)
    assert.notEqual(idle, active)
  })

  test('markdown renders structure without raw HTML', () => {
    const html = render(
      React.createElement(React.Fragment, null, ui.renderMarkdown('## 标题\n\n**粗** 和 `代码`\n\n- 甲\n- 乙\n\n> 引用\n\n```js\nx = 1\n```\n\n<img src=x onerror=alert(1)>')),
    )
    assert.match(html, /<h2>标题<\/h2>/)
    assert.match(html, /<strong>粗<\/strong>/)
    assert.match(html, /<code>代码<\/code>/)
    assert.match(html, /<li>甲<\/li>/)
    assert.match(html, /<blockquote>引用<\/blockquote>/)
    assert.match(html, /<pre><code>x = 1<\/code><\/pre>/)
    // raw HTML in the source stays inert text
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img/)
  })
}
