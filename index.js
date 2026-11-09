/**
 * Host half of 提示词稿箱 / Prompt Stash.
 *
 * The stash is plain files under the *global* harness home (`<dsh home>/prompt-stash`):
 *
 *   library.json      every entry's metadata (title, colour, tags, session, workspace,
 *                     timestamps, excerpt), plus the UI settings the archive page keeps
 *   notes/<id>.md     one markdown body per draft
 *   templates/<id>.md one markdown body per template
 *
 * The browser half talks to this file through one fenced JSON route
 * (`/prompt-stash/api/<action>`). There is deliberately no delete action and no
 * delete button anywhere: the archive can create, update, and duplicate, never
 * remove.
 *
 * Kept in one file on purpose — the storage rules, the wire shape, and the route
 * are one topic; reading any of them means reading all three.
 */

import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Route prefix owned by this plugin. */
export const API_PREFIX = '/prompt-stash/api'

/** Directory name under the global harness home. */
export const STASH_DIR_NAME = 'prompt-stash'

/** Metadata file name inside the stash directory. */
export const LIBRARY_FILE = 'library.json'

/** Library document version; bump when the fold semantics change. */
export const LIBRARY_VERSION = 1

/** Kind → body directory. `note` is the draft the editor saves; `template` seeds new drafts. */
export const BODY_DIRS = { note: 'notes', template: 'templates' }

/** Kinds accepted on the wire. */
export const KINDS = ['note', 'template']

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Largest markdown body stored, in characters. */
const MAX_BODY_CHARS = 512 * 1024

/** Excerpt length kept in the metadata for card previews and search. */
const EXCERPT_CHARS = 240

/** Largest browser report stored in `diagnostics.json`, in characters. */
const REPORT_CHARS = 32 * 1024

/** Default UI settings; the archive page overwrites them through the `settings` action. */
export const DEFAULT_SETTINGS = {
  groupBy: 'time',
  sortBy: 'updated',
  scope: 'all',
  filters: { colors: [], tags: [] },
  query: '',
}

// --------------------------------------------------------------------------- paths

/**
 * Resolve the global harness home.
 *
 * `profileContext.home` is what the Host itself computed at boot (it already
 * honours `$DSH_HOME`), so it wins. The environment variables are the fallback
 * for a composition without that service; `~/.dsh` is the documented default.
 */
export function dshHomeOf(ctx, env = process.env, home = homedir()) {
  let served
  try {
    const profileContext = ctx === undefined ? undefined : ctx.get('profileContext')
    served = profileContext === undefined ? undefined : profileContext.home
  } catch {
    served = undefined
  }
  if (typeof served === 'string' && served.trim() !== '') return resolve(expandHome(served.trim(), home))
  return resolveDshHome(env, home)
}

/** Environment-only resolution: `$DSH_HOME`, then the profile dir's grandparent, then `~/.dsh`. */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (configured !== '') return resolve(expandHome(configured, home))
  // <dsh home>/profiles/<name> — the launcher sets this for every shell it spawns,
  // so its grandparent is the harness home even when DSH_HOME is unset.
  const profileDir = typeof env.DSH_PROFILE_DIR === 'string' ? env.DSH_PROFILE_DIR.trim() : ''
  if (profileDir !== '') {
    const generation = resolve(profileDir)
    const candidate = dirname(dirname(generation))
    if (candidate !== '' && dirname(candidate) !== candidate && dirname(candidate) !== '') return candidate
  }
  return join(home, '.dsh')
}

/** Expand `~`, `~/`, and `~\` against the OS home. */
export function expandHome(value, home = homedir()) {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
  return value
}

/** Default stash directory for a harness home. */
export function stashDirOf(dshHome) {
  return join(dshHome, STASH_DIR_NAME)
}

// --------------------------------------------------------------------------- ids and text

/** True for an id this plugin generated (filename-safe, cannot escape its body directory). */
export function isSafeId(id) {
  return typeof id === 'string' && /^[nt]_[a-z0-9]{6,32}$/u.test(id)
}

/** Mint a new entry id: `n_`/`t_` prefix makes the kind visible in the folder listing. */
export function newId(kind) {
  const prefix = kind === 'template' ? 't' : 'n'
  const stem = Date.now().toString(36) + randomUUID().replace(/-/gu, '').slice(0, 8)
  return `${prefix}_${stem.slice(0, 24)}`
}

