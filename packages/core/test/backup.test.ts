import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDatabase, createTask, openDatabase, snapshotName } from '../src/index'
import { makeCtx } from './helpers'

const scratch = () => mkdtempSync(join(tmpdir(), 'daybreak-backup-'))

async function setup(now = '2026-11-10T08:00:00Z') {
  const ctx = await makeCtx(now)
  const base = scratch()
  const workDir = join(base, 'data')
  const dir = join(base, 'backups')
  mkdirSync(workDir)
  return { ctx, base, workDir, dir }
}

describe('backupDatabase', () => {
  it('writes a copy named after today that opens with the same tasks', async () => {
    const { ctx, workDir, dir } = await setup()
    createTask(ctx, { title: 'Order a spare SMA torque wrench', section: 'inbox' })
    const result = backupDatabase(ctx, { dir, workDir, retainDays: 14 })
    expect(result.date).toBe('2026-11-10')
    expect(result.file).toBe(join(dir, 'daybreak-2026-11-10.db'))
    const copy = await openDatabase(result.file)
    expect(copy.all<{ title: string }>('SELECT title FROM tasks').map((r) => r.title)).toEqual([
      'Order a spare SMA torque wrench',
    ])
    copy.close()
    // Nothing temporary is left behind, in the target or the data folder.
    expect(readdirSync(dir)).toEqual(['daybreak-2026-11-10.db'])
    expect(readdirSync(workDir)).toEqual([])
  })

  it('dates the copy by the Daybreak day, which starts at 04:00', async () => {
    // 02:30 in Copenhagen on 11 November is still 10 November.
    const { ctx, workDir, dir } = await setup('2026-11-11T01:30:00Z')
    expect(backupDatabase(ctx, { dir, workDir, retainDays: 14 }).date).toBe('2026-11-10')
  })

  it('a later run on the same day replaces that day’s copy', async () => {
    const { ctx, workDir, dir } = await setup()
    backupDatabase(ctx, { dir, workDir, retainDays: 14 })
    createTask(ctx, { title: 'Book the cleanroom for Thursday', section: 'inbox' })
    const { file } = backupDatabase(ctx, { dir, workDir, retainDays: 14 })
    const copy = await openDatabase(file)
    expect(copy.get<{ n: number }>('SELECT count(*) AS n FROM tasks')?.n).toBe(1)
    copy.close()
    expect(readdirSync(dir)).toEqual(['daybreak-2026-11-10.db'])
  })

  it('creates the target folder when its parent exists', async () => {
    const { ctx, workDir, dir } = await setup()
    expect(existsSync(dir)).toBe(false)
    backupDatabase(ctx, { dir, workDir, retainDays: 14 })
    expect(existsSync(join(dir, snapshotName('2026-11-10')))).toBe(true)
  })

  it('refuses a target whose parent is missing too, and creates nothing', async () => {
    const { ctx, base, workDir } = await setup()
    const dir = join(base, 'OneDrive - Typo', 'Daybreak backups')
    expect(() => backupDatabase(ctx, { dir, workDir, retainDays: 14 })).toThrow(
      /doesn't exist, and neither does/,
    )
    expect(existsSync(join(base, 'OneDrive - Typo'))).toBe(false)
  })

  it('refuses a target that is a file', async () => {
    const { ctx, base, workDir } = await setup()
    const file = join(base, 'not-a-folder')
    writeFileSync(file, '')
    expect(() => backupDatabase(ctx, { dir: file, workDir, retainDays: 14 })).toThrow(/is a file/)
  })

  it('deletes copies retainDays or more old, keeping the 3 newest and other files', async () => {
    const { ctx, workDir, dir } = await setup()
    mkdirSync(dir)
    const old = ['2026-10-20', '2026-10-26', '2026-10-27', '2026-11-01', '2026-11-03']
    for (const d of old) writeFileSync(join(dir, snapshotName(d)), '')
    writeFileSync(join(dir, 'daybreak-2026-10-01.db.bak'), '')
    writeFileSync(join(dir, 'notes.txt'), '')
    // retain 14 days on 2026-11-10: 2026-10-27 is 14 days old, 2026-10-28 would be 13.
    const { pruned } = backupDatabase(ctx, { dir, workDir, retainDays: 14 })
    expect(pruned.sort()).toEqual([
      snapshotName('2026-10-20'),
      snapshotName('2026-10-26'),
      snapshotName('2026-10-27'),
    ])
    expect(readdirSync(dir).sort()).toEqual([
      'daybreak-2026-10-01.db.bak',
      'daybreak-2026-11-01.db',
      'daybreak-2026-11-03.db',
      'daybreak-2026-11-10.db',
      'notes.txt',
    ])
  })

  it('after a long break the newest 3 copies stay, however old', async () => {
    const { ctx, workDir, dir } = await setup()
    mkdirSync(dir)
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      writeFileSync(join(dir, snapshotName(d)), '')
    }
    backupDatabase(ctx, { dir, workDir, retainDays: 7 })
    expect(readdirSync(dir).sort()).toEqual([
      'daybreak-2026-09-03.db',
      'daybreak-2026-09-04.db',
      'daybreak-2026-11-10.db',
    ])
  })

  it('mirrors new daily logs and leaves copied ones alone', async () => {
    const { ctx, base, workDir, dir } = await setup()
    const logsDir = join(base, 'logs')
    mkdirSync(logsDir)
    writeFileSync(join(logsDir, '2026-11-08.md'), '# 2026-11-08 · Sunday\n')
    writeFileSync(join(logsDir, '2026-11-09.md.tmp'), 'half-written')
    expect(backupDatabase(ctx, { dir, workDir, retainDays: 14, logsDir }).logsCopied).toBe(1)
    writeFileSync(join(logsDir, '2026-11-09.md'), '# 2026-11-09 · Monday\n')
    expect(backupDatabase(ctx, { dir, workDir, retainDays: 14, logsDir }).logsCopied).toBe(1)
    expect(backupDatabase(ctx, { dir, workDir, retainDays: 14, logsDir }).logsCopied).toBe(0)
    expect(readdirSync(join(dir, 'logs')).sort()).toEqual(['2026-11-08.md', '2026-11-09.md'])
  })

  it('a missing logs folder is not an error', async () => {
    const { ctx, base, workDir, dir } = await setup()
    const logsDir = join(base, 'no-logs-yet')
    expect(backupDatabase(ctx, { dir, workDir, retainDays: 14, logsDir }).logsCopied).toBe(0)
  })
})
