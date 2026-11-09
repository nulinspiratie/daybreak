import type { Section } from '@daybreak/core'
import type { FlatRow } from './flatten'

/** Where a dragged tree task lands, as sent to POST /move, plus what the drop indicator shows. */
export interface DropProjection {
  parentId: string | null
  section: Section
  depth: number
  afterId?: string
  beforeId?: string
  /** e.g. "Level 3 · becomes a sibling of 'Write loader for…'" */
  label: string
}

const TITLE_MAX = 16
const short = (title: string) =>
  title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX)}…` : title
const SECTION_NAME: Record<Section, string> = { inbox: 'Inbox', projects: 'Projects' }

/**
 * The Projects heading's id in the tree's sortable list. Dropped onto it, a task crosses the
 * boundary: an Inbox task (moving down) to the top of Projects, a Projects task (moving up) to
 * the end of Inbox. It is also the only target in an empty section.
 */
export const PROJECTS_HEAD = 'head:projects'

/** The empty-Inbox line, a drop target only while Inbox has no rows: dropped there, a task goes to Inbox. */
export const INBOX_EMPTY = 'head:inbox'

/** Inbox is flat. A task's counts include subtasks the recent view hides, so they are checked too. */
const hasSubtasks = (r: FlatRow) => r.hasChildren || r.node.totalCount > 0

/** `rows` without the descendants of `id`: they travel with it, so they are never drop targets. */
export function withoutDescendants(rows: FlatRow[], id: string): FlatRow[] {
  const i = rows.findIndex((r) => r.id === id)
  if (i < 0) return rows
  let j = i + 1
  while (j < rows.length && rows[j]!.depth > rows[i]!.depth) j++
  return [...rows.slice(0, i + 1), ...rows.slice(j)]
}

/** Walking up from `rows[i - 1]`: the nearest row at `depth` (the previous sibling) and the parent. */
function placeAbove(rows: FlatRow[], i: number, depth: number, section: Section) {
  let sibling: FlatRow | undefined
  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j]!
    if (r.section !== section) break
    if (r.depth === depth && !sibling) {
      sibling = r
      if (depth === 0) break
    }
    if (r.depth < depth) return { sibling, parent: r }
  }
  return { sibling, parent: undefined }
}

/**
 * Where `activeId` lands when dropped over `overId` with the pointer `offsetX` px right of where
 * the drag started. It takes over's slot (after it when moving down, before it when moving up, as
 * a sortable list does); every `indent` px of offset is one level, clamped to what the rows
 * around the slot allow. Null when nothing can be dropped there.
 */
export function projectDrop(
  rows: FlatRow[],
  activeId: string,
  overId: string,
  offsetX: number,
  indent = 22,
): DropProjection | null {
  const kept = withoutDescendants(
    rows.filter((r) => !r.isDraft),
    activeId,
  )
  const from = kept.findIndex((r) => r.id === activeId)
  if (from < 0) return null
  const active = kept[from]!
  if (overId === PROJECTS_HEAD) return acrossHeading(kept, active)
  if (overId === INBOX_EMPTY) {
    if (hasSubtasks(active) || kept.some((r) => r.section === 'inbox')) return null
    return { parentId: null, section: 'inbox', depth: 0, label: 'Level 1 · goes to Inbox' }
  }
  const to = kept.findIndex((r) => r.id === overId)
  if (to < 0) return null
  const section = kept[to]!.section
  const moved = [...kept]
  moved.splice(from, 1)
  moved.splice(to, 0, active)
  const inSection = (r: FlatRow | undefined) => (r?.section === section ? r : undefined)
  const prev = inSection(moved[to - 1])
  const next = inSection(moved[to + 1])

  let depth = 0
  if (section === 'inbox') {
    if (hasSubtasks(active)) return null
  } else {
    const min = next?.depth ?? 0
    const max = prev ? prev.depth + 1 : 0
    depth = Math.min(max, Math.max(min, active.depth + Math.round(offsetX / indent)))
  }

  const { sibling, parent } = placeAbove(moved, to, depth, section)
  const p: DropProjection = { parentId: depth === 0 ? null : parent!.id, section, depth, label: '' }
  let relation: string
  if (sibling) {
    p.afterId = sibling.id
    relation = `becomes a sibling of '${short(sibling.node.title)}'`
  } else if (parent) {
    // A collapsed parent hides its children, so the task goes after the last of them.
    const last = parent.node.collapsed
      ? parent.node.children.filter((c) => c.id !== activeId).at(-1)
      : undefined
    if (last) p.afterId = last.id
    else if (next && next.depth === depth) p.beforeId = next.id
    relation = `becomes a child of '${short(parent.node.title)}'`
  } else {
    if (next) p.beforeId = next.id
    relation = `goes to the top of ${SECTION_NAME[section]}`
  }
  p.label = `Level ${depth + 1} · ${relation}`
  return p
}

/** Dropped on the Projects heading: just past it, into the other section, at the top level. */
function acrossHeading(rows: FlatRow[], active: FlatRow): DropProjection | null {
  const base = { parentId: null, depth: 0 }
  if (active.section === 'inbox') {
    const first = rows.find((r) => r.section === 'projects')
    return {
      ...base,
      section: 'projects',
      ...(first && { beforeId: first.id }),
      label: 'Level 1 · goes to the top of Projects',
    }
  }
  if (hasSubtasks(active)) return null
  const last = rows.filter((r) => r.section === 'inbox').at(-1)
  return last
    ? {
        ...base,
        section: 'inbox',
        afterId: last.id,
        label: `Level 1 · becomes a sibling of '${short(last.node.title)}'`,
      }
    : { ...base, section: 'inbox', label: 'Level 1 · goes to the top of Inbox' }
}

/** True when `p` puts the task back where it is: the same parent, after the same sibling. */
export function isUnchanged(rows: FlatRow[], activeId: string, p: DropProjection): boolean {
  const i = rows.findIndex((r) => r.id === activeId)
  const active = rows[i]
  if (!active || active.parentId !== p.parentId || active.section !== p.section) return false
  const { sibling } = placeAbove(rows, i, active.depth, active.section)
  return sibling?.id === p.afterId
}

/**
 * Where a task lands in the day list `ids` when dropped `side` of `overId` (null: below the
 * list, so at the end). Null when the order would not change.
 */
export function projectDayDrop(
  ids: string[],
  activeId: string,
  overId: string | null,
  side: 'before' | 'after',
): { afterId?: string; beforeId?: string } | null {
  const others = ids.filter((id) => id !== activeId)
  let at: { afterId?: string; beforeId?: string }
  let index: number
  if (overId === null || !others.includes(overId)) {
    if (overId === activeId) return null
    const last = others.at(-1)
    at = last === undefined ? {} : { afterId: last }
    index = others.length
  } else {
    const k = others.indexOf(overId)
    at = side === 'after' ? { afterId: overId } : { beforeId: overId }
    index = side === 'after' ? k + 1 : k
  }
  const from = ids.indexOf(activeId)
  return from >= 0 && from === index ? null : at
}