/** Collapse whitespace and cut a one-line title. */
export function deriveTitle(raw, fallback = '未命名草稿') {
  const line = String(raw ?? '')
    .split(/\r?\n/u)
    .map((row) => row.trim())
    .find((row) => row.length > 0)
  if (line === undefined) return fallback
  const stripped = line.replace(/^#{1,6}\s+/u, '').replace(/^[-*+]\s+/u, '').trim()
  const title = stripped === '' ? fallback : stripped
  return title.length > 120 ? `${title.slice(0, 119)}…` : title
}

/** First meaningful characters of a body, with markdown markers flattened. */
export function excerptOf(body) {
  const flat = String(body ?? '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^[-*+]\s+/gmu, '')
    .replace(/[*_~>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat
}

/** Clamp a stored body to the accepted size. */
export function clampBody(body) {
  const text = typeof body === 'string' ? body : String(body ?? '')
  return text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text
}

/** Named colour tokens accepted on the wire; the client mirrors this list for its swatches. */
export const COLOR_TOKENS = ['slate', 'blue', 'green', 'amber', 'rose', 'violet', 'teal']

/** Normalize a hex colour or palette token; anything else falls back to the neutral token. */
export function normalizeColor(value, fallback = 'slate') {
  if (typeof value !== 'string') return fallback
  const text = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/u.test(text)) return text
  if (/^#[0-9a-f]{3}$/u.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`
  }
  if (COLOR_TOKENS.includes(text)) return text
  return fallback
}

/** Normalize a tag list: trimmed, non-empty, unique, at most 8, 24 characters each. */
export function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const tags = []
  for (const item of value) {
    const tag = String(item ?? '').trim().replace(/\s+/gu, ' ')
    if (tag === '' || tag.length > 24) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= 8) break
  }
  return tags
}

// --------------------------------------------------------------------------- library document

/** Empty library document. */
export function emptyLibrary() {
  return { version: LIBRARY_VERSION, notes: [], templates: [], settings: { ...DEFAULT_SETTINGS } }
}

/** One entry's shape, with every field defaulted. */
export function normalizeEntry(raw, kind) {
  const entry = raw !== null && typeof raw === 'object' ? raw : {}
  const id = isSafeId(entry.id) ? entry.id : newId(kind)
  const body = typeof entry.body === 'string' ? entry.body : ''
  const createdAt = typeof entry.createdAt === 'string' && entry.createdAt !== '' ? entry.createdAt : new Date().toISOString()
  const updatedAt = typeof entry.updatedAt === 'string' && entry.updatedAt !== '' ? entry.updatedAt : createdAt
  return {
    id,
    title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.slice(0, 200) : deriveTitle(body),
    color: normalizeColor(entry.color),
    tags: normalizeTags(entry.tags),
    createdAt,
    updatedAt,
    chars: Number.isFinite(entry.chars) ? entry.chars : body.length,
    lines: Number.isFinite(entry.lines) ? entry.lines : (body === '' ? 0 : body.split(/\r?\n/u).length),
    excerpt: typeof entry.excerpt === 'string' ? entry.excerpt : excerptOf(body),
    session: normalizeRef(entry.session, ['id', 'title', 'cwd']),
    workspace: normalizeRef(entry.workspace, ['id', 'name', 'path']),
    templateId: typeof entry.templateId === 'string' ? entry.templateId : '',
  }
}

/** Normalize an optional `{ id, title, cwd }`-shaped reference. */
function normalizeRef(raw, fields) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const out = {}
  for (const field of fields) {
    const value = raw[field]
    if (typeof value === 'string' && value !== '') out[field] = value.slice(0, 400)
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Coerce an arbitrary parsed JSON document into the library shape this plugin owns. */
export function normalizeLibrary(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const settings = source.settings !== null && typeof source.settings === 'object' ? source.settings : {}
  return {
    version: LIBRARY_VERSION,
    notes: Array.isArray(source.notes) ? source.notes.map((entry) => normalizeEntry(entry, 'note')) : [],
    templates: Array.isArray(source.templates)
      ? source.templates.map((entry) => normalizeEntry(entry, 'template'))
      : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      filters: {
        ...DEFAULT_SETTINGS.filters,
        ...(settings.filters !== null && typeof settings.filters === 'object' ? settings.filters : {}),
      },
    },
  }
}

/** The list for one kind. */
export function listOf(library, kind) {
  return kind === 'template' ? library.templates : library.notes
}

// --------------------------------------------------------------------------- store

/** Async file-backed stash. One instance per mounted plugin row. */
export function createStore({ dir }) {
  const libraryPath = join(dir, LIBRARY_FILE)
  let queue = Promise.resolve()

  /** Serialize every mutation: one writer, no lost updates from two tabs. */
  function withLock(task) {
    const run = queue.then(task, task)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function ensureDirs() {
    await fs.mkdir(dir, { recursive: true })
    for (const sub of Object.values(BODY_DIRS)) await fs.mkdir(join(dir, sub), { recursive: true })
  }

  async function readLibrary() {
    await ensureDirs()
    try {
      const text = await fs.readFile(libraryPath, 'utf8')
      return normalizeLibrary(JSON.parse(text))
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyLibrary()
      if (error instanceof SyntaxError) return emptyLibrary()
      throw error
    }
  }

  async function writeLibrary(library) {
    await ensureDirs()
    await writeAtomic(libraryPath, `${JSON.stringify(library, null, 2)}\n`)
  }

  function bodyPath(kind, id) {
    return join(dir, BODY_DIRS[kind], `${id}.md`)
  }

  async function readBody(kind, id) {
    if (!isSafeId(id)) throw badRequest('invalid id')
    try {
      return await fs.readFile(bodyPath(kind, id), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      throw error
    }
  }

  async function writeBody(kind, id, body) {
    await ensureDirs()
    await writeAtomic(bodyPath(kind, id), body)
  }

  return {
    dir,
    readLibrary,
    writeLibrary,
    readBody,
    writeBody,
    withLock,
    ensureDirs,
  }
}

/** Codes that mean "the antivirus/indexer is holding the file for a moment" on Windows. */
const TRANSIENT_WRITE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

/**
 * Write through a sibling temp file and rename, so a crash never truncates the
 * library. `wx` refuses to follow a planted symlink; transient Windows sharing
 * failures are retried with backoff instead of failing a save.
 */
async function writeAtomic(target, text) {
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
    for (let attempt = 0, delay = 20; ; attempt += 1) {
      try {
        await fs.rename(temp, target)
        return
      } catch (error) {
        if (!TRANSIENT_WRITE_CODES.has(error?.code) || attempt >= 8) throw error
        await new Promise((done) => setTimeout(done, delay))
        delay = Math.min(delay * 2, 200)
      }
    }
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** A 400-shaped error the route turns into `{ ok: false }`. */
export function badRequest(message, code = 'bad-request') {
  const error = new Error(message)
  error.code = code
  return error
}

// --------------------------------------------------------------------------- actions

/**
 * Create or update one entry (the lock-free body).
 *
 * @param store - the stash store.
 * @param request - `{ kind, id?, title?, body?, color?, tags?, session?, workspace?, templateId? }`.
 * @returns `{ entry, library }`.
 */
async function saveEntryInner(store, request) {
  const kind = KINDS.includes(request?.kind) ? request.kind : 'note'
  const library = await store.readLibrary()
  const list = listOf(library, kind)
  const now = new Date().toISOString()
  const body = clampBody(request?.body ?? '')
  const existingIndex = isSafeId(request?.id) ? list.findIndex((entry) => entry.id === request.id) : -1
  const previous = existingIndex >= 0 ? list[existingIndex] : undefined
  const entry = normalizeEntry(
    {
      ...(previous ?? {}),
      ...(previous === undefined && isSafeId(request?.id) ? { id: request.id } : {}),
      ...(typeof request?.title === 'string' ? { title: request.title } : {}),
      ...(typeof request?.color === 'string' ? { color: request.color } : {}),
      ...(request?.tags !== undefined ? { tags: request.tags } : {}),
      ...(request?.session !== undefined ? { session: request.session } : {}),
      ...(request?.workspace !== undefined ? { workspace: request.workspace } : {}),
      ...(typeof request?.templateId === 'string' ? { templateId: request.templateId } : {}),
      body,
      updatedAt: now,
      ...(previous === undefined ? { createdAt: now } : {}),
    },
    kind,
  )
  entry.chars = body.length
  entry.lines = body === '' ? 0 : body.split(/\r?\n/u).length
  entry.excerpt = excerptOf(body)
  if (previous === undefined) list.unshift(entry)
  else list[existingIndex] = entry
  await store.writeBody(kind, entry.id, body)
  await store.writeLibrary(library)
  return { entry: { ...entry, kind }, library }
}

/** Create or update one entry, serialized with every other write. */
export async function saveEntry(store, request) {
  return store.withLock(() => saveEntryInner(store, request))
}

/** Update metadata only (title, colour, tags) without touching the markdown body. */
export async function updateMeta(store, request) {
  const kind = KINDS.includes(request?.kind) ? request.kind : 'note'
  if (!isSafeId(request?.id)) throw badRequest('invalid id')
  return store.withLock(async () => {
    const library = await store.readLibrary()
    const list = listOf(library, kind)
    const index = list.findIndex((entry) => entry.id === request.id)
    if (index < 0) throw badRequest('entry not found', 'not-found')
    const next = { ...list[index] }
    const patch = request?.patch !== null && typeof request.patch === 'object' ? request.patch : {}
    if (typeof patch.title === 'string' && patch.title.trim() !== '') next.title = patch.title.trim().slice(0, 200)
    if (patch.color !== undefined) next.color = normalizeColor(patch.color, next.color)
    if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags)
    next.updatedAt = new Date().toISOString()
    list[index] = next
    await store.writeLibrary(library)
    return { entry: { ...next, kind }, library }
  })
}

/** Merge UI settings. */
export async function saveSettings(store, patch) {
  return store.withLock(async () => {
    const library = await store.readLibrary()
    const incoming = patch !== null && typeof patch === 'object' ? patch : {}
    library.settings = {
      ...library.settings,
      ...incoming,
      filters: {
        ...library.settings.filters,
        ...(incoming.filters !== null && typeof incoming.filters === 'object' ? incoming.filters : {}),
      },
    }
    await store.writeLibrary(library)
    return library.settings
  })
}

/** Create a fresh draft from a template body; the response carries the body it copied. */
export async function draftFromTemplate(store, templateId, session, workspace) {
  if (!isSafeId(templateId)) throw badRequest('invalid template id')
  // Read AND write under one lock: a concurrent template save must not seed the
  // draft from a body that has already been replaced.
  return store.withLock(async () => {
    const library = await store.readLibrary()
    const template = library.templates.find((entry) => entry.id === templateId)
    if (template === undefined) throw badRequest('template not found', 'not-found')
    // A template with no body yet still seeds an empty draft carrying its title
    // and colour, which is what "new from template" means for a placeholder.
    const body = await store.readBody('template', templateId)
    const saved = await saveEntryInner(store, {
      kind: 'note',
      body,
      title: template.title,
      color: template.color,
      tags: template.tags,
      session,
      workspace,
      templateId,
    })
    return { ...saved, body }
  })
}

// --------------------------------------------------------------------------- open folder

/**
 * Open a directory in the platform file manager.
 *
 * Resolves once the opener actually started, and never waits for its exit:
 * Explorer on Windows exits 1 after handing the path to the running desktop
 * process, which is not a failure.
 */
export function openFolder(target) {
  const [command, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]]
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
    child.once('error', reject)
  })
}

