# AUDIT — dsh-prompt-stash 0.1.0

Adversarial review, read-only against the plugin sources. The sources changed twice while this
audit was in flight (model.js/ui.js at 10:34, dom tests/client.js at 10:36, 2026-11-05 +08:00), so
this report pins the exact snapshot it audited:

| file | sha256 (prefix) |
| --- | --- |
| `index.js` | `4bfbc1e830eb7a46…` |
| `client.js` | `3bd07b0b0cc2faa4…` |
| `src/client/entry.js` | `c46109950f3930a7…` |
| `src/client/model.js` | `2fa2f3db5a8ac35d…` |
| `src/client/ui.js` | `bd6311be29d1ea0a…` |
| `tests/dom.test.mjs` | `0e5025be89748879…` |
| `tests/host.test.mjs` | `405ea73776e7f314…` |
| `tests/model.test.mjs` | `02518562fd583986…` |
| `tests/ui.test.mjs` | `b40327b0d1014c24…` |
| `README.md` | `aa84690a53e62e7d…` |
| `notes/DELIVERY.md` | `b7c21f682f84ae51…` |

At this snapshot: `node --test tests/` = **52/52 pass**, and `node build.mjs` reproduces
`client.js` byte-for-byte (same hash before/after). Note the docs still say 50 tests; two were
added after they were written.

---

## 1. Verdict

The storage layer, the global-directory resolution, the no-delete promise, the left-rail/`main`
registration and the inject/save semantics are implemented with care, and the code mostly matches
the contracts in `notes/*-contracts.md`. It is nevertheless **not ship-ready**: both write paths
out of the archive are unusable in the real app. While the archive page is the active main panel
the harness clears `sidebarRight.mounted`, so "new draft", "new template" and card-open all bail or
throw, the retry calls `layout.openRightbar` (which does not change `activePanelId`), and the
"back to chat" fallback passes `'conversation'` where the harness only treats `activePanelId ===
null` as the conversation. Separately, requirement 2's "create a new prompt draft from a template"
exists only as an unused host/model helper: the template card's "用模板新建" button actually opens
the template itself, and saving from there overwrites the template. On top of that there is a
duplicate-save race on repeated Ctrl+S, a draft-persistence lifecycle bug, two real i18n defects,
and tests that structurally hide the archive/runtime failures (the DOM harness stubs
`currentSessionId`, and one test asserts nothing at all). Verdict: **block on A1/A2, fix A3–A6,
then re-run the suite and re-check the real window.**

---

## 2. Findings

Severity: **blocker** = requirement miss or unusable feature; **should-fix** = real defect with a
clear fix; **nit** = correctness/polish/docs.

