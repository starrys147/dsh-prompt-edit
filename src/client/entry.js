/**
 * 提示词稿箱 / Prompt Stash — Client bundle entry.
 *
 * Registers four things, all through slots and services the harness already
 * owns (no DOM scraping, no second app root):
 *
 *   1. a native right-sidebar tab TYPE (`prompt-stash`) with its body and chip,
 *      so the editor is a real tab in the right column — closed, split,
 *      restored and focused by the host like any other;
 *   2. the `/prompt` client command that opens it;
 *   3. the left-rail entry and the `main` page behind it (the archive manager);
 *   4. nothing that outlives the plugin: every registration rides `ctx.effect`.
 *
 * Registration outcomes are reported back to the Host once, to a
 * `diagnostics.json` inside the stash directory. A browser that cannot show
 * this half has no other way to say what happened, and a silent no-op
 * registration is the failure mode this plugin would otherwise hide.
 */
(function () {
  'use strict'

  const PACKAGE_ID = 'dsh-prompt-stash'
  const KIND = 'prompt-stash'
  const TAB_TYPE_ID = 'prompt-stash:editor'
  const COMMAND_NAME = 'prompt'

  /** Split a path into `{ dir, name }` for both Windows and POSIX spellings. */
  function splitPath(value) {
    const text = String(value || '').replace(/[\\/]+$/u, '')
    if (text === '') return { dir: '', name: '' }
    const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
    return index < 0 ? { dir: '', name: text } : { dir: text.slice(0, index), name: text.slice(index + 1) }
  }

  window.__ModuleLoader__.load({
    id: PACKAGE_ID,
    factory(require) {
      const React = require('react')
      const M = globalThis.__PromptStashModel
      const ui = globalThis.__PromptStashUI.createUI(React)

      /**
       * What the Host gets told about this page's registrations. `pending`
       * means the callback never ran (the service never appeared).
       */
      const diagnostics = {
        build: '0.1.0',
        startedAt: new Date().toISOString(),
        packageId: PACKAGE_ID,
        pageBase: typeof document !== 'undefined' ? String(document.baseURI || '') : '',
        route: M.routeUrl('report'),
        injected: { slots: false, locale: false },
        tabType: 'pending',
        tabGuide: 'pending',
        tabBody: 'pending',
        tabChip: 'pending',
        command: 'pending',
        rail: 'pending',
        main: 'pending',
        openTab: null,
        editorMounted: null,
        composer: null,
        reportSends: 0,
        errors: [],
      }
      let flushTimer = null

      /** Send the diagnostics once the current burst of registrations settles. */
      function flushDiagnostics(immediate) {
        if (flushTimer !== null) clearTimeout(flushTimer)
        flushTimer = setTimeout(
          () => {
            flushTimer = null
            sendDiagnostics(0)
          },
          immediate === true ? 0 : 500,
        )
      }

      /** POST the diagnostics; a failed send is retried twice before giving up. */
      function sendDiagnostics(attempt) {
        diagnostics.reportSends = attempt + 1
        try {
          M.api('report', { report: diagnostics }).catch(() => {
            if (attempt < 2) setTimeout(() => sendDiagnostics(attempt + 1), 1500)
          })
        } catch (error) {
          if (attempt < 2) setTimeout(() => sendDiagnostics(attempt + 1), 1500)
        }
      }

      /** Timers owned by this plugin generation; cleared on unload. */
      const pendingTimers = new Set()
      function later(fn, ms) {
        const id = setTimeout(() => {
          pendingTimers.delete(id)
          try {
            fn()
          } catch (error) {
            report(error)
          }
        }, ms)
        pendingTimers.add(id)
        return id
      }

      function noteError(where, error) {
        diagnostics.errors.push({
          where,
          message: error instanceof Error ? error.message : String(error),
        })
        flushDiagnostics()
      }

      /**
       * The bundle's handle on the context plus the few cross-surface actions.
       * Both surfaces reach each other only through this object, so neither
       * has to know how the other is mounted.
       */
      function createRuntime(ctx) {
        const localeCache = { active: null, t: M.makeTranslator(M.dictFor(''), 'zh'), lang: 'zh' }

        function translate() {
          let active = ''
          try {
            const locale = ctx.get('locale')
            const snapshot = locale === undefined ? undefined : locale.getLocale()
            active = snapshot === undefined ? '' : String(snapshot.active || '')
          } catch {
            active = ''
          }
          if (localeCache.active !== active) {
            localeCache.active = active
            localeCache.lang = M.langOf(active)
            localeCache.t = M.makeTranslator(M.dictFor(active), localeCache.lang)
          }
          return { t: localeCache.t, lang: localeCache.lang }
        }

        function service(name) {
          try {
            return ctx.get(name)
          } catch {
            return undefined
          }
        }

        /** The session the right column is currently mounted for ('' when none). */
        function currentSessionId() {
          const controller = service('sidebarRight')
          try {
            const mounted = controller === undefined ? undefined : controller.mounted
            const value = mounted === undefined ? undefined : mounted.getSnapshot()
            if (typeof value === 'string') return value
          } catch {
            /* the column may not be adopted yet */
          }
          return ''
        }

        /** What the editor records against this session: its title, cwd and workspace name. */
        function describeSession(sessionId) {
          const out = { session: undefined, workspace: undefined }
          if (typeof sessionId !== 'string' || sessionId === '') return out
          let summary
          try {
            const sessions = service('sessions')
            summary = sessions === undefined ? undefined : sessions.list.getSnapshot().byId[sessionId]
          } catch {
            summary = undefined
          }
          const cwd =
            summary !== undefined && typeof summary.cwd === 'string'
              ? summary.cwd
              : summary !== undefined && summary.header !== undefined && typeof summary.header.cwd === 'string'
                ? summary.header.cwd
                : ''
          out.session = {
            id: sessionId,
            title: summary !== undefined && typeof summary.title === 'string' ? summary.title : '',
            cwd,
          }
          if (cwd !== '') {
            const parts = splitPath(cwd)
            out.workspace = { id: cwd, name: parts.name, path: cwd }
          }
          return out
        }

        /**
         * Reveal the editor tab in the right column.
         *
         * Two things can stand in the way, and both are recoverable:
         *  - the column has not adopted this session yet ("no session surface is
         *    mounted") — expanding it mounts the seat;
         *  - a global main panel owns the centre, which makes the harness clear
         *    the column's on-screen session entirely — selecting `null` gives the
         *    conversation back, and the column reports its session again.
         *
         * @returns whether an open was attempted (the deferred path reports later).
         */
        function openEditorTab() {
          const controller = service('sidebarRight')
          const fail = (reason, first) => {
            diagnostics.openTab = {
              ok: false,
              at: new Date().toISOString(),
              error: reason,
              first: first === undefined ? null : first,
            }
            flushDiagnostics()
            M.store.toast(translate().t('needSession'), 'err')
            return false
          }
          const tryOnce = () => {
            try {
              controller.openTab(KIND)
              return { ok: true }
            } catch (error) {
              return { ok: false, error }
            }
          }
          const expand = () => {
            try {
              const layout = service('layout')
              if (layout !== undefined && typeof layout.openRightbar === 'function') layout.openRightbar(true, false)
            } catch {
              /* the layout service may be disposing */
            }
          }
          if (controller === undefined || typeof controller.openTab !== 'function') {
            return fail('sidebarRight service unavailable')
          }
          if (currentSessionId() === '') {
            // A global panel is showing; give the conversation back and let the
            // seat report its session before addressing the column.
            goChat()
            later(() => {
              let result = tryOnce()
              if (!result.ok) {
                expand()
                result = tryOnce()
              }
              diagnostics.openTab = result.ok
                ? { ok: true, deferred: true, at: new Date().toISOString() }
                : {
                    ok: false,
                    at: new Date().toISOString(),
                    error: result.error instanceof Error ? result.error.message : String(result.error),
                  }
              flushDiagnostics()
              if (!result.ok) M.store.toast(translate().t('needSession'), 'err')
            }, 80)
            return true
          }
          const first = tryOnce()
          if (first.ok) {
            diagnostics.openTab = { ok: true, at: new Date().toISOString() }
            flushDiagnostics()
            return true
          }
          expand()
          const second = tryOnce()
          if (second.ok) {
            diagnostics.openTab = { ok: true, recovered: true, at: new Date().toISOString() }
            flushDiagnostics()
            return true
          }
          return fail(
            second.error instanceof Error ? second.error.message : String(second.error),
            first.error instanceof Error ? first.error.message : String(first.error),
          )
        }

        /**
         * Start a blank draft (of a note or a template) and show it in the editor.
         *
         * With a global panel in the centre the column has no on-screen session,
         * so the conversation is asked for first; the request itself carries
         * whatever session is known and the editor fills in the rest from its
         * own tab.
         *
         * @param kind - `note` or `template`.
         */
        function newBlankDraft(kind) {
          const target = kind === 'template' ? 'template' : 'note'
          const start = () => {
            const sessionId = currentSessionId()
            if (sessionId === '') return false
            M.requestOpen({ kind: target, blank: true, sessionId })
            const opened = openEditorTab()
            M.store.toast(translate().t(target === 'template' ? 'templateOpened' : 'draftOpened'), 'info')
            return opened
          }
          if (start()) return true
          // A global panel owns the centre, so the column has no session yet.
          // Give the conversation back and ask again once it reports one; never
          // leave a session-less request behind for the next editor to adopt.
          goChat()
          later(() => {
            if (start()) return
            diagnostics.blankDraft = 'no-session'
            flushDiagnostics()
            M.store.toast(translate().t('needSession'), 'err')
          }, 120)
          return true
        }

        /**
         * Create a new draft from a stored template and show it in the editor.
         * The template itself stays untouched — that separation is the point.
         */
        async function newDraftFromTemplate(templateId) {
          if (currentSessionId() === '') goChat()
          const sessionId = currentSessionId()
          const meta = describeSession(sessionId)
          try {
            const doc = await M.fromTemplate(templateId, meta.session, meta.workspace)
            M.requestOpen({ kind: 'note', id: doc.id, blank: false, sessionId })
            openEditorTab()
            return true
          } catch (error) {
            M.store.toast(error instanceof Error ? error.message : String(error), 'err')
            return false
          }
        }

        /** Open one stored document in the editor tab (the archive's click action). */
        function openDocument(request) {
          const sessionId = currentSessionId()
          M.requestOpen({
            kind: request.kind === 'template' ? 'template' : 'note',
            id: request.id || '',
            blank: false,
            sessionId,
          })
          const opened = openEditorTab()
          if (!opened && sessionId === '') goChat()
          return opened
        }

        /** Switch the centre panel to the archive page. */
        function goArchive() {
          const layout = service('layout')
          if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        }

        /**
         * Switch the centre panel back to the conversation.
         *
         * `null` is the harness's spelling of "no global panel"; the string
         * `'conversation'` would select a main slot the layout does not have, and
         * the right column only regains its on-screen session for `null`.
         */
        function goChat() {
          const layout = service('layout')
          if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null)
        }

        return {
          ctx,
          translate,
          service,
          currentSessionId,
          describeSession,
          openEditorTab,
          newBlankDraft,
          newDraftFromTemplate,
          openDocument,
          goArchive,
          goChat,
          diagnostics,
          noteEditorMounted(hasComposer) {
            diagnostics.editorMounted = new Date().toISOString()
            diagnostics.composer = hasComposer ? 'present' : 'missing'
            flushDiagnostics()
          },
        }
      }

      const PANEL_ID = KIND

      function Panel(props) {
        return React.createElement(ui.ArchivePanel, { ...props, runtime: props.runtime })
      }
      function RailIcon(props) {
        return React.createElement(ui.SidebarIcon, props)
      }
      /** The chip label, re-read per render so a locale switch reaches the tab. */
      function TabChip(props) {
        const runtime = props.runtime
        const { t } = runtime.translate()
        return React.createElement('span', null, t('editorTitle'))
      }

      return {
        inject: ['slots', 'locale'],
        apply(ctx) {
          const runtime = createRuntime(ctx)
          diagnostics.injected.slots = ctx.slots !== undefined && ctx.slots !== null
          diagnostics.injected.locale = ctx.get('locale') !== undefined

          // The archive page and the rail entry share one id: the rail row calls
          // `layout.selectPanel(id)` and `main` dispatches on that same key. The
          // host drops `activePanelId` by itself when this page unmounts, so no
          // layout cleanup is needed here.
          ctx.effect(
            () => () => {
              for (const id of pendingTimers) clearTimeout(id)
              pendingTimers.clear()
            },
            'dsh-prompt-stash: owned timers',
          )

          ctx.effect(
            () =>
              ctx.slots.inject('main', () => {
                diagnostics.main = 'registered'
                flushDiagnostics()
                return ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ runtime }) }, Panel)
              }),
            'dsh-prompt-stash: main page',
          )

          ctx.effect(
            () =>
              ctx.slots.inject('sidebar.panellist', () => {
                diagnostics.rail = 'registered'
                flushDiagnostics()
                return ctx.slots.register(
                  {
                    name: 'sidebar.panellist',
                    id: PANEL_ID,
                    order: 7,
                    label: () => runtime.translate().t('nav'),
                  },
                  RailIcon,
                )
              }),
            'dsh-prompt-stash: rail entry',
          )

          // The native right-sidebar tab type, its body and chip, and the
          // `/prompt` command. Both wait for their service with `ctx.inject`,
          // because the slot declaration exists before the service does.
          ctx.effect(
            () =>
              ctx.inject(['sidebarRightTabs'], (scope) => {
                const tabs = scope.sidebarRightTabs
                if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') {
                  diagnostics.tabType = 'service-unavailable'
                  flushDiagnostics()
                  return
                }
                const definition = {
                  id: TAB_TYPE_ID,
                  kind: KIND,
                  keepMounted: true,
                  title: () => runtime.translate().t('editorTitle'),
                }
                const guide = [
                  {
                    id: KIND,
                    order: 40,
                    title: () => runtime.translate().t('editorTitle'),
                    description: () => runtime.translate().t('panelSubtitle'),
                    icon: ui.SidebarIcon,
                  },
                ]
                const disposers = []
                let disposeType
                try {
                  disposeType = tabs.register({ ...definition, guide })
                  diagnostics.tabType = 'registered'
                  diagnostics.tabGuide = 'registered'
                } catch (error) {
                  noteError('sidebarRightTabs.register(with guide)', error)
                  try {
                    // A host that rejects this guide shape still gets the tab type.
                    disposeType = tabs.register(definition)
                    diagnostics.tabType = 'registered'
                    diagnostics.tabGuide = 'rejected'
                  } catch (inner) {
                    diagnostics.tabType = 'failed'
                    noteError('sidebarRightTabs.register', inner)
                    flushDiagnostics()
                    return
                  }
                }
                flushDiagnostics()
                disposers.push(disposeType)
                disposers.push(
                  ctx.slots.inject('sidebar.right.pane.tab', () => {
                    diagnostics.tabBody = 'registered'
                    flushDiagnostics()
                    return ctx.slots.register(
                      {
                        name: 'sidebar.right.pane.tab',
                        key: TAB_TYPE_ID,
                        inject: (sessionId) => ({ runtime, sessionId }),
                      },
                      ui.EditorPanel,
                    )
                  }),
                )
                disposers.push(
                  ctx.slots.inject('sidebar.right.pane.tab.title', () => {
                    diagnostics.tabChip = 'registered'
                    flushDiagnostics()
                    return ctx.slots.register(
                      {
                        name: 'sidebar.right.pane.tab.title',
                        key: TAB_TYPE_ID,
                        inject: () => ({ runtime }),
                      },
                      TabChip,
                    )
                  }),
                )
                scope.effect(() => () => {
                  for (const dispose of disposers.splice(0)) {
                    try {
                      if (typeof dispose === 'function') dispose()
                    } catch (error) {
                      report(error)
                    }
                  }
                }, 'dsh-prompt-stash: tab type')
              }),
            'dsh-prompt-stash: right-sidebar seat',
          )

          ctx.effect(
            () =>
              ctx.inject(['commandUi'], (scope) => {
                const commands = scope.commandUi
                if (commands === undefined || commands === null || typeof commands.register !== 'function') {
                  diagnostics.command = 'service-unavailable'
                  flushDiagnostics()
                  return
                }
                scope.effect(
                  () => {
                    diagnostics.command = 'registered'
                    flushDiagnostics()
                    return commands.register({
                      name: COMMAND_NAME,
                      available: () => true,
                      label: () => runtime.translate().t('editorTitle'),
                      description: () => runtime.translate().t('panelSubtitle'),
                      icon: ui.SidebarIcon,
                      ui: {
                        kind: 'action',
                        run: () => {
                          runtime.openEditorTab()
                        },
                      },
                    })
                  },
                  'dsh-prompt-stash: /prompt',
                )
              }),
            'dsh-prompt-stash: command seat',
          )
        },
      }

      /** Surface a registration failure without blanking the whole surface. */
      function report(error) {
        try {
          console.error('[dsh-prompt-stash]', error)
        } catch {
          /* console may be gone during teardown */
        }
      }
    },
  })
})()
