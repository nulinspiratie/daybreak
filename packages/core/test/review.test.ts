import { describe, expect, it } from 'vitest'
import type { Ctx, ReviewView } from '../src/index'
import {
  createTask,
  dayView,
  decide,
  eventsOn,
  finishReview,
  fixedClock,
  getTask,
  needsReview,
  reviewView,
  schedule,
  setMark,
  setStatus,
  skipReview,
  softDelete,
  undoDecision,
} from '../src/index'
import { build, makeCtx } from './helpers'

const D = '2026-11-10'
const NOW = '2026-11-10T08:00:00Z'
const LONG_AGO = '2026-10-20T08:00:00Z'
const YESTERDAY = '2026-11-09'

type TestCtx = Awaited<ReturnType<typeof makeCtx>>

/** Run `fn` with the clock at `iso`, then put it back to NOW. */
function at<T>(ctx: TestCtx, iso: string, fn: () => T): T {
  ctx.clock.set(iso)
  try {
    return fn()
  } finally {
    ctx.clock.set(NOW)
  }
}

const titles = (items: ReviewView['leftovers']) => items.map((i) => i.task.title)
const reviewEvents = (ctx: Ctx) => eventsOn(ctx, D).filter((e) => e.kind.startsWith('review_'))

function expectInvalid(fn: () => unknown) {
  expect(fn).toThrow(expect.objectContaining({ code: 'invalid' }))
}

describe('leftovers', () => {
  it('leftovers are open tasks scheduled before today, oldest first', async () => {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\n    d\n    e\n    f\n    g')
      schedule(ctx, ids.a!, YESTERDAY)
      schedule(ctx, ids.b!, '2026-11-07')
      schedule(ctx, ids.c!, YESTERDAY)
      schedule(ctx, ids.d!, '2026-11-07')
      schedule(ctx, ids.e!, '2026-11-08')
      setStatus(ctx, ids.e!, 'done')
      schedule(ctx, ids.f!, '2026-11-08')
      softDelete(ctx, ids.f!)
      return ids
    })
    const view = reviewView(ctx, D)
    expect(titles(view.leftovers)).toEqual(['b', 'd', 'a', 'c'])
    const b = view.leftovers[0]!
    expect(b).toMatchObject({
      group: 'leftover',
      decision: null,
      path: ['P'],
      scheduledOn: '2026-11-07',
      workedOn: null,
    })
    expect(b.task.id).toBe(ids.b)
  })

  it('tasks scheduled for today are not in the review', async () => {
    const ctx = await makeCtx(NOW)
    const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c')
    schedule(ctx, ids.a!, D)
    schedule(ctx, ids.b!, YESTERDAY)
    const view = reviewView(ctx, D)
    const all = [...view.leftovers, ...view.suggestions].map((i) => i.task.id)
    expect(all).not.toContain(ids.a)
    expect(titles(view.leftovers)).toEqual(['b'])
  })

  it('weekend gap', async () => {
    const ctx = await makeCtx('2026-11-09T08:00:00Z')
    const ids = build(ctx, 'projects:\n  P\n    fri\n    thu')
    schedule(ctx, ids.fri!, '2026-11-06')
    schedule(ctx, ids.thu!, '2026-11-05')
    expect(titles(reviewView(ctx, '2026-11-09').leftovers)).toEqual(['thu', 'fri'])
  })
})

