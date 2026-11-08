import { Database } from 'bun:sqlite'
import type { Db, SqlValue } from './adapter'

export async function open(path: string): Promise<Db> {
  const raw = new Database(path)
  raw.exec('PRAGMA busy_timeout = 5000')
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...params: SqlValue[]) => ({ changes: raw.query(sql).run(...params).changes }),
    get: <T>(sql: string, ...params: SqlValue[]) => (raw.query(sql).get(...params) ?? undefined) as T | undefined,
    all: <T>(sql: string, ...params: SqlValue[]) => raw.query(sql).all(...params) as T[],
    close: () => raw.close(),
  }
}
