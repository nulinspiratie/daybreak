// Daybreak's settings file: ~/.daybreak.toml (or DAYBREAK_CONFIG). See docs/spec.md §7.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { posix, resolve, win32 } from 'node:path'
import { parseToml, TomlError, type TomlTable, type TomlValue } from './toml'

export interface BackupConfig {
  /** Absolute folder the daily copies go to; defaults to `<data folder>/backups`. */
  dir: string
  /** Daily copies older than this many days are deleted (the newest few are always kept). */
  retainDays: number
}

export interface ServerConfig {
  port: number
  dayStartsAt: string
  backup: BackupConfig
}

export interface LoadedConfig {
  config: ServerConfig
  /** The settings file that was read (and created, if it was missing). */
  file: string
  /** Unknown sections and keys: reported, not fatal, so the file can run ahead of the code. */
  warnings: string[]
}

export const DEFAULT_PORT = 47815
export const DEFAULT_DAY_STARTS_AT = '04:00'
export const DEFAULT_RETAIN_DAYS = 14
const MAX_RETAIN_DAYS = 3650
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Where the settings file lives. DAYBREAK_CONFIG wins. With DAYBREAK_DATA_DIR set (dev, the seed,
 * the smoke test) it lives in that data folder, so a scratch run never reads the real settings and
 * never backs fictional data up into the real backup folder. Otherwise it's ~/.daybreak.toml.
 */
export function resolveConfigFile(env: NodeJS.ProcessEnv, dataDir: string, home: string): string {
  if (env.DAYBREAK_CONFIG) return resolve(env.DAYBREAK_CONFIG)
  const path = pathFor(dataDir)
  if (env.DAYBREAK_DATA_DIR) return path.join(dataDir, 'daybreak.toml')
  return pathFor(home).join(home, '.daybreak.toml')
}

/** Windows-style paths get win32 joins, so tests on Linux can use C:\ paths and vice versa. */
function pathFor(p: string): typeof posix {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') ? win32 : posix
}

export function template(port: number, dayStartsAt: string): string {
  return `# Daybreak settings. Restart Daybreak after changing this file.
# Paths: use single quotes, so backslashes are kept as they are: 'C:\\Users\\…'.
# ~ and %NAME% (an environment variable) are expanded.

[server]
port = ${port}

[day]
# The day rolls over at this time, not at midnight (HH:MM, 24-hour clock).
starts_at = "${dayStartsAt}"

[backup]
# A copy of the database is made once a day, and again each hour while there are changes.
# Leave dir unset to keep the copies in the data folder's backups folder. For the work OneDrive:
# dir = '%OneDriveCommercial%\\Daybreak backups'
retain_days = ${DEFAULT_RETAIN_DAYS}
`
}

export interface LoadConfigOptions {
  file: string
  dataDir: string
  env: NodeJS.ProcessEnv
  home: string
  platform: NodeJS.Platform
}

/**
 * Reads the settings file, creating it with every setting written out if it's missing. When it's
 * created, port and dayStartsAt are carried over from an old `<data folder>/config.json`, which is
 * then renamed to config.json.old. Throws, naming the file, on anything it can't use.
 */
