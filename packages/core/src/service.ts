import type { Clock } from './clock'
import type { Ctx } from './ctx'
import { today } from './ctx'
import { transaction, type Db } from './db/adapter'
import type { ISODate } from './dates'
import { exportProject } from './export'
import {
  decide, finishReview, lastReviewDate, needsReview, reviewView, skipReview, undoDecision,
} from './review'
import { createTask, updateTask, type CreateInput, type TaskPatch } from './tasks/create'
import { softDelete, restore } from './tasks/delete'
import { setMark } from './tasks/marks'
import { indent, moveDown, moveTask, moveUp, outdent } from './tasks/move'
import { getTask } from './tasks/rows'
import { dayCounts, dayView, schedule } from './tasks/schedule'
import { setStatus } from './tasks/status'
import { treeView } from './tasks/tree'
import type {
  Config, DayView, Mark, MoveTarget, ReviewChoice, ReviewView, Status, Task, TreeView,
} from './types'

export interface DaybreakDeps {
  db: Db
  clock: Clock
  config: Config
  logsDir?: string
}

export type ChangeEvent = { type: 'changed' }

export interface Daybreak {
  today(): ISODate
  tree(completed?: 'recent' | 'all' | 'none'): TreeView
  day(date: ISODate): DayView
  dayCounts(from: ISODate, to: ISODate): Record<ISODate, number>
  getTask(id: string): Task
  create(input: CreateInput): Task
  update(id: string, patch: TaskPatch): Task
  move(id: string, to: MoveTarget): Task
  nudge(id: string, direction: 'up' | 'down' | 'indent' | 'outdent'): Task
  setStatus(
    id: string,
    status: Status,
    opts?: { withOpenDescendants?: boolean },
  ): { task: Task; changedIds: string[] }
  setMark(id: string, mark: Mark | null): void
  schedule(id: string, date: ISODate | null, at?: { afterId?: string; beforeId?: string }): Task
  delete(id: string): { deletedIds: string[] }
  restore(id: string): { restoredIds: string[] }
  review(date: ISODate): ReviewView
  decide(date: ISODate, taskId: string, choice: ReviewChoice, targetDate?: ISODate): ReviewView
  undoDecision(date: ISODate): ReviewView
  skipReview(date: ISODate): void
  finishReview(date: ISODate): void
  needsReview(): boolean
  autoFinishEmptyReview(): void
  exportProject(id: string): string
  onChange(listener: (e: ChangeEvent) => void): () => void
}

const NUDGES = { up: moveUp, down: moveDown, indent, outdent } as const

export function createDaybreak(deps: DaybreakDeps): Daybreak {
  const ctx: Ctx = { db: deps.db, clock: deps.clock, config: deps.config }
  const listeners = new Set<(e: ChangeEvent) => void>()

  function emit(): void {
    for (const listener of [...listeners]) {
      try {
        listener({ type: 'changed' })
      } catch {
        // a broken listener must not fail the mutation or block the others
      }
    }
  }

  /** Run `fn` in one transaction, then notify listeners once it has committed. */
  function mutate<T>(fn: () => T): T {
    const result = transaction(ctx.db, fn)
    emit()
    return result
  }

  return {
    today: () => today(ctx),
    tree: (completed = 'recent') => treeView(ctx, completed),
    day: (date) => dayView(ctx, date),
    dayCounts: (from, to) => dayCounts(ctx, from, to),
    getTask: (id) => getTask(ctx, id),
    create: (input) => mutate(() => createTask(ctx, input)),
    update: (id, patch) => mutate(() => updateTask(ctx, id, patch)),
    move: (id, to) => mutate(() => moveTask(ctx, id, to)),
    nudge: (id, direction) => mutate(() => NUDGES[direction](ctx, id)),
    setStatus: (id, status, opts) => mutate(() => setStatus(ctx, id, status, opts)),
    setMark: (id, mark) => mutate(() => setMark(ctx, id, mark)),
    schedule: (id, date, at) => mutate(() => schedule(ctx, id, date, at)),
    delete: (id) => mutate(() => softDelete(ctx, id)),
    restore: (id) => mutate(() => restore(ctx, id)),
    review: (date) => reviewView(ctx, date),
    decide: (date, taskId, choice, targetDate) => mutate(() => decide(ctx, date, taskId, choice, targetDate)),
    undoDecision: (date) => mutate(() => undoDecision(ctx, date)),
    skipReview: (date) => mutate(() => skipReview(ctx, date)),
    finishReview: (date) => mutate(() => finishReview(ctx, date)),
    needsReview: () => needsReview(ctx),
    autoFinishEmptyReview() {
      const date = today(ctx)
      if (needsReview(ctx) || lastReviewDate(ctx) === date) return
      mutate(() => finishReview(ctx, date))
    },
    exportProject: (id) => exportProject(ctx, id),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
