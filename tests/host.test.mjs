/**
 * Host-layer tests: the file-backed stash and its fenced JSON route, exercised
 * through a fake Cordis context — no running Harness, no browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOST = await import('../index.js')

/** A context with just enough surface for `apply`: effects, `get`, and a route table. */
function fakeContext(options) {
  const services = { connection: { requestRejection: () => undefined }, ...(options || {}) }
  const routes = []
  return {
    routes,
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    get(name) {
      return services[name]
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => undefined
      },
    },
  }
}

/** A request body as the web server hands it over. */
function mockRequest(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** A response recorder. */
function mockResponse() {
  return {
    status: 0,
    headers: {},
    text: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.text = text
    },
  }
}

/** One API round trip against a mounted plugin. */
async function call(ctx, action, body) {
  const route = ctx.routes[0]
  assert.ok(route, 'the plugin must register its route')
  const res = mockResponse()
  await route.handler(mockRequest('POST', `/prompt-stash/api/${action}`, body), res)
  const parsed = JSON.parse(res.text)
  return { status: res.status, body: parsed }
}

/** Remove a temp tree, retrying past the Windows sharing window of the plugin's own warm-up writes. */
async function rmWithRetry(target) {
  for (let attempt = 0, delay = 30; attempt < 8; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 7) throw error
      await new Promise((done) => setTimeout(done, delay))
      delay = Math.min(delay * 2, 300)
    }
  }
}

async function withStash(run, options) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-prompt-stash-test-'))
  try {
    const ctx = fakeContext(options && options.services)
    HOST.apply(ctx, { dir })
    await run({ ctx, dir })
  } finally {
    await rmWithRetry(dir)
  }
}

test('the bundle exposes the one supported Host shape', () => {
  assert.equal(typeof HOST.apply, 'function')
  assert.deepEqual(HOST.inject, ['webServer', 'connection'])
  assert.equal(HOST.API_PREFIX, '/prompt-stash/api')
})

test('the global harness home prefers the boot-resolved profile context', () => {
  const ctx = { get: (name) => (name === 'profileContext' ? { home: 'D:/resolved-home' } : undefined) }
  assert.equal(HOST.dshHomeOf(ctx, { DSH_HOME: 'E:/env-home' }), 'D:\\resolved-home')
  assert.equal(HOST.dshHomeOf({ get: () => undefined }, { DSH_HOME: 'E:/env-home' }, 'C:/Users/x'), 'E:\\env-home')
  assert.equal(HOST.dshHomeOf(undefined, {}, 'C:/Users/x'), join('C:/Users/x', '.dsh'))
  // a throwing service must not take the route down with it
  assert.equal(HOST.dshHomeOf({ get() { throw new Error('late mount') } }, {}, 'C:/Users/x'), join('C:/Users/x', '.dsh'))
})

test('the global harness home resolves from DSH_HOME, then the profile dir, then ~/.dsh', () => {
  assert.equal(HOST.resolveDshHome({ DSH_HOME: 'D:/harness' }, 'C:/Users/x'), 'D:\\harness')
  assert.equal(
    HOST.resolveDshHome({ DSH_PROFILE_DIR: 'C:/Users/x/.dsh/profiles/desktop' }, 'C:/Users/x'),
    'C:\\Users\\x\\.dsh',
  )
  assert.equal(HOST.resolveDshHome({}, 'C:/Users/x'), join('C:/Users/x', '.dsh'))
  // `~` expands against the OS home, not the workspace.
  assert.equal(HOST.expandHome('~/data', '/home/u'), join('/home/u', 'data'))
})

test('ids are filename-safe and carry their kind', () => {
  const note = HOST.newId('note')
  const template = HOST.newId('template')
  assert.match(note, /^n_[a-z0-9]+$/u)
  assert.match(template, /^t_[a-z0-9]+$/u)
  assert.ok(HOST.isSafeId(note))
  assert.ok(HOST.isSafeId(template))
  for (const bad of ['', '../etc/passwd', 'n_', 'x_abc123', 'n_ABC!', null, 12]) {
    assert.equal(HOST.isSafeId(bad), false, String(bad))
  }
})

