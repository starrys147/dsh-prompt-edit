/**
 * Builds `client.js` from the plain-script source parts.
 *
 * The parts are ordinary classic scripts that publish their surface on
 * `globalThis`, concatenated in dependency order. That keeps the browser
 * artifact a single file (what the module loader expects) while letting the
 * unit tests import `src/client/model.js` on its own. No bundler, no transpile.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const parts = ['src/client/model.js', 'src/client/ui.js', 'src/client/entry.js']
const banner = [
  '/* 提示词稿箱 / Prompt Stash — generated file. Edit src/client/*.js and run `npm run build`. */',
  '/* Browser-only Client half: no Harness Client package, no external asset. */',
  '',
].join('\n')

const bodies = []
for (const part of parts) {
  const text = await readFile(join(root, part), 'utf8')
  // A semicolon after every part: each file is an IIFE, and without it the next
  // part's leading `(` would be parsed as a call on the previous result.
  bodies.push(`/* ---- ${part} ---- */\n${text.trimEnd()}\n;\n`)
}
await writeFile(join(root, 'client.js'), `${banner}${bodies.join('\n')}`, 'utf8')
console.log(`client.js written (${parts.length} parts, ${Math.round(JSON.stringify(bodies.join('')).length / 1024)} KiB raw)`)
