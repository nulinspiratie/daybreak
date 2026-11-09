import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setIdGenerator } from '../src/ids'
import type { Ctx, ISODate } from '../src/index'
import {
  buildDayLog,
  createDaybreak,
  createTask,
  decide,
  reviewView,
  schedule,
  setMark,
  setStatus,
  softDelete,
  updateTask,
  writeMissingLogs,
} from '../src/index'
import { makeCtx } from './helpers'

type TestCtx = Awaited<ReturnType<typeof makeCtx>>

const tempDirs: string[] = []

/** A logs dir path inside a fresh temp dir. The logs dir itself does not exist yet. */
function tempLogsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daybreak-log-test-'))
  tempDirs.push(dir)
  return path.join(dir, 'logs')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  setIdGenerator()
  vi.restoreAllMocks()
})

/** Move the clock to mid-morning of `date` (Copenhagen time, after the 04:00 day start). */
function on(ctx: TestCtx, date: ISODate): void {
  ctx.clock.set(`${date}T09:00:00Z`)
}

function lastLogged(ctx: Ctx): string | null {
  return (
    ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_logged_date'")?.value ??
    null
  )
}

function service(ctx: TestCtx, logsDir: string) {
  return createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config, logsDir })
}

const read = (logsDir: string, date: ISODate) =>
  fs.readFileSync(path.join(logsDir, `${date}.md`), 'utf8')
const files = (logsDir: string) => (fs.existsSync(logsDir) ? fs.readdirSync(logsDir).sort() : [])

/** Rename `id` on `date`: an event that fills no section, so the day has events. */
function quietEventOn(ctx: TestCtx, date: ISODate, id: string): void {
  on(ctx, date)
  updateTask(ctx, id, { title: `renamed on ${date}` })
}

const project = (ctx: Ctx, title: string, parentId: string | null = null, scheduledOn?: ISODate) =>
  createTask(ctx, { title, section: 'projects', parentId, scheduledOn }).id
const inbox = (ctx: Ctx, title: string, scheduledOn?: ISODate) =>
  createTask(ctx, { title, section: 'inbox', scheduledOn }).id