| id | severity | area | file:line | what is wrong | concrete fix |
| --- | --- | --- | --- | --- | --- |
| A1 | **blocker** | Template → draft (req. 2) | `src/client/ui.js:1199-1205`, `src/client/ui.js:1246-1250`; `src/client/model.js:780`, `src/client/model.js:849`; `index.js:443-461` | The only template affordance is `ArchiveCard.open()` with `kind:'template'`, so "用模板新建 / New from template" opens the **template** in the editor (badge 模板). A save from there updates the template entry with the draft text — it does not create a draft. `M.fromTemplate` and the host `fromTemplate` action are dead code (no caller in `ui.js`/`entry.js`; only `tests/host.test.mjs:260` exercises it). Requirement 2's "create new prompt drafts from templates" is not delivered end to end. | In `createRuntime` add `newDraftFromTemplate(templateId)` that resolves the session (see A2), calls `M.fromTemplate(id, session, workspace)`, then `M.requestOpen({kind:'note', id: doc.id, sessionId})` + `openEditorTab()`. Wire the template card/button to it (and, if wanted, add a separate "edit template" label for the template itself). Add a DOM/entry test that a template click ends in a note, not a template update. |
| A2 | **blocker** | Archive → editor plumbing | `src/client/entry.js:134-144` (`currentSessionId`), `:176-212` (`openEditorTab`), `:215-226` (`openDocument`), `:235-238` (`goChat`); `src/client/ui.js:1285-1295` (`createDraft`) | The archive is a root `main` panel; while it is active the harness's right-sidebar on-screen store is `undefined`. Evidence in the running 0.2.1-rc.5 build: `dsh-client-ui-sidebar-right/lib/client.js:4954` does `show(panelInfo.activePanelId === null ? selected?.sessionId : undefined)` and `:1723` hides the session views on the same condition; `layout.selectPanel(null)` is how the shipped workspace plugin returns to the conversation. Therefore `currentSessionId()` is `''` on the archive page: `createDraft` toasts `needSession`/`goChat` and returns; `openDocument` sets a session-less request, `openTab` throws "no session surface is mounted", the catch retries `controller.openTab` in the same tick after `layout.openRightbar(true,false)` (openRightbar does **not** change `activePanelId`, so the retry cannot succeed), then `goChat()` sets `'conversation'` — which the rightbar does not treat as the conversation (`activePanelId === null` is required), leaving `mounted` unset and the rightbar hidden. Net: card-open, 新建草稿 and 新建模板 cannot open/reveal the editor from the archive; the only accident that "works" is a card click while the editor tab is already mounted (the hidden body adopts the request), and even then the user is bounced to chat with the column hidden. | Add `ensureOnScreenSession()`: if `currentSessionId()===''`, call `layout.selectPanel(null)` (the panelInfo store notifies the rightbar synchronously, so `mounted` is set before return) and re-read. Call it at the start of `createDraft` and `openDocument`; only `requestOpen` after the id is known; only `goChat`/toast `needSession` when it is still `''`. Change `goChat` to `layout.selectPanel(null)`. Add an entry.js test with a fake ctx: mounted `undefined` → assert `selectPanel(null)` then `openTab`; no `'conversation'` id. |
| A3 | should-fix | Save concurrency | `src/client/ui.js:918-960` (`saveNow`), `:1003-1019` (`onKeyDown`), `:1144-1152` | The Save button is disabled while `status==='saving'`, but the Ctrl+S branch calls `saveNow` unconditionally and `saveNow` has no in-flight guard. Two quick presses both serialize `doc` with `id:''` (`ui.js:930`), so the host mints two notes from one draft; the later response wins the editor while the first note stays in the library. | Keep a `savingRef` (or check `status === 'saving'` inside `saveNow` and in the key handler), set it before the await and clear in `finally`; optionally mint/keep an id after the first create. Add a DOM test with two Ctrl+S presses against a delayed fetch, assert exactly one `save` call / one note. |
| A4 | should-fix | Draft persistence lifecycle | `src/client/ui.js:855-858` (autosave effect), `:949-950` (save path) | Two bugs in one effect. (a) After a successful save, `M.writeLocalDraft(sessionId, null)` clears the draft, then `setDoc(next)` triggers the effect 350 ms later and writes the just-saved doc back as a "local draft" — the clear is undone and a stale copy can later overwrite a newer host entry; (b) `clearTimeout` in the effect cleanup drops the pending write when the tab unmounts, so closing the tab within 350 ms of typing loses unsaved text (README:22 promises per-session fallback). | Only write when `doc.dirty`; keep the latest doc in a ref and flush it in a separate unmount cleanup; after a save, suppress exactly the next autosave (ref flag) instead of relying on the timer ordering. Cover both with DOM tests (unmount immediately after typing; save then wait 500 ms and assert storage is gone). |
| A5 | should-fix | i18n / locale | `src/client/model.js:411` (`t.lang`), `src/client/model.js:309-310` (date units), `src/client/entry.js:119-122` (translator), `src/client/ui.js:716-717`, `:759` | `groupOf` passes `t.lang` to `colorName`, but production `runtime.translate()` returns `{t, lang}` and never stamps `t.lang`; the unit tests hide this by doing `t.lang='zh'` (`tests/model.test.mjs:11`). Probe: EN colour grouping yields `["蓝"]`. `formatWhen` hard-codes `月/日/年`, so EN cards show `9月26日`. `remove ${tag}` and `Custom colour` are hard-coded English even in ZH (only the custom-colour title is bilingual). | In `runtime.translate()` set `localeCache.t.lang = localeCache.lang`; move the date suffixes into ZH/EN keys and pass them through `t`; add `removeTag`/`customColor` keys and use them in `TagEditor`/`ColorPicker`. Extend model/i18n tests to assert EN output without hand-stamping `.lang`. |
| A6 | should-fix | Test quality / false confidence | `tests/model.test.mjs:168-173`, `:207-209`; `tests/ui.test.mjs:202-203`; `tests/dom.test.mjs:119-147`, `:412-462`; no `entry.js` test | (i) The "every text field is HTML-free" test asserts only `globalThis.__PromptStashUI === undefined` — it can never fail and proves nothing (XSS is actually covered in `ui.test.mjs:250-263`). (ii) The "route URL keeps a reverse-proxy prefix" test has no `document`, so it asserts the `http://dsh.internal/` fallback, never the prefix branch. (iii) `assert.equal((html.match(/class="ps-btn ps-btn ps-ed/gu)||[]).length, 0)` matches a string that cannot exist. (iv) No test imports `entry.js`; the DOM runtime stub returns `'session-1'` from `currentSessionId` and `openEditorTab` unconditionally, so A1/A2 cannot surface. (v) jsdom/profile React paths are hard-coded (a scratch `node_modules` and the profile path) and a missing path silently registers one skipped test, so "52 pass" is environment-specific and green-on-skip elsewhere. | Delete/rewrite (i) and (iii); set `globalThis.document={baseURI:'http://host/prefix/'}` in (ii) and assert `http://host/prefix/prompt-stash/api/library`. Add an entry.js unit test with a fake `window.__ModuleLoader__`/ctx covering `/prompt` `ui.run` and A2's `selectPanel(null)` path. Pin jsdom as a devDependency (or fail loudly, not skip) and document the required profile React path. |
| A7 | nit | Save result not reconciled | `src/client/ui.js:941-949` | After save the editor copies only `id`/`savedAt`/`title` from the host entry; a tag longer than 24 chars or a normalised colour/session survives in the UI as "saved" although the host stored something else (host `normalizeTags` drops it), and re-opening shows a different value. | Rebuild the document from the returned `entry` (title, colour, tags, session, workspace) while keeping the local body. |
| A8 | nit | Markdown renderer keys | `src/client/ui.js:622`, `:634-695` | `nextKey()` is `b${i}` using the current line index; adjacent block types can share a key. Probe: `renderMarkdown('- a\n# b')` returns `ul key b1` **and** `h1 key b1`. React duplicate-key warnings / stale reconciliation when the preview updates. | Use a monotonic counter incremented in `nextKey()`; keep the inline prefix separate. Probe with a render test that asserts sibling keys are unique. |
| A9 | nit | Narrow-column CSS | `src/client/ui.js:50` (`container-type`), `:527-531` (`@container`), `:288` (`.ps-actions`) | `.ps-root` is the query container and is also `.ps-editor`; a container query cannot style the container itself, so `.ps-editor { padding: 8px 9px 10px }` never applies (the other two rules target descendants and do work). `.ps-actions` has no `flex-wrap`; at the harness's 300 px right-column minimum the four EN buttons (`Save`, `Save as template`, `Insert`, `Send`) exceed the ~276 px content box and overflow. | Move the narrow padding onto descendants (or an inner wrapper); add `flex-wrap: wrap` to `.ps-actions`. This needs a visual check at 300/320 px in both themes. |
| A10 | nit | Session/workspace refs are captured once | `src/client/ui.js:815` (`useMemo`), `:842-852` (booted effect once); `src/client/entry.js:147-173` | `describeSession` reads `sessions.list.getSnapshot()` without subscribing; `meta` only recomputes when `runtime`/`sessionId` change, and the restore effect is one-shot. If the tab mounts before the session summary/title is populated, or the session is renamed or its cwd changes, the saved entry keeps the stale title/cwd (workspace grouping can be missing). Live library shows the happy path worked. | Subscribe with `useSyncExternalStore` to the sessions list (or a `useSessionSummary` hook), recompute `meta`, and fill `doc.session/workspace` while they are still unset. |
| A11 | nit | Diagnostics growth / temp-name race | `index.js:45` (2 MB body cap), `:598-619` (`report` history), `:331-334` (`writeAtomic`) | `report` stores the caller's report verbatim in a 20-entry history after accepting up to 2 MB, so `diagnostics.json` can reach ~40 MB; concurrent same-millisecond reports also share `${target}.${pid}.${Date.now()}.tmp` (`wx`), so one fails with EEXIST. | Cap the stored report (e.g. 16-32 KB, truncate long strings/errors) and serialise report writes through `store.withLock`; include a random suffix in the temp name. |
| A12 | nit | Docs overstate / are stale | `README.md:49` and `:59`; `notes/DELIVERY.md:59`, `:66`, `:81`; `notes/client-contracts.md:248-249`; `notes/host-contracts.md:194-198` | Test counts say 50 (now 52); "两个窗口同时保存不会互相覆盖" is only true inside one Host process (the lock is in-memory, `index.js:257-269`, no cross-process lock); `client-contracts.md` §8.8 still says the current entry.js has no `.title` slot and a string icon (both fixed); `host-contracts.md` §7 still lists three "deltas to fix" that are already fixed; `DELIVERY.md` says the archive expand-retry makes `/prompt` work (A2 shows it does not). | Update the counts; qualify the concurrency claim ("same Host process"); mark the contract "deltas" as resolved and re-check the entry.js gap list. |
| A13 | nit | Fence fails open | `index.js:543-552` | `fenced()` returns **true** when `connection`/`requestRejection` is unavailable, so the route becomes unauthenticated in exactly the mismatch it is meant to survive. `inject = ['webServer','connection']` makes that state unlikely, but fail-open is the wrong default for a write route. | Return 403 (or 503) when the fence cannot be evaluated; keep the deliberate pre-fence `report` log line as-is but still refuse the body write. |
| A14 | nit | Store race (load vs save) | `src/client/model.js:621-633` (`load`), `:755-766` (`save`) | Both replace `store.library`; a slow initial `library` response can land after a save response and overwrite the newer library (archive shows a stale list until reload). | Tag loads with a monotonic token and ignore responses older than the last applied mutation, or merge the saved entry into the current library. |
| A15 | nit | Template copy reads outside the lock | `index.js:443-461` | `draftFromTemplate` reads the template body/library and then `saveEntry` takes the lock; a concurrent save of the template can seed the draft from a stale body. (No delete exists, so it is only an update race.) | Read the template and body inside the `withLock` section, or pass a locked `saveEntry` variant the body read under the same lock. |
| A16 | nit | Premature "created" toasts / wrong confirm label | `src/client/ui.js:1294`, `:1113` | "新建草稿/新建模板" toasts `templateCreated`/`draftCreated` before anything is saved; the overwrite-confirm primary button is labelled `openInEditor` ("在编辑器中打开") though it discards the current draft. | Use "已打开新草稿/模板" wording; add a `discardAndOpen` key for the confirm button (e.g. 放弃并打开 / Discard and open). |
| A17 | nit | Optimistic send / wrong error key | `src/client/ui.js:984-1001`, `:979-981` | Send toasts 已发送 even when `inputActions.submit` is absent (hasComposer only checks `setDraft`) or the submit no-ops; inject/send failures are reported with the `saveFailed` key ("保存失败"). | Treat a missing `submit` as no composer; add `injectFailed`/`sendFailed` keys. |

