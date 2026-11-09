// Pre-commit check (run by .githooks/pre-commit) and CI data guard.
//
//   bun scripts/check-staged.ts          staged files: data guard, Biome format + safe fixes
//                                        (re-staged), then typecheck + tests if code changed
//   bun scripts/check-staged.ts --all    every tracked file: data guard only (CI)
//
// Work task data must never be committed (CLAUDE.md). This refuses database
// files, the data folder's token and config, and daily logs outside docs/.
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'

const all = process.argv.includes('--all')

function git(args: string[]): string[] {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(r.stderr)
    process.exit(1)
  }
  return r.stdout.split('\0').filter(Boolean)
}

const files = all
  ? git(['ls-files', '-z'])
  : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])

function looksLikeTaskData(path: string): string | null {
  const name = basename(path).toLowerCase()
  if (/\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3)$/.test(name)) return 'a database file'
  if (name === 'token') return "the data folder's token"
  if (/(^|\/)daybreak\//i.test(path)) return 'a file from a Daybreak data folder'
  if (!path.startsWith('docs/') && /(^|\/)logs\/\d{4}-\d{2}-\d{2}\.md$/.test(path))
    return 'a daily log'
  return null
}

const refused = files
  .map((f) => [f, looksLikeTaskData(f)] as const)
  .filter(([, why]) => why !== null)
if (refused.length > 0) {
  console.error('Refusing to commit what looks like work task data:')
  for (const [f, why] of refused) console.error(`  ${f}  (${why})`)
  console.error(
    'Task data lives in %LOCALAPPDATA%\\Daybreak or DAYBREAK_DATA_DIR, never in this repo.',
  )
  process.exit(1)
}
if (all) {
  console.log(`Data guard: ${files.length} tracked files, none look like task data.`)
  process.exit(0)
}

const code = files.some((f) => /\.(ts|tsx|css|html|json)$/.test(f) || basename(f) === 'bun.lock')
if (!code) process.exit(0)

function run(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  return r.status ?? 1
}

// Biome: format and apply safe lint fixes to the staged files, then stage the result. A file
// with unstaged changes too is only checked, never rewritten, so those changes stay unstaged.
const biomeFiles = files.filter((f) => /\.(ts|tsx|js|mjs|css|json|html)$/.test(f))
if (biomeFiles.length > 0) {
  const partly = new Set(git(['diff', '--name-only', '-z', '--', ...biomeFiles]))
  const whole = biomeFiles.filter((f) => !partly.has(f))
  const biome = ['x', 'biome', 'check', '--no-errors-on-unmatched', '--files-ignore-unknown=true']
  if (whole.length > 0) {
    run('bun', [...biome, '--write', ...whole])
    git(['add', '--', ...whole])
  }
  if (run('bun', [...biome, '--error-on-warnings', ...biomeFiles]) !== 0) {
    console.error(
      partly.size > 0
        ? 'pre-commit: Biome found problems. Files with unstaged changes are not fixed for you;\n' +
            'stage them fully or run "bun run format", then commit again.'
        : 'pre-commit: Biome found problems it cannot fix on its own (above). Fix them and commit again.',
    )
    process.exit(1)
  }
}

for (const script of ['typecheck', 'test']) {
  console.log(`pre-commit: bun run ${script}`)
  if (run('bun', ['run', script]) !== 0) {
    console.error(`pre-commit: "bun run ${script}" failed. Fix it and commit again.`)
    process.exit(1)
  }
}