// --------------------------------------------------------------------------- routes

/** Read one JSON request body with a hard size cap. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw badRequest('request body too large', 'too-large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('invalid JSON body', 'bad-json')
  }
}

/** Write a JSON response. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** The Host plugin body: one fenced JSON route over the file-backed stash. */
export function apply(ctx, config = {}) {
  const configuredDir = typeof config?.dir === 'string' && config.dir.trim() !== '' ? config.dir.trim() : ''
  const dir = configuredDir === '' ? stashDirOf(dshHomeOf(ctx)) : resolve(expandHome(configuredDir))
  const store = createStore({ dir })

  // Warm the directory so the folder button works before the first save, and
  // leave a marker of which build is mounted (Host and browser generations can
  // drift apart; this is how that is checked).
  store
    .ensureDirs()
    .then(() =>
      writeAtomic(
        join(store.dir, 'mount.json'),
        `${JSON.stringify(
          { plugin: 'dsh-prompt-stash', version: '0.1.0', mountedAt: new Date().toISOString(), dir: store.dir },
          null,
          2,
        )}\n`,
      ),
    )
    .catch(() => undefined)

  // Read the fence lazily: the Connection service may mount after this plugin.
  // It fails CLOSED — a route that cannot prove the caller came from the page
  // has no business reading or writing the user's stash.
  const fenced = (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      connection = undefined
    }
    if (connection === undefined || typeof connection.requestRejection !== 'function') return false
    return connection.requestRejection(req) === undefined
  }

  async function dispatch(action, payload) {
    switch (action) {
      case 'diagnostics': {
        // Read back what the browser reported about its registrations.
        await store.ensureDirs()
        try {
          const text = await fs.readFile(join(store.dir, 'diagnostics.json'), 'utf8')
          return { ok: true, diagnostics: JSON.parse(text) }
        } catch (error) {
          if (error?.code === 'ENOENT') return { ok: true, diagnostics: null }
          throw error
        }
      }
      case 'library': {
        const library = await store.readLibrary()
        return { ok: true, dir: store.dir, library }
      }
      case 'read': {
        const kind = KINDS.includes(payload.kind) ? payload.kind : 'note'
        if (!isSafeId(payload.id)) throw badRequest('invalid id')
        const body = await store.readBody(kind, payload.id)
        return { ok: true, body }
      }
      case 'save': {
        const { entry, library } = await saveEntry(store, payload)
        return { ok: true, entry, dir: store.dir, library }
      }
      case 'meta': {
        const { entry, library } = await updateMeta(store, payload)
        return { ok: true, entry, library }
      }
      case 'settings': {
        const settings = await saveSettings(store, payload.patch)
        return { ok: true, settings }
      }
      case 'fromTemplate': {
        const { entry, library, body } = await draftFromTemplate(store, payload.id, payload.session, payload.workspace)
        return { ok: true, entry, body, library }
      }
      case 'openFolder': {
        await store.ensureDirs()
        await openFolder(store.dir)
        return { ok: true, dir: store.dir }
      }
      case 'report': {
        // The browser half cannot log anywhere the Host can read: it writes what
        // it registered here, so a silent no-op registration is diagnosable.
        // Reports accumulate (capped) rather than replace, because a later boot
        // report would otherwise overwrite the interesting one.
        await store.ensureDirs()
        const file = join(store.dir, 'diagnostics.json')
        const source = payload.report !== null && typeof payload.report === 'object' ? payload.report : payload
        // Cap what is stored: the request body itself may be up to 2 MiB, and a
        // 20-entry history of that would be a 40 MiB file.
        const serialized = JSON.stringify(source)
        const report =
          serialized.length > REPORT_CHARS
            ? { truncated: true, bytes: serialized.length, head: serialized.slice(0, REPORT_CHARS) }
            : source
        return store.withLock(async () => {
          let history = []
          try {
            const previous = JSON.parse(await fs.readFile(file, 'utf8'))
            if (Array.isArray(previous?.history)) history = previous.history
          } catch {
            history = []
          }
          const entry = { receivedAt: new Date().toISOString(), report }
          history.push(entry)
          const kept = history.slice(-20)
          await writeAtomic(file, `${JSON.stringify({ latest: entry, history: kept }, null, 2)}\n`)
          return { ok: true, file, kept: kept.length }
        })
      }
      default:
        throw badRequest(`unknown action "${action}"`, 'unknown-action')
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          const allowed = fenced(req)
          const url = new URL(req.url ?? API_PREFIX, 'http://dsh.internal')
          const action = url.pathname.startsWith(`${API_PREFIX}/`)
            ? url.pathname.slice(API_PREFIX.length + 1).split('/')[0]
            : new URLSearchParams(url.search).get('action') ?? ''
          if (action === 'report') {
            // Only the browser can say why its registrations did nothing, and a
            // fence rejection would erase that message. Record the attempt and
            // the verdict before answering (a status line, never the payload),
            // capped so an unauthenticated caller cannot fill the disk.
            try {
              await store.ensureDirs()
              const logFile = join(store.dir, 'diagnostics.log')
              const size = await fs.stat(logFile).then((info) => info.size, () => 0)
              if (size < 64 * 1024) {
                await fs.appendFile(
                  logFile,
                  `${new Date().toISOString()} ${req.method} ${url.pathname} origin=${req.headers?.origin ?? '-'} allowed=${allowed}\n`,
                )
              }
            } catch {
              /* diagnostics must never break the answer */
            }
          }
          if (!allowed) {
            sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
            return
          }
          if (req.method !== 'POST' && req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
            return
          }
          try {
            const payload = req.method === 'POST' ? await readJsonBody(req) : {}
            const result = await dispatch(action, payload ?? {})
            sendJson(res, 200, result)
          } catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'failed'
            const status = code === 'not-found' ? 404 : code === 'forbidden' ? 403 : 400
            sendJson(res, status, {
              ok: false,
              error: { code, message: error instanceof Error ? error.message : String(error) },
            })
          }
        },
      }),
    'dsh-prompt-stash: api route',
  )
}

/** Services this Host half needs; without them the route cannot mount. */
export const inject = ['webServer', 'connection']
