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