test('title, excerpt, tags and colour normalisation are total', () => {
  assert.equal(HOST.deriveTitle('# 标题\n正文'), '标题')
  assert.equal(HOST.deriveTitle('', '兜底'), '兜底')
  assert.equal(HOST.excerptOf('```\ncode\n```\n# 标题后正文'), '标题后正文')
  assert.deepEqual(HOST.normalizeTags([' a ', 'A', '', 'b', 'x'.repeat(30)]), ['a', 'b'])
  assert.deepEqual(HOST.normalizeTags('nope'), [])
  assert.equal(HOST.normalizeColor('#ABC'), '#aabbcc')
  assert.equal(HOST.normalizeColor('BLUE'), 'blue')
  assert.equal(HOST.normalizeColor('nope', 'slate'), 'slate')
  assert.equal(HOST.clampBody('x'.repeat(10)).length, 10)
  assert.equal(HOST.clampBody('x'.repeat(600 * 1024)).length, 512 * 1024)
})

test('an empty stash answers a valid library and creates its directories', async () => {
  await withStash(async ({ ctx, dir }) => {
    const { status, body } = await call(ctx, 'library', {})
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.dir, dir)
    assert.deepEqual(body.library.notes, [])
    assert.deepEqual(body.library.templates, [])
    assert.deepEqual(body.library.settings, { ...HOST.DEFAULT_SETTINGS })
    assert.ok((await stat(join(dir, 'notes'))).isDirectory())
    assert.ok((await stat(join(dir, 'templates'))).isDirectory())
  })
})

test('save creates a note on disk, and a second save updates it in place', async () => {
  await withStash(async ({ ctx, dir }) => {
    const first = await call(ctx, 'save', {
      kind: 'note',
      title: '第一稿',
      body: '# 提示\n写点东西',
      color: '#4d6bfe',
      tags: ['开发'],
      session: { id: 's1', title: '会话一' },
      workspace: { id: '/w', name: '项目', path: '/w' },
    })
    assert.equal(first.status, 200)
    const entry = first.body.entry
    assert.match(entry.id, /^n_/u)
    assert.equal(entry.title, '第一稿')
    assert.equal(entry.color, '#4d6bfe')
    assert.deepEqual(entry.tags, ['开发'])
    assert.equal(entry.session.title, '会话一')
    assert.equal(entry.lines, 2)
    assert.ok(entry.excerpt.includes('写点东西'))
    assert.equal(entry.createdAt, entry.updatedAt)

    const bodyOnDisk = await readFile(join(dir, 'notes', `${entry.id}.md`), 'utf8')
    assert.equal(bodyOnDisk, '# 提示\n写点东西')

    const second = await call(ctx, 'save', { kind: 'note', id: entry.id, title: '改过', body: '短' })
    assert.equal(second.body.entry.id, entry.id)
    assert.equal(second.body.entry.title, '改过')
    assert.equal(second.body.entry.createdAt, entry.createdAt)
    assert.notEqual(second.body.entry.updatedAt, entry.updatedAt)
    assert.equal(second.body.library.notes.length, 1)
    // the session reference survives an update that does not repeat it
    assert.equal(second.body.entry.session.title, '会话一')
    // no temp file survives an atomic write
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), [])
  })
})

test('save without a title derives one from the first line', async () => {
  await withStash(async ({ ctx }) => {
    const { body } = await call(ctx, 'save', { kind: 'note', body: '## 用标题当名字\n正文' })
    assert.equal(body.entry.title, '用标题当名字')
  })
})

test('read returns the markdown body; an unknown id is empty, not an error', async () => {
  await withStash(async ({ ctx }) => {
    const saved = await call(ctx, 'save', { kind: 'note', title: 'a', body: '内容' })
    const read = await call(ctx, 'read', { kind: 'note', id: saved.body.entry.id })
    assert.equal(read.body.body, '内容')
    const missing = await call(ctx, 'read', { kind: 'note', id: HOST.newId('note') })
    assert.equal(missing.body.body, '')
    const traversal = await call(ctx, 'read', { kind: 'note', id: '../library' })
    assert.equal(traversal.status, 400)
    assert.equal(traversal.body.ok, false)
  })
})