describe('decide', () => {
  async function leftovers() {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\n      c1\n      c2\n  Q\n    x')
      for (const t of ['a', 'b', 'c']) schedule(ctx, ids[t]!, YESTERDAY)
      schedule(ctx, ids.x!, D)
      setStatus(ctx, ids.c2!, 'done')
      return ids
    })
    return { ctx, ids }
  }

  it('decide today appends to My Day and the row stays in leftovers with decision', async () => {
    const { ctx, ids } = await leftovers()
    const before = getTask(ctx, ids.a!)
    const view = decide(ctx, D, ids.a!, 'today')
    expect(dayView(ctx, D).items.map((i) => i.task.title)).toEqual(['x', 'a'])
    expect(titles(view.leftovers)).toEqual(['a', 'b', 'c'])
    expect(view.leftovers[0]).toMatchObject({
      decision: { choice: 'today', date: D },
      scheduledOn: D,
    })
    expect(view.leftovers[1]!.decision).toBeNull()
    const ev = reviewEvents(ctx)
    expect(ev).toHaveLength(1)
    expect(ev[0]!.kind).toBe('review_today')
    expect(ev[0]!.taskId).toBe(ids.a)
    expect(ev[0]!.data).toEqual({
      reviewDate: D,
      group: 'leftover',
      previous: {
        scheduledOn: YESTERDAY,
        dayPosition: before.dayPosition,
        status: 'open',
        closedAt: null,
      },
      to: D,
    })
  })

  it('deciding a task not in the review is invalid', async () => {
    const { ctx, ids } = await leftovers()
    expectInvalid(() => decide(ctx, D, ids.x!, 'backlog'))
    expect(getTask(ctx, ids.x!).scheduledOn).toBe(D)
    expect(reviewEvents(ctx)).toHaveLength(0)
  })

  it('decide done marks it done with its open subtasks, and Z reopens exactly those', async () => {
    const { ctx, ids } = await leftovers()
    const view = decide(ctx, D, ids.c!, 'done')
    expect(getTask(ctx, ids.c!)).toMatchObject({ status: 'done', scheduledOn: YESTERDAY })
    expect(getTask(ctx, ids.c1!).status).toBe('done')
    expect(view.leftovers.find((i) => i.task.id === ids.c)!.decision).toMatchObject({
      choice: 'done',
    })
    expect(view.sortedCount).toBe(1)
    const ev = reviewEvents(ctx)[0]!
    expect(ev.kind).toBe('review_done')
    expect(ev.data.closedIds).toEqual([ids.c, ids.c1])
    undoDecision(ctx, D)
    expect(getTask(ctx, ids.c!)).toMatchObject({ status: 'open', closedAt: null })
    expect(getTask(ctx, ids.c1!).status).toBe('open')
    expect(getTask(ctx, ids.c2!).status).toBe('done')
  })

  it('decide day requires targetDate', async () => {
    const { ctx, ids } = await leftovers()
    expectInvalid(() => decide(ctx, D, ids.a!, 'day'))
    expect(getTask(ctx, ids.a!).scheduledOn).toBe(YESTERDAY)
    expect(reviewEvents(ctx)).toHaveLength(0)
    const view = decide(ctx, D, ids.a!, 'day', '2026-11-12')
    expect(getTask(ctx, ids.a!).scheduledOn).toBe('2026-11-12')
    expect(view.leftovers[0]).toMatchObject({ decision: { choice: 'day', date: '2026-11-12' } })
    expect(reviewEvents(ctx)[0]!.data.to).toBe('2026-11-12')
  })

  it('decide backlog on a leftover clears the scheduled day', async () => {
    const { ctx, ids } = await leftovers()
    const view = decide(ctx, D, ids.b!, 'backlog')
    expect(getTask(ctx, ids.b!)).toMatchObject({ scheduledOn: null, dayPosition: null })
    expect(view.leftovers[1]).toMatchObject({ decision: { choice: 'backlog' }, scheduledOn: null })
  })

  it('decide backlog on a suggestion does not touch the task', async () => {
    const ctx = await makeCtx(NOW)
    const ids = build(ctx, 'projects:\n  P\n    s')
    const before = getTask(ctx, ids.s!)
    expect(titles(reviewView(ctx, D).suggestions)).toEqual(['s'])
    const view = decide(ctx, D, ids.s!, 'backlog')
    expect(getTask(ctx, ids.s!)).toEqual(before)
    expect(view.suggestions).toHaveLength(1)
    expect(view.suggestions[0]).toMatchObject({
      group: 'suggestion',
      decision: { choice: 'backlog' },
    })
    expect(reviewEvents(ctx)[0]!.data.group).toBe('suggestion')
  })

  it('decide cancel cancels with open descendants', async () => {
    const { ctx, ids } = await leftovers()
    const view = decide(ctx, D, ids.c!, 'cancel')
    expect(getTask(ctx, ids.c!).status).toBe('cancelled')
    expect(getTask(ctx, ids.c1!).status).toBe('cancelled')
    expect(getTask(ctx, ids.c2!).status).toBe('done')
    expect(view.leftovers.find((i) => i.task.id === ids.c)!.decision).toMatchObject({
      choice: 'cancel',
    })
    const ev = reviewEvents(ctx)[0]!
    expect(ev.kind).toBe('review_cancel')
    expect(ev.data.closedIds).toEqual([ids.c, ids.c1])
  })
})