---

## 3. Claims I could not verify

- **Real rendering.** No screenshot or click evidence: without a remote-debuggable Electron window I
  could not inspect the real right column at 300–460 px, dark mode, card density, the new inline
  confirm bar, or focus order. A9 is from CSS reasoning, not eyes.
- **`/prompt` → tab actually appears in a live session.** The live
  `<dsh home>/prompt-stash/diagnostics.json` (received 2026-11-05T02:35:05Z) shows
  `tabType/tabGuide/tabBody/tabChip/command/rail/main: registered`, `editorMounted` set and
  `composer: "present"`, but `openTab: null` in every entry — the plugin's `openEditorTab` has
  never recorded success in the live page. Source analysis says the happy path works when a
  conversation is active; I could not click it.
- **Inject / Send against the real composer.** Verified only from harness source: `setDraft`
  replaces the whole draft and does not focus (`dsh-client-ui-conversation/lib/client.js:14951-14964`
  and `:15032-15045` in the running 0.2.1-rc.5 build), and `submit` dispatches `enter` with the
  current projection; the plugin never calls `focus`. The real contenteditable/caret/scroll
  behaviour is untested.
- **Open archive folder.** The host `openFolder` + Explorer exit-1 tolerance look correct, but the
  live diagnostics/log contain no `openFolder` call; I did not verify that the folder opens.
