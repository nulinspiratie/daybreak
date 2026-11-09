import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Ctx } from './ctx'
import { today } from './ctx'
import { daysBetween, type ISODate } from './dates'

export interface BackupOptions {
  /** The folder the copies go to (for example on the work OneDrive). */
  dir: string
  /** A local folder for the temporary copy, normally the data folder. Never the target. */
  workDir: string
  /** Copies dated this many days before today, or more, are deleted. At least 1. */
  retainDays: number
  /** Mirrored into `<dir>/logs`; finished logs never change, so only new ones are copied. */
  logsDir?: string
  /** The newest copies always kept, whatever their age. */
  keep?: number
}

export interface BackupResult {
  date: ISODate
  file: string
  logsCopied: number
  pruned: string[]
}

export const BACKUP_KEEP = 3
const SNAPSHOT = /^daybreak-(\d{4}-\d{2}-\d{2})\.db$/
const LOG = /^\d{4}-\d{2}-\d{2}\.md$/

export const snapshotName = (date: ISODate): string => `daybreak-${date}.db`

/**
 * Copy the database to `<dir>/daybreak-<today>.db` (replacing an earlier copy from today), mirror
 * new daily logs, then delete copies older than `retainDays`. Must run outside a transaction.
 *
 * SQLite never touches `dir`: VACUUM INTO writes a complete, consistent copy into `workDir`, which
 * is copied into `dir` under a `.partial` name and renamed. A sync client such as OneDrive only
 * ever sees finished files. Old copies are deleted only after the new one is in place.
 */
export function backupDatabase(ctx: Ctx, opts: BackupOptions): BackupResult {
  const date = today(ctx)
  ensureDir(opts.dir)

  const file = join(opts.dir, snapshotName(date))
  const tmp = join(opts.workDir, `${snapshotName(date)}.tmp`)
  rmSync(tmp, { force: true })
  try {
    ctx.db.run('VACUUM INTO ?', tmp)
    publish(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }

  const logsCopied =
    opts.logsDir === undefined ? 0 : mirrorLogs(opts.logsDir, join(opts.dir, 'logs'))
  const pruned = prune(opts.dir, date, opts.retainDays, opts.keep ?? BACKUP_KEEP)
  return { date, file, logsCopied, pruned }
}

/**
 * The target folder must exist, or be creatable inside a folder that does: a typo in the path
 * becomes an error instead of a new folder nobody syncs.
 */
function ensureDir(dir: string): void {
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Error(`The backup folder ${dir} is a file`)
    return
  }
  const parent = dirname(dir)
  if (!existsSync(parent)) {
    throw new Error(
      `The backup folder ${dir} doesn't exist, and neither does ${parent}. Check dir in [backup] in the settings file.`,
    )
  }
  mkdirSync(dir)
}

/** Copy `from` to `to` under a temporary name, then rename it into place. */
function publish(from: string, to: string): void {
  const partial = `${to}.partial`
  try {
    copyFileSync(from, partial)
    renameSync(partial, to)
  } finally {
    rmSync(partial, { force: true })
  }
}

function mirrorLogs(logsDir: string, target: string): number {
  if (!existsSync(logsDir)) return 0
  let copied = 0
  for (const name of readdirSync(logsDir)) {
    if (!LOG.test(name)) continue
    const to = join(target, name)
    if (existsSync(to)) continue
    mkdirSync(target, { recursive: true })
    publish(join(logsDir, name), to)
    copied++
  }
  return copied
}

/** Delete snapshots dated `retainDays` or more before `date`, never the `keep` newest. */
function prune(dir: string, date: ISODate, retainDays: number, keep: number): string[] {
  const snapshots = readdirSync(dir)
    .map((name) => ({ name, date: SNAPSHOT.exec(name)?.[1] as ISODate | undefined }))
    .filter((s): s is { name: string; date: ISODate } => s.date !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const pruned: string[] = []
  for (const s of snapshots.slice(keep)) {
    if (daysBetween(s.date, date) < retainDays) continue
    rmSync(join(dir, s.name), { force: true })
    pruned.push(s.name)
  }
  return pruned
}
