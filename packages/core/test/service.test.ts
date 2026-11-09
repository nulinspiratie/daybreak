import { describe, expect, it } from 'vitest'
import type { ChangeEvent } from '../src/index'
import { createDaybreak, eventsOn, seed, today } from '../src/index'
import { makeCtx } from './helpers'

async function make() {
  const ctx = await makeCtx()
  const d = createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config })
  const events: ChangeEvent[] = []
  d.onChange((e) => events.push(e))
  return { ctx, d, events }
}

describe('Daybreak facade', () => {
  it('each mutation runs in one transaction', async () => {
    const { ctx, d, events } = await make()
    const a = d.create({ title: 'A', section: 'projects' })
    const b = d.create({ title: 'B', section: 'projects' })
    events.length = 0
    ctx.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON events WHEN NEW.kind = 'moved' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    )
    expect(() => d.move(b.id, { parentId: a.id, section: 'projects' })).toThrow()
    expect(d.getTask(b.id).parentId).toBeNull()
    expect(eventsOn(ctx, today(ctx)).filter((e) => e.kind === 'moved')).toEqual([])
    expect(events).toEqual([])
  })

  it('onChange fires once per successful mutation and never for reads or failed mutations', async () => {
    const { d, events } = await make()
    const t = d.create({ title: 'A', section: 'projects' })
    expect(events).toEqual([{ type: 'changed' }])
    d.today()
    d.tree()
    d.day(d.today())
    d.dayCounts(d.today(), d.today())
    d.getTask(t.id)
    d.review(d.today())
    d.needsReview()
    d.exportProject(t.id)
    expect(events).toHaveLength(1)
    expect(() => d.update('nope00', { title: 'x' })).toThrow()
    expect(() => d.create({ title: '  ', section: 'projects' })).toThrow()
    expect(events).toHaveLength(1)
    d.update(t.id, { notes: 'n' })
    d.schedule(t.id, d.today())
    d.setMark(t.id, 'doing')
    d.setStatus(t.id, 'done')
    d.delete(t.id)
    d.restore(t.id)
    expect(events).toHaveLength(7)
  })

  it('emits after commit, and a throwing listener neither fails the mutation nor blocks others', async () => {
    const { ctx, d } = await make()
    const seen: number[] = []
    d.onChange(() => {
      throw new Error('listener bug')
    })
    d.onChange(() => seen.push(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n))
    const t = d.create({ title: 'A', section: 'projects' })
    expect(t.title).toBe('A')
    expect(seen).toEqual([1])
  })

  it('unsubscribe stops notifications', async () => {
    const { d } = await make()
    const got: ChangeEvent[] = []
    const off = d.onChange((e) => got.push(e))
    d.create({ title: 'A', section: 'projects' })
    off()
    d.create({ title: 'B', section: 'projects' })
    expect(got).toHaveLength(1)
  })

  it('nudge and schedule-with-position delegate to the core functions', async () => {
    const { d } = await make()
    const a = d.create({ title: 'A', section: 'projects' })
    const b = d.create({ title: 'B', section: 'projects' })
    d.nudge(b.id, 'up')
    expect(d.tree().projects.map((n) => n.title)).toEqual(['B', 'A'])
    d.nudge(a.id, 'indent')
    expect(d.getTask(a.id).parentId).toBe(b.id)
    d.nudge(a.id, 'outdent')
    expect(d.getTask(a.id).parentId).toBeNull()
    d.schedule(a.id, d.today())
    d.schedule(b.id, d.today(), { beforeId: a.id })
    expect(d.day(d.today()).items.map((i) => i.task.title)).toEqual(['B', 'A'])
  })

  it('autoFinishEmptyReview finishes an empty review once, and leaves a non-empty one', async () => {
    const { ctx, d, events } = await make()
    expect(d.needsReview()).toBe(false)
    d.autoFinishEmptyReview()
    const last = () =>
      ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_review_date'")?.value
    expect(last()).toBe(d.today())
    expect(events).toHaveLength(1)
    d.autoFinishEmptyReview()
    expect(events).toHaveLength(1)

    const next = await make()
    const t = next.d.create({ title: 'old', section: 'projects' })
    next.d.schedule(t.id, '2026-11-01')
    expect(next.d.needsReview()).toBe(true)
    next.d.autoFinishEmptyReview()
    expect(next.d.needsReview()).toBe(true)
  })
})

