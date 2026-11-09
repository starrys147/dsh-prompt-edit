> 这份文件写于实现之前。文中「当前 entry.js 的缺口」一类描述是当时的状态，实现时已全部修掉（含 `.title` 槽位与组件图标），保留仅作追溯。
# DSH Client-plugin contracts — right-sidebar tab, left-sidebar panel, client slash command

All evidence from installed code (0.2.1-rc.5). Path shorthand:

- **A** = `<extracted app.asar>/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js`
- **P** = `<dsh home>/profiles/<profile>/node_modules/` (third-party plugins)
- **CAT** = `A dsh-cordis-client-runner` — generated **slot contract catalog**: kind, scope, options, standard props,
  occupants, examples per slot. Search `key: "<slot>"`. **B** = `P dsh-better-sidebar/src/client/native/` (typed consumer).
- **RN** = `P dsh-restart-now/lib/client.js`; **LL** = `P dsh-lamp-line/src/entry.js` — plain-JS consumers.

Props rule: `hooks: { x }` becomes a prop `use`+`X` (`A dsh-client-ui-renderer:451,494`);
`inject: (sessionId) => ({...})` adds plain props; `locale: NS` adds `t` (**omitting `locale` omits `t`**).

## 1. Tab types — service `sidebarRightTabs`

Provided at `A dsh-client-ui-sidebar-right:4965` (`ctx.reflect.provide("sidebarRightTabs", tabs)`), registry class
`:4560`, `register(definition)` at **`:4580`**.

| field | type | default | notes |
|---|---|---|---|
| `id` | string | — (required) | identity of the implementation; also the slot `key` for body/title. Duplicate throws `tab type id "X" is already registered` (:4585) |
| `kind` | string | — (required) | page/tab discriminator. Conflicts throw (:4587) except one `builtin`+one `extension` pair |
| `patterns` | string[] | `[]` | globs over `dsh-resource://` addresses (`matcherFor` :4531). With `:` → whole address; without → URI pathname, basename match, case-insensitive |
| `priority` | `'extension'\|'builtin'\|'fallback'` | `'extension'` | band; ranks 3/2/1 (`RANKS` :4491) |
| `canOpen` | `(address)=>boolean` | — | veto; `false` removes a candidate |
| `title` | `(address)=>string` | — (required) | chip text captured at open (`claim` :4720) |
| `guide` | entry[] | `[]` | see below |
| `keepMounted` | boolean | `false` | body stays mounted through hiding/tab+session switches (:1371, `:1547`) |
| `multiple` | boolean | `false` | each open gets `sidebar://<kind>/<uuid>` (:2301) |

Throws in `register`: duplicate `id`; duplicate `guide[].id` (:4583); kind already held non-coexistent (:4587).
Throws on open: `no tab type is registered as "<kind>"` (:2299), `no session surface is mounted` (:2597),
`no registered tab type claims "<address>"` (:2294).

`guide` entries — `{ id, order, title: () => string, description?: () => string, icon?: Component }`
(`B/index.ts:96-108`; consumed `:5009-5120`):

- `id` required, unique per provider (`:4583`); `order` compared numerically (`:4734`) — **always supply a number**.
- `title`/`description` are **thunks**, called per render (`:601-621`); `description` renders only while the guide lists ≤ 4 entries (`:516`) — omit the field rather than pass `''` (`B/index.ts:120-130`).
- `icon` is a **React component**: `<Icon size={22|26} … />` (`EntryBox` :517-535); missing → cube placeholder.

## 2. Opening a tab — service `sidebarRight`

Controller class `:2210`; provided `:4966`. Public face:

- `openTab(kind, options?)` :2243 → `placeTab` :2298; `openResource(address, options?)` :2234 claims by globs
- `openTabIn(sessionId, …)` :2267 / `openResourceIn` :2255 — for a tab's own `tab.actions` (not on `ISidebarRight`)
- `active()` :2351 (active tab of the active pane), `isExpanded()` :2361, `toggleExpanded()` :2365, `focus(tabId)` :2377, `close(tabId)`, `tabsIn(sessionId)` :2222, `openTabs` (:2141, inventory snapshot store)
- `options`: `{ kind?, paneId?, replaceTab?, revealIfOpened?, preferNewPane?, params? }` (`place` :2309-2322) — `params` is JSON-shaped, unchecked, delivered as `navigation.params`.

