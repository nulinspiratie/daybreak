// Pre-commit check (run by .githooks/pre-commit) and CI data guard.
//
//   bun scripts/check-staged.ts          staged files: data guard, then typecheck + tests if code changed
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
  if (!path.startsWith('docs/') && /(^|\/)logs\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return 'a daily log'
  return null
}

const refused = files.map((f) => [f, looksLikeTaskData(f)] as const).filter(([, why]) => why !== null)
if (refused.length > 0) {
  console.error('Refusing to commit what looks like work task data:')
  for (const [f, why] of refused) console.error(`  ${f}  (${why})`)
  console.error('Task data lives in %LOCALAPPDATA%\\Daybreak or DAYBREAK_DATA_DIR, never in this repo.')
  process.exit(1)
}
if (all) {
  console.log(`Data guard: ${files.length} tracked files, none look like task data.`)
  process.exit(0)
}

const code = files.some((f) => /\.(ts|tsx|css|html|json)$/.test(f) || basename(f) === 'bun.lock')
if (!code) process.exit(0)

for (const script of ['typecheck', 'test']) {
  console.log(`pre-commit: bun run ${script}`)
  const r = spawnSync('bun', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`pre-commit: "bun run ${script}" failed. Fix it, or commit with --no-verify to skip.`)
    process.exit(1)
  }
}