describe('changing a decision', () => {
  async function three() {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\n      c1')
      for (const t of ['a', 'b', 'c']) schedule(ctx, ids[t]!, YESTERDAY)
      return ids
    })
    return { ctx, ids, before: getTask(ctx, ids.a!) }
  }
  const choices = (v: ReviewView) => v.leftovers.map((i) => i.decision?.choice ?? null)

  it('a decided item can be decided again: the old choice is undone, then the new one applied', async () => {
    const { ctx, ids, before } = await three()
    decide(ctx, D, ids.a!, 'today')
    decide(ctx, D, ids.b!, 'backlog')
    const view = decide(ctx, D, ids.a!, 'cancel')
    expect(getTask(ctx, ids.a!)).toMatchObject({
      status: 'cancelled',
      scheduledOn: YESTERDAY,
      dayPosition: before.dayPosition,
    })
    expect(dayView(ctx, D).items).toHaveLength(0)
    expect(titles(view.leftovers)).toEqual(['a', 'b', 'c'])
    expect(choices(view)).toEqual(['cancel', 'backlog', null])
    expect(view.sortedCount).toBe(2)
    expect(view.leftovers[0]!.leftoverFrom).toBe(YESTERDAY)
    expect(reviewEvents(ctx).map((e) => e.kind)).toEqual([
      'review_today',
      'review_backlog',
      'review_undo',
      'review_cancel',
    ])
    // The new decision is now the latest, so its seq is the highest.
    expect(view.leftovers[0]!.decision!.seq).toBeGreaterThan(view.leftovers[1]!.decision!.seq)
  })

  it('a cancel changed to today reopens the subtasks it closed', async () => {
    const { ctx, ids } = await three()
    decide(ctx, D, ids.c!, 'cancel')
    decide(ctx, D, ids.c!, 'today')
    expect(getTask(ctx, ids.c!)).toMatchObject({ status: 'open', scheduledOn: D })
    expect(getTask(ctx, ids.c1!).status).toBe('open')
  })

  it('the same choice again changes nothing; another day to a different day moves it', async () => {
    const { ctx, ids } = await three()
    decide(ctx, D, ids.a!, 'today')
    decide(ctx, D, ids.a!, 'today')
    expect(reviewEvents(ctx)).toHaveLength(1)
    decide(ctx, D, ids.b!, 'day', '2026-11-12')
    decide(ctx, D, ids.b!, 'day', '2026-11-12')
    expect(reviewEvents(ctx)).toHaveLength(2)
    const view = decide(ctx, D, ids.b!, 'day', '2026-11-13')
    expect(getTask(ctx, ids.b!).scheduledOn).toBe('2026-11-13')
    expect(view.leftovers[1]!.decision).toMatchObject({ choice: 'day', date: '2026-11-13' })
  })

  it('Z after a change leaves the item undecided, with the task as it was before the review', async () => {
    const { ctx, ids, before } = await three()
    decide(ctx, D, ids.a!, 'today')
    decide(ctx, D, ids.a!, 'done')
    const view = undoDecision(ctx, D)
    expect(getTask(ctx, ids.a!)).toMatchObject({
      status: 'open',
      scheduledOn: YESTERDAY,
      dayPosition: before.dayPosition,
    })
    expect(choices(view)).toEqual([null, null, null])
  })

  it('items decided out of order keep their place in the list', async () => {
    const { ctx, ids } = await three()
    let view = decide(ctx, D, ids.c!, 'today')
    expect(titles(view.leftovers)).toEqual(['a', 'b', 'c'])
    expect(choices(view)).toEqual([null, null, 'today'])
    view = decide(ctx, D, ids.a!, 'day', '2026-11-12')
    expect(titles(view.leftovers)).toEqual(['a', 'b', 'c'])
    expect(titles(reviewView(ctx, D).leftovers)).toEqual(['a', 'b', 'c'])
  })
})