test('metadata updates leave the body alone', async () => {
  await withStash(async ({ ctx }) => {
    const saved = await call(ctx, 'save', { kind: 'note', title: '旧名', body: '正文' })
    const id = saved.body.entry.id
    const meta = await call(ctx, 'meta', { kind: 'note', id, patch: { title: '新名', color: '#3f9d6d', tags: ['x'] } })
    assert.equal(meta.body.entry.title, '新名')
    assert.equal(meta.body.entry.color, '#3f9d6d')
    assert.deepEqual(meta.body.entry.tags, ['x'])
    const read = await call(ctx, 'read', { kind: 'note', id })
    assert.equal(read.body.body, '正文')
  })
})

test('settings merge instead of replacing', async () => {
  await withStash(async ({ ctx }) => {
    const first = await call(ctx, 'settings', { patch: { groupBy: 'color', filters: { tags: ['a'] } } })
    assert.equal(first.body.settings.groupBy, 'color')
    assert.equal(first.body.settings.sortBy, HOST.DEFAULT_SETTINGS.sortBy)
    assert.deepEqual(first.body.settings.filters.tags, ['a'])
    const second = await call(ctx, 'settings', { patch: { sortBy: 'title' } })
    assert.equal(second.body.settings.groupBy, 'color')
    assert.equal(second.body.settings.sortBy, 'title')
    assert.deepEqual(second.body.settings.filters.tags, ['a'])
    const library = await call(ctx, 'library', {})
    assert.equal(library.body.library.settings.groupBy, 'color')
  })
})

test('a draft can be created from a template and remembers its source', async () => {
  await withStash(async ({ ctx }) => {
    const template = await call(ctx, 'save', {
      kind: 'template',
      title: '审稿模板',
      body: '请审阅：',
      color: '#c2653f',
      tags: ['模板'],
    })
    const draft = await call(ctx, 'fromTemplate', {
      id: template.body.entry.id,
      session: { id: 's2', title: '会话二' },
    })
    assert.equal(draft.status, 200)
    assert.equal(draft.body.entry.kind, 'note')
    assert.equal(draft.body.entry.title, '审稿模板')
    assert.equal(draft.body.body, '请审阅：')
    assert.equal(draft.body.entry.color, '#c2653f')
    assert.deepEqual(draft.body.entry.tags, ['模板'])
    assert.equal(draft.body.entry.templateId, template.body.entry.id)
    const body = await call(ctx, 'read', { kind: 'note', id: draft.body.entry.id })
    assert.equal(body.body.body, '请审阅：')
  })
})

test('an oversized client report is truncated instead of filling the disk', async () => {
  await withStash(async ({ ctx, dir }) => {
    const huge = { note: 'x'.repeat(80 * 1024) }
    const result = await call(ctx, 'report', { report: huge })
    assert.equal(result.status, 200)
    const written = JSON.parse(await readFile(join(dir, 'diagnostics.json'), 'utf8'))
    assert.equal(written.latest.report.truncated, true)
    assert.ok(written.latest.report.bytes > 32 * 1024)
    assert.equal(typeof written.latest.report.head, 'string')
    assert.ok(written.latest.report.head.length <= 32 * 1024)
  })
})

test('concurrent reports keep their order instead of clobbering each other', async () => {
  await withStash(async ({ ctx, dir }) => {
    await call(ctx, 'report', { report: { seq: 1 } })
    await call(ctx, 'report', { report: { seq: 2 } })
    await call(ctx, 'report', { report: { seq: 3 } })
    const written = JSON.parse(await readFile(join(dir, 'diagnostics.json'), 'utf8'))
    assert.deepEqual(written.history.map((row) => row.report.seq), [1, 2, 3])
    assert.equal(written.latest.report.seq, 3)
  })
})

test('there is no delete surface: the action refuses and no helper exists', async () => {
  await withStash(async ({ ctx, dir }) => {
    const saved = await call(ctx, 'save', { kind: 'note', title: '留着', body: 'x' })
    for (const action of ['delete', 'remove', 'trash', 'destroy']) {
      const result = await call(ctx, action, { kind: 'note', id: saved.body.entry.id })
      assert.equal(result.status, 400, action)
      assert.equal(result.body.error.code, 'unknown-action')
    }
    assert.equal(typeof HOST.deleteEntry, 'undefined')
    assert.equal(typeof HOST.removeEntry, 'undefined')
    const files = await readdir(join(dir, 'notes'))
    assert.deepEqual(files, [`${saved.body.entry.id}.md`])
  })
})

