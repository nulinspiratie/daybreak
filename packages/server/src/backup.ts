import type { BackupResult, ISODate } from '@daybreak/core'

export interface BackupStatus {
  dir: string
  /** When the last copy was made (ISO time), or null if none has been made since start-up. */
  lastAt: string | null
  /** Why the last attempt failed; null once one succeeds. */
  error: string | null
}

export interface BackupScheduleDeps {
  dir: string
  run: () => BackupResult
  today: () => ISODate
  now?: () => number
  /** Called when `error` appears or clears, so open windows can refetch the status. */
  onStatusChange?: () => void
  /** Minimum time between attempts within a day. */
  everyMs?: number
}

export const BACKUP_EVERY_MS = 60 * 60_000
export const BACKUP_TICK_MS = 60_000

/**
 * When to back up: at start-up and on the first check of each new day, then at most once an
 * hour while there are changes since the last copy (or while the last attempt failed). Failures
 * are logged and reported in the status; they never stop the server.
 */
export function createBackupSchedule(deps: BackupScheduleDeps) {
  const now = deps.now ?? Date.now
  const every = deps.everyMs ?? BACKUP_EVERY_MS
  let lastAttemptAt: number | undefined
  let lastAttemptDay: ISODate | undefined
  let dirty = false
  const status: BackupStatus = { dir: deps.dir, lastAt: null, error: null }

  function attempt(day: ISODate): void {
    lastAttemptAt = now()
    lastAttemptDay = day
    dirty = false
    const hadError = status.error !== null
    try {
      deps.run()
      status.lastAt = new Date(lastAttemptAt).toISOString()
      status.error = null
    } catch (e) {
      dirty = true
      status.error = (e as Error).message
      console.error(`Daybreak: backup failed: ${status.error}`)
    }
    if (hadError !== (status.error !== null)) deps.onStatusChange?.()
  }

  return {
    /** One check; run it every minute or so. */
    tick(): void {
      let day: ISODate
      try {
        day = deps.today()
      } catch {
        return
      }
      const newDay = lastAttemptAt === undefined || lastAttemptDay !== day
      const hourly = (dirty || status.error !== null) && now() - (lastAttemptAt ?? 0) >= every
      if (newDay || hourly) attempt(day)
    },
    /** Something changed in the database since the last copy. */
    markDirty(): void {
      dirty = true
    },
    status(): BackupStatus {
      return { ...status }
    },
  }
}

export type BackupSchedule = ReturnType<typeof createBackupSchedule>

/** Ticks now, then every `intervalMs`. Returns a function that stops it. */
export function startBackups(schedule: BackupSchedule, intervalMs = BACKUP_TICK_MS): () => void {
  schedule.tick()
  const timer = setInterval(() => schedule.tick(), intervalMs)
  return () => clearInterval(timer)
}