**Visibility: `ctx.layout.openRightbar()` is NOT needed.** `openContent` starts with
`planSetExpanded(state, true)` (`:1115-1118`); the seat then reports geometry itself via
`syncPresentation({shown,…})` → `layout.openRightbar(track, fullscreen)` (`:5004-5006`, called `:1610,1632`).
`openTab` throws when no Session surface is mounted (`:2597`) — always guard it. README:93 states the same.

## 3. Tab body / chip — keyed slots `sidebar.right.pane.tab` and `.title`

Exact consumer call (`B/index.ts:255-290`), verified against `CAT` (`key: "sidebar.right.pane.tab"`):

```js
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: DEFINITION_ID,               // = the tab type's `id` (the dispatch key)
  locale: NS,                       // optional; adds `t`
  inject: (sessionId) => ({ … }),   // plain props; the `tabInfo` hook is already supplied by the DECLARATION
}, Body))
```

Kind = `keyed`, scope = `session`, declared by `rightbar.session` (`:5046-5055`). Standard props (CAT `:5861-5885`):
`useRemoteAccess useResource useWorkspaces usePanelInfo useSessions useSessionStatus useSessionRetainInfo
useSessionAccess useWorkspaceAccess useChat useConversation useInput useSession useProjection useAccess useTrajectory`
plus plain `sessionId`, `inputActions`, and the declaration-supplied **`useTabInfo`**.

`useTabInfo()` (`tabInfoFactory` :4856-4900) returns:

```js
{ sidebar: { expanded, fullscreen }, panel: { id: paneId },
  tab: { id, kind, title, contentId, visible,
         navigation: { address, params, revision },   // createSnapshotStore; read navigation.params each render
         signal,                                       // AbortSignal, aborted on close
         actions: { openTab, openResource, close, bindCommands },
         refreshShortcut } }
```

Read your own params as `const { tab } = props.useTabInfo(); tab.navigation.params` (built-ins:
`A dsh-client-ui-plan:179-182`, `A dsh-client-ui-sidebar-documentpreview:527-528`); `navigation.revision` bumps on every
re-navigation — re-seed local state when it changes.

Title chip `sidebar.right.pane.tab.title` — same `key` and `useTabInfo`, same standard props. Register nothing → the chip
shows `definition.title(address)` captured at open time (`:1441`).

## 4. Left sidebar entry (`sidebar.panellist`) + main page (`main`)

`sidebar.panellist` — **list**, scope **root**, declared by `sidebar` (`A dsh-client-ui-sidebar:627-631`). Options
(CAT `:5764-5800`): `id` **required** (your cell; also the panel id), `order` (number, default 0), `label` (string or
thunk, resolved via `resolveSlotLabel`), `locale`. The sidebar builds the whole row (button, tooltip, label,
`aria-current`) and renders **only your glyph**: `renderSlot('sidebar.panellist', { size, active }, { only: id })`
(`:226`); owner props = `{ size: number, active: boolean }`. **There is no `onClick`** — selection is automatic, the row
calls `ctx.layout.selectPanel(id)` (`:209-222`).

`main` — **keyed**, scope **root**, declared by `AppFrame` (`A dsh-client-ui-layout:631-640`), option only `key`
(**required**, string), dispatched as `renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })`
(`:118-120`). So **panellist `id` must equal main `key`**; `layout.selectPanel(id)` throws `main panel "id" is not
registered` otherwise (`:468-471`). `activePanelId` is auto-cleared when your `main` entry disappears (`:407-411,614-617`)
— no manual cleanup needed. Standard props = the ten root hooks (CAT `:4383-4393`); no `sessionId`/`inputActions` at root
scope. Key `conversation` is taken. Pairing examples: `RN:1320-1327` (both `id`/`key` = `PANEL_ID`), `LL:56-66`,
`A dsh-client-ui-schedule:7476-7491`.

