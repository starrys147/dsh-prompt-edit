/**
 * 提示词稿箱 / Prompt Stash — model layer.
 *
 * One IIFE that owns, in order: the i18n dictionaries, the colour palette, the
 * pure shaping of the archive (grouping / sorting / filtering), and the live
 * store that talks to the Host route. The UI layer reads this through
 * `globalThis.__PromptStashModel`; the unit tests import this file directly.
 *
 * Everything here is plain browser JavaScript: no imports, no Harness Client
 * package, no framework beyond `fetch` and `localStorage`.
 */
(function () {
  'use strict'

  // --------------------------------------------------------------- i18n

  const ZH = {
    nav: '稿箱',
    panelTitle: '提示词稿箱',
    panelSubtitle: '这里放写了一半的提示词、模板和它们的来处。',
    editorTitle: '提示词',
    editorEmpty: '空稿。直接写，Ctrl+S 存进稿箱。',
    titlePlaceholder: '给这一稿起个名字',
    bodyPlaceholder: '在这里写提示词。支持 Markdown 语法。',
    save: '保存',
    saveAsTemplate: '存为模板',
    inject: '注入',
    send: '发送',
    saved: '已保存',
    saving: '保存中…',
    unsaved: '未保存',
    injected: '已注入输入框',
    sent: '已发送',
    noComposer: '这个会话还没有可用的输入框',
    emptyBody: '稿子是空的',
    tags: '标签',
    addTag: '加标签',
    tagPlaceholder: '标签，回车确认',
    color: '颜色',
    charCount: '{n} 字',
    session: '会话',
    workspace: '工作区',
    noSession: '未关联会话',
    noWorkspace: '未关联工作区',
    newDraft: '新建草稿',
    newTemplate: '新建模板',
    openFolder: '打开存档文件夹',
    opened: '已打开存档文件夹',
    openFolderFailed: '打不开存档文件夹：{msg}',
    group: '分组',
    groupTime: '时间',
    groupSession: '会话',
    groupWorkspace: '工作区',
    groupColor: '颜色',
    groupTag: '标签',
    groupNone: '不分组',
    sort: '排序',
    sortUpdated: '最近保存',
    sortCreated: '创建时间',
    sortTitle: '标题',
    scopeAll: '全部',
    scopeNotes: '草稿',
    scopeTemplates: '模板',
    search: '搜索标题、内容、标签',
    filterColor: '按颜色筛选',
    filterTag: '按标签筛选',
    clearFilters: '清空筛选',
    empty: '稿箱还是空的。在右边栏按 /prompt，或者点「新建草稿」。',
    emptyFiltered: '没有符合筛选条件的稿子。',
    loadFailed: '读不到稿箱：{msg}',
    saveFailed: '保存失败：{msg}',
    retry: '重试',
    loading: '正在读稿箱…',
    cardOpen: '打开',
    cardUseTemplate: '用模板新建',
    cardTemplate: '模板',
    cardDraft: '草稿',
    colorSlate: '灰',
    colorBlue: '蓝',
    colorGreen: '绿',
    colorAmber: '琥珀',
    colorRose: '玫瑰',
    colorViolet: '紫',
    colorTeal: '青',
    groupToday: '今天',
    groupYesterday: '昨天',
    groupWeek: '本周',
    groupMonth: '本月',
    groupOlder: '更早',
    groupNoneTag: '无标签',
    groupNoneColor: '未上色',
    untitled: '未命名草稿',
    justNow: '刚刚',
    minutesAgo: '{n} 分钟前',
    hoursAgo: '{n} 小时前',
    daysAgo: '{n} 天前',
    dateSameYear: '{month}月{day}日',
    dateOtherYear: '{year}年{month}月{day}日',
    openInEditor: '在编辑器中打开',
    templateCreated: '模板已创建',
    draftCreated: '草稿已创建',
    needSession: '先在任意会话里按 /prompt 打开编辑器',
    preview: '预览',
    edit: '编辑',
    noPreview: '没有可预览的内容',
    docTitle: '文稿',
    lineSep: '行',
    unsavedHint: '有未保存的改动',
    confirmOverwrite: '当前有未保存的改动',
    shortcutSave: 'Ctrl+S 保存',
    shortcutInject: 'Ctrl+Enter 注入',
    templateTag: '模板',
    copySuffix: '副本',
    archive: '存档',
    shortcuts: '快捷键',
    openArchive: '打开存档',
    backToChat: '回到对话',
    cancel: '取消',
    keepEditing: '继续写',
    discardAndOpen: '放弃并打开',
    customColor: '自定义颜色',
    removeTag: '移除标签',
    draftOpened: '已打开新草稿',
    templateOpened: '已打开新模板',
    injectFailed: '注入失败：{msg}',
    sendFailed: '发送失败：{msg}',
  }

  const EN = {
    nav: 'Stash',
    panelTitle: 'Prompt Stash',
    panelSubtitle: 'Half-written prompts, templates, and where they came from.',
    editorTitle: 'Prompt',
    editorEmpty: 'Empty draft. Just write; Ctrl+S files it in the stash.',
    titlePlaceholder: 'Name this draft',
    bodyPlaceholder: 'Write the prompt here. Markdown works.',
    save: 'Save',
    saveAsTemplate: 'Save as template',
    inject: 'Insert',
    send: 'Send',
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved',
    injected: 'Inserted into the composer',
    sent: 'Sent',
    noComposer: 'This session has no composer available',
    emptyBody: 'The draft is empty',
    tags: 'Tags',
    addTag: 'Add tag',
    tagPlaceholder: 'tag, then Enter',
    color: 'Colour',
    charCount: '{n} chars',
    session: 'Session',
    workspace: 'Workspace',
    noSession: 'No session',
    noWorkspace: 'No workspace',
    newDraft: 'New draft',
    newTemplate: 'New template',
    openFolder: 'Open archive folder',
    opened: 'Archive folder opened',
    openFolderFailed: 'Could not open the archive folder: {msg}',
    group: 'Group',
    groupTime: 'Time',
    groupSession: 'Session',
    groupWorkspace: 'Workspace',
    groupColor: 'Colour',
    groupTag: 'Tag',
    groupNone: 'None',
    sort: 'Sort',
    sortUpdated: 'Recently saved',
    sortCreated: 'Created',
    sortTitle: 'Title',
    scopeAll: 'All',
    scopeNotes: 'Drafts',
    scopeTemplates: 'Templates',
    search: 'Search titles, bodies, tags',
    filterColor: 'Filter by colour',
    filterTag: 'Filter by tag',
    clearFilters: 'Clear filters',
    empty: 'The stash is empty. Press /prompt in the right sidebar, or create a draft.',
    emptyFiltered: 'Nothing matches the current filters.',
    loadFailed: 'Could not read the stash: {msg}',
    saveFailed: 'Save failed: {msg}',
    retry: 'Retry',
    loading: 'Reading the stash…',
    cardOpen: 'Open',
    cardUseTemplate: 'New from template',
    cardTemplate: 'Template',
    cardDraft: 'Draft',
    colorSlate: 'Slate',
    colorBlue: 'Blue',
    colorGreen: 'Green',
    colorAmber: 'Amber',
    colorRose: 'Rose',
    colorViolet: 'Violet',
    colorTeal: 'Teal',
    groupToday: 'Today',
    groupYesterday: 'Yesterday',
    groupWeek: 'This week',
    groupMonth: 'This month',
    groupOlder: 'Earlier',
    groupNoneTag: 'No tag',
    groupNoneColor: 'No colour',
    untitled: 'Untitled draft',
    justNow: 'just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: '{n} d ago',
    dateSameYear: '{month}/{day}',
    dateOtherYear: '{month}/{day}/{year}',
    openInEditor: 'Open in editor',
    templateCreated: 'Template created',
    draftCreated: 'Draft created',
    needSession: 'Open the editor with /prompt in a session first',
    preview: 'Preview',
    edit: 'Edit',
    noPreview: 'Nothing to preview',
    docTitle: 'Prompt document',
    lineSep: 'lines',
    unsavedHint: 'Unsaved changes',
    confirmOverwrite: 'This draft has unsaved changes',
    shortcutSave: 'Ctrl+S saves',
    shortcutInject: 'Ctrl+Enter inserts',
    templateTag: 'Template',
    copySuffix: 'copy',
    archive: 'Archive',
    shortcuts: 'Shortcuts',
    openArchive: 'Open archive',
    backToChat: 'Back to chat',
    cancel: 'Cancel',
    keepEditing: 'Keep editing',
    discardAndOpen: 'Discard and open',
    customColor: 'Custom colour',
    removeTag: 'Remove tag',
    draftOpened: 'New draft opened',
    templateOpened: 'New template opened',
    injectFailed: 'Insert failed: {msg}',
    sendFailed: 'Send failed: {msg}',
  }

  const LANGS = { zh: ZH, en: EN }

  /** Locale id → dictionary; anything non-Chinese falls back to English. */
  function dictFor(active) {
    const id = String(active || '').toLowerCase()
    return id.startsWith('zh') ? ZH : EN
  }

  /** Normalize a locale snapshot id to the language tag the dictionaries use. */
  function langOf(active) {
    return String(active || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }

  /**
   * `t('charCount', { n: 12 })` with `{name}` placeholders.
   *
   * The translator carries `.lang` because grouping needs the language for
   * colour names, and callers that only hold `t` would otherwise default to
   * Chinese in an English UI.
   */
  function makeTranslator(dict, lang) {
    function t(key, vars) {
      const template = dict[key] !== undefined ? dict[key] : ZH[key] !== undefined ? ZH[key] : key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/gu, (match, name) =>
        vars[name] === undefined ? match : String(vars[name]),
      )
    }
    t.lang = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : dict === EN ? 'en' : 'zh'
    return t
  }

  // --------------------------------------------------------------- palette

  /** Named colours the archive groups by; a custom hex is stored just as well. */
  const PALETTE = [
    { id: 'slate', hex: '#8a8f98', zh: '灰', en: 'Slate' },
    { id: 'blue', hex: '#4d6bfe', zh: '蓝', en: 'Blue' },
    { id: 'green', hex: '#3f9d6d', zh: '绿', en: 'Green' },
    { id: 'amber', hex: '#c98a2b', zh: '琥珀', en: 'Amber' },
    { id: 'rose', hex: '#c2653f', zh: '玫瑰', en: 'Rose' },
    { id: 'violet', hex: '#8b6ad4', zh: '紫', en: 'Violet' },
    { id: 'teal', hex: '#2f8f99', zh: '青', en: 'Teal' },
  ]

  const PALETTE_BY_ID = new Map(PALETTE.map((item) => [item.id, item]))
  const PALETTE_BY_HEX = new Map(PALETTE.map((item) => [item.hex.toLowerCase(), item]))

  /** Resolve a stored colour (palette id or hex) to a CSS colour. */
  function colorOf(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (text === '') return PALETTE[0].hex
    if (PALETTE_BY_ID.has(text)) return PALETTE_BY_ID.get(text).hex
    if (PALETTE_BY_HEX.has(text)) return PALETTE_BY_HEX.get(text).hex
    return text
  }

  /** Human label for a stored colour in the active language. */
  function colorName(value, lang) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
    const hit = PALETTE_BY_ID.get(text) || PALETTE_BY_HEX.get(text)
    if (hit) return lang === 'en' ? hit.en : hit.zh
    return text === '' ? '' : text
  }

  // --------------------------------------------------------------- time

  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  /** Parse an ISO timestamp; never throws. */
  function parseTime(value) {
    const time = Date.parse(typeof value === 'string' ? value : '')
    return Number.isFinite(time) ? time : 0
  }

  /** Start of the local day for a timestamp. */
  function startOfDay(time) {
    const date = new Date(time)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  /** Human "when" for a card: 刚刚 / 14 分钟前 / 昨天 09:20 / 10月12日. */
  function formatWhen(value, t, now = Date.now()) {
    const time = parseTime(value)
    if (time === 0) return ''
    const delta = now - time
    if (delta < MINUTE) return t('justNow')
    if (delta < HOUR) return t('minutesAgo', { n: Math.max(1, Math.floor(delta / MINUTE)) })
    if (delta < DAY && startOfDay(now) === startOfDay(time)) {
      return t('hoursAgo', { n: Math.max(1, Math.floor(delta / HOUR)) })
    }
    const dayDelta = Math.round((startOfDay(now) - startOfDay(time)) / DAY)
    if (dayDelta === 1) return t('groupYesterday')
    if (dayDelta > 1 && dayDelta < 7) return t('daysAgo', { n: dayDelta })
    const date = new Date(time)
    const sameYear = date.getFullYear() === new Date(now).getFullYear()
    const parts = { month: date.getMonth() + 1, day: date.getDate(), year: date.getFullYear() }
    return sameYear ? t('dateSameYear', parts) : t('dateOtherYear', parts)
  }

  /** Full local timestamp for tooltips. */
  function formatExact(value) {
    const time = parseTime(value)
    if (time === 0) return ''
    const date = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  /** Time bucket for the "time" grouping. */
  function timeBucket(value, t, now = Date.now()) {
    const time = parseTime(value)
    if (time === 0) return { id: 'older', title: t('groupOlder'), order: 90 }
    const today = startOfDay(now)
    if (time >= today) return { id: 'today', title: t('groupToday'), order: 0 }
    if (time >= today - DAY) return { id: 'yesterday', title: t('groupYesterday'), order: 10 }
    if (time >= today - 6 * DAY) return { id: 'week', title: t('groupWeek'), order: 20 }
    if (time >= today - 29 * DAY) return { id: 'month', title: t('groupMonth'), order: 30 }
    return { id: 'older', title: t('groupOlder'), order: 90 }
  }

  // --------------------------------------------------------------- shaping

  /** Title fallback identical to the Host's rule (first non-empty line, markers stripped). */
  function deriveTitle(body, fallback) {
    const line = String(body || '')
      .split(/\r?\n/u)
      .map((row) => row.trim())
      .find((row) => row.length > 0)
    if (line === undefined) return fallback || ''
    const stripped = line.replace(/^#{1,6}\s+/u, '').replace(/^[-*+]\s+/u, '').trim()
    return (stripped === '' ? fallback || '' : stripped).slice(0, 120)
  }

  /** Every entry of a library with its kind attached. */
  function allEntries(library, scope) {
    const notes = library && Array.isArray(library.notes) ? library.notes : []
    const templates = library && Array.isArray(library.templates) ? library.templates : []
    if (scope === 'note') return notes.map((entry) => ({ ...entry, kind: 'note' }))
    if (scope === 'template') return templates.map((entry) => ({ ...entry, kind: 'template' }))
    return [
      ...notes.map((entry) => ({ ...entry, kind: 'note' })),
      ...templates.map((entry) => ({ ...entry, kind: 'template' })),
    ]
  }

  /** Case-insensitive match over title, excerpt and tags. */
  function matchesQuery(entry, query) {
    if (!query) return true
    const needle = query.trim().toLowerCase()
    if (needle === '') return true
    const haystack = [entry.title, entry.excerpt, (entry.tags || []).join(' '), entry.session && entry.session.title, entry.workspace && (entry.workspace.name || entry.workspace.path)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  }

  /** Apply scope, filters and query. */
  function filterEntries(library, view) {
    const scope = view.scope || 'all'
    const colors = Array.isArray(view.filters && view.filters.colors) ? view.filters.colors : []
    const tags = Array.isArray(view.filters && view.filters.tags) ? view.filters.tags : []
    return allEntries(library, scope).filter((entry) => {
      if (colors.length > 0 && !colors.includes(colorOf(entry.color))) return false
      if (tags.length > 0) {
        const owned = (entry.tags || []).map((tag) => tag.toLowerCase())
        if (!tags.some((tag) => owned.includes(String(tag).toLowerCase()))) return false
      }
      return matchesQuery(entry, view.query || '')
    })
  }

  /** Sort comparator chosen by `sortBy`. */
  function comparator(sortBy) {
    if (sortBy === 'created') return (a, b) => parseTime(b.createdAt) - parseTime(a.createdAt)
    if (sortBy === 'title') {
      return (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN', { numeric: true })
    }
    return (a, b) => parseTime(b.updatedAt) - parseTime(a.updatedAt)
  }

  /** The single grouping key an entry falls back to for non-tag groupings. */
  function groupOf(entry, groupBy, t) {
    if (groupBy === 'session') {
      const session = entry.session || {}
      const title = session.title || session.cwd || ''
      return { id: session.id || 'none', title: title || t('noSession'), order: 0 }
    }
    if (groupBy === 'workspace') {
      const workspace = entry.workspace || {}
      const title = workspace.name || workspace.path || ''
      return { id: workspace.id || workspace.path || 'none', title: title || t('noWorkspace'), order: 0 }
    }
    if (groupBy === 'color') {
      const hex = colorOf(entry.color)
      const preset = PALETTE.find((item) => item.hex.toLowerCase() === hex)
      const index = preset ? PALETTE.indexOf(preset) : PALETTE.length
      return { id: hex, title: colorName(entry.color, t.lang) || t('groupNoneColor'), order: index, color: hex }
    }
    return { id: 'all', title: '', order: 0 }
  }

  /**
   * Group the archive for the tiled card view.
   *
   * @param library - the library document.
   * @param view - `{ groupBy, sortBy, scope, query, filters }`.
   * @param t - translator (also carries `.lang`).
   * @returns `[{ id, title, color?, order, entries }]` in display order.
   */
  function groupEntries(library, view, t, now = Date.now()) {
    const groupBy = view.groupBy || 'time'
    const entries = filterEntries(library, view)
    const compare = comparator(view.sortBy)
    /** @type {Map<string, { id: string, title: string, color?: string, order: number, latest: number, entries: any[] }>} */
    const groups = new Map()

    const push = (key, entry) => {
      let group = groups.get(key.id)
      if (group === undefined) {
        group = { id: key.id, title: key.title, color: key.color, order: key.order, latest: 0, entries: [] }
        groups.set(key.id, group)
      }
      group.entries.push(entry)
      group.latest = Math.max(group.latest, parseTime(entry.updatedAt))
    }

    for (const entry of entries) {
      if (groupBy === 'tag') {
        const tags = entry.tags || []
        if (tags.length === 0) push({ id: 'none', title: t('groupNoneTag'), order: 900 }, entry)
        else for (const tag of tags) push({ id: `tag:${tag.toLowerCase()}`, title: tag, order: 0 }, entry)
        continue
      }
      if (groupBy === 'time') {
        push(timeBucket(entry.updatedAt, t, now), entry)
        continue
      }
      if (groupBy === 'none') {
        push({ id: 'all', title: '', order: 0 }, entry)
        continue
      }
      push(groupOf(entry, groupBy, t), entry)
    }

    const list = [...groups.values()]
    for (const group of list) group.entries.sort(compare)
    list.sort((a, b) => {
      if (groupBy === 'time' || groupBy === 'color') return a.order - b.order || b.latest - a.latest
      if (groupBy === 'none') return 0
      return b.latest - a.latest || a.title.localeCompare(b.title, 'zh-Hans-CN')
    })
    return list
  }

  /** Colour filters present in the library, ordered by palette then hex. */
  function colorFacets(library) {
    const counts = new Map()
    for (const entry of allEntries(library, 'all')) {
      const hex = colorOf(entry.color)
      counts.set(hex, (counts.get(hex) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([hex, count]) => ({ hex, count, order: PALETTE.findIndex((item) => item.hex.toLowerCase() === hex) }))
      .sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order) || b.count - a.count)
  }

  /** Tag filters present in the library, most used first. */
  function tagFacets(library, limit = 24) {
    const counts = new Map()
    for (const entry of allEntries(library, 'all')) {
      for (const tag of entry.tags || []) {
        const key = tag.toLowerCase()
        const row = counts.get(key) || { tag, count: 0 }
        row.count += 1
        counts.set(key, row)
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit)
  }

  /** Counts for the scope tabs. */
  function scopeCounts(library) {
    const notes = library && Array.isArray(library.notes) ? library.notes.length : 0
    const templates = library && Array.isArray(library.templates) ? library.templates.length : 0
    return { all: notes + templates, note: notes, template: templates }
  }

  // --------------------------------------------------------------- host api

  /**
   * The page's own base for route resolution.
   *
   * In the Electron shell the page is `dsh-app://app/` and the shell forwards
   * non-static paths to the Host same-origin; behind a reverse proxy the base
   * carries the directory prefix. Never use a leading slash: it pins the
   * request to the origin root and escapes that prefix.
   */
  function pageBase() {
    if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') {
      return document.baseURI
    }
    return 'http://dsh.internal/'
  }

  /** One absolute URL for `prompt-stash/api/<action>` on this page's own origin. */
  function routeUrl(action) {
    const relative = `prompt-stash/api/${action}`
    try {
      return new URL(relative, pageBase()).href
    } catch {
      return `http://dsh.internal/${relative}`
    }
  }

  /** POST one action; resolves the `{ ok: true }` envelope or throws a readable error. */
  async function api(action, payload) {
    let response
    try {
      response = await fetch(routeUrl(action), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    let body = null
    try {
      body = await response.json()
    } catch {
      throw new Error(`HTTP ${response.status}`)
    }
    if (body === null || body.ok !== true) {
      const message = body && body.error && body.error.message ? body.error.message : `HTTP ${response.status}`
      const failure = new Error(message)
      failure.code = body && body.error ? body.error.code : 'failed'
      throw failure
    }
    return body
  }

  // --------------------------------------------------------------- store

  const EMPTY_LIBRARY = { version: 1, notes: [], templates: [], settings: {} }

  /** Bumped by every successful write, so a slower in-flight read can tell it became stale. */
  let writeSeq = 0

  /** One snapshot store shared by both surfaces. */
  function createStore() {
    let state = {
      status: 'idle',
      error: '',
      dir: '',
      library: EMPTY_LIBRARY,
      view: { groupBy: 'time', sortBy: 'updated', scope: 'all', query: '', filters: { colors: [], tags: [] } },
      sessionId: '',
      sessionMeta: null,
      openRequest: null,
      toast: null,
      saveState: 'idle',
      lastSavedAt: '',
    }
    const listeners = new Set()
    let toastSeq = 0

    function get() {
      return state
    }
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    function set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      if (next === state) return
      state = { ...state, ...next }
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          /* one broken subscriber must not stop the rest */
        }
      }
    }
    function toast(message, tone) {
      toastSeq += 1
      set({ toast: { message, tone: tone || 'info', seq: toastSeq } })
    }

    return { get, subscribe, set, toast }
  }

  const store = createStore()

  /** Merge Host settings into the local view (local wins on first load). */
  function adoptSettings(settings) {
    if (settings === null || typeof settings !== 'object') return
    const view = { ...store.get().view }
    if (typeof settings.groupBy === 'string') view.groupBy = settings.groupBy
    if (typeof settings.sortBy === 'string') view.sortBy = settings.sortBy
    if (typeof settings.scope === 'string') view.scope = settings.scope
    if (typeof settings.query === 'string') view.query = settings.query
    if (settings.filters && typeof settings.filters === 'object') {
      view.filters = {
        colors: Array.isArray(settings.filters.colors) ? settings.filters.colors.filter((item) => typeof item === 'string') : [],
        tags: Array.isArray(settings.filters.tags) ? settings.filters.tags.filter((item) => typeof item === 'string') : [],
      }
    }
    store.set({ view })
  }

  /** Read the library from the Host; safe to call repeatedly. */
  async function load(options) {
    const silent = options && options.silent === true
    const startedAt = writeSeq
    if (!silent) store.set({ status: store.get().status === 'ready' ? 'ready' : 'loading', error: '' })
    try {
      const result = await api('library')
      // A save may have landed while this read was in flight; its response is
      // the newer truth, so a stale read must not replace it — but the UI still
      // has to leave the "loading" state.
      if (startedAt !== writeSeq) {
        if (!silent) store.set({ status: 'ready', error: '' })
        return result
      }
      store.set({ status: 'ready', error: '', dir: result.dir || '', library: normalizeLibrary(result.library) })
      if (!(options && options.keepView === true)) adoptSettings(result.library && result.library.settings)
      return result
    } catch (error) {
      store.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** Coerce a Host library document into the shape the UI reads. */
  function normalizeLibrary(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {}
    return {
      version: 1,
      notes: Array.isArray(source.notes) ? source.notes : [],
      templates: Array.isArray(source.templates) ? source.templates : [],
      settings: source.settings !== null && typeof source.settings === 'object' ? source.settings : {},
    }
  }

  /** Persist one view setting (debounced by the caller). */
  let settingsTimer = null
  function saveView(patch) {
    const view = { ...store.get().view, ...(patch || {}) }
    store.set({ view })
    if (settingsTimer !== null) clearTimeout(settingsTimer)
    settingsTimer = setTimeout(() => {
      settingsTimer = null
      api('settings', { patch: store.get().view }).catch(() => undefined)
    }, 400)
  }

  // --------------------------------------------------------------- drafts (editor)

  /** In-memory draft fallback: a custom-scheme page may expose localStorage and still throw on use. */
  const memoryDrafts = new Map()

  /** localStorage key for one session's unsaved draft. */
  function draftKey(sessionId) {
    return `dsh-prompt-stash/draft/${sessionId || 'global'}`
  }

  /** Read the unsaved draft kept for a session (memory first, then storage). */
  function readLocalDraft(sessionId) {
    const key = draftKey(sessionId)
    if (memoryDrafts.has(key)) return memoryDrafts.get(key)
    try {
      const raw = globalThis.localStorage?.getItem(key)
      if (raw === null || raw === undefined) return null
      const value = JSON.parse(raw)
      if (value === null || typeof value !== 'object') return null
      memoryDrafts.set(key, value)
      return value
    } catch {
      return null
    }
  }

  /** Write (or clear) the unsaved draft kept for a session. */
  function writeLocalDraft(sessionId, draft) {
    const key = draftKey(sessionId)
    if (draft === null) memoryDrafts.delete(key)
    else memoryDrafts.set(key, draft)
    try {
      if (draft === null) globalThis.localStorage?.removeItem(key)
      else globalThis.localStorage?.setItem(key, JSON.stringify(draft))
    } catch {
      /* storage blocked: the in-memory copy still survives a tab switch */
    }
  }

  /** The editor's initial document for a session: local draft first, then a blank draft. */
  function initialDocument(sessionId, sessionMeta) {
    const local = readLocalDraft(sessionId)
    if (local !== null && typeof local.body === 'string') {
      return {
        id: typeof local.id === 'string' ? local.id : '',
        kind: local.kind === 'template' ? 'template' : 'note',
        title: typeof local.title === 'string' ? local.title : '',
        body: local.body,
        color: typeof local.color === 'string' ? local.color : 'slate',
        tags: Array.isArray(local.tags) ? local.tags : [],
        session: sessionMeta && sessionMeta.session ? sessionMeta.session : undefined,
        workspace: sessionMeta && sessionMeta.workspace ? sessionMeta.workspace : undefined,
        dirty: local.dirty === true,
        savedAt: typeof local.savedAt === 'string' ? local.savedAt : '',
      }
    }
    return {
      id: '',
      kind: 'note',
      title: '',
      body: '',
      color: 'slate',
      tags: [],
      session: sessionMeta && sessionMeta.session ? sessionMeta.session : undefined,
      workspace: sessionMeta && sessionMeta.workspace ? sessionMeta.workspace : undefined,
      dirty: false,
      savedAt: '',
    }
  }

  /** Build an editor document from a library entry + its body. */
  function documentOf(entry, body, kind) {
    return {
      id: entry.id,
      kind: kind || 'note',
      title: entry.title || '',
      body: typeof body === 'string' ? body : '',
      color: entry.color || 'slate',
      tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
      session: entry.session,
      workspace: entry.workspace,
      dirty: false,
      savedAt: entry.updatedAt || '',
    }
  }

  /** Read one entry's markdown body. */
  async function readBody(kind, id) {
    const result = await api('read', { kind, id })
    return typeof result.body === 'string' ? result.body : ''
  }

  /** Save (create or update) one entry; returns the saved entry. */
  async function save(entry) {
    const payload = {
      kind: entry.kind === 'template' ? 'template' : 'note',
      id: entry.id || undefined,
      title: entry.title,
      body: entry.body,
      color: entry.color,
      tags: entry.tags,
      session: entry.session,
      workspace: entry.workspace,
      templateId: entry.kind === 'note' ? entry.templateId : undefined,
    }
    const result = await api('save', payload)
    writeSeq += 1
    store.set({ library: normalizeLibrary(result.library), dir: result.dir || store.get().dir })
    return result.entry
  }

  /** Update title/colour/tags of one entry without touching its body. */
  async function updateMeta(kind, id, patch) {
    const result = await api('meta', { kind, id, patch })
    writeSeq += 1
    store.set({ library: normalizeLibrary(result.library) })
    return result.entry
  }

  /** Create a draft from a template and return it with its body. */
  async function fromTemplate(templateId, session, workspace) {
    const result = await api('fromTemplate', { id: templateId, session, workspace })
    writeSeq += 1
    store.set({ library: normalizeLibrary(result.library) })
    const body = typeof result.body === 'string' && result.body !== '' ? result.body : await readBody('note', result.entry.id)
    return documentOf(result.entry, body, 'note')
  }

  /** Ask the Host to reveal the stash directory. */
  async function openFolder() {
    return api('openFolder')
  }

  /**
   * Ask any mounted editor to adopt a document.
   *
   * @param request - `{ kind, id, blank, sessionId }`; `blank` opens an empty
   * draft of `kind`, otherwise `id` names the stored entry to load.
   */
  function requestOpen(request) {
    const source = request !== null && typeof request === 'object' ? request : {}
    store.set({
      openRequest: {
        kind: source.kind === 'template' ? 'template' : 'note',
        id: typeof source.id === 'string' ? source.id : '',
        blank: source.blank === true,
        sessionId: typeof source.sessionId === 'string' ? source.sessionId : '',
        nonce: Date.now(),
      },
    })
  }

  // --------------------------------------------------------------- exports

  globalThis.__PromptStashModel = {
    PALETTE,
    colorOf,
    colorName,
    parseTime,
    startOfDay,
    formatWhen,
    formatExact,
    timeBucket,
    deriveTitle,
    allEntries,
    filterEntries,
    groupEntries,
    colorFacets,
    tagFacets,
    scopeCounts,
    comparator,
    dictFor,
    langOf,
    makeTranslator,
    ZH,
    EN,
    api,
    routeUrl,
    pageBase,
    store,
    load,
    saveView,
    normalizeLibrary,
    draftKey,
    readLocalDraft,
    writeLocalDraft,
    initialDocument,
    documentOf,
    readBody,
    save,
    updateMeta,
    fromTemplate,
    openFolder,
    requestOpen,
  }
})()