- **Cross-process concurrency.** The README's "two windows cannot overwrite each other" holds only
  inside one Host process (in-memory `withLock`); I did not run two DSH processes against the same
  `~/.dsh/prompt-stash`.
- **Multi-session / `keepMounted` state.** The harness documents that `keepMounted` bodies survive
  session switches; the plugin's per-tab document state is not reset by `sessionId`. I reasoned
  that the harness gives each tab occurrence its own component instance (so no cross-session leak),
  but I did not run a two-session scenario.
- **The installed bundle being served.** `mount.json` says 0.1.0 and the live diagnostics match,
  but I cannot hash the `client.js` the page executed; the local rebuild is byte-identical to the
  sources at the pinned snapshot.
- **English locale in the real app.** The locale service shape is verified
  (`getLocale().active`, `subscribe`), and the i18n defects in A5 were reproduced against the pure
  functions; I did not switch the live app to EN.
- **`@deepseek-ai/dsh-client-ui-slots`** appears in `package.json:dsh.client.inject`, but no such
  package exists in the installed 0.2.1-rc.5 set I inspected; reading `dsh-client-modules/lib/client.js`
  shows missing inject targets are skipped, so it is harmless, but I could not confirm the intended
  dependency/casing.
- **Screen-reader behaviour** of the editor's `role="alertdialog"` confirm bar and of the archive
  cards (`role="button"` with a nested button) was not tested.

