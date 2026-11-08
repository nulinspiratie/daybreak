import type { Section, TreeNode, TreeView } from '@daybreak/core'
import type { Draft } from '../ui/store'

export interface FlatRow {
  id: string
  node: TreeNode
  depth: number
  section: Section
  parentId: string | null
  hasChildren: boolean
  isDraft?: boolean
}

export const DRAFT_ID = 'draft'

function walk(nodes: TreeNode[], depth: number, section: Section, parentId: string | null, out: FlatRow[]): void {
  for (const n of nodes) {
    out.push({ id: n.id, node: n, depth, section, parentId, hasChildren: n.children.length > 0 })
    if (!n.collapsed) walk(n.children, depth + 1, section, n.id, out)
  }
}

/** Index just past the row at `i` and everything nested under it. */
function afterSubtree(rows: FlatRow[], i: number): number {
  const depth = rows[i]!.depth
  let j = i + 1
  while (j < rows.length && rows[j]!.depth > depth) j++
  return j
}

function draftRow(draft: Draft, depth: number): FlatRow {
  const node: TreeNode = {
    id: DRAFT_ID, parentId: draft.parentId, section: draft.section, position: '', title: '', notes: '',
    link: null, scheduledOn: null, dayPosition: null, status: 'open', closedAt: null, deletedAt: null,
    collapsed: false, tags: [], createdAt: '', updatedAt: '', children: [], mark: null, doneCount: 0, totalCount: 0,
  }
  return { id: DRAFT_ID, node, depth, section: draft.section, parentId: draft.parentId, hasChildren: false, isDraft: true }
}

/** Visible rows in display order (Inbox, then Projects), with the draft row spliced in. */
export function flatten(view: TreeView, draft?: Draft | null): FlatRow[] {
  const rows: FlatRow[] = []
  walk(view.inbox, 0, 'inbox', null, rows)
  walk(view.projects, 0, 'projects', null, rows)
  if (!draft) return rows

  const parentIdx = draft.parentId === null ? -1 : rowIndex(rows, draft.parentId)
  const depth = parentIdx >= 0 ? rows[parentIdx]!.depth + 1 : 0
  let at: number
  const afterIdx = draft.afterId === undefined ? -1 : rowIndex(rows, draft.afterId)
  const beforeIdx = draft.beforeId === undefined ? -1 : rowIndex(rows, draft.beforeId)
  if (afterIdx >= 0) at = afterSubtree(rows, afterIdx)
  else if (beforeIdx >= 0) at = beforeIdx
  else if (parentIdx >= 0) at = afterSubtree(rows, parentIdx)
  else {
    // End of the section's top level: after the section's last row.
    let last = -1
    rows.forEach((r, i) => {
      if (r.section === draft.section) last = i
    })
    at = last + 1
    if (last < 0 && draft.section === 'projects') at = rows.length
  }
  rows.splice(at, 0, draftRow(draft, depth))
  return rows
}

export function rowIndex(rows: FlatRow[], id: string): number {
  return rows.findIndex((r) => r.id === id)
}
