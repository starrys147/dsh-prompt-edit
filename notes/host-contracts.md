> 这份文件写于实现之前。文末「Deltas to fix」列的是当时 `index.js` 的问题，实现时已全部修掉，保留仅作追溯。
# DSH Host-plugin contracts — dsh-prompt-stash

Evidence: `<extracted app.asar>/dsh/node_modules/@deepseek-ai/` (0.2.1-rc.5 built `lib/*.js`), profile plugins at
`<dsh home>/profiles/<profile>/node_modules/`, Electron shell `<extracted app.asar>/lib/main.js`.

## 1. `ctx.webServer.register` — exact contract

The shape assumed in the brief (`handler(request: Request): Response`, `method?`, `prefix?`) is **wrong**:

```ts
// dsh-tool-cordis/lib/types/api-catalog.js:8567-8572 (generated from the .d.ts); WebUpgradeRoute :8607
export interface WebRoute {
  kind: WebRouteKind;                                    // 'exact' | 'prefix'
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
```
`register(route): () => void` (catalog:3623; impl `host-webserver/lib/index.js:326-345`), `registerUpgrade` (:340),
`registerFallback(handler)` (:355-362, one seat, duplicate throws), `tapIndex`/`renderIndex` for index HTML.
Matching (:495-505, dispatch :190-206): exact map first; else longest **prefix**, matching iff `pathname === prefix ||
pathname.startsWith(prefix + '/')` → `'/prompt-stash/api'` matches `/prompt-stash/api/library` and `/prompt-stash/api`,
**not** `/prompt-stash/apix`; else the fallback seat (the SPA, `host-frontend-static:87-88`), never ours. Duplicate
`(kind,path)` throws; register inside `ctx.effect(...)`. No method filter — check `req.method`, answer `405` + `Allow`.

### (a) JSON GET/POST route pair
```js
export const inject = ['webServer', 'connection']

export function apply(ctx, config = {}) {
  const fence = (req) => ctx.connection.requestRejection(req) === undefined   // 401/403 when defined
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/prompt-stash/api',
    handler: async (req, res) => {
      if (!fence(req)) return sendJson(res, 403, { ok: false, error: { code: 'forbidden' } })
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const action = url.pathname.slice('/prompt-stash/api/'.length).split('/')[0] || 'library'
      try {
        if (req.method === 'GET') return sendJson(res, 200, await handleGet(action, url))
        if (req.method === 'POST') return sendJson(res, 200, await handlePost(action, await readJsonBody(req)))
        res.writeHead(405, { allow: 'GET, POST' }); res.end()
      } catch (error) {
        sendJson(res, Number(error?.status) || 400, { ok: false, error: { code: error?.code ?? 'failed', message: String(error?.message ?? error) } })
      }
    },
  }), 'prompt-stash: /prompt-stash/api')

  function sendJson(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
}
```
`readJsonBody`: `for await (const chunk of req)` with a byte cap — reference `host-open-in-app/lib/index.js:11-24`.

## 2. Browser authentication of a same-origin fetch

`ctx.connection.requestRejection(req)` (catalog:705; impl `dsh-client-connection/lib/index.js:737-747`) =
`isTrustedApiRequest` (:240-252) + browser-cookie / API-peer check → `401` (no valid session), `403` (untrusted Host/Origin),
`undefined` = allow. Both references call it first on every route (`dsh-better-sidebar/src/index.ts:1411`,
`dsh-host-open-in-app/lib/index.js:1264-1271`). Identity is a signed `HttpOnly; SameSite=Strict; Path=/` cookie
`dsh-auth-<sha256(authority)>` (`:335`, attributes :347), minted when index.html loads with `?token=<launch token>`
(`authorizeIndex` :458-497). A same-origin `fetch` (default `credentials:'same-origin'`) sends it — **no token or header in
client code**; a 401 is exactly a missing/expired cookie.

