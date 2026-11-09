import { expect, test } from 'bun:test'
import { migrate, openDatabase } from '../src/index'

test('bun driver: open, migrate, insert and read back a meta row', async () => {
  const db = await openDatabase(':memory:')
  migrate(db)
  expect(db.run("INSERT INTO meta (key, value) VALUES ('k', 'v')").changes).toBe(1)
  expect(db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'k')?.value).toBe('v')
  expect(
    db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value,
  ).toBe('1')
  expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1)
  db.close()
})
