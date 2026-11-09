/**
 * Test environment resolution.
 *
 * The Client-side tests import React/ReactDOM from the installed DSH profile
 * (they are not dependencies of this package), and the DOM tests need jsdom.
 * Both are resolved from the environment instead of a hard-coded machine path:
 *
 *   DSH_PROMPT_STASH_PROFILE_MODULES  explicit profile `node_modules` directory
 *   DSH_PROFILE_DIR                   set by DSH in every shell it spawns
 *   DSH_HOME + DSH_PROFILE            fallback: `<home>/profiles/<profile>`
 *   `~/.dsh/profiles/desktop`         last resort
 *
 *   DSH_PROMPT_STASH_JSDOM            explicit `node_modules` holding jsdom
 *   `<repo>/node_modules`             after `npm install` (jsdom is a devDependency)
 *
 * A test file whose dependency cannot be found registers ONE skipped test with
 * that reason, so a missing environment never looks like a passing suite.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root (the parent of `tests/`). */
export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** First candidate directory that contains `probe`, or undefined. */
function firstWith(candidates, probe) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue
    if (existsSync(join(candidate, probe))) return candidate
  }
  return undefined
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileName = process.env.DSH_PROFILE || 'desktop'

/** `node_modules` of the DSH profile that owns React/ReactDOM. */
export const profileModules = firstWith(
  [
    process.env.DSH_PROMPT_STASH_PROFILE_MODULES,
    process.env.DSH_PROFILE_DIR ? join(process.env.DSH_PROFILE_DIR, 'node_modules') : undefined,
    join(dshHome, 'profiles', profileName, 'node_modules'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules'),
  ],
  join('react', 'index.js'),
)

/** `node_modules` directory that holds jsdom, or undefined when it is not installed. */
export const jsdomModules = firstWith(
  [process.env.DSH_PROMPT_STASH_JSDOM, join(repoRoot, 'node_modules')],
  join('jsdom', 'lib', 'api.js'),
)

/** Where a missing dependency is documented, for the skip reason. */
export const hints = {
  profile: 'React/ReactDOM from the DSH profile: set DSH_PROFILE_DIR or DSH_PROMPT_STASH_PROFILE_MODULES',
  jsdom: `jsdom: run "npm install" in ${repoRoot} or set DSH_PROMPT_STASH_JSDOM to a node_modules directory that has it`,
}
