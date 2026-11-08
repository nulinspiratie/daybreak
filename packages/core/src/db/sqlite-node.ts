import type { DatabaseSync } from 'node:sqlite'
import type { Db, SqlValue } from './adapter'

// node:sqlite prints an ExperimentalWarning when first loaded. Drop only that
// one warning while importing; every other warning passes through untouched.
async function loadNodeSqlite(): Promise<typeof import('node:sqlite')> {
  const original = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message
    if (/SQLite is an experimental feature/i.test(text)) return
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    return await import('node:sqlite')
  } finally {
    process.emitWarning = original
  }
}

export async function open(path: string): Promise<Db> {
  const { DatabaseSync } = await loadNodeSqlite()
  const raw: DatabaseSync = new DatabaseSync(path)
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA busy_timeout = 5000')
  raw.exec('PRAGMA foreign_keys = ON')
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...params: SqlValue[]) => ({ changes: Number(raw.prepare(sql).run(...params).changes) }),
    get: <T>(sql: string, ...params: SqlValue[]) => raw.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: SqlValue[]) => raw.prepare(sql).all(...params) as T[],
    close: () => raw.close(),
  }
}