describe('undoDecision', () => {
  async function decided() {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\n      c1')
      for (const t of ['a', 'b', 'c']) schedule(ctx, ids[t]!, YESTERDAY)
      return ids
    })
    const before = { a: getTask(ctx, ids.a!), b: getTask(ctx, ids.b!), c: getTask(ctx, ids.c!) }
    decide(ctx, D, ids.a!, 'today')
    decide(ctx, D, ids.b!, 'backlog')
    decide(ctx, D, ids.c!, 'cancel')
    return { ctx, ids, before }
  }

  it('undo reverts the last decision only, repeatedly', async () => {
    const { ctx, ids, before } = await decided()

    let view = undoDecision(ctx, D)
    expect(getTask(ctx, ids.c!)).toMatchObject({ status: 'open', closedAt: null })
    expect(getTask(ctx, ids.c1!)).toMatchObject({ status: 'open', closedAt: null })
    expect(getTask(ctx, ids.b!).scheduledOn).toBeNull()
    expect(view.leftovers.map((i) => i.decision?.choice ?? null)).toEqual([
      'today',
      'backlog',
      null,
    ])

    view = undoDecision(ctx, D)
    expect(getTask(ctx, ids.b!)).toMatchObject({
      scheduledOn: YESTERDAY,
      dayPosition: before.b.dayPosition,
    })
    expect(getTask(ctx, ids.a!).scheduledOn).toBe(D)
    expect(view.leftovers.map((i) => i.decision?.choice ?? null)).toEqual(['today', null, null])

    view = undoDecision(ctx, D)
    expect(getTask(ctx, ids.a!)).toMatchObject({
      scheduledOn: YESTERDAY,
      dayPosition: before.a.dayPosition,
    })
    expect(dayView(ctx, D).items).toHaveLength(0)
    expect(titles(view.leftovers)).toEqual(['a', 'b', 'c'])
    expect(view.sortedCount).toBe(0)

    const undos = () => reviewEvents(ctx).filter((e) => e.kind === 'review_undo')
    expect(undos()).toHaveLength(3)
    const decisionIds = reviewEvents(ctx)
      .filter((e) => e.kind !== 'review_undo')
      .map((e) => e.id)
    expect(undos().map((e) => e.data.undoneEventId)).toEqual(decisionIds.reverse())

    // Nothing left to undo: no-op.
    undoDecision(ctx, D)
    expect(undos()).toHaveLength(3)
  })

  it('a task can be decided again after its decision is undone', async () => {
    const { ctx, ids } = await decided()
    undoDecision(ctx, D)
    const view = decide(ctx, D, ids.c!, 'today')
    expect(view.leftovers[2]!.decision).toMatchObject({ choice: 'today', date: D })
    expect(getTask(ctx, ids.c!).status).toBe('open')
  })

  it('undoing a "not today" on a suggestion records the undo but leaves the task row alone', async () => {
    const ctx = await makeCtx(NOW)
    const ids = build(ctx, 'projects:\n  P\n    s')
    decide(ctx, D, ids.s!, 'backlog')
    at(ctx, '2026-11-10T09:00:00Z', () => schedule(ctx, ids.s!, '2026-11-20'))
    const edited = getTask(ctx, ids.s!)
    const view = at(ctx, '2026-11-10T10:00:00Z', () => undoDecision(ctx, D))
    expect(getTask(ctx, ids.s!)).toEqual(edited)
    expect(view.sortedCount).toBe(0)
    const undo = reviewEvents(ctx).filter((e) => e.kind === 'review_undo')
    expect(undo).toHaveLength(1)
    expect(undo[0]!.taskId).toBe(ids.s)
  })

  it('skips a decision whose task was deleted since, and undoes the one before it', async () => {
    const { ctx, ids, before } = await decided()
    softDelete(ctx, ids.c!)
    const view = undoDecision(ctx, D)
    expect(getTask(ctx, ids.b!)).toMatchObject({
      scheduledOn: YESTERDAY,
      dayPosition: before.b.dayPosition,
    })
    expect(view.leftovers.map((i) => i.decision?.choice ?? null)).toEqual(['today', null])
    const undos = reviewEvents(ctx).filter((e) => e.kind === 'review_undo')
    expect(undos.map((e) => e.taskId)).toEqual([ids.b])
  })

  it('undo survives a new service instance on the same db', async () => {
    const { ctx, ids } = await decided()
    const ctx2: Ctx = { db: ctx.db, clock: fixedClock(NOW), config: ctx.config }
    expect(reviewView(ctx2, D).sortedCount).toBe(3)
    undoDecision(ctx2, D)
    expect(getTask(ctx2, ids.c!).status).toBe('open')
    expect(getTask(ctx2, ids.c1!).status).toBe('open')
    expect(reviewView(ctx2, D).sortedCount).toBe(2)
  })
})

