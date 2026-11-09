/**
 * Model-layer tests: the pure shaping of the archive, plus the document
 * helpers the editor starts from. No browser, no host.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

await import('../src/client/model.js')
const M = globalThis.__PromptStashModel
const t = M.makeTranslator(M.ZH)
t.lang = 'zh'
const tEn = M.makeTranslator(M.EN)
tEn.lang = 'en'

const NOW = new Date('2026-11-05T12:00:00+08:00').getTime()

function entry(id, patch) {
  return {
    id,
    title: id,
    color: 'slate',
    tags: [],
    createdAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    excerpt: '',
    ...patch,
  }
}

function libraryOf(notes, templates) {
  return { version: 1, notes: notes || [], templates: templates || [], settings: {} }
}

test('translator: placeholders, missing keys, and both languages', () => {
  assert.equal(M.makeTranslator(M.ZH)('charCount', { n: 12 }), '12 字')
  assert.equal(M.makeTranslator(M.EN)('charCount', { n: 12 }), '12 chars')
  assert.equal(M.makeTranslator(M.ZH)('no-such-key'), 'no-such-key')
  assert.equal(M.dictFor('zh-CN'), M.ZH)
  assert.equal(M.dictFor('en-US'), M.EN)
  assert.equal(M.dictFor(''), M.EN)
})

test('titles derive from the first meaningful line and strip markers', () => {
  assert.equal(M.deriveTitle('# 标题\n正文'), '标题')
  assert.equal(M.deriveTitle('\n\n- 列表项\n'), '列表项')
  assert.equal(M.deriveTitle('', '空'), '空')
  assert.equal(M.deriveTitle('   \n  ', '空'), '空')
  assert.equal(M.deriveTitle('x'.repeat(200)).length, 120)
})

test('time formatting is relative where it should be', () => {
  const iso = (ms) => new Date(ms).toISOString()
  assert.equal(M.formatWhen(iso(NOW - 5000), t, NOW), '刚刚')
  assert.equal(M.formatWhen(iso(NOW - 14 * 60 * 1000), t, NOW), '14 分钟前')
  assert.equal(M.formatWhen(iso(NOW - 3 * 60 * 60 * 1000), t, NOW), '3 小时前')
  assert.equal(M.formatWhen(iso(NOW - 26 * 60 * 60 * 1000), t, NOW), '昨天')
  assert.equal(M.formatWhen(iso(NOW - 3 * 24 * 60 * 60 * 1000), t, NOW), '3 天前')
  assert.equal(M.formatWhen('', t, NOW), '')
})

test('time buckets follow local calendar days', () => {
  const iso = (ms) => new Date(ms).toISOString()
  assert.equal(M.timeBucket(iso(NOW), t, NOW).id, 'today')
  assert.equal(M.timeBucket(iso(NOW - 20 * 60 * 60 * 1000), t, NOW).id, 'yesterday')
  assert.equal(M.timeBucket(iso(NOW - 3 * 24 * 60 * 60 * 1000), t, NOW).id, 'week')
  assert.equal(M.timeBucket(iso(NOW - 12 * 24 * 60 * 60 * 1000), t, NOW).id, 'month')
  assert.equal(M.timeBucket(iso(NOW - 60 * 24 * 60 * 60 * 1000), t, NOW).id, 'older')
})

test('scope, query, colour and tag filters compose', () => {
  const library = libraryOf(
    [
      entry('a', { title: '写一个插件', tags: ['开发'], color: '#4d6bfe', excerpt: 'markdown 编辑器' }),
      entry('b', { title: '别的东西', tags: ['杂事'], color: '#3f9d6d' }),
    ],
    [entry('t1', { title: '模板一', tags: ['开发'] })],
  )
  assert.equal(M.filterEntries(library, { scope: 'all' }).length, 3)
  assert.equal(M.filterEntries(library, { scope: 'note' }).length, 2)
  assert.equal(M.filterEntries(library, { scope: 'template' }).length, 1)
  assert.deepEqual(
    M.filterEntries(library, { scope: 'all', query: '插件' }).map((item) => item.id),
    ['a'],
  )
  assert.deepEqual(
    M.filterEntries(library, { scope: 'all', query: 'markdown' }).map((item) => item.id),
    ['a'],
  )
  assert.deepEqual(
    M.filterEntries(library, { scope: 'all', filters: { colors: ['#3f9d6d'], tags: [] } }).map((item) => item.id),
    ['b'],
  )
  assert.deepEqual(
    M.filterEntries(library, { scope: 'all', filters: { colors: [], tags: ['开发'] } }).map((item) => item.id),
    ['a', 't1'],
  )
  // A palette id and its hex are the same colour.
  assert.deepEqual(
    M.filterEntries(library, { scope: 'all', filters: { colors: [M.colorOf('blue')], tags: [] } }).map((item) => item.id),
    ['a'],
  )
})

test('grouping by time sorts buckets and entries newest first', () => {
  const library = libraryOf([
    entry('old', { updatedAt: new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString() }),
    entry('new', { updatedAt: new Date(NOW - 1000).toISOString() }),
    entry('mid', { updatedAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString() }),
  ])
  const groups = M.groupEntries(library, { groupBy: 'time', sortBy: 'updated' }, t, NOW)
  assert.deepEqual(groups.map((group) => group.id), ['today', 'week', 'older'])
  assert.deepEqual(groups[0].entries.map((item) => item.id), ['new'])
  assert.deepEqual(groups[2].entries.map((item) => item.id), ['old'])
})

test('grouping by session, workspace and colour uses the recorded references', () => {
  const library = libraryOf([
    entry('a', { session: { id: 's1', title: '会话一' }, workspace: { id: 'w1', name: '项目甲' }, color: '#4d6bfe' }),
    entry('b', { session: { id: 's1', title: '会话一' }, workspace: { id: 'w2', name: '项目乙' }, color: '#3f9d6d' }),
    entry('c', {}),
  ])
  const bySession = M.groupEntries(library, { groupBy: 'session', sortBy: 'updated' }, t, NOW)
  assert.deepEqual(bySession.map((group) => group.id).sort(), ['none', 's1'])
  const byWorkspace = M.groupEntries(library, { groupBy: 'workspace', sortBy: 'updated' }, t, NOW)
  assert.deepEqual(byWorkspace.map((group) => group.title).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), ['未关联工作区', '项目甲', '项目乙'].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')))
  const byColor = M.groupEntries(library, { groupBy: 'color', sortBy: 'updated' }, t, NOW)
  assert.equal(byColor[0].color, M.PALETTE[0].hex)
  assert.ok(byColor.some((group) => group.color === '#4d6bfe'))
})

test('grouping by tag repeats an entry under every tag and collects the untagged', () => {
  const library = libraryOf([
    entry('a', { tags: ['开发', '写作'] }),
    entry('b', { tags: ['写作'] }),
    entry('c', { tags: [] }),
  ])
  const groups = M.groupEntries(library, { groupBy: 'tag', sortBy: 'updated' }, t, NOW)
  const byId = new Map(groups.map((group) => [group.id, group]))
  assert.deepEqual(byId.get('tag:开发').entries.map((item) => item.id), ['a'])
  assert.deepEqual(byId.get('tag:写作').entries.map((item) => item.id).sort(), ['a', 'b'])
  assert.deepEqual(byId.get('none').entries.map((item) => item.id), ['c'])
})

test('group "none" returns one unnamed group and sorting by title is stable', () => {
  const library = libraryOf([entry('b', { title: '乙' }), entry('a', { title: '甲' }), entry('c', { title: '丙' })])
  const groups = M.groupEntries(library, { groupBy: 'none', sortBy: 'title' }, t, NOW)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].title, '')
  assert.deepEqual(groups[0].entries.map((item) => item.title), ['丙', '甲', '乙'])
})

test('facets count colours and tags across drafts and templates', () => {
  const library = libraryOf(
    [entry('a', { tags: ['x', 'y'] }), entry('b', { tags: ['x'], color: '#3f9d6d' })],
    [entry('t', { tags: ['x'] })],
  )
  assert.deepEqual(M.colorFacets(library).map((item) => [item.hex, item.count]), [
    [M.PALETTE[0].hex, 2],
    ['#3f9d6d', 1],
  ])
  assert.deepEqual(M.tagFacets(library).map((item) => [item.tag, item.count]), [
    ['x', 3],
    ['y', 1],
  ])
  assert.deepEqual(M.scopeCounts(library), { all: 3, note: 2, template: 1 })
})

test('the translator carries its language and the date units follow it', () => {
  assert.equal(M.makeTranslator(M.ZH).lang, 'zh')
  assert.equal(M.makeTranslator(M.EN).lang, 'en')
  assert.equal(M.langOf('zh-CN'), 'zh')
  assert.equal(M.langOf('en-US'), 'en')
  assert.equal(M.langOf(''), 'en')
  const oldDate = new Date('2025-03-04T10:00:00+08:00').getTime()
  assert.equal(M.formatWhen(new Date(oldDate).toISOString(), M.makeTranslator(M.ZH, 'zh'), NOW), '2025年3月4日')
  assert.equal(M.formatWhen(new Date(oldDate).toISOString(), M.makeTranslator(M.EN, 'en'), NOW), '3/4/2025')
  // A colour group header follows the translator's language, not a hard-coded one.
  const library = libraryOf([entry('a', { color: '#4d6bfe' })])
  const zhGroups = M.groupEntries(library, { groupBy: 'color', sortBy: 'updated' }, M.makeTranslator(M.ZH, 'zh'), NOW)
  const enGroups = M.groupEntries(library, { groupBy: 'color', sortBy: 'updated' }, M.makeTranslator(M.EN, 'en'), NOW)
  assert.ok(zhGroups.some((group) => group.title === '蓝'))
  assert.ok(enGroups.some((group) => group.title === 'Blue'))
})

test('document helpers start from a blank draft and map stored entries', () => {
  const blank = M.initialDocument('s1', { session: { id: 's1', title: '会话' } })
  assert.equal(blank.id, '')
  assert.equal(blank.body, '')
  assert.equal(blank.kind, 'note')
  assert.deepEqual(blank.tags, [])
  assert.equal(blank.session.title, '会话')

  const doc = M.documentOf({ id: 'n_abc123', title: '标题', color: '#4d6bfe', tags: ['a'], updatedAt: '2026-01-01T00:00:00Z' }, '正文', 'note')
  assert.deepEqual(doc, {
    id: 'n_abc123',
    kind: 'note',
    title: '标题',
    body: '正文',
    color: '#4d6bfe',
    tags: ['a'],
    session: undefined,
    workspace: undefined,
    dirty: false,
    savedAt: '2026-01-01T00:00:00Z',
  })
})

test('a custom hex colour survives, an unknown value falls back to slate', () => {
  assert.equal(M.colorOf('#A1B2C3'), '#a1b2c3')
  assert.equal(M.colorOf('blue'), '#4d6bfe')
  assert.equal(M.colorOf('not a colour'), 'not a colour')
  assert.equal(M.colorName('#4d6bfe', 'zh'), '蓝')
  assert.equal(M.colorName('#4d6bfe', 'en'), 'Blue')
  assert.equal(M.colorName('#a1b2c3', 'zh'), '#a1b2c3')
})

test('the host route URL is page-relative so a proxy prefix survives', () => {
  const realDocument = globalThis.document
  globalThis.document = { baseURI: 'https://host/dataops/proxy/3080/' }
  try {
    assert.equal(M.routeUrl('library'), 'https://host/dataops/proxy/3080/prompt-stash/api/library')
  } finally {
    globalThis.document = realDocument
  }
  delete globalThis.document
  assert.equal(M.routeUrl('library'), 'http://dsh.internal/prompt-stash/api/library')
})