export function loadConfig(opts: LoadConfigOptions): LoadedConfig {
  const { file } = opts
  if (!existsSync(file)) {
    const legacy = readLegacyJson(opts.dataDir)
    mkdirSync(pathFor(file).dirname(file), { recursive: true })
    writeFileSync(
      file,
      template(legacy?.port ?? DEFAULT_PORT, legacy?.dayStartsAt ?? DEFAULT_DAY_STARTS_AT),
    )
    if (legacy) renameSync(legacy.file, `${legacy.file}.old`)
  }

  const fail = (message: string): never => {
    throw new Error(`Settings file ${file}: ${message}`)
  }
  let doc: ReturnType<typeof parseToml>
  try {
    doc = parseToml(readFileSync(file, 'utf8'))
  } catch (e) {
    if (e instanceof TomlError) fail(e.message)
    throw e
  }

  const warnings: string[] = []
  const KNOWN: Record<string, readonly string[]> = {
    server: ['port'],
    day: ['starts_at'],
    backup: ['dir', 'retain_days'],
  }
  const sections: Record<string, TomlTable> = {}
  for (const [name, value] of Object.entries(doc)) {
    if (!(name in KNOWN)) {
      warnings.push(`unknown ${isTable(value) ? `section [${name}]` : `setting ${name}`}`)
      continue
    }
    if (!isTable(value)) fail(`${name} must be a section, [${name}]`)
    sections[name] = value as TomlTable
    for (const key of Object.keys(value as TomlTable)) {
      if (!KNOWN[name]!.includes(key)) warnings.push(`unknown setting ${key} in [${name}]`)
    }
  }
  const get = (section: string, key: string): TomlValue | undefined => sections[section]?.[key]
  const show = (v: TomlValue) => JSON.stringify(v)

  const port = get('server', 'port') ?? DEFAULT_PORT
  if (typeof port !== 'number' || port < 1 || port > 65535) {
    fail(`port in [server] must be a whole number from 1 to 65535, got ${show(port)}`)
  }
  const dayStartsAt = get('day', 'starts_at') ?? DEFAULT_DAY_STARTS_AT
  if (typeof dayStartsAt !== 'string' || !HHMM.test(dayStartsAt)) {
    fail(`starts_at in [day] must be "HH:MM" from "00:00" to "23:59", got ${show(dayStartsAt)}`)
  }
  const retainDays = get('backup', 'retain_days') ?? DEFAULT_RETAIN_DAYS
  if (typeof retainDays !== 'number' || retainDays < 1 || retainDays > MAX_RETAIN_DAYS) {
    fail(
      `retain_days in [backup] must be a whole number from 1 to ${MAX_RETAIN_DAYS}, got ${show(retainDays)}`,
    )
  }
  const rawDir = get('backup', 'dir')
  let dir: string
  if (rawDir === undefined) {
    dir = pathFor(opts.dataDir).join(opts.dataDir, 'backups')
  } else {
    if (typeof rawDir !== 'string' || rawDir.trim() === '') {
      fail(`dir in [backup] must be a folder path in quotes, got ${show(rawDir)}`)
    }
    dir = expandPath(rawDir as string, opts.env, opts.home, opts.platform, (m) =>
      fail(`dir in [backup]: ${m}`),
    )
    if (samePath(dir, opts.dataDir, opts.platform)) {
      fail('dir in [backup] is the data folder itself; use a folder of its own')
    }
  }

  return {
    config: {
      port: port as number,
      dayStartsAt: dayStartsAt as string,
      backup: { dir, retainDays: retainDays as number },
    },
    file,
    warnings,
  }
}

function isTable(v: unknown): v is TomlTable {
  return typeof v === 'object' && v !== null
}

/**
 * Expands a leading ~ and %NAME% environment variables, then checks the result is absolute.
 * Variable names match case-insensitively on Windows, as Windows itself does.
 */
export function expandPath(
  raw: string,
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform,
  fail: (message: string) => never,
): string {
  const path = platform === 'win32' ? win32 : posix
  let out = raw.trim()
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) out = home + out.slice(1)
  out = out.replace(/%([^%\\/]+)%/g, (_, name: string) => {
    const value = lookupEnv(env, name, platform)
    if (value === undefined || value === '') fail(`the environment variable %${name}% isn't set`)
    return value as string
  })
  if (!path.isAbsolute(out)) fail(`${JSON.stringify(raw)} must be a full path, such as 'C:\\…'`)
  return path.normalize(out)
}

function lookupEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const path = platform === 'win32' ? win32 : posix
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '')
  return platform === 'win32'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b)
}

/** port and dayStartsAt from the config.json that came before the settings file, if any. */
function readLegacyJson(
  dataDir: string,
): { file: string; port?: number; dayStartsAt?: string } | undefined {
  const file = pathFor(dataDir).join(dataDir, 'config.json')
  if (!existsSync(file)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(
      `${file} is not valid JSON, so its settings can't be moved to the settings file: ${(e as Error).message}`,
    )
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file} must be a JSON object, so its settings can be moved`)
  }
  const obj = raw as Record<string, unknown>
  const port =
    typeof obj.port === 'number' && Number.isInteger(obj.port) && obj.port >= 1 && obj.port <= 65535
      ? obj.port
      : undefined
  const dayStartsAt =
    typeof obj.dayStartsAt === 'string' && HHMM.test(obj.dayStartsAt) ? obj.dayStartsAt : undefined
  return { file, port, dayStartsAt }
}