describe('reviewView counts', () => {
  it('sortedCount and totalCount; todayCount = dayView(date).totalCount', async () => {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n  Q\n    x\ninbox:\n  i')
      schedule(ctx, ids.a!, YESTERDAY)
      schedule(ctx, ids.b!, YESTERDAY)
      schedule(ctx, ids.x!, D)
      return ids
    })
    let view = reviewView(ctx, D)
    expect(titles(view.leftovers)).toEqual(['a', 'b'])
    expect(titles(view.suggestions)).toEqual(['i'])
    expect(view).toMatchObject({ date: D, sortedCount: 0, totalCount: 3, todayCount: 1 })

    view = decide(ctx, D, ids.a!, 'today')
    expect(view).toMatchObject({ sortedCount: 1, totalCount: 3, todayCount: 2 })
    expect(view.todayCount).toBe(dayView(ctx, D).totalCount)

    view = decide(ctx, D, ids.i!, 'backlog')
    expect(view).toMatchObject({ sortedCount: 2, totalCount: 3, todayCount: 2 })
  })

  it('workedOn reports the Monday mark', async () => {
    const ctx = await makeCtx('2026-11-09T08:00:00Z')
    const ids = build(ctx, 'projects:\n  P\n    a\n    b')
    setMark(ctx, ids.a!, 'worked')
    schedule(ctx, ids.b!, '2026-11-09')
    ctx.clock.set(NOW)
    const view = reviewView(ctx, D)
    expect(titles(view.leftovers)).toEqual(['a', 'b'])
    expect(view.leftovers[0]!.workedOn).toBe('2026-11-09')
    expect(view.leftovers[1]!.workedOn).toBeNull()
  })
})

