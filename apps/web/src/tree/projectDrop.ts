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
const short = (title: string) => (title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX)}…` : title)
const SECTION_NAME: Record<Section, string> = { inbox: 'Inbox', projects: 'Projects' }

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
export function projectDrop(rows: FlatRow[], activeId: string, overId: string, offsetX: number, indent = 22): DropProjection | null {
  const kept = withoutDescendants(rows.filter((r) => !r.isDraft), activeId)
  const from = kept.findIndex((r) => r.id === activeId)
  const to = kept.findIndex((r) => r.id === overId)
  if (from < 0 || to < 0) return null
  const active = kept[from]!
  const section = kept[to]!.section
  const moved = [...kept]
  moved.splice(from, 1)
  moved.splice(to, 0, active)
  const inSection = (r: FlatRow | undefined) => (r?.section === section ? r : undefined)
  const prev = inSection(moved[to - 1])
  const next = inSection(moved[to + 1])

  let depth = 0
  if (section === 'inbox') {
    if (active.hasChildren) return null // Inbox is flat
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
    const last = parent.node.collapsed ? parent.node.children.filter((c) => c.id !== activeId).at(-1) : undefined
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
