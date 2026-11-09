/**
 * 提示词稿箱 / Prompt Stash — the browser UI.
 *
 * `createUI(React)` returns the three components the bundle registers:
 * `EditorPanel` (a native right-sidebar tab body), `ArchivePanel` (the `main`
 * page behind the left-rail entry) and `SidebarIcon` (the rail glyph).
 *
 * Everything renders inside `.ps-root`, whose stylesheet travels with the
 * component (a `<style>` element unmounts with it). Colours come from theme
 * tokens with plain fallbacks, so a renamed token degrades the look instead of
 * breaking it. No Harness Client package is imported.
 */
(function () {
  'use strict'

  function createUI(React) {
    const h = React.createElement
    const {
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
      useSyncExternalStore,
    } = React

    const M = globalThis.__PromptStashModel

    // ------------------------------------------------------------- stylesheet

    const CSS = String.raw`
.ps-root {
  --ps-accent: #4d6bfe;
  --ps-line: var(--dsw-alias-border-l2, rgba(0, 0, 0, .12));
  --ps-line-strong: var(--dsw-alias-border-l4, rgba(0, 0, 0, .22));
  --ps-surface: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, .024));
  --ps-sunken: var(--dsw-alias-bg-base, #fff);
  --ps-text: var(--dsw-alias-label-primary, #1b1b1f);
  --ps-text-soft: var(--dsw-alias-label-secondary, #4a4a55);
  --ps-text-faint: var(--dsw-alias-label-tertiary, #82828f);
  --ps-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05));
  --ps-brand: var(--dsw-alias-brand-primary, #4d6bfe);
  --ps-danger: var(--dsw-alias-state-error-primary, #c0392b);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  container-type: inline-size;
  color: var(--ps-text);
  background: var(--dsw-alias-bg-base, #fff);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.ps-root *, .ps-root *::before, .ps-root *::after { box-sizing: border-box; }
.ps-root :where(button) { font: inherit; color: inherit; }
.ps-root :where(input, textarea, select) { font: inherit; color: inherit; }
.ps-root ::-webkit-scrollbar { width: 10px; height: 10px; }
.ps-root ::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 8px;
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, .18));
  background-clip: content-box;
}
.ps-root ::-webkit-scrollbar-thumb:hover { background-color: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, .3)); }

/* ---------- shared controls ---------- */
.ps-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: .5px solid var(--ps-line);
  border-radius: 6px;
  background: var(--ps-surface);
  color: var(--ps-text);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color .12s ease, border-color .12s ease;
}
.ps-btn:hover:not(:disabled) { background: var(--ps-hover); border-color: var(--ps-line-strong); }
.ps-btn:disabled { opacity: .45; cursor: default; }
.ps-root .ps-btn-primary {
  border-color: transparent;
  background: var(--ps-brand);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.ps-btn-primary:hover:not(:disabled) { background: var(--ps-brand); filter: brightness(1.06); border-color: transparent; }
.ps-btn-quiet { border-color: transparent; background: transparent; }
.ps-btn-quiet:hover:not(:disabled) { background: var(--ps-hover); border-color: transparent; }
.ps-btn-sm { height: 22px; padding: 0 8px; font-size: 12px; }
.ps-kbd {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, .07));
  color: var(--ps-text-faint);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 15px;
}
.ps-input {
  width: 100%;
  height: 28px;
  padding: 0 9px;
  border: .5px solid var(--ps-line);
  border-radius: 6px;
  background: var(--ps-sunken);
  outline: none;
}
.ps-input:focus { border-color: var(--ps-brand); }
.ps-input::placeholder { color: var(--ps-text-faint); }
.ps-select {
  height: 26px;
  padding: 0 6px;
  border: .5px solid var(--ps-line);
  border-radius: 6px;
  background: var(--ps-surface);
  outline: none;
  cursor: pointer;
}
.ps-label { color: var(--ps-text-faint); font-size: 11.5px; }

/* ---------- the editor tab ---------- */
.ps-editor { padding: 10px 12px 12px; gap: 8px; }
.ps-ed-head { display: flex; flex-direction: column; gap: 6px; flex: none; }
.ps-ed-titlerow { display: flex; align-items: center; gap: 6px; }
.ps-ed-title { flex: 1 1 auto; min-width: 0; font-weight: 600; }
.ps-ed-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 18px; }
.ps-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ps-surface);
  color: var(--ps-text-soft);
  font-size: 11px;
  line-height: 16px;
}
.ps-badge-accent { background: color-mix(in srgb, var(--ps-accent) 16%, transparent); color: var(--ps-accent); }
.ps-ed-meta { display: flex; gap: 6px; align-items: center; min-width: 0; }
.ps-ed-metatext {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ps-text-faint);
  font-size: 11.5px;
}
.ps-ed-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; }
.ps-swatches { display: flex; align-items: center; gap: 4px; }
.ps-swatch {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, .16);
  border-radius: 50%;
  cursor: pointer;
}
.ps-swatch[data-on='true'] { box-shadow: 0 0 0 2px var(--ps-sunken), 0 0 0 3.5px currentColor; }
.ps-custom {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px dashed var(--ps-line-strong);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.ps-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ps-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, .06));
  color: var(--ps-text-soft);
  font-size: 11px;
  line-height: 16px;
}
.ps-tag-x {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ps-text-faint);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}
.ps-tag-x:hover { color: var(--ps-danger); }
.ps-taginput {
  width: 84px;
  height: 20px;
  padding: 0 6px;
  border: .5px dashed var(--ps-line);
  border-radius: 999px;
  background: transparent;
  font-size: 11.5px;
  outline: none;
}
.ps-taginput:focus { border-style: solid; border-color: var(--ps-brand); }
.ps-ed-body { display: flex; flex-direction: column; min-height: 140px; flex: 1 1 auto; }
.ps-ta {
  flex: 1 1 auto;
  width: 100%;
  min-height: 140px;
  padding: 10px 12px;
  border: .5px solid var(--ps-line);
  border-radius: 9px;
  background: var(--ps-sunken);
  color: var(--ps-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.65;
  outline: none;
  resize: none;
  tab-size: 2;
}
.ps-ta:focus { border-color: var(--ps-brand); }
.ps-preview {
  flex: 1 1 auto;
  overflow: auto;
  padding: 10px 12px;
  border: .5px solid var(--ps-line);
  border-radius: 9px;
  background: var(--ps-sunken);
  font-size: 12.5px;
  line-height: 1.7;
}
.ps-preview > :first-child { margin-top: 0; }
.ps-preview h1, .ps-preview h2, .ps-preview h3, .ps-preview h4 { margin: 14px 0 6px; line-height: 1.3; }
.ps-preview h1 { font-size: 17px; }
.ps-preview h2 { font-size: 15px; }
.ps-preview h3 { font-size: 13.5px; }
.ps-preview p { margin: 8px 0; }
.ps-preview ul, .ps-preview ol { margin: 8px 0; padding-left: 20px; }
.ps-preview li { margin: 3px 0; }
.ps-preview blockquote {
  margin: 8px 0;
  padding: 2px 10px;
  border-left: 2.5px solid var(--ps-line-strong);
  color: var(--ps-text-soft);
}
.ps-preview code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, .07));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.ps-preview pre {
  margin: 8px 0;
  padding: 9px 11px;
  overflow: auto;
  border-radius: 7px;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, .07));
}
.ps-preview pre code { padding: 0; background: none; font-size: 11.5px; line-height: 1.6; }
.ps-preview a { color: var(--dsw-alias-link, var(--ps-brand)); text-decoration: none; }
.ps-preview a:hover { text-decoration: underline; }
.ps-preview hr { margin: 12px 0; border: 0; border-top: .5px solid var(--ps-line); }
.ps-empty { padding: 18px 6px; color: var(--ps-text-faint); text-align: center; }
.ps-ed-foot { display: flex; flex-direction: column; gap: 7px; flex: none; }
.ps-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border: .5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c98a2b) 45%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c98a2b) 10%, transparent);
}
.ps-confirm-text { flex: 1 1 100%; color: var(--ps-text-soft); font-size: 11.5px; }
.ps-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  color: var(--ps-text-faint);
  font-size: 11.5px;
}
.ps-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ps-text-faint); flex: none; }
.ps-dot[data-tone='ok'] { background: var(--dsw-alias-state-success-primary, #2f9e5f); }
.ps-dot[data-tone='warn'] { background: var(--dsw-alias-state-warn-primary, #c98a2b); }
.ps-dot[data-tone='err'] { background: var(--ps-danger); }
.ps-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ps-actions .ps-btn { flex: 1 1 auto; justify-content: center; }
/* Send stays an outlined button on purpose: it commits immediately and has no
   shortcut, so it must not be the loudest control next to Save and Insert. */
.ps-actions .ps-btn-send {
  flex: 0 0 auto;
  min-width: 62px;
  border-color: var(--ps-line-strong);
}

/* ---------- the archive page ---------- */
.ps-archive { padding: 0; }
.ps-ar-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 26px 12px;
  flex: none;
}
.ps-ar-headtext { flex: 1 1 auto; min-width: 0; }
.ps-ar-title { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: .01em; }
.ps-ar-sub { margin: 3px 0 0; color: var(--ps-text-faint); font-size: 12px; }
.ps-ar-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; flex: none; }
.ps-ar-toolbar {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 0 26px 10px;
  flex: none;
}
.ps-seg { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--ps-surface); gap: 2px; }
.ps-seg button {
  height: 22px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ps-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.ps-seg button[data-on='true'] {
  background: var(--ps-sunken);
  color: var(--ps-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .1);
}
.ps-seg .ps-count { color: var(--ps-text-faint); font-size: 11px; margin-left: 3px; }
.ps-search { flex: 1 1 200px; min-width: 150px; max-width: 330px; }
.ps-ar-field { display: inline-flex; align-items: center; gap: 5px; }
.ps-facets {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 26px 12px;
  flex: none;
  border-bottom: .5px solid var(--ps-line);
}
.ps-facet {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: .5px solid var(--ps-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ps-text-soft);
  font-size: 11.5px;
  cursor: pointer;
}
.ps-facet:hover { background: var(--ps-hover); }
.ps-facet[data-on='true'] {
  border-color: color-mix(in srgb, var(--ps-brand) 55%, transparent);
  background: color-mix(in srgb, var(--ps-brand) 12%, transparent);
  color: var(--ps-text);
}
.ps-facet .ps-swatch { width: 10px; height: 10px; border-width: 0; }
.ps-facet-sep { width: 1px; height: 14px; background: var(--ps-line); margin: 0 2px; }
.ps-ar-scroll { flex: 1 1 auto; overflow: auto; padding: 16px 26px 30px; min-height: 220px; }
.ps-group + .ps-group { margin-top: 22px; }
.ps-grouphead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 9px;
  color: var(--ps-text-soft);
  font-size: 12px;
  font-weight: 600;
}
.ps-grouphead .ps-swatch { width: 9px; height: 9px; border-width: 0; transform: translateY(-1px); }
.ps-groupcount { color: var(--ps-text-faint); font-weight: 400; font-size: 11px; }
.ps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(238px, 1fr));
  gap: 10px;
  align-items: start;
}
.ps-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 11px 12px 10px 14px;
  border: .5px solid var(--ps-line);
  border-radius: 10px;
  background: var(--ps-surface);
  cursor: pointer;
  transition: border-color .12s ease, background-color .12s ease;
}
.ps-card:hover { border-color: var(--ps-line-strong); }
.ps-card:focus-visible { outline: 2px solid var(--ps-brand); outline-offset: 1px; }
.ps-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--ps-accent);
}
.ps-card-top { display: flex; align-items: center; gap: 6px; }
.ps-kind {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, .06));
  color: var(--ps-text-faint);
  font-size: 10.5px;
  line-height: 16px;
}
.ps-kind[data-kind='template'] {
  background: color-mix(in srgb, var(--ps-accent) 15%, transparent);
  color: var(--ps-accent);
}
.ps-card-time { margin-left: auto; color: var(--ps-text-faint); font-size: 11px; }
.ps-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
.ps-card-excerpt {
  margin: 0;
  color: var(--ps-text-soft);
  font-size: 11.5px;
  line-height: 1.55;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-word;
  white-space: pre-wrap;
}
.ps-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ps-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  padding-top: 7px;
  border-top: .5px solid var(--ps-line);
}
.ps-card-meta {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ps-text-faint);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ps-card-open {
  flex: none;
  height: 21px;
  padding: 0 8px;
  border: .5px solid var(--ps-line);
  border-radius: 5px;
  background: transparent;
  color: var(--ps-text-soft);
  font-size: 11px;
  cursor: pointer;
}
.ps-card:hover .ps-card-open { border-color: var(--ps-line-strong); color: var(--ps-text); }
.ps-card-open:hover { background: var(--ps-hover); }
.ps-ar-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 26px;
  border-top: .5px solid var(--ps-line);
  color: var(--ps-text-faint);
  font-size: 11px;
  flex: none;
}
.ps-path {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  direction: rtl;
  text-align: left;
}
.ps-nodel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ps-text-faint);
  font-size: 11px;
}

/* ---------- toast ---------- */
.ps-toast {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 30;
  transform: translateX(-50%);
  max-width: 88%;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-toast-bg, rgba(32, 32, 38, .94));
  color: var(--dsw-alias-toast-label, #fff);
  font-size: 11.5px;
  line-height: 1.5;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .22);
  pointer-events: none;
}
.ps-toast[data-tone='err'] { background: var(--ps-danger); }

/* ---------- narrow right column ---------- */
@container (max-width: 420px) {
  .ps-actions .ps-btn { padding: 0 7px; }
  .ps-kbd { display: none; }
}
@container (max-width: 340px) {
  .ps-ed-badges { display: none; }
}
`

    // ------------------------------------------------------------- hooks

    /** Subscribe to the shared store. */
    function useStore() {
      return useSyncExternalStore(M.store.subscribe, M.store.get, M.store.get)
    }

    /** Re-render on locale changes and return the translator for the active language. */
    function useTranslate(runtime) {
      const [, setTick] = useState(0)
      useEffect(() => {
        const locale = runtime && runtime.ctx ? runtime.ctx.get('locale') : undefined
        if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setTick((value) => value + 1))
      }, [runtime])
      return runtime.translate()
    }

    /** A `<style>` element scoped to this plugin root; unmounting removes it. */
    function Style() {
      return h('style', { 'data-ps': 'styles' }, CSS)
    }

    /** Floating status line; the store's `toast.seq` re-arms the timer. */
    function Toast() {
      const state = useStore()
      const toast = state.toast
      const [visible, setVisible] = useState(false)
      useEffect(() => {
        if (toast === null || toast === undefined) return undefined
        setVisible(true)
        const timer = setTimeout(() => setVisible(false), 2400)
        return () => clearTimeout(timer)
      }, [toast && toast.seq])
      if (toast === null || toast === undefined || !visible) return null
      return h('div', { className: 'ps-toast', 'data-tone': toast.tone || 'info', role: 'status' }, toast.message)
    }

    // ------------------------------------------------------------- markdown

    const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/gu

    /** Inline markdown → React children (no raw HTML, ever). */
    function renderInline(text, keyPrefix) {
      const out = []
      const source = String(text || '')
      let last = 0
      let index = 0
      INLINE_RE.lastIndex = 0
      let match = INLINE_RE.exec(source)
      while (match !== null) {
        if (match.index > last) out.push(source.slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}:${index}`
        index += 1
        if (match[1] !== undefined) out.push(h('code', { key }, token.slice(1, -1)))
        else if (match[2] !== undefined) out.push(h('strong', { key }, token.slice(2, -2)))
        else if (match[3] !== undefined) out.push(h('em', { key }, token.slice(1, -1)))
        else if (match[4] !== undefined) {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(token)
          if (link === null) out.push(token)
          else if (/^(https?:|mailto:)/iu.test(link[2])) {
            out.push(
              h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer noopener' }, link[1]),
            )
          } else out.push(h('span', { key }, link[1]))
        }
        last = match.index + token.length
        match = INLINE_RE.exec(source)
      }
      if (last < source.length) out.push(source.slice(last))
      return out
    }

    const HEADING_RE = /^(#{1,6})\s+(.*)$/u
    const BULLET_RE = /^\s*[-*+]\s+(.*)$/u
    const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/u
    const QUOTE_RE = /^>\s?(.*)$/u
    const FENCE_RE = /^\s*```(\S*)\s*$/u

    /** A deliberately small markdown renderer: headings, lists, quotes, fences, inline marks. */
    function renderMarkdown(text) {
      const lines = String(text || '').split(/\r?\n/u)
      const blocks = []
      let i = 0
      // One counter for both block and inline keys: `b${i}` alone repeats
      // whenever a block renders more than one element at the same line index.
      let blockSeq = 0
      const nextKey = () => `b${(blockSeq += 1)}`
      while (i < lines.length) {
        const line = lines[i]
        const fence = FENCE_RE.exec(line)
        if (fence !== null) {
          const body = []
          i += 1
          while (i < lines.length && FENCE_RE.exec(lines[i]) === null) {
            body.push(lines[i])
            i += 1
          }
          i += 1
          blocks.push(h('pre', { key: nextKey() }, h('code', null, body.join('\n'))))
          continue
        }
        const heading = HEADING_RE.exec(line)
        if (heading !== null) {
          const level = heading[1].length
          blocks.push(h(`h${level}`, { key: nextKey() }, renderInline(heading[2], nextKey())))
          i += 1
          continue
        }
        if (BULLET_RE.test(line)) {
          const items = []
          while (i < lines.length && BULLET_RE.test(lines[i])) {
            const item = BULLET_RE.exec(lines[i])
            items.push(h('li', { key: nextKey() }, renderInline(item[1], nextKey())))
            i += 1
          }
          blocks.push(h('ul', { key: nextKey() }, items))
          continue
        }
        if (ORDERED_RE.test(line)) {
          const items = []
          while (i < lines.length && ORDERED_RE.test(lines[i])) {
            const item = ORDERED_RE.exec(lines[i])
            items.push(h('li', { key: nextKey() }, renderInline(item[1], nextKey())))
            i += 1
          }
          blocks.push(h('ol', { key: nextKey() }, items))
          continue
        }
        if (QUOTE_RE.test(line)) {
          const body = []
          while (i < lines.length && QUOTE_RE.test(lines[i])) {
            body.push(QUOTE_RE.exec(lines[i])[1])
            i += 1
          }
          blocks.push(h('blockquote', { key: nextKey() }, renderInline(body.join(' '), nextKey())))
          continue
        }
        if (/^\s*$/u.test(line)) {
          i += 1
          continue
        }
        if (/^\s*(---+|\*\*\*+)\s*$/u.test(line)) {
          blocks.push(h('hr', { key: nextKey() }))
          i += 1
          continue
        }
        const body = []
        while (
          i < lines.length &&
          !/^\s*$/u.test(lines[i]) &&
          FENCE_RE.exec(lines[i]) === null &&
          HEADING_RE.exec(lines[i]) === null &&
          !BULLET_RE.test(lines[i]) &&
          !ORDERED_RE.test(lines[i]) &&
          !QUOTE_RE.test(lines[i])
        ) {
          body.push(lines[i])
          i += 1
        }
        blocks.push(h('p', { key: nextKey() }, renderInline(body.join(' '), nextKey())))
      }
      return blocks
    }

    // ------------------------------------------------------------- small parts

    /** Seven preset swatches plus the platform colour input. */
    function ColorPicker({ value, onPick, lang, title, t }) {
      const current = M.colorOf(value)
      return h(
        'div',
        { className: 'ps-swatches', title },
        M.PALETTE.map((item) =>
          h('button', {
            key: item.id,
            type: 'button',
            className: 'ps-swatch',
            style: { background: item.hex, color: item.hex },
            'data-on': item.hex.toLowerCase() === current,
            title: lang === 'en' ? item.en : item.zh,
            'aria-label': lang === 'en' ? item.en : item.zh,
            onClick: (event) => {
              event.stopPropagation()
              onPick(item.hex)
            },
          }),
        ),
        h('input', {
          type: 'color',
          className: 'ps-custom',
          value: /^#[0-9a-f]{6}$/iu.test(current) ? current : '#8a8f98',
          title: t('customColor'),
          'aria-label': t('customColor'),
          onChange: (event) => onPick(event.target.value),
          onClick: (event) => event.stopPropagation(),
        }),
      )
    }

    /** Tag chips with remove buttons and an inline add field. */
    function TagEditor({ tags, onChange, t }) {
      const [draft, setDraft] = useState('')
      const list = Array.isArray(tags) ? tags : []
      const commit = () => {
        const value = draft.trim()
        if (value === '') return
        if (!list.some((tag) => tag.toLowerCase() === value.toLowerCase())) onChange([...list, value].slice(0, 8))
        setDraft('')
      }
      return h(
        'div',
        { className: 'ps-tags' },
        list.map((tag) =>
          h(
            'span',
            { className: 'ps-tag', key: tag },
            tag,
            h(
              'button',
              {
                type: 'button',
                className: 'ps-tag-x',
                title: t('removeTag'),
                'aria-label': `${t('removeTag')}: ${tag}`,
                onClick: (event) => {
                  event.stopPropagation()
                  onChange(list.filter((item) => item !== tag))
                },
              },
              '×',
            ),
          ),
        ),
        list.length < 8
          ? h('input', {
              className: 'ps-taginput',
              value: draft,
              placeholder: t('tagPlaceholder'),
              'aria-label': t('addTag'),
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit()
                } else if (event.key === 'Backspace' && draft === '' && list.length > 0) {
                  onChange(list.slice(0, -1))
                }
              },
              onBlur: commit,
            })
          : null,
      )
    }

    /** Time + counts line, shared by both surfaces. */
    function statusLine(t, doc, status, savedAt) {
      if (status === 'saving') return { tone: 'warn', text: t('saving') }
      if (status === 'error') return { tone: 'err', text: t('unsaved') }
      if (doc.dirty) return { tone: 'warn', text: t('unsavedHint') }
      if (savedAt !== '') return { tone: 'ok', text: `${t('saved')} · ${M.formatWhen(savedAt, t)}` }
      return { tone: 'idle', text: t('shortcutSave') }
    }

    // ------------------------------------------------------------- editor tab

    /**
     * The right-sidebar tab body.
     *
     * Standard slot props supply `sessionId` and `inputActions`; `runtime` is
     * this bundle's own handle on the context.
     */
    function EditorPanel(props) {
      const runtime = props.runtime
      const sessionId = props.sessionId || props.tabSessionId || ''
      const inputActions = props.inputActions
      const state = useStore()
      const translation = useTranslate(runtime)
      const { t, lang } = translation

      const meta = useMemo(() => runtime.describeSession(sessionId), [runtime, sessionId])
      const [doc, setDoc] = useState(() => M.initialDocument(sessionId, meta))
      const [tab, setTab] = useState('edit')
      const [status, setStatus] = useState('idle')
      const [errorText, setErrorText] = useState('')
      const [pending, setPending] = useState(null)
      const handledNonce = useRef(0)
      const booted = useRef(false)
      // Read by the adopt effect without making it re-run on every keystroke.
      const dirtyRef = useRef(false)
      dirtyRef.current = doc.dirty
      // One save at a time, and the last unsaved text, for the unmount flush.
      const savingRef = useRef(false)
      const latestDoc = useRef(doc)
      latestDoc.current = doc

      // The editor needs the library too: metadata for a document the archive
      // asked it to adopt, and the id of what it is editing.
      useEffect(() => {
        if (M.store.get().status === 'idle') M.load({}).catch(() => undefined)
      }, [])

      // Tell the host that the tab body really mounted and whether the composer
      // actions arrived; this is the only channel the page has for that.
      useEffect(() => {
        if (runtime !== undefined && typeof runtime.noteEditorMounted === 'function') {
          runtime.noteEditorMounted(inputActions !== undefined && inputActions !== null)
        }
      }, [runtime, inputActions])

      // Restore the associated session/workspace once the metadata is known.
      useEffect(() => {
        if (booted.current) return
        booted.current = true
        if (doc.session === undefined || doc.workspace === undefined) {
          setDoc((current) => ({
            ...current,
            session: current.session || meta.session,
            workspace: current.workspace || meta.workspace,
          }))
        }
      }, [meta, doc.session, doc.workspace])

      // Autosave the unsaved draft per session, so switching tabs cannot lose
      // it. Only a dirty document is written: after a successful save the
      // cleared storage must stay cleared.
      useEffect(() => {
        if (!doc.dirty) return undefined
        const timer = setTimeout(() => M.writeLocalDraft(sessionId, doc), 350)
        return () => clearTimeout(timer)
      }, [doc, sessionId])

      // A tab can be torn down inside that 350 ms window (switching sessions,
      // closing the column); flush the last keystrokes synchronously.
      useEffect(
        () => () => {
          const last = latestDoc.current
          if (last !== undefined && last !== null && last.dirty) M.writeLocalDraft(sessionId, last)
        },
        [sessionId],
      )

      // Adopt a document requested by the archive page. A dirty draft is never
      // replaced silently: the request waits behind an inline confirmation, so
      // clicking a card in the archive cannot eat unsaved text.
      const adoptRequest = useCallback(
        async (request) => {
          if (request.blank === true) {
            setDoc({
              id: '',
              kind: request.kind === 'template' ? 'template' : 'note',
              title: '',
              body: '',
              color: 'slate',
              tags: [],
              session: meta.session,
              workspace: meta.workspace,
              dirty: false,
              savedAt: '',
            })
            setStatus('idle')
            return
          }
          try {
            const body = await M.readBody(request.kind, request.id)
            const list = request.kind === 'template' ? state.library.templates : state.library.notes
            const entry = list.find((item) => item.id === request.id)
            const next = M.documentOf(entry || { id: request.id, title: '' }, body, request.kind)
            next.session = next.session || meta.session
            next.workspace = next.workspace || meta.workspace
            next.dirty = false
            setDoc(next)
            setStatus(next.savedAt === '' ? 'idle' : 'saved')
            M.writeLocalDraft(sessionId, next)
          } catch (error) {
            setStatus('error')
            setErrorText(error instanceof Error ? error.message : String(error))
          }
        },
        [meta, sessionId, state.library],
      )

      useEffect(() => {
        const request = state.openRequest
        if (request === null || request === undefined) return
        if (request.nonce === handledNonce.current) return
        if (request.sessionId !== '' && sessionId !== '' && request.sessionId !== sessionId) return
        handledNonce.current = request.nonce
        if (dirtyRef.current) {
          setPending(request)
          return
        }
        adoptRequest(request)
      }, [state.openRequest, adoptRequest, sessionId])

      const patchDoc = useCallback((patch) => {
        setDoc((current) => ({ ...current, ...patch, dirty: true }))
        setStatus('idle')
      }, [])

      const saveNow = useCallback(
        async (asTemplate) => {
          // One save in flight at a time: a second Ctrl+S while the first is
          // still waiting would carry `id: ''` and create a duplicate note.
          if (savingRef.current) return
          if (doc.body.trim() === '' && doc.title.trim() === '' && !asTemplate) {
            M.store.toast(t('emptyBody'), 'err')
            return
          }
          savingRef.current = true
          setStatus('saving')
          setErrorText('')
          try {
            const payload = {
              ...doc,
              kind: asTemplate === true ? 'template' : doc.kind,
              id: asTemplate === true ? '' : doc.id,
              session: doc.session,
              workspace: doc.workspace,
            }
            const entry = await M.save(payload)
            if (asTemplate === true) {
              // The template is a copy: the draft on screen stays exactly as it
              // was, including its unsaved marker.
              M.store.toast(t('templateCreated'), 'info')
              setStatus('idle')
            } else {
              // Merge into the LATEST document: something may have been typed
              // while the save was in flight, and the click-time snapshot would
              // silently overwrite it.
              const latest = latestDoc.current !== undefined ? latestDoc.current : doc
              const unchanged =
                latest.body === payload.body &&
                latest.title === payload.title &&
                latest.color === payload.color &&
                JSON.stringify(latest.tags || []) === JSON.stringify(payload.tags || [])
              const next = unchanged
                ? {
                    ...latest,
                    id: entry.id,
                    kind: entry.kind === 'template' ? 'template' : 'note',
                    // Take the host's normalised values back, so a dropped tag
                    // or a normalised colour does not linger as "saved".
                    title: entry.title,
                    color: typeof entry.color === 'string' ? entry.color : latest.color,
                    tags: Array.isArray(entry.tags) ? entry.tags : latest.tags,
                    session: entry.session === undefined ? latest.session : entry.session,
                    workspace: entry.workspace === undefined ? latest.workspace : entry.workspace,
                    savedAt: entry.updatedAt,
                    dirty: false,
                  }
                : {
                    // The stored copy is the submitted one; newer keystrokes
                    // stay dirty and the next save updates the same entry.
                    ...latest,
                    id: entry.id,
                    kind: entry.kind === 'template' ? 'template' : 'note',
                    savedAt: entry.updatedAt,
                    dirty: true,
                  }
              setDoc(next)
              if (unchanged) M.writeLocalDraft(sessionId, null)
              else M.writeLocalDraft(sessionId, next)
              setStatus(unchanged ? 'saved' : 'idle')
            }
          } catch (error) {
            setStatus('error')
            setErrorText(error instanceof Error ? error.message : String(error))
            M.store.toast(t('saveFailed', { msg: error instanceof Error ? error.message : String(error) }), 'err')
          } finally {
            savingRef.current = false
          }
        },
        [doc, sessionId, t],
      )

      const hasComposer = inputActions !== undefined && inputActions !== null && typeof inputActions.setDraft === 'function'
      const canSend = hasComposer && typeof inputActions.submit === 'function'

      const injectNow = useCallback(() => {
        if (!hasComposer) {
          M.store.toast(t('noComposer'), 'err')
          return
        }
        if (doc.body.trim() === '') {
          M.store.toast(t('emptyBody'), 'err')
          return
        }
        try {
          // Replace the composer's whole draft; deliberately no focus() call, so
          // inserting never pulls the caret out of this editor.
          inputActions.setDraft(doc.body)
          if (typeof inputActions.persistDraft === 'function') inputActions.persistDraft()
          M.store.toast(t('injected'), 'info')
        } catch (error) {
          M.store.toast(t('injectFailed', { msg: error instanceof Error ? error.message : String(error) }), 'err')
        }
      }, [doc.body, canSend, hasComposer, inputActions, t])

      const sendNow = useCallback(() => {
        if (!canSend) {
          M.store.toast(t('noComposer'), 'err')
          return
        }
        if (doc.body.trim() === '') {
          M.store.toast(t('emptyBody'), 'err')
          return
        }
        try {
          inputActions.setDraft(doc.body)
          if (typeof inputActions.persistDraft === 'function') inputActions.persistDraft()
          if (typeof inputActions.submit === 'function') inputActions.submit()
          M.store.toast(t('sent'), 'info')
        } catch (error) {
          M.store.toast(t('sendFailed', { msg: error instanceof Error ? error.message : String(error) }), 'err')
        }
      }, [doc.body, canSend, hasComposer, inputActions, t])

      const onKeyDown = useCallback(
        (event) => {
          const mod = event.ctrlKey || event.metaKey
          if (mod && !event.shiftKey && !event.altKey && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            event.stopPropagation()
            saveNow(false)
            return
          }
          if (mod && !event.shiftKey && !event.altKey && event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            injectNow()
          }
        },
        [injectNow, saveNow],
      )

      const info = statusLine(t, doc, status, doc.savedAt)

      return h(
        'div',
        { className: 'ps-root ps-editor', onKeyDown, tabIndex: -1, 'data-ps-editor': 'true' },
        h(Style),
        h(
          'header',
          { className: 'ps-ed-head' },
          h(
            'div',
            { className: 'ps-ed-titlerow' },
            h('input', {
              className: 'ps-input ps-ed-title',
              value: doc.title,
              placeholder: t('titlePlaceholder'),
              'aria-label': t('titlePlaceholder'),
              onChange: (event) => patchDoc({ title: event.target.value }),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn ps-btn-quiet ps-btn-sm',
                title: t('openArchive'),
                'aria-label': t('openArchive'),
                onClick: () => runtime.goArchive(),
              },
              '▤',
            ),
          ),
          h(
            'div',
            { className: 'ps-ed-badges' },
            h('span', { className: 'ps-badge ps-badge-accent' }, doc.kind === 'template' ? t('cardTemplate') : t('cardDraft')),
            h(
              'span',
              { className: 'ps-ed-meta' },
              h('span', { className: 'ps-ed-metatext' }, meta.session && meta.session.title ? meta.session.title : t('noSession')),
              meta.workspace && (meta.workspace.name || meta.workspace.path)
                ? h('span', { className: 'ps-ed-metatext' }, `· ${meta.workspace.name || meta.workspace.path}`)
                : null,
            ),
          ),
          h(
            'div',
            { className: 'ps-ed-toolbar' },
            h(ColorPicker, {
              value: doc.color,
              lang,
              t,
              title: t('color'),
              onPick: (color) => patchDoc({ color }),
            }),
            h('span', { className: 'ps-label' }, t('tags')),
            h(TagEditor, { tags: doc.tags, onChange: (tags) => patchDoc({ tags }), t }),
          ),
        ),
        h(
          'div',
          { className: 'ps-ed-body' },
          tab === 'edit'
            ? h('textarea', {
                className: 'ps-ta',
                value: doc.body,
                placeholder: t('bodyPlaceholder'),
                spellCheck: false,
                'aria-label': t('editorTitle'),
                onChange: (event) => patchDoc({ body: event.target.value }),
              })
            : h(
                'div',
                { className: 'ps-preview' },
                doc.body.trim() === '' ? h('p', { className: 'ps-empty' }, t('noPreview')) : renderMarkdown(doc.body),
              ),
        ),
        pending === null
          ? null
          : h(
              'div',
              { className: 'ps-confirm', role: 'alertdialog', 'aria-label': t('confirmOverwrite') },
              h('span', { className: 'ps-confirm-text' }, t('confirmOverwrite')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ps-btn ps-btn-sm',
                  onClick: () => {
                    const request = pending
                    setPending(null)
                    adoptRequest(request)
                  },
                },
                t('discardAndOpen'),
              ),
              h(
                'button',
                { type: 'button', className: 'ps-btn ps-btn-quiet ps-btn-sm', onClick: () => setPending(null) },
                t('keepEditing'),
              ),
            ),
        h(
          'div',
          { className: 'ps-ed-foot' },
          h(
            'div',
            { className: 'ps-status', title: errorText || M.formatExact(doc.savedAt) },
            h('span', { className: 'ps-dot', 'data-tone': info.tone }),
            h('span', null, info.text),
            h('span', { style: { marginLeft: 'auto' } }, t('charCount', { n: doc.body.length })),
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn ps-btn-quiet ps-btn-sm',
                onClick: () => setTab(tab === 'edit' ? 'preview' : 'edit'),
                title: tab === 'edit' ? t('preview') : t('edit'),
              },
              tab === 'edit' ? t('preview') : t('edit'),
            ),
          ),
          h(
            'div',
            { className: 'ps-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn',
                onClick: () => saveNow(false),
                title: t('shortcutSave'),
                disabled: status === 'saving',
              },
              t('save'),
              h('kbd', { className: 'ps-kbd' }, 'Ctrl+S'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn',
                onClick: () => saveNow(true),
                title: t('saveAsTemplate'),
                disabled: status === 'saving' || (doc.body.trim() === '' && doc.title.trim() === ''),
              },
              t('saveAsTemplate'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn',
                onClick: injectNow,
                title: t('shortcutInject'),
                disabled: !hasComposer,
              },
              t('inject'),
              h('kbd', { className: 'ps-kbd' }, 'Ctrl+↵'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ps-btn ps-btn-send ps-btn-sm',
                onClick: sendNow,
                title: t('send'),
                disabled: !canSend,
              },
              t('send'),
            ),
          ),
        ),
        h(Toast),
      )
    }

    // ------------------------------------------------------------- archive page

    /** One tiled card; the whole card opens the document, the footer repeats it as a button. */
    function ArchiveCard({ entry, runtime, t, lang }) {
      const kind = entry.kind === 'template' ? 'template' : 'note'
      const accent = M.colorOf(entry.color)
      const open = (event) => {
        if (event !== undefined) event.stopPropagation()
        runtime.openDocument({ kind, id: entry.id })
      }
      const metaBits = []
      if (entry.session && entry.session.title) metaBits.push(entry.session.title)
      if (entry.workspace && (entry.workspace.name || entry.workspace.path)) {
        metaBits.push(entry.workspace.name || entry.workspace.path)
      }
      return h(
        'article',
        {
          className: 'ps-card',
          style: { '--ps-accent': accent },
          tabIndex: 0,
          role: 'button',
          title: `${entry.title || t('untitled')} · ${M.formatExact(entry.updatedAt)}`,
          onClick: open,
          onKeyDown: (event) => {
            // A key event that started on the footer button belongs to that
            // button: swallowing it here would cancel the button's own
            // activation (the template button opens a draft, not the card).
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              open()
            }
          },
        },
        h(
          'div',
          { className: 'ps-card-top' },
          h('span', { className: 'ps-kind', 'data-kind': kind }, kind === 'template' ? t('cardTemplate') : t('cardDraft')),
          h('time', { className: 'ps-card-time' }, M.formatWhen(entry.updatedAt, t)),
        ),
        h('h3', { className: 'ps-card-title' }, entry.title || t('untitled')),
        entry.excerpt ? h('p', { className: 'ps-card-excerpt' }, entry.excerpt) : null,
        entry.tags && entry.tags.length > 0
          ? h(
              'div',
              { className: 'ps-card-tags' },
              entry.tags.map((tag) => h('span', { className: 'ps-tag', key: tag }, tag)),
            )
          : null,
        h(
          'footer',
          { className: 'ps-card-foot' },
          h('span', { className: 'ps-card-meta' }, metaBits.join(' · ') || t('noSession')),
          h(
            'button',
            {
              type: 'button',
              className: 'ps-card-open',
              onClick: (event) => {
                event.stopPropagation()
                if (kind === 'template') {
                  // A template is a seed, not a document to edit by accident:
                  // this always mints a fresh draft and leaves it untouched.
                  if (typeof runtime.newDraftFromTemplate === 'function') runtime.newDraftFromTemplate(entry.id)
                } else {
                  open(event)
                }
              },
            },
            kind === 'template' ? t('cardUseTemplate') : t('cardOpen'),
          ),
        ),
      )
    }

    /** The `main` page: grouping, sorting, filtering, templates, folder button. */
    function ArchivePanel(props) {
      const runtime = props.runtime
      const state = useStore()
      const translation = useTranslate(runtime)
      const { t, lang } = translation

      useEffect(() => {
        if (state.status === 'idle') {
          M.load({}).catch(() => undefined)
        }
      }, [state.status])

      const groups = useMemo(
        () => M.groupEntries(state.library, state.view, t),
        [state.library, state.view, t],
      )
      const colors = useMemo(() => M.colorFacets(state.library), [state.library])
      const tags = useMemo(() => M.tagFacets(state.library), [state.library])
      const counts = useMemo(() => M.scopeCounts(state.library), [state.library])
      const total = useMemo(() => M.filterEntries(state.library, state.view).length, [state.library, state.view])

      const setView = (patch) => M.saveView(patch)

      const toggleFilter = (key, value) => {
        const current = state.view.filters[key] || []
        const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
        setView({ filters: { ...state.view.filters, [key]: next } })
      }

      const createDraft = async (kind) => {
        // The runtime brings the conversation back first when a global panel is
        // showing, then asks the editor for a blank draft — and reports whether
        // that actually became possible, instead of toasting optimistically.
        if (typeof runtime.newBlankDraft === 'function') {
          runtime.newBlankDraft(kind)
          return
        }
        M.requestOpen({ kind, blank: true, sessionId: runtime.currentSessionId() })
        runtime.openEditorTab()
      }

      const openFolder = async () => {
        try {
          await M.openFolder()
          M.store.toast(t('opened'), 'info')
        } catch (error) {
          M.store.toast(t('openFolderFailed', { msg: error instanceof Error ? error.message : String(error) }), 'err')
        }
      }

      const hasFilters = (state.view.filters.colors || []).length > 0 || (state.view.filters.tags || []).length > 0

      return h(
        'div',
        { className: 'ps-root ps-archive' },
        h(Style),
        h(
          'header',
          { className: 'ps-ar-head' },
          h(
            'div',
            { className: 'ps-ar-headtext' },
            h('h1', { className: 'ps-ar-title' }, t('panelTitle')),
            h('p', { className: 'ps-ar-sub' }, t('panelSubtitle')),
          ),
          h(
            'div',
            { className: 'ps-ar-actions' },
            h(
              'button',
              { type: 'button', className: 'ps-btn ps-btn-primary', onClick: () => createDraft('note') },
              t('newDraft'),
            ),
            h(
              'button',
              { type: 'button', className: 'ps-btn', onClick: () => createDraft('template') },
              t('newTemplate'),
            ),
            h('button', { type: 'button', className: 'ps-btn', onClick: openFolder }, t('openFolder')),
          ),
        ),
        h(
          'div',
          { className: 'ps-ar-toolbar' },
          h(
            'div',
            { className: 'ps-seg', role: 'tablist', 'aria-label': t('scopeAll') },
            [
              ['all', t('scopeAll'), counts.all],
              ['note', t('scopeNotes'), counts.note],
              ['template', t('scopeTemplates'), counts.template],
            ].map(([id, label, count]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  role: 'tab',
                  'data-on': state.view.scope === id,
                  'aria-selected': state.view.scope === id,
                  onClick: () => setView({ scope: id }),
                },
                label,
                h('span', { className: 'ps-count' }, count),
              ),
            ),
          ),
          h('input', {
            className: 'ps-input ps-search',
            value: state.view.query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: (event) => setView({ query: event.target.value }),
          }),
          h(
            'label',
            { className: 'ps-ar-field' },
            h('span', { className: 'ps-label' }, t('group')),
            h(
              'select',
              {
                className: 'ps-select',
                value: state.view.groupBy,
                'aria-label': t('group'),
                onChange: (event) => setView({ groupBy: event.target.value }),
              },
              [
                ['time', t('groupTime')],
                ['session', t('groupSession')],
                ['workspace', t('groupWorkspace')],
                ['color', t('groupColor')],
                ['tag', t('groupTag')],
                ['none', t('groupNone')],
              ].map(([value, label]) => h('option', { key: value, value }, label)),
            ),
          ),
          h(
            'label',
            { className: 'ps-ar-field' },
            h('span', { className: 'ps-label' }, t('sort')),
            h(
              'select',
              {
                className: 'ps-select',
                value: state.view.sortBy,
                'aria-label': t('sort'),
                onChange: (event) => setView({ sortBy: event.target.value }),
              },
              [
                ['updated', t('sortUpdated')],
                ['created', t('sortCreated')],
                ['title', t('sortTitle')],
              ].map(([value, label]) => h('option', { key: value, value }, label)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'ps-facets' },
          h('span', { className: 'ps-label' }, t('filterColor')),
          colors.slice(0, 8).map((facade) =>
            h(
              'button',
              {
                key: facade.hex,
                type: 'button',
                className: 'ps-facet',
                'data-on': (state.view.filters.colors || []).includes(facade.hex),
                title: facade.hex,
                onClick: () => toggleFilter('colors', facade.hex),
              },
              h('span', { className: 'ps-swatch', style: { background: facade.hex } }),
              String(facade.count),
            ),
          ),
          tags.length > 0 ? h('span', { className: 'ps-facet-sep' }) : null,
          tags.slice(0, 12).map((facade) =>
            h(
              'button',
              {
                key: facade.tag,
                type: 'button',
                className: 'ps-facet',
                'data-on': (state.view.filters.tags || []).includes(facade.tag),
                onClick: () => toggleFilter('tags', facade.tag),
              },
              facade.tag,
              h('span', { className: 'ps-count' }, String(facade.count)),
            ),
          ),
          hasFilters
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ps-facet',
                  onClick: () => setView({ filters: { colors: [], tags: [] } }),
                },
                t('clearFilters'),
              )
            : null,
        ),
        h(
          'div',
          { className: 'ps-ar-scroll' },
          state.status === 'loading'
            ? h('p', { className: 'ps-empty' }, t('loading'))
            : state.status === 'error'
              ? h(
                  'div',
                  { className: 'ps-empty' },
                  h('p', null, t('loadFailed', { msg: state.error })),
                  h('button', { type: 'button', className: 'ps-btn', onClick: () => M.load({}).catch(() => undefined) }, t('retry')),
                )
              : total === 0
                ? h('p', { className: 'ps-empty' }, (state.library.notes.length + state.library.templates.length) === 0 ? t('empty') : t('emptyFiltered'))
                : groups.map((group) =>
                    h(
                      'section',
                      { className: 'ps-group', key: group.id },
                      group.title === ''
                        ? null
                        : h(
                            'h2',
                            { className: 'ps-grouphead' },
                            group.color ? h('span', { className: 'ps-swatch', style: { background: group.color } }) : null,
                            group.title,
                            h('span', { className: 'ps-groupcount' }, String(group.entries.length)),
                          ),
                      h(
                        'div',
                        { className: 'ps-grid' },
                        group.entries.map((entry) =>
                          h(ArchiveCard, {
                            key: `${entry.kind}:${entry.id}`,
                            entry,
                            runtime,
                            t,
                            lang,
                          }),
                        ),
                      ),
                    ),
                  ),
        ),
        h(
          'footer',
          { className: 'ps-ar-foot' },
          h('span', { className: 'ps-path', title: state.dir }, state.dir || '~/.dsh/prompt-stash'),
          h('span', { className: 'ps-nodel' }, lang === 'en' ? 'no delete — files stay on disk' : '不做删除，文件都在磁盘上'),
        ),
        h(Toast),
      )
    }

    // ------------------------------------------------------------- rail icon

    /** The left-rail glyph; the host owns the button, label, tooltip and active state. */
    function SidebarIcon(props) {
      const size = (props && props.size) || 16
      const active = !!(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M5.4 3.8h13.2a2 2 0 0 1 2 2v12.4a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2z',
          fill: active ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7.6 8.6h8.8M7.6 12h8.8M7.6 15.4h5.2',
          stroke: active ? 'var(--dsw-alias-bg-base, #ffffff)' : 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    return { EditorPanel, ArchivePanel, SidebarIcon, renderMarkdown, CSS }
  }

  globalThis.__PromptStashUI = { createUI }
})()
