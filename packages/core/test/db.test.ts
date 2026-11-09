import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Db, migrate, openDatabase, transaction } from '../src/index'

const dirs: string[] = []
const dbs: Db[] = []

async function open(path: string | ':memory:' = ':memory:'): Promise<Db> {
  const db = await openDatabase(path)
  dbs.push(db)
  return db
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('schema', () => {
  it('migrate creates tasks, day_marks, events, meta', async () => {
    const db = await open()
    migrate(db)
    const names = db
      .all<{ name: string; type: string }>('SELECT name, type FROM sqlite_master')
      .map((r) => r.name)
    for (const n of ['tasks', 'day_marks', 'events', 'meta', 'tasks_parent', 'tasks_day']) {
      expect(names).toContain(n)
    }
  })

  it('migrate is idempotent', async () => {
    const db = await open()
    migrate(db)
    migrate(db)
    expect(
      db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value,
    ).toBe('1')
  })

  it('tasks has deleted_at', async () => {
    const db = await open()
    migrate(db)
    const cols = db.all<{ name: string }>('PRAGMA table_info(tasks)').map((c) => c.name)
    expect(cols).toContain('deleted_at')
  })
})

describe('transaction', () => {
  const count = (db: Db) =>
    db.get<{ n: number }>('SELECT count(*) AS n FROM meta WHERE key = ?', 'x')!.n

  it('commits on success and returns the value', async () => {
    const db = await open()
    migrate(db)
    const r = transaction(db, () => {
      db.run("INSERT INTO meta (key, value) VALUES ('x', '1')")
      return 42
    })
    expect(r).toBe(42)
    expect(count(db)).toBe(1)
  })

  it('transaction rolls back on throw', async () => {
    const db = await open()
    migrate(db)
    expect(() =>
      transaction(db, () => {
        db.run("INSERT INTO meta (key, value) VALUES ('x', '1')")
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(count(db)).toBe(0)
  })

  it('nested transaction joins outer', async () => {
    const db = await open()
    migrate(db)
    expect(() =>
      transaction(db, () => {
        db.run("INSERT INTO meta (key, value) VALUES ('x', '1')")
        transaction(db, () => {
          throw new Error('inner')
        })
      }),
    ).toThrow('inner')
    expect(count(db)).toBe(0)
  })

  it('can start a new transaction after a rollback', async () => {
    const db = await open()
    migrate(db)
    expect(() =>
      transaction(db, () => {
        throw new Error('a')
      }),
    ).toThrow('a')
    transaction(db, () => db.run("INSERT INTO meta (key, value) VALUES ('x', '1')"))
    expect(count(db)).toBe(1)
  })
})

describe('openDatabase', () => {
  it('file database uses WAL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daybreak-'))
    dirs.push(dir)
    const db = await open(join(dir, 'test.db'))
    expect(db.get<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode).toBe('wal')
  })

  it('enables foreign keys', async () => {
    const db = await open()
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1)
  })

  it('run reports changes; get returns undefined when no row', async () => {
    const db = await open()
    migrate(db)
    expect(db.run("INSERT INTO meta (key, value) VALUES ('a', 'b')").changes).toBe(1)
    expect(db.get('SELECT * FROM meta WHERE key = ?', 'nope')).toBeUndefined()
  })
})