```js
// Client recipe — mirrors dsh-better-sidebar/src/client/host-route-url.ts:46-48, api.ts:255-257.
const url = new URL('prompt-stash/api/save', document.baseURI)   // RELATIVE: leading slash MUST be stripped
const r = await fetch(url.href, {                                // no credentials/headers needed
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
})
if (r.status === 401 || r.status === 403) throw new Error('prompt-stash: not authorized')
```
`document.baseURI` is `dsh-app://app/` in the Electron shell and a directory base behind a proxy — never build `'/prompt-stash/api'` (origin-root pins outside a proxy prefix) and never fetch `__DSH_TRANSPORT__.streamBaseUrl`.

**Pitfalls.** The shell's `protocol.handle` forwards every non-static path to the Host, deleting
`host/origin/cookie/sec-fetch-site` and injecting the Host cookie (`main.js:8268-8294`, dispatch :12411-12418): a direct
`fetch('http://127.0.0.1:<port>/…')` is cross-origin and plugin routes send **no CORS headers** → "Failed to fetch"
(`dsh-better-sidebar/src/client/desktop-env.ts:34-57`). The fence also needs `sec-fetch-site !== 'cross-site'` and a
same-authority `Origin`; a non-loopback Host must appear in the composition's `connection.trustedHosts` (`:1016-1032`).

## 3. Global DSH home (`<dsh home>`, default `~/.dsh`)

**Canonical: `ctx.profileContext.home`,** provided at boot:

```js
// dsh/lib/profile-boot-C14i-8IN.js:290-304
const profileContext = { name, dir: composed.profile.dir, patchPath, installAnchor, startedBundles,
                         cwd: process.cwd(), home: resolveDshHome(),   // ← global home: <dsh home>
                         overlays, telemetryDisabledEnv }
hostCtx.provide("profileContext", profileContext)
```
Consumers: `dsh-settings/lib/index.js:344-349` (`profileContext.home`), `dsh-shell-env:90-94` (`dir`→`DSH_PROFILE_DIR`). So `home` = global home, `dir` = profile dir.

Helper `@deepseek-ai/dsh-home-paths`: `resolveDshHome(configured?, env=process.env)` → explicit > `$DSH_HOME`
(whitespace-only = unset) > `~/.dsh`, `resolve()`-normalized (`lib/index.js:83-111`). Bare `@deepseek-ai/*` imports resolve
here only because `~/.dsh/profiles/node_modules/@deepseek-ai/` holds symlinks into the harness checkout
(verified: resolves from the plugin dir, `MODULE_NOT_FOUND` from a plain workspace).

**`process.env.DSH_HOME` is NOT reliable inside the Host.** The `DSH_*` variables are injected *per model shell call*
(`dsh-shell-env:84-94`) and ambient `DSH_*` are discarded by the executor (`:33-38`): a bash tool's values say nothing about
the Host process env.

### (b) Resolve the global dsh home
```js
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
const expandHome = (v) => (v === '~' ? homedir() : v.startsWith('~/') || v.startsWith('~\\') ? join(homedir(), v.slice(2)) : v)
/** $DSH_HOME, then profileContext.home, then ~/.dsh (mirrors resolveDshHome). */
export function dshHomeOf(ctx, env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (configured !== '') return resolve(expandHome(configured))
  const served = ctx?.get?.('profileContext')?.home          // lazy: may mount after apply()
  if (typeof served === 'string' && served !== '') return resolve(served)
  return join(homedir(), '.dsh')
}
```
`$DSH_HOME` honours the override; `profileContext.home` is what the Host itself computed (correct with no `DSH_HOME`);
`~/.dsh` is the documented default. Stash dir: `join(dshHome, 'prompt-stash')`.

## 4. Writes + safety

**No sandbox wraps plugin code.** `ctx.fs` is a service whose base class and bare local backend report
`sandboxMode === undefined`, documented as "does not confine at all"; confinement is a separate composition-selected backend
(`dsh-fs-sandbox`) plumbed through `ctx.sandboxPolicy` for **tool** layers (`dsh-fs/lib/index.js:76-86`, `api-catalog:1916`).
Host plugins are ordinary in-process Node modules with full `fs` rights. Precedents outside any workspace:
`dsh-credentials-local/lib/index.js:7-8` imports `writeFileAtomic` + `resolveDshHome`, `:58`
`join(resolveDshHome(...), '.credentials.yaml')`, `:552-564` `mkdir` + `writeFileAtomic`; `dsh-settings:348` writes
`join(profile.home,'settings.yaml')`; `dsh-better-sidebar/lib/index.js:1` imports `node:fs/promises` directly.