describe('suggestions', () => {
  it('a project with an event 3 days ago yields its first open unscheduled leaf', async () => {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () =>
      build(ctx, 'projects:\n  P\n    A\n      A1\n      A2\n    B\n  Q\n    q1'),
    )
    at(ctx, '2026-11-07T08:00:00Z', () => schedule(ctx, ids.A1!, '2026-11-20'))
    const view = reviewView(ctx, D)
    expect(titles(view.suggestions)).toEqual(['A2'])
    expect(view.suggestions[0]).toMatchObject({
      group: 'suggestion',
      path: ['P', 'A'],
      decision: null,
    })
  })

  it('a leaf is a task with no open live children; a childless project is its own leaf', async () => {
    const ctx = await makeCtx(NOW)
    const ids = build(ctx, 'projects:\n  P\n    A\n      A1\n  R')
    setStatus(ctx, ids.A1!, 'done')
    expect(titles(reviewView(ctx, D).suggestions)).toEqual(['A', 'R'])
  })

  it('a project idle for 8 days yields nothing; 7 days is still recent', async () => {
    const ctx = await makeCtx(NOW)
    at(ctx, '2026-11-02T08:00:00Z', () => build(ctx, 'projects:\n  Q\n    q1'))
    at(ctx, '2026-11-03T08:00:00Z', () => build(ctx, 'projects:\n  R\n    r1'))
    expect(titles(reviewView(ctx, D).suggestions)).toEqual(['r1'])
  })

  it('an Inbox task 8 days old yields; 6 days old does not', async () => {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, '2026-11-02T08:00:00Z', () => build(ctx, 'inbox:\n  old\n  old-scheduled'))
    at(ctx, '2026-11-04T08:00:00Z', () => build(ctx, 'inbox:\n  young'))
    schedule(ctx, ids['old-scheduled']!, '2026-11-20')
    const view = reviewView(ctx, D)
    expect(titles(view.suggestions)).toEqual(['old'])
    expect(view.suggestions[0]).toMatchObject({ path: ['Inbox'], scheduledOn: null })
  })

  it('the cap is 5, projects first, then Inbox oldest first', async () => {
    const ctx = await makeCtx(NOW)
    for (let n = 1; n <= 7; n++) {
      at(ctx, `2026-10-2${n}T08:00:00Z`, () =>
        createTask(ctx, { title: `i${n}`, section: 'inbox' }),
      )
    }
    build(ctx, 'projects:\n  P\n    p1')
    expect(titles(reviewView(ctx, D).suggestions)).toEqual(['p1', 'i1', 'i2', 'i3', 'i4'])
  })

  it('review events are not activity: a dismissed suggestion does not keep its project active', async () => {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, '2026-11-01T08:00:00Z', () => build(ctx, 'projects:\n  P\n    s'))
    // Review of 2026-11-05: P was active on 11-01, so s is offered and dismissed.
    at(ctx, '2026-11-05T08:00:00Z', () => {
      expect(titles(reviewView(ctx, '2026-11-05').suggestions)).toEqual(['s'])
      decide(ctx, '2026-11-05', ids.s!, 'backlog')
    })
    // 2026-11-10: the last real activity (11-01) is 9 days old; the review_backlog of 11-05 does not count.
    expect(titles(reviewView(ctx, D).suggestions)).toEqual([])
  })

  it('suggestions never include leftovers', async () => {
    const ctx = await makeCtx(NOW)
    const ids = build(ctx, 'projects:\n  P\n    a\n    b')
    schedule(ctx, ids.a!, YESTERDAY)
    decide(ctx, D, ids.a!, 'backlog')
    const view = reviewView(ctx, D)
    expect(titles(view.leftovers)).toEqual(['a'])
    expect(titles(view.suggestions)).toEqual(['b'])
  })

  it('decided suggestions keep their place, their project yields no more, fresh ones fill to 5', async () => {
    const ctx = await makeCtx(NOW)
    const inbox: Record<string, string> = {}
    for (let n = 1; n <= 5; n++) {
      at(ctx, `2026-10-2${n}T08:00:00Z`, () => {
        inbox[`i${n}`] = createTask(ctx, { title: `i${n}`, section: 'inbox' }).id
      })
    }
    const ids = build(ctx, 'projects:\n  P\n    p1\n    p2\n  Q\n    q1')
    expect(titles(reviewView(ctx, D).suggestions)).toEqual(['p1', 'q1', 'i1', 'i2', 'i3'])

    // p1 moves to another day; P would now offer p2, but a decided project offers no more.
    let view = decide(ctx, D, ids.p1!, 'day', '2026-11-20')
    expect(titles(view.suggestions)).toEqual(['p1', 'q1', 'i1', 'i2', 'i3'])

    // q1 is now scheduled today, yet stays listed and still counts toward the cap.
    view = decide(ctx, D, ids.q1!, 'today')
    expect(titles(view.suggestions)).toEqual(['p1', 'q1', 'i1', 'i2', 'i3'])
    expect(view.suggestions[1]!.decision).toMatchObject({ choice: 'today', date: D })

    // Deciding out of order moves nothing: projects in tree order, then Inbox oldest first.
    view = decide(ctx, D, inbox.i3!, 'cancel')
    expect(titles(view.suggestions)).toEqual(['p1', 'q1', 'i1', 'i2', 'i3'])
    expect(view.suggestions.map((i) => i.decision?.choice ?? null)).toEqual([
      'day',
      'today',
      null,
      null,
      'cancel',
    ])
    expect(view.sortedCount).toBe(3)
    expect(view.totalCount).toBe(5)

    // Undoing p1 lets P offer its first leaf again.
    view = undoDecision(ctx, D)
    view = undoDecision(ctx, D)
    view = undoDecision(ctx, D)
    expect(titles(view.suggestions)).toEqual(['p1', 'q1', 'i1', 'i2', 'i3'])
    expect(view.sortedCount).toBe(0)
  })
})