## 5. Client slash command — service `commandUi`

`CommandUiRuntime` `A dsh-client-ui-commands:1394`, provided as service `commandUi`; `register(contribution)` **:1451**.
Contribution:

```js
{ name: 'prompt',                     // required, no leading '/'
  label: () => string,                // optional; thunk, re-read per menu
  description: () => string,          // optional
  icon: Component | string,           // optional; string = ReferenceIconRegular *kind*, else <Icon size={14}/>
  available: (session) => boolean,     // REQUIRED (called unguarded at :1545,1561,1636)
  ui: { kind: 'action', run: (session) => void }
  // or { kind: 'popupSelect', options: async (session) => ..., onSelect?, searchMode?, searchLabels? }
}
```

- Rows: `candidates()` (:1533) merges host catalog rows, then available contributions, then `sectionRows` (empty query)
  or `rankByName` (typed) — ordering is ranking, not registration order (`:1548-1554`).
- Enter: `matchEnter` (:1624) matches contributions **before** the host catalog; an `action` runs only for a **bare**
  token, consumes it from the draft, calls `ui.run(session)` and returns `'handled'` (`invoke` :1678-1681). With
  arguments the line falls through to the host.
- Collision: `contribution /X collides with a host command` **:1546**, thrown from `candidates()` — i.e. when the `/`
  menu opens, not at register time. Per-source containment (`A dsh-client-ui-input-trigger:1436` → `source-failed`)
  means the whole `/` command menu goes empty.
- Access: `ctx.get('commandUi')` (`A dsh-client-ui-permission-presets:758`) or
  `ctx.inject(['commandUi'], scope => scope.commandUi.register(...))` (`A dsh-client-ui-model-selection:1864-1895`).
  Real `action` consumers: `A dsh-client-ui-conversation:19897-19910` (`/file`); `A dsh-client-ui-message-feedback:862-874`
  shows `decorate` (host-command decoration), not `register`. Duplicate `name` within your plugin throws at register (:1454).

## 6. Dynamic client module mechanics

- Classic script: `window.__ModuleLoader__.load({ id: '<package name>', factory(require) { … return { inject, apply } } })`;
  `id` must equal the graph row id = package name (`A dsh-client-modules:683-695`, duplicate throws); the factory return is
  the cordis plugin.
- `package.json`: `dsh.client = { platform: 'web', immediately?: true, inject: ['@deepseek-ai/dsh-client-…'] }` — packages,
  whereas the module's own `inject` lists cordis **services** (`slots`, `locale`, `sidebarRight`, `sidebarRightTabs`, `commandUi`).
- `require('react')` works; `@deepseek-ai/dsh-client-ui-primitives` also resolves but is optional — guard it (`RN:63-67`).
- `ctx.effect(fn,label)`, `ctx.on`, `ctx.get(name)`, `ctx.inject([...], cb)`, `ctx.slots.*` are all available. Register inside
  `ctx.effect` (unload disposes), and wrap slot registrations in `ctx.slots.inject(name, …)` — a slot only accepts
  registrations after its owner declares it.
- CSS: one `<style data-plugin-css="<pkg>/<file>.css">` in `document.head`, de-duped by the matching
  `document.querySelector` (`RN:342-350`, `A dsh-client-ui-layout:74-83`); no shipped plugin removes it.
- `ctx.locale` is **optional**: without it everything renders, but `locale: NS` renders raw keys (`translate()` falls back to the key, `A dsh-client-locale:1423-1428`) — use `register(NS,{zh,en})` + `bind(NS)`.

## 7. Copy-paste skeleton