---

## 4. What I checked and found correct

- **Tests/build.** 52/52 pass at the snapshot; `node build.mjs` reproduces `client.js` exactly
  (hash unchanged); building does not dirty the tree.
- **No delete anywhere.** Host action table has no delete/remove/trash/destroy (and those names
  return `unknown-action`), no helper exists, the archive has no delete button/menu, and the footer
  states the promise. The only "remove" in the UI is `TagEditor`'s tag chip (metadata editing) and
  `fs.rm` of the atomic-write temp file — neither removes archive entries.
- **Inject semantics.** The plugin calls only `inputActions.setDraft(fullBody)` (+ optional
  `persistDraft`) and never `focus()`; the harness's `setDraft` is a whole-draft replacement and
  does not focus. Ctrl+Enter is intercepted with preventDefault/stopPropagation.
- **Send has no shortcut.** Only the Send button calls `submit`; no keyboard branch maps to send;
  the DOM tests assert Ctrl+Shift+Enter does not submit. The plugin does not call `focus` anywhere.
- **Save.** Ctrl+S sends kind/title/body/color/tags/session/workspace; a live saved entry in
  `~/.dsh/prompt-stash/library.json` carries the real session id/title and cwd-derived workspace,
  so "global stash associated with the session" is demonstrated in practice. A second save reuses
  the host-returned id (in-place update) under normal, non-double-press use.