describe('seed', () => {
  it('seed creates the Inbox and three projects from design/Main.dc.html', async () => {
    const { d } = await make()
    seed(d)
    const t = d.tree('all')
    expect(t.projects.map((p) => p.title)).toEqual([
      'Fridge 3 readout upgrade',
      'Parity-readout calibration pipeline',
      'Hiring: lab engineer',
    ])
    expect(t.inbox.map((n) => n.title)).toEqual([
      'Message Anja about the cryostat cooldown slot',
      'Reply to Marcus re: wire-bonding quote',
      'Book a room for Thursday’s design review',
      'Check whether the spare HEMT amplifier arrived',
      'Renew lab safety training',
      'Ask IT about VPN on the measurement PC',
      'Forward fridge maintenance log to facilities',
      'Call facilities about the helium delivery',
      'Send cooldown slides to Priya',
    ])
    const fridge = t.projects[0]!
    expect(fridge.children.map((c) => c.title)).toEqual([
      'Milestone 1 — Design and procurement',
      'Milestone 2 — Install and cooldown',
      'Milestone 3 — Characterise noise temperature',
    ])
    const m2 = fridge.children[1]!
    expect(m2.children.map((c) => c.title)).toEqual([
      'Order replacement coax lines',
      'Install TWPA on the mixing chamber plate',
      'Update wiring diagram in the lab wiki',
      'Plan cooldown window with Anja',
    ])
    expect(m2.children[1]!.children.map((c) => c.title)).toEqual([
      'Verify pump tone frequency with the VNA',
      'Thermal anchoring check before closing the can',
    ])
    expect(m2.children[0]!.status).toBe('done')
    expect(t.inbox[5]!.status).toBe('cancelled')
  })

  it('seed schedules two overdue, four today with one doing, and a few later this week', async () => {
    const { d } = await make()
    seed(d)
    const day = d.today()
    const all: { scheduledOn: string | null; title: string }[] = []
    const walk = (nodes: ReturnType<typeof d.tree>['projects']) =>
      nodes.forEach((n) => {
        all.push(n)
        walk(n.children)
      })
    const t = d.tree('all')
    walk(t.projects)
    walk(t.inbox)
    const scheduled = all.filter((n) => n.scheduledOn !== null)
    expect(scheduled.filter((n) => n.scheduledOn! < day)).toHaveLength(2)
    const today = d.day(day)
    expect(today.items).toHaveLength(4)
    expect(today.items.filter((i) => i.mark === 'doing')).toHaveLength(1)
    const weekAhead = scheduled.filter(
      (n) => n.scheduledOn! > day && n.scheduledOn! <= '2026-11-16',
    )
    expect(weekAhead.length).toBeGreaterThanOrEqual(3)
  })

  it('seed is deterministic apart from dates', async () => {
    const strip = async () => {
      const { d } = await make()
      seed(d)
      const rows: string[] = []
      const walk = (nodes: ReturnType<typeof d.tree>['projects'], depth: number) =>
        nodes.forEach((n) => {
          rows.push(
            `${'  '.repeat(depth)}${n.title}|${n.status}|${n.collapsed}|${n.notes}|${n.link}|${n.scheduledOn}|${n.mark}`,
          )
          walk(n.children, depth + 1)
        })
      const t = d.tree('all')
      walk(t.projects, 0)
      walk(t.inbox, 0)
      return rows
    }
    expect(await strip()).toEqual(await strip())
  })
})