describe('skip, finish and needsReview', () => {
  async function withLeftover() {
    const ctx = await makeCtx(NOW)
    at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a')
      schedule(ctx, ids.a!, YESTERDAY)
    })
    return ctx
  }

  it('needsReview false after skip or finish, true again next day when there are leftovers', async () => {
    const ctx = await withLeftover()
    expect(needsReview(ctx)).toBe(true)
    expect(reviewView(ctx, D)).toMatchObject({ skipped: false, finished: false })

    skipReview(ctx, D)
    expect(needsReview(ctx)).toBe(false)
    expect(reviewView(ctx, D)).toMatchObject({ skipped: true, finished: false })
    const skip = eventsOn(ctx, D).filter((e) => e.kind === 'review_skip')
    expect(skip.map((e) => e.data)).toEqual([{ reviewDate: D }])

    ctx.clock.set('2026-11-11T08:00:00Z')
    expect(needsReview(ctx)).toBe(true)
    finishReview(ctx, '2026-11-11')
    expect(needsReview(ctx)).toBe(false)
    expect(reviewView(ctx, '2026-11-11')).toMatchObject({ skipped: false, finished: true })

    ctx.clock.set('2026-11-12T08:00:00Z')
    expect(needsReview(ctx)).toBe(true)
  })

  it('needsReview false when there is nothing to review', async () => {
    const ctx = await makeCtx(NOW)
    expect(needsReview(ctx)).toBe(false)
    at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a')
      schedule(ctx, ids.a!, D)
    })
    expect(needsReview(ctx)).toBe(false)
  })
})

describe('leftoverFrom', () => {
  async function setup() {
    const ctx = await makeCtx(NOW)
    const ids = at(ctx, LONG_AGO, () => {
      const ids = build(ctx, 'projects:\n  P\n    a\n    b\n    c\n    d')
      schedule(ctx, ids.a!, YESTERDAY)
      schedule(ctx, ids.b!, '2026-11-07')
      schedule(ctx, ids.c!, YESTERDAY)
      schedule(ctx, ids.d!, YESTERDAY)
      return ids
    })
    // Q is created this week, so its leaf s is a suggestion.
    const q = build(ctx, 'projects:\n  Q\n    s')
    return { ctx, ids: { ...ids, ...q } }
  }
  const from = (view: ReviewView, id: string) =>
    view.leftovers.find((i) => i.task.id === id)!.leftoverFrom

  it('is the scheduled day of an undecided leftover and null for a suggestion', async () => {
    const { ctx, ids } = await setup()
    const view = reviewView(ctx, D)
    expect(from(view, ids.a!)).toBe(YESTERDAY)
    expect(from(view, ids.b!)).toBe('2026-11-07')
    expect(view.suggestions.length).toBeGreaterThan(0)
    for (const s of view.suggestions) expect(s.leftoverFrom).toBeNull()
  })

  it('keeps the original day once decided today, another day or backlog, also on a fresh read', async () => {
    const { ctx, ids } = await setup()
    decide(ctx, D, ids.a!, 'today')
    decide(ctx, D, ids.b!, 'day', '2026-11-12')
    decide(ctx, D, ids.c!, 'backlog')
    const view = reviewView(ctx, D)
    expect(view.leftovers.find((i) => i.task.id === ids.a)!.scheduledOn).toBe(D)
    expect(from(view, ids.a!)).toBe(YESTERDAY)
    expect(from(view, ids.b!)).toBe('2026-11-07')
    expect(from(view, ids.c!)).toBe(YESTERDAY)
    expect(from(view, ids.d!)).toBe(YESTERDAY)
  })

  it('is the original day again after undo', async () => {
    const { ctx, ids } = await setup()
    decide(ctx, D, ids.b!, 'day', '2026-11-12')
    const view = undoDecision(ctx, D)
    expect(from(view, ids.b!)).toBe('2026-11-07')
    expect(view.leftovers.find((i) => i.task.id === ids.b)!.decision).toBeNull()
  })
})
