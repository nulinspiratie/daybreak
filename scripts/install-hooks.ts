// Run by `bun install` (the root "prepare" script): point git at .githooks/ and at the
// list of bulk-formatting commits for `git blame`.
// Does nothing outside a git checkout, so installing from a zip still works.
import { spawnSync } from 'node:child_process'

const inRepo = spawnSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }).status === 0
if (inRepo) {
  spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
  spawnSync('git', ['config', 'blame.ignoreRevsFile', '.git-blame-ignore-revs'], {
    stdio: 'inherit',
  })
}