- **Global directory.** `profileContext.home` wins, then `DSH_HOME`, then the profile-dir
  grandparent, then `~/.dsh`; live `mount.json`/`library.json` are under
  `<dsh home>/prompt-stash`, not the workspace or plugin dir.
- **Entry points.** `sidebar.panellist` id = `main` key = `prompt-stash` (left rail), the editor is
  a native `sidebarRightTabs` type (`prompt-stash:editor`, body and `.title` keyed by that id), and
  `/prompt` is registered through `commandUi` as an `action`. Live diagnostics show all of these
  registered (only `openTab` itself untested).
- **Archive view.** Tiled CSS grid (`auto-fill, minmax(238px,1fr)`), no tree; scope/query/colour/
  tag filters compose; group/sort by time, session, workspace, colour, tag; facets; empty and
  error-with-retry states; templates can be created; "open archive folder" is present.
- **Storage correctness.** Metadata in `library.json`, bodies in `notes/`+`templates/` as markdown;
  ids are filename-safe (`^[nt]_[a-z0-9]{6,32}$`) and every read/save/meta/fromTemplate path
  validates them; temp-file + `wx` + rename writes with bounded Windows retry; one writer queue per
  process; corrupt library degrades to an empty stash; 2 MB request cap and 512 K body clamp; tags/
  colours normalised; `deleteEntry`/`removeEntry` absent.
- **Security.** Markdown is rendered with React text nodes only — no `dangerouslySetInnerHTML`,
  no raw HTML, links restricted to http/https/mailto; `openFolder` takes a host-resolved path, not
  a request path; the JSON route is fenced by `connection.requestRejection` (fail-open edge noted in
  A13); `report` logging is size-capped (64 KB) though its JSON history is not (A11).
- **Theme.** Every `--dsw-alias-*` token the stylesheet references exists in the shipped 0.2.1-rc.5
  frontend CSS (`bg-base`, `bg-layer-1/3`, `border-l2/l4`, `label-*`, `markdown-code-block`, `link`,
  `toast-*`, `state-*`, `scrollbar-*`, `brand-primary`); fallbacks are light-only but only used when
  a token is absent.
- **Data shapes.** Client and host agree on `library`/`entry`/`entry.kind`, `read`→`{body}`,
  `save`→`{entry,library}`, `settings` patch merge, `fromTemplate`→`{entry,body,library}`,
  `openFolder`→`{dir}`; session refs `{id,title,cwd}` and workspace refs `{id,name,path}` round-trip
  through `normalizeEntry`.
- **Pure shaping.** `groupEntries`/`filterEntries`/`colorFacets`/`tagFacets`/`compare`/`formatWhen`/
  `timeBucket`/`deriveTitle`/`documentOf`/`initialDocument` are covered by the model tests
  (the gaps are in the test list in A6, not in the shaping itself). The duplicate-key defect is in
  the renderer only (A8).

---

## 5. Re-review — 2026-11-05 11:37 +08:00

This section supersedes the status of the findings above; the original snapshot is kept for history.
The tree was still being written while this pass ran (model.js 11:28:50, ui.js/dom.test 11:30:06,
index.js 11:30:39, host.test 11:31:03). The first run at 11:28 reproduced the expected **61** tests;
after those edits the stable snapshot has **63**.

| file | sha256 |
| --- | --- |
| `index.js` | `9e42ab0def445d83…` |
| `client.js` | `21beec78d85dc92c…` |
| `src/client/entry.js` | `5c16db85ea8a31be…` |
| `src/client/model.js` | `de718867d0cd7a14…` |
| `src/client/ui.js` | `6810ac1810896a13…` |
| `tests/dom.test.mjs` | `577064979f2f16ca…` |
| `tests/entry.test.mjs` | `f9ff2dd94ad332cd…` |
| `tests/host.test.mjs` | `0ff3be8f41a2563d…` |
| `tests/model.test.mjs` | `190a01fe7d24361f…` |
| `tests/ui.test.mjs` | `774daa0cbd680d7f…` |