```js
window.__ModuleLoader__.load({
  id: 'dsh-prompt-stash',
  factory(require) {
    const React = require('react')
    const NS = 'promptStash'
    const KIND = 'prompt-stash'                 // page kind, also the guide entry id
    const TYPE_ID = 'dsh-prompt-stash:editor'   // tab-type id == body/title slot key
    const PANEL_ID = 'prompt-stash'             // panellist id == main key
    const zh = { panel: '提示词', cmd: '打开提示词编辑器' }
    const en = { panel: 'Prompts', cmd: 'Open the prompt editor' }

    const CSS = '.dps-body{display:flex;flex-direction:column;height:100%;padding:12px}'
    const CSS_ID = 'dsh-prompt-stash/client.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-prompt-stash'; tag.dataset.pluginCss = CSS_ID; tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function Body(props) {
      const { tab } = props.useTabInfo()
      const params = tab.navigation.params ?? {}
      const [text, setText] = React.useState(params.text ?? '')
      React.useEffect(() => { setText(params.text ?? '') }, [tab.navigation.revision])
      return React.createElement('textarea', { className: 'dps-body', value: text, disabled: !tab.visible,
        onChange: (e) => setText(e.target.value) })
    }
    function Title(props) { return props.useTabInfo().tab.title }
    function Glyph(props) {
      return React.createElement('svg', { width: props.size, height: props.size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor' }, React.createElement('path', { d: 'M3 2h10v12H3z M5 5h6 M5 8h6' }))
    }
    function MainPage(props) {                     // no inject -> root standard props only
      props.useSessions((s) => s)
      return React.createElement('div', { className: 'dps-body' }, 'Prompt Stash')
    }

    return {
      inject: ['slots', 'locale'],                 // sidebarRight* / commandUi are awaited below
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-stash: dicts')
        const t = ctx.locale.bind(NS)
        // (a) tab TYPE  (b) BODY keyed by the type id  (c) chip title
        ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
          const tabs = scope.sidebarRightTabs
          if (tabs === undefined) return
          scope.effect(() => tabs.register({
            id: TYPE_ID, kind: KIND, keepMounted: true,
            title: () => t('panel'),
            guide: [{ id: KIND, order: 40, title: () => t('panel'), icon: Glyph }],
          }), 'prompt-stash: tab type')
          scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
            name: 'sidebar.right.pane.tab', key: TYPE_ID, locale: NS,
          }, Body))
          scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
            name: 'sidebar.right.pane.tab.title', key: TYPE_ID, locale: NS,
          }, Title))
        })
        // (d) left rail entry + (e) main page — same id/key
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, MainPage)), 'prompt-stash: main page')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => t('panel'), locale: NS,
        }, Glyph)), 'prompt-stash: rail entry')
        // (f) client slash command -> opens the tab
        ctx.inject(['commandUi', 'sidebarRight'], (scope) => {
          scope.effect(() => scope.commandUi.register({
            name: 'prompt', available: () => true,
            label: () => t('cmd'), icon: Glyph,
            ui: { kind: 'action', run: () => {
              try { scope.sidebarRight.openTab(KIND, { params: { text: '' } }) } catch (e) { console.error(e) }
            } },
          }), 'prompt-stash: /prompt')
        })
      },
    }
  },
})
```

## 8. Things that break the skeleton

1. **`openTab` with no mounted Session throws** (`no session surface is mounted`, `:2597`) — always try/catch.
2. **Type before open**: opening an unregistered kind throws (`:2299`); the tab-type registration must be live first.
3. **panellist `id` ≠ `main` `key`** → clicking the rail entry throws `layout.selectPanel: … is not registered`.
4. **`/prompt` colliding with a host command empties the whole `/` menu** (throw inside `candidates`, `:1546`), and is not
   catchable at register time. Prefer a distinctive name or accept the risk knowingly.
5. **`icon` string** on a contribution means `ReferenceIconRegular kind`, not a glyph — pass a component.
6. Register the tab type inside `ctx.inject(['sidebarRightTabs'])`: the slot declaration appears before the service, so a
   declaration-triggered registration reads it as missing (`B/index.ts:196-205`).
7. `keepMounted: true` means your body keeps state across hiding/session switches — do not rely on unmount to reset.
8. Current `src/client/entry.js` gaps: no `sidebar.right.pane.tab.title` registration (chip keeps the captured title after
   a rename); `service('sidebarRight').mounted` is internal (`:2214`); command `icon: '▤'` is a string → reference-icon kind.
