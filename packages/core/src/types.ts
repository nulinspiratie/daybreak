// Pure types. No Node or Bun imports: the browser imports this module too.
import type { ISODate } from './dates'

export type Section = 'inbox' | 'projects'
export type Status = 'open' | 'done' | 'cancelled'
export type Mark = 'doing' | 'worked'

export type EventKind =
  | 'created' | 'renamed' | 'moved' | 'scheduled' | 'unscheduled' | 'done' | 'reopened'
  | 'cancelled' | 'doing' | 'worked' | 'deleted' | 'restored'
  | 'review_today' | 'review_day' | 'review_backlog' | 'review_cancel' | 'review_skip' | 'review_undo'

export interface Task {
  id: string
  parentId: string | null
  section: Section
  position: string
  title: string
  notes: string
  link: string | null
  scheduledOn: ISODate | null
  dayPosition: string | null
  status: Status
  closedAt: string | null
  deletedAt: string | null
  collapsed: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Config {
  dayStartsAt: string
}

export interface TreeNode extends Task {
  children: TreeNode[]
  mark: Mark | null
  doneCount: number
  totalCount: number
}

export interface TreeView {
  today: ISODate
  inbox: TreeNode[]
  projects: TreeNode[]
  hiddenCompletedCount: number
}

export interface MoveTarget {
  parentId: string | null
  section: Section
  afterId?: string
  beforeId?: string
}

export interface DayItem {
  task: Task
  path: string[]
  mark: Mark | null
  doneCount: number
  totalCount: number
}

export interface DayView {
  date: ISODate
  items: DayItem[]
  doneCount: number
  totalCount: number
}

export type ReviewChoice = 'today' | 'day' | 'backlog' | 'cancel'

export interface ReviewItem {
  task: Task
  path: string[]
  group: 'leftover' | 'suggestion'
  decision: { choice: ReviewChoice; date?: ISODate } | null
  workedOn: ISODate | null
  scheduledOn: ISODate | null
}

export interface ReviewView {
  date: ISODate
  leftovers: ReviewItem[]
  suggestions: ReviewItem[]
  sortedCount: number
  totalCount: number
  todayCount: number
  finished: boolean
  skipped: boolean
}