Verified: `node --test tests/` = **63/63 pass, 0 skip**; `node build.mjs` before/after is
**byte-identical** (`client.js` `21beec78…`). Live desktop evidence: the plugin's
`<dsh home>/prompt-stash/diagnostics.json` latest (received 2026-11-05T03:35:01Z) carries
`openTab: {ok:true, deferred:true, at:03:34:52Z}`, i.e. the new deferred recovery **ran and
succeeded in the real app**; `mount.json` remounted at 03:35:28Z. The live library still has
**0 templates**, so B1's template flow has test/probe evidence only, not live evidence.

### 5.1 Closed (verified in code, not just in tests)

- **B1** — pointer path closed: the template card's footer button calls
  `runtime.newDraftFromTemplate` (`ui.js:1283-1293`), which calls `M.fromTemplate` and then opens
  the returned note (`entry.js:284-297`); `entry.test` "a template card creates a new draft…" and
  `dom.test` "a template card mints a draft…" cover the wiring. Caveats: the whole-card click still
  edits the template by design (R7), and keyboard activation is still broken (R2).
- **B2** — closed: `openEditorTab` selects the conversation with `selectPanel(null)` and defers the
  open 80 ms (`entry.js:219-239`); `newBlankDraft`/`newDraftFromTemplate`/`openDocument` use it;
  `goChat` now passes `null` (`entry.js:326-329`). `entry.test` models `mounted===undefined` and the
  live deferred success above matches it.
- **S1** — `savingRef` in-flight guard (`ui.js:939-947`, `986-988`); DOM test "two quick Ctrl+S
  presses produce one save, not two notes" passes. (A separate save/typing race remains — R1.)
- **S2** — the autosave effect writes only dirty docs (`ui.js:863-867`) and the unmount effect
  flushes `latestDoc` (`ui.js:869-877`). Probes: type then immediate unmount → draft persisted;
  type then save then 500 ms then unmount → storage stays `null`.
- **S3** — `makeTranslator(dict, lang)` stamps `.lang` (`model.js:247-257`), `langOf` exists, date
  units are dictionary keys; probe: EN colour group "Blue", EN old date "9/26", ZH "9月26日"; the
  only call sites are `entry.js` and tests, and none broke.
- **S4 (main parts)** — the "HTML-free" no-op was replaced by the translator/date test; the routeUrl
  test now asserts a real `document.baseURI` prefix; the ui.test send-badge assertion is real; the
  new `tests/entry.test.mjs` drives the real entry against a fake Cordis context.
- **A7** saved-value reconciliation (`ui.js:964-977`), **A9** `.ps-actions` wrap + dead container
  rule removed (`ui.js:288`, `527-530`), **A11** report cap + lock (`index.js:53-54`, `612-640`),
  **A13** fence fails closed (`index.js:545-553`), **A14** `writeSeq` stale-load drop
  (`model.js:592`, `661-667`), **A15** template read+write under one lock (`index.js:448-471`),
  **A16** confirm/toast wording, **A17** `canSend` + failure-message keys — all verified in code.

### 5.2 Still open (all nits / low)

- **A10** session/workspace refs are still captured once (`ui.js:818` `useMemo`, `848-858`
  one-shot restore); renames / late cwd are not picked up. Live entry happens to be correct.
- **A12** docs still claim 50 tests (`README.md:59`, `notes/DELIVERY.md:59`) versus 63 now;
  `notes/client-contracts.md:248-249` and `notes/host-contracts.md:194-198` "current gaps/deltas"
  remain stale.
- **A6 residual** — dom/ui tests still hard-code a scratch `node_modules` and
  the profile path and silently skip when absent; `model.test.mjs:10-13` still hand-stamps
  `t.lang` (harmless now); the new "concurrent reports keep their order" test awaits each call
  sequentially, so it cannot catch a missing lock despite its name.
