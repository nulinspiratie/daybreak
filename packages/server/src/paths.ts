// Only node: built-ins here: Vite's config loader imports this file (SPEC R5).
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'

export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (env.DAYBREAK_DATA_DIR) return resolve(env.DAYBREAK_DATA_DIR)
  if (platform === 'win32' && env.LOCALAPPDATA) return win32.join(env.LOCALAPPDATA, 'Daybreak')
  if (env.XDG_DATA_HOME) return posix.join(env.XDG_DATA_HOME, 'daybreak')
  return posix.join(home, '.local', 'share', 'daybreak')
}

/** Realpath of `p`, or of its nearest existing ancestor with the missing tail re-appended. */
function realpathLoose(p: string): string {
  const abs = resolve(p)
  const tail: string[] = []
  let cur = abs
  while (!existsSync(cur)) {
    const parent = dirname(cur)
    if (parent === cur) return abs
    tail.unshift(cur.slice(parent.length).replace(/^[\\/]+/, ''))
    cur = parent
  }
  return join(realpathSync(cur), ...tail)
}

export function assertOutsideRepo(dataDir: string, repoRoot: string): void {
  const dir = realpathLoose(dataDir)
  const repo = realpathLoose(repoRoot)
  const rel = relative(repo, dir)
  // An absolute `rel` means a different drive on Windows: outside the repo.
  const escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  if (!escapes) {
    throw new Error(
      `Refusing to use ${dir}: it is inside the repository (${repo}). Work data never goes in the repo.`,
    )
  }
}

export function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, 'token')
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(existing)) return existing
  }
  mkdirSync(dataDir, { recursive: true })
  const token = randomBytes(32).toString('hex')
  writeFileSync(file, `${token}\n`, { mode: 0o600 })
  return token
}