describe('buildDayLog', () => {
  it('matches the SPEC §6 example', async () => {
    const queue = [
      'prj001',
      'k3f9a2',
      'prj002',
      'prj003',
      'p2a1x7',
      'prj004',
      'prj005',
      'm2c8d1',
      'l6q0z3',
      'n7c2e9',
    ]
    setIdGenerator(() => queue.shift()!)
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const pipeline = project(ctx, 'Parity-readout calibration pipeline')
    const jonas = project(ctx, "Review Jonas's PR on drift correction", pipeline, '2026-11-09')
    const parity = project(ctx, 'Parity-readout')
    const port = project(ctx, 'Port fit routines', parity)
    const loader = project(ctx, 'Write loader for HDF5 v2 files', port, '2026-11-09')
    const fridge = project(ctx, 'Fridge 3')
    const milestone = project(ctx, 'Milestone 2', fridge)
    const wiring = project(ctx, 'Update wiring diagram in the lab wiki', milestone, '2026-11-09')
    const vpn = inbox(ctx, 'Ask IT about VPN on the measurement PC', '2026-11-09')

    on(ctx, '2026-11-09')
    setMark(ctx, loader, 'worked')
    setStatus(ctx, jonas, 'done')
    inbox(ctx, 'Order a spare SMA torque wrench')

    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    const d = service(ctx, logsDir)
    d.decide('2026-11-10', wiring, 'today')
    d.decide('2026-11-10', vpn, 'cancel')
    d.finishReview('2026-11-10')

    expect(read(logsDir, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] Review Jonas's PR on drift correction · Parity-readout calibration pipeline (#k3f9a2)

## Worked on
- [~] Write loader for HDF5 v2 files · Parity-readout › Port fit routines (#p2a1x7)

## Not done
- [ ] Update wiring diagram in the lab wiki · Fridge 3 › Milestone 2 (#m2c8d1) → moved to 2026-11-10
- [ ] Ask IT about VPN on the measurement PC · Inbox (#l6q0z3) → cancelled

## Added
- Order a spare SMA torque wrench · Inbox (#n7c2e9)
`)
  })

  it('empty sections are omitted', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const a = project(ctx, 'a', p)
    on(ctx, '2026-11-09')
    setStatus(ctx, a, 'done')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] a · P (#${a})
`)
  })

  it('a day without events gives null', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    project(ctx, 'P')
    expect(buildDayLog(ctx, '2026-11-05')).toBeNull()
  })

  it('a day whose events fill no section gives null', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    on(ctx, '2026-11-05')
    updateTask(ctx, p, { title: 'P renamed' })
    expect(buildDayLog(ctx, '2026-11-05')).toBeNull()
  })

  it('deleted tasks are left out', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const gone = project(ctx, 'gone', p, '2026-11-09')
    const kept = project(ctx, 'kept', p, '2026-11-09')
    const worked = project(ctx, 'worked gone', p)
    on(ctx, '2026-11-09')
    setStatus(ctx, gone, 'done')
    setStatus(ctx, kept, 'done')
    setMark(ctx, worked, 'worked')
    const added = inbox(ctx, 'added gone')
    const missed = project(ctx, 'missed gone', p, '2026-11-09')
    on(ctx, '2026-11-10')
    softDelete(ctx, gone)
    softDelete(ctx, worked)
    softDelete(ctx, added)
    softDelete(ctx, missed)
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] kept · P (#${kept})
`)
  })

  it('cancelled in review shows "→ cancelled"; the other review outcomes', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const c = project(ctx, 'c', p, '2026-11-09')
    const b = project(ctx, 'b', p, '2026-11-09')
    const d = project(ctx, 'd', p, '2026-11-09')
    const t = project(ctx, 't', p, '2026-11-09')
    const n = project(ctx, 'n', p, '2026-11-09')
    quietEventOn(ctx, '2026-11-09', project(ctx, 'other'))
    on(ctx, '2026-11-10')
    decide(ctx, '2026-11-10', c, 'cancel')
    decide(ctx, '2026-11-10', b, 'backlog')
    decide(ctx, '2026-11-10', d, 'day', '2026-11-13')
    decide(ctx, '2026-11-10', t, 'today')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Not done
- [ ] c · P (#${c}) → cancelled
- [ ] b · P (#${b}) → backlog
- [ ] d · P (#${d}) → moved to 2026-11-13
- [ ] t · P (#${t}) → moved to 2026-11-10
- [ ] n · P (#${n})
`)
  })

  it('an undone review decision does not count', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const a = project(ctx, 'a', p, '2026-11-09')
    quietEventOn(ctx, '2026-11-09', project(ctx, 'other'))
    on(ctx, '2026-11-10')
    const d = createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config })
    d.decide('2026-11-10', a, 'cancel')
    d.undoDecision('2026-11-10')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Not done
- [ ] a · P (#${a})
`)
  })

  it('a "today" decision moves to the review date', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const a = project(ctx, 'a', p, '2026-11-05')
    quietEventOn(ctx, '2026-11-05', project(ctx, 'other'))
    // Yesterday's review, finished late: the clock's today is 2026-11-10.
    on(ctx, '2026-11-10')
    decide(ctx, '2026-11-09', a, 'today')
    expect(buildDayLog(ctx, '2026-11-05')).toBe(`# 2026-11-05 · Thursday

## Not done
- [ ] a · P (#${a}) → moved to 2026-11-09
`)
  })

  it('title is the title at write time; path uses " › "', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const q = project(ctx, 'Q', p)
    const t = project(ctx, 't', q)
    on(ctx, '2026-11-09')
    setStatus(ctx, t, 'done')
    on(ctx, '2026-11-10')
    updateTask(ctx, t, { title: 't renamed' })
    updateTask(ctx, q, { title: 'Q renamed' })
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] t renamed · P › Q renamed (#${t})
`)
  })

  it('a top-level project task has path "Projects"; an Inbox task has path "Inbox"', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    const solo = project(ctx, 'Solo')
    const note = inbox(ctx, 'Note')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Added
- Solo · Projects (#${solo})
- Note · Inbox (#${note})
`)
  })

  it('each task appears once: Done, then Worked on, then Not done (R42)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const done = project(ctx, 'done', p, '2026-11-09')
    const worked = project(ctx, 'worked', p, '2026-11-09')
    const movedWorked = project(ctx, 'moved worked', p, '2026-11-09')
    on(ctx, '2026-11-09')
    setMark(ctx, worked, 'doing')
    setMark(ctx, movedWorked, 'worked')
    setStatus(ctx, done, 'done')
    // Closing drops today's mark, so put one back to see that Done wins over Worked on.
    ctx.db.run(
      "INSERT INTO day_marks (date, task_id, mark) VALUES ('2026-11-09', ?, 'worked')",
      done,
    )
    on(ctx, '2026-11-10')
    decide(ctx, '2026-11-10', movedWorked, 'day', '2026-11-12')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] done · P (#${done})

## Worked on
- [~] worked · P (#${worked})
- [~] moved worked · P (#${movedWorked}) → moved to 2026-11-12
`)
  })

  it('a task cancelled during the day is Not done "→ cancelled" when it was scheduled that day (R43)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const cancelled = project(ctx, 'cancelled', p, '2026-11-09')
    const rescheduledAfter = project(ctx, 'rescheduled after', p, '2026-11-09')
    const reopened = project(ctx, 'reopened', p, '2026-11-09')
    const backlog = project(ctx, 'backlog', p)
    const otherDay = project(ctx, 'other day', p, '2026-11-12')
    on(ctx, '2026-11-09')
    setStatus(ctx, cancelled, 'cancelled')
    setStatus(ctx, rescheduledAfter, 'cancelled')
    setStatus(ctx, reopened, 'cancelled')
    setStatus(ctx, reopened, 'open')
    setStatus(ctx, backlog, 'cancelled')
    setStatus(ctx, otherDay, 'cancelled')
    on(ctx, '2026-11-10')
    schedule(ctx, rescheduledAfter, '2026-11-14')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Not done
- [ ] cancelled · P (#${cancelled}) → cancelled
- [ ] rescheduled after · P (#${rescheduledAfter}) → cancelled
- [ ] reopened · P (#${reopened})
`)
  })

  it('the last close of the day decides: done then cancelled is Not done, done then reopened is not Done (R45)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const doneCancelled = project(ctx, 'done then cancelled', p, '2026-11-09')
    const doneReopened = project(ctx, 'done then reopened', p, '2026-11-09')
    const reopenedDone = project(ctx, 'reopened then done', p, '2026-11-09')
    const unscheduled = project(ctx, 'done then cancelled, unscheduled', p)
    on(ctx, '2026-11-09')
    setStatus(ctx, doneCancelled, 'done')
    setStatus(ctx, doneCancelled, 'cancelled')
    setStatus(ctx, doneReopened, 'done')
    setStatus(ctx, doneReopened, 'open')
    setStatus(ctx, reopenedDone, 'done')
    setStatus(ctx, reopenedDone, 'open')
    setStatus(ctx, reopenedDone, 'done')
    setStatus(ctx, unscheduled, 'done')
    setStatus(ctx, unscheduled, 'cancelled')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] reopened then done · P (#${reopenedDone})

## Not done
- [ ] done then cancelled · P (#${doneCancelled}) → cancelled
- [ ] done then reopened · P (#${doneReopened})
`)
  })

  it('a done cascade lists the closed descendants under Done in tree order after the parent (R46)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const before = project(ctx, 'before', p)
    const q = project(ctx, 'Q', p)
    const c1 = project(ctx, 'c1', q)
    const g = project(ctx, 'g', c1)
    const c2 = project(ctx, 'c2', q)
    const already = project(ctx, 'already done', q)
    setStatus(ctx, already, 'done')
    on(ctx, '2026-11-09')
    setStatus(ctx, before, 'done')
    setStatus(ctx, q, 'done', { withOpenDescendants: true })
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] before · P (#${before})
- [x] Q · P (#${q})
- [x] c1 · P › Q (#${c1})
- [x] g · P › Q › c1 (#${g})
- [x] c2 · P › Q (#${c2})
`)
  })

  it('a cancel cascade lists the descendants scheduled that day as Not done "→ cancelled" (R46)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const child = project(ctx, 'child', p, '2026-11-09')
    project(ctx, 'unscheduled child', p)
    project(ctx, 'other day child', p, '2026-11-12')
    on(ctx, '2026-11-09')
    setStatus(ctx, p, 'cancelled', { withOpenDescendants: true })
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Not done
- [ ] child · P (#${child}) → cancelled
`)
  })

  it('a cascade reopened the same day lists nothing as closed; an undone review cancel reopens its cascade', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const c = project(ctx, 'c', p, '2026-11-09')
    const r = project(ctx, 'R', null, '2026-11-08')
    const rc = project(ctx, 'rc', r, '2026-11-09')
    on(ctx, '2026-11-09')
    setStatus(ctx, p, 'done', { withOpenDescendants: true })
    setStatus(ctx, p, 'open')
    const d = createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config })
    d.decide('2026-11-09', r, 'cancel')
    d.undoDecision('2026-11-09')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Not done
- [ ] c · P (#${c})
- [ ] rc · R (#${rc})
`)
  })

  it('events before dayStartsAt belong to the previous day', async () => {
    const ctx = await makeCtx('2026-11-10T08:00:00Z', { dayStartsAt: '06:00' })
    // Copenhagen is UTC+1 in November: 04:30Z is 05:30 local, 05:30Z is 06:30 local.
    ctx.clock.set('2026-11-10T04:30:00Z')
    const late = inbox(ctx, 'late night')
    ctx.clock.set('2026-11-10T05:30:00Z')
    const early = inbox(ctx, 'early morning')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Added
- late night · Inbox (#${late})
`)
    expect(buildDayLog(ctx, '2026-11-10')).toBe(`# 2026-11-10 · Tuesday

## Added
- early morning · Inbox (#${early})
`)
  })

  it('lines follow the events that put them there; open scheduled tasks follow in day order (R44)', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    const d1 = project(ctx, 'd1', p)
    const d2 = project(ctx, 'd2', p)
    const w1 = project(ctx, 'w1', p)
    const w2 = project(ctx, 'w2', p)
    const decided = project(ctx, 'decided', p, '2026-11-09')
    const z1 = project(ctx, 'z1', p, '2026-11-09')
    const z2 = project(ctx, 'z2', p, '2026-11-09')
    const cancelled = project(ctx, 'cancelled', p, '2026-11-09')
    on(ctx, '2026-11-09')
    const a2 = inbox(ctx, 'a2')
    const a1 = inbox(ctx, 'a1')
    setStatus(ctx, d2, 'done')
    setStatus(ctx, d1, 'done')
    setMark(ctx, w2, 'worked')
    setMark(ctx, w1, 'worked')
    setStatus(ctx, cancelled, 'cancelled')
    schedule(ctx, z2, '2026-11-09', { beforeId: z1 })
    on(ctx, '2026-11-10')
    decide(ctx, '2026-11-10', decided, 'backlog')
    expect(buildDayLog(ctx, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Done
- [x] d2 · P (#${d2})
- [x] d1 · P (#${d1})

## Worked on
- [~] w2 · P (#${w2})
- [~] w1 · P (#${w1})

## Not done
- [ ] cancelled · P (#${cancelled}) → cancelled
- [ ] decided · P (#${decided}) → backlog
- [ ] z2 · P (#${z2})
- [ ] z1 · P (#${z1})

## Added
- a2 · Inbox (#${a2})
- a1 · Inbox (#${a1})
`)
  })
})

describe('writeMissingLogs', () => {
  it('first run logs every day with events before today', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    on(ctx, '2026-11-05')
    project(ctx, 'a', p)
    on(ctx, '2026-11-10')
    project(ctx, 'today', p)
    const logsDir = tempLogsDir()
    expect(lastLogged(ctx)).toBeNull()
    expect(writeMissingLogs(ctx, logsDir)).toEqual(['2026-11-02', '2026-11-05'])
    expect(files(logsDir)).toEqual(['2026-11-02.md', '2026-11-05.md'])
    expect(lastLogged(ctx)).toBe('2026-11-09')
  })

  it('weekend gap writes Fri only, not Sat or Sun, then sets last_logged_date', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-06')
    const a = project(ctx, 'a')
    setStatus(ctx, a, 'done')
    on(ctx, '2026-11-09')
    const logsDir = tempLogsDir()
    service(ctx, logsDir).finishReview('2026-11-09')
    expect(files(logsDir)).toEqual(['2026-11-06.md'])
    expect(read(logsDir, '2026-11-06')).toMatch(/^# 2026-11-06 · Friday\n/)
    expect(lastLogged(ctx)).toBe('2026-11-08')
  })

  it('a day whose sections are all empty writes no file but advances last_logged_date', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    on(ctx, '2026-11-05')
    updateTask(ctx, p, { title: 'P renamed' })
    on(ctx, '2026-11-06')
    const logsDir = tempLogsDir()
    expect(writeMissingLogs(ctx, logsDir)).toEqual(['2026-11-02'])
    expect(files(logsDir)).toEqual(['2026-11-02.md'])
    expect(lastLogged(ctx)).toBe('2026-11-05')
  })

  it('already written logs are never rewritten', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    const a = project(ctx, 'a')
    setStatus(ctx, a, 'done')
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    const d = service(ctx, logsDir)
    d.finishReview('2026-11-10')
    const before = read(logsDir, '2026-11-09')
    expect(before).toContain(`- [x] a · Projects (#${a})`)
    d.update(a, { title: 'a renamed' })
    d.finishReview('2026-11-10')
    on(ctx, '2026-11-11')
    d.finishReview('2026-11-11')
    expect(read(logsDir, '2026-11-09')).toBe(before)
    expect(files(logsDir)).toEqual(['2026-11-09.md'])
  })

  it('a reset last_logged_date does not rewrite a log: the file stays byte-identical', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    const a = project(ctx, 'a')
    setStatus(ctx, a, 'done')
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    const d = service(ctx, logsDir)
    d.finishReview('2026-11-10')
    const before = fs.readFileSync(path.join(logsDir, '2026-11-09.md'))
    d.update(a, { title: 'a renamed' })
    ctx.db.run("DELETE FROM meta WHERE key = 'last_logged_date'")
    d.finishReview('2026-11-10')
    expect(fs.readFileSync(path.join(logsDir, '2026-11-09.md')).equals(before)).toBe(true)
    expect(files(logsDir)).toEqual(['2026-11-09.md'])
    expect(lastLogged(ctx)).toBe('2026-11-09')
  })

  it('a pre-existing file for a day is left untouched and counts as written', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-06')
    project(ctx, 'fri')
    on(ctx, '2026-11-09')
    project(ctx, 'mon')
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(path.join(logsDir, '2026-11-06.md'), 'kept as it was\n')
    expect(writeMissingLogs(ctx, logsDir)).toEqual(['2026-11-09'])
    expect(read(logsDir, '2026-11-06')).toBe('kept as it was\n')
    expect(files(logsDir)).toEqual(['2026-11-06.md', '2026-11-09.md'])
    expect(lastLogged(ctx)).toBe('2026-11-09')
  })

  it('skipReview also writes logs', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    const a = project(ctx, 'a')
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    service(ctx, logsDir).skipReview('2026-11-10')
    expect(read(logsDir, '2026-11-09')).toBe(`# 2026-11-09 · Monday

## Added
- a · Projects (#${a})
`)
  })

  it('an empty review that finishes itself also writes logs', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    inbox(ctx, 'a') // a fresh Inbox task is no suggestion, so the review is empty
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    service(ctx, logsDir).autoFinishEmptyReview()
    expect(files(logsDir)).toEqual(['2026-11-09.md'])
  })

  it('a review interrupted before finish writes at the next finish', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    const p = project(ctx, 'P')
    const a = project(ctx, 'a', p, '2026-11-09')
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    service(ctx, logsDir).decide('2026-11-10', a, 'today')
    // The tab closes here; nothing is written until a review is finished or skipped.
    expect(files(logsDir)).toEqual([])

    on(ctx, '2026-11-11')
    const restarted = service(ctx, logsDir)
    restarted.skipReview('2026-11-11')
    expect(files(logsDir)).toEqual(['2026-11-09.md', '2026-11-10.md'])
    expect(read(logsDir, '2026-11-09')).toContain(`- [ ] a · P (#${a}) → moved to 2026-11-10`)
    expect(read(logsDir, '2026-11-10')).toContain(`- [ ] a · P (#${a})\n`)
  })

  it('a write error does not fail finish; it stops and keeps last_logged_date before the failed day (R44)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = await makeCtx()
    on(ctx, '2026-11-02')
    const p = project(ctx, 'P')
    on(ctx, '2026-11-05')
    project(ctx, 'a', p)
    on(ctx, '2026-11-06')
    project(ctx, 'b', p)
    on(ctx, '2026-11-10')
    const logsDir = tempLogsDir()
    // A directory where the 2026-11-05 temp file should go makes that write fail.
    const blocker = path.join(logsDir, '2026-11-05.md.tmp')
    fs.mkdirSync(blocker, { recursive: true })
    const d = service(ctx, logsDir)

    expect(() => d.finishReview('2026-11-10')).not.toThrow()
    expect(reviewView(ctx, '2026-11-10').finished).toBe(true)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(files(logsDir)).toEqual(['2026-11-02.md', '2026-11-05.md.tmp'])
    expect(lastLogged(ctx)).toBe('2026-11-04')

    fs.rmSync(blocker, { recursive: true })
    on(ctx, '2026-11-11')
    d.finishReview('2026-11-11')
    expect(files(logsDir)).toEqual(['2026-11-02.md', '2026-11-05.md', '2026-11-06.md'])
    expect(lastLogged(ctx)).toBe('2026-11-10')
  })

  it('without logsDir, finish and skip write nothing and leave last_logged_date unset', async () => {
    const ctx = await makeCtx()
    on(ctx, '2026-11-09')
    project(ctx, 'a')
    on(ctx, '2026-11-10')
    const d = createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config })
    d.finishReview('2026-11-10')
    d.skipReview('2026-11-10')
    expect(lastLogged(ctx)).toBeNull()
  })
})
