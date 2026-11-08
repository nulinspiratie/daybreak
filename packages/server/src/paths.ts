// Only node: built-ins here: Vite's config loader imports this file (SPEC R5).
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'

export interface ServerConfig {
  port: number
  dayStartsAt: string
}

export const DEFAULT_CONFIG: ServerConfig = { port: 47815, dayStartsAt: '04:00' }

export function resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (env.DAYBREAK_DATA_DIR) return resolve(env.DAYBREAK_DATA_DIR)
  if (platform === 'win32' && env.LOCALAPPDATA) return win32.join(env.LOCALAPPDATA, 'Daybreak')
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, 'daybreak')
  return join(home, '.local', 'share', 'daybreak')
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
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(
      `Refusing to use ${dir}: it is inside the repository (${repo}). Work data never goes in the repo.`,
    )
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function loadConfig(dataDir: string): ServerConfig {
  const file = join(dataDir, 'config.json')
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
    return { ...DEFAULT_CONFIG }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`config.json (${file}) is not valid JSON: ${(e as Error).message}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`config.json (${file}) must be a JSON object`)
  }
  const obj = raw as Record<string, unknown>
  const port = obj.port ?? DEFAULT_CONFIG.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config.json (${file}): "port" must be an integer from 1 to 65535, got ${JSON.stringify(port)}`)
  }
  const dayStartsAt = obj.dayStartsAt ?? DEFAULT_CONFIG.dayStartsAt
  if (typeof dayStartsAt !== 'string' || !HHMM.test(dayStartsAt)) {
    throw new Error(
      `config.json (${file}): "dayStartsAt" must be HH:MM from 00:00 to 23:59, got ${JSON.stringify(dayStartsAt)}`,
    )
  }
  return { port, dayStartsAt }
}

export function loadOrCreateToken(dataDir: string): string {
  const file = join(dataDir, 'token')
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(existing)) return existing
  }
  mkdirSync(dataDir, { recursive: true })
  const token = randomBytes(32).toString('hex')
  writeFileSync(file, token + '\n', { mode: 0o600 })
  return token
}