**Do not use `ctx.fs.writeText` for `~/.dsh`** — it is policy-gated per session (`dsh-drawai/lib/index.js:5714-5723` passes a
session sandbox policy and surfaces `[sandbox: <mode> @ <root>]` failures). Plain `node:fs/promises` has no such gate.

### (c) Atomic write helper (Windows-safe)
```js
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
const TRANSIENT = new Set(['EACCES', 'EBUSY', 'EPERM'])          // mirrors dsh-atomic-write:18-45

export async function writeFileAtomic(file, content, { mode = 0o600 } = {}) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode, flag: 'wx' })        // wx: never follow a planted symlink
    for (let attempt = 0, delay = 20; ; attempt++) {
      try { await rename(temp, file); return }                  // readers see old or new, never partial
      catch (error) {
        if (!TRANSIENT.has(error?.code) || attempt >= 8) throw error
        await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 200)
      }
    }
  } catch (error) { await rm(temp, { force: true }); throw error }
}
```
Same algorithm as `@deepseek-ai/dsh-atomic-write/lib/index.js:62-78` (which also offers `withFileLock` for cross-process RMW).

## 5. Open the folder in Windows Explorer

- **Raw spawn (recommended).** `dsh-better-sidebar/src/open-external.ts:262-299` spawns `spawn(cmd, args,
  { detached: true, stdio: 'ignore' })`, resolves on `'spawn'`, then `child.unref()`; Windows argv at :103.
- **Canonical helper** `openNativePath(path, signal)` / `revealNativePath` from `@deepseek-ai/dsh-native-command`
  (:219, :260): one argv element holding a file URL, and it **tolerates Explorer's exit code 1** (`:143-150`). Caveat: §3.

### (d) Open the folder
```js
import { spawn } from 'node:child_process'
/** Resolve once the OS opener actually started; reject only when it cannot start. */
export function openFolder(target) {
  const [command, args] =
    process.platform === 'win32' ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]]
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('spawn', () => { child.unref(); resolvePromise() })
    child.once('error', reject)          // ENOENT/EACCES; never wait for exit — Explorer may exit 1
  })
}
```
`execFile(..., cb)` is the wrong shape: its callback gets an error for Explorer's exit code 1, so the button reports a
failure for a folder that opened. `mkdir(dir,{recursive:true})` first, or a missing `~/.dsh/prompt-stash` opens Documents.

## 6. Attachments (feasibility)

1. `addAttachments(ids)` takes `string[]` of ids that must already resolve in the **browser** registry; `pruneAttachments`
   later drops unknown ones (`dsh-client-ui-conversation/lib/client.js:15131-15137, 15169-15173`).
2. Ids come from the host upload pipeline: `fileUploads.upload(sessionId,{data:base64,name})` → `{receiptId, file:{attachmentId,…}}`
   (`dsh-client-file-upload/lib/client.js:179-193, 285-289`; host `api-catalog:1001-1040`).
3. Bytes persist through `ctx.attachments` (`admitEncodedFile`, `api-catalog:351-400`) as a *file* attachment keyed by an
   owning Agent/Session. 4. So "stash entry → composer attachment" needs client → our route or `fileUploads` remote → durable
   `attachmentId` → `addAttachments([id])`; a client plugin cannot mint one from a string. Verdict: possible, but a session-bound round trip with real file bytes — not a shortcut for the file-backed stash.

## 7. Deltas to fix in the current `index.js`

1. `:477` `const connection = ctx.get('connection')` is captured once at `apply()`; if Connection mounts later the fence silently
   allows everyone. Add `'connection'` to `inject` (`:558`) or read it inside `fenced()`.
2. `:418-437` `openFolder` uses `execFile` + callback → Explorer exit 1 is reported as failure. Use §5(d).
3. `:92-108` `resolveDshHome` reads `process.env.DSH_PROFILE_DIR` — shell-tool-only (§3); use `ctx.profileContext?.home`.