test('unknown actions and malformed bodies fail as JSON, never as a crash', async () => {
  await withStash(async ({ ctx, dir }) => {
    const unknown = await call(ctx, 'nope', {})
    assert.equal(unknown.status, 400)
    assert.equal(unknown.body.ok, false)
    const route = ctx.routes[0]
    const res = mockResponse()
    await route.handler(mockRequest('POST', '/prompt-stash/api/save', undefined), res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.text).ok, true) // empty body = an empty draft
    const bad = mockResponse()
    const badReq = { method: 'POST', url: '/prompt-stash/api/save', async *[Symbol.asyncIterator]() { yield Buffer.from('{oops') } }
    await route.handler(badReq, bad)
    assert.equal(bad.status, 400)
    assert.equal(JSON.parse(bad.text).error.code, 'bad-json')
    const wrongMethod = mockResponse()
    await route.handler({ method: 'DELETE', url: '/prompt-stash/api/save' }, wrongMethod)
    assert.equal(wrongMethod.status, 405)
    assert.ok((await stat(dir)).isDirectory())
  })
})

test('the connection fence rejects a request the transport distrusts', async () => {
  await withStash(
    async ({ ctx }) => {
      const res = mockResponse()
      await ctx.routes[0].handler(mockRequest('POST', '/prompt-stash/api/library', {}), res)
      assert.equal(res.status, 403)
      assert.equal(JSON.parse(res.text).error.code, 'forbidden')
    },
    { services: { connection: { requestRejection: () => ({ reason: 'untrusted' }) } } },
  )
  await withStash(
    async ({ ctx }) => {
      const res = mockResponse()
      await ctx.routes[0].handler(mockRequest('POST', '/prompt-stash/api/library', {}), res)
      assert.equal(res.status, 200)
    },
    { services: { connection: { requestRejection: () => undefined } } },
  )
})

test('a corrupt library file degrades to an empty stash instead of failing the route', async () => {
  await withStash(async ({ ctx, dir }) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'library.json'), '{not json', 'utf8')
    const result = await call(ctx, 'library', {})
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.library.notes, [])
    const saved = await call(ctx, 'save', { kind: 'note', title: 'a', body: 'b' })
    assert.equal(saved.status, 200)
    const raw = JSON.parse(await readFile(join(dir, 'library.json'), 'utf8'))
    assert.equal(raw.notes.length, 1)
    assert.equal(raw.version, 1)
  })
})

test('a custom config directory wins over the harness home', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-prompt-stash-cfg-'))
  try {
    const ctx = fakeContext({})
    HOST.apply(ctx, { dir })
    const result = await call(ctx, 'library', {})
    assert.equal(result.body.dir, dir)
  } finally {
    await rmWithRetry(dir)
  }
})

test('the client can report what it registered, into the stash directory', async () => {
  await withStash(async ({ ctx, dir }) => {
    const first = { packageId: 'dsh-prompt-stash', tabType: 'registered', command: 'registered' }
    const result = await call(ctx, 'report', { report: first })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    const written = JSON.parse(await readFile(join(dir, 'diagnostics.json'), 'utf8'))
    assert.equal(written.latest.report.tabType, 'registered')
    assert.ok(typeof written.latest.receivedAt === 'string')

    // A later report must not erase the earlier one: the history keeps both.
    const second = { packageId: 'dsh-prompt-stash', smoke: 'timer-fired' }
    await call(ctx, 'report', { report: second })
    const again = JSON.parse(await readFile(join(dir, 'diagnostics.json'), 'utf8'))
    assert.equal(again.latest.report.smoke, 'timer-fired')
    assert.equal(again.history.length, 2)
    assert.equal(again.history[0].report.tabType, 'registered')

    // The read-back action answers the whole document.
    const read = await call(ctx, 'diagnostics', {})
    assert.equal(read.body.diagnostics.history.length, 2)
  })
})
