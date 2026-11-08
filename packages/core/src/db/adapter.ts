export type SqlValue = string | number | null

export interface RunResult {
  changes: number
}

export interface Db {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): RunResult
  get<T>(sql: string, ...params: SqlValue[]): T | undefined
  all<T>(sql: string, ...params: SqlValue[]): T[]
  close(): void
}

const depth = new WeakMap<Db, number>()

/**
 * Run `fn` inside BEGIN IMMEDIATE / COMMIT, rolling back if it throws.
 * Nested calls join the outer transaction: only the outermost call commits or
 * rolls back, so an error anywhere inside discards everything.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0
  if (level > 0) {
    depth.set(db, level + 1)
    try {
      return fn()
    } finally {
      depth.set(db, level)
    }
  }
  db.exec('BEGIN IMMEDIATE')
  depth.set(db, 1)
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // the original error is the one worth reporting
    }
    throw err
  } finally {
    depth.set(db, 0)
  }
}