- **A14 edge** — a dropped stale load returns without restoring `status`; a save landing during the
  very first load can leave the archive on "正在读稿箱…" forever, and a stale *failed* load still
  sets `error`.

### 5.3 New findings (this pass)

| id | severity | area | file:line | issue | fix |
| --- | --- | --- | --- | --- | --- |
| R1 | should-fix | Save vs concurrent typing | `src/client/ui.js:937-991` | `saveNow` builds the post-save document from the click-time closure (`next = {...doc}`, `setDoc(next)`, `writeLocalDraft(sessionId,null)`). Text typed while the save is in flight is overwritten when the response lands. Probe: typed `A`, Ctrl+S, typed `A plus B typed during save`; 320 ms later textarea = `A`, local draft = `null` — data loss (pre-existing; S1's guard does not cover it). | Merge with a functional `setDoc(current => …)`: keep the current body/title/colour/tags when they differ from the payload, keep `dirty` for changed fields, and clear local storage only when the doc is unchanged. Set `latestDoc.current` synchronously. |
| R2 | should-fix | Keyboard template action | `src/client/ui.js:1253-1258`, `:1284-1293` | Enter/Space on "用模板新建" bubbles to the card's `onKeyDown`, which calls `openDocument(template)` and `preventDefault()`s the button's activation. Probe (jsdom): keydown → `openDocument({kind:'template'})`, `defaultPrevented=true`; mouse click → `newDraftFromTemplate`. Keyboard users edit/overwrite the template instead of minting a draft. | Ignore bubbled keys (`if (event.target !== event.currentTarget) return`) or `stopPropagation` on the footer button; add a keydown DOM test. |
| R3 | should-fix (low) | No-session create | `src/client/entry.js:270-278`, `src/client/ui.js:1331-1341` | If no session ever becomes the conversation, `newBlankDraft` still sets a session-less `openRequest` and `createDraft` toasts 已打开新草稿 immediately; 80 ms later the deferred open fails with `needSession`, and the stale request is consumed by the next editor as a blank document. False success + surprising replace. | Resolve the deferred branch (promise/result) and request/toast only when a session id is known; clear `openRequest` when the open fails. |
| R4 | nit | Deferred timer leak | `src/client/entry.js:223` | The 80 ms timer is untracked; after plugin unload it can still call `openTab`, toast, and `flushDiagnostics` (which schedules a 500 ms report plus up to two 1.5 s retries). | Track timer ids in `createRuntime` and clear them from a `ctx.effect` teardown. |
| R5 | nit | Unmount flush race | `src/client/ui.js:869-877`, `:964-979` | Normal path is clean (probe), but if unmount interleaves between the save continuation and its render commit, `latestDoc.current` is still the pre-save dirty doc and the unmount flush can re-write it after `writeLocalDraft(null)`. | Set `latestDoc.current` (and clear its dirty flag) synchronously in `saveNow` before `setDoc`. |
| R6 | nit | Stale-load status | `src/client/model.js:659-674` | The `writeSeq` drop returns without touching `status`; a stale failed load still sets `error`. | On stale success set `status:'ready'`; skip `set({status:'error'})` when `startedAt !== writeSeq`. |
| R7 | nit | Template whole-card click | `src/client/ui.js:1253-1293` | By design the card body opens the template for editing while only the small footer button mints a draft; the large target lands in the template and a later Save overwrites it. | Product decision; if kept, consider a separate "编辑模板" affordance or a confirm for Save on an archive-opened template. |

Claims that remain unverified after this pass: B1 in the live window (live library has no template),
real composer inject/send clicks, open-folder against Explorer, visual layout/dark mode at narrow
widths, and multi-session `keepMounted` state. Live evidence added by this pass: the deferred
`openTab` success and a remounted Host (`mount.json` 03:35:28Z).
