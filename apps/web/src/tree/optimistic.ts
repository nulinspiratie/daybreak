import type { TreeNode, TreeView } from '@daybreak/core'
import type { QueryClient } from '@tanstack/react-query'
import type { Draft } from '../ui/store'

/** Where a new task goes, in the same terms as a draft. */
export type Placement = Draft

// A task created from a draft is shown at once under a placeholder id. Writes run one at a time,
// so a later write that names it (the next draft's afterId, a Tab, a rename) reads the real id
// through resolveId when its turn comes, not when the key was pressed.
let pendingSeq = 0
const realIds = new Map<string, string>()

/** A placeholder id; real ids are six characters from [0-9a-z], so the two never clash. */
export function pendingId(): string {
  return `new:${++pendingSeq}`
}

/** Records the real id the server gave a placeholder. */
export function settlePendingId(placeholder: string, id: string): void {
  realIds.set(placeholder, id)
}

/** The real id for a placeholder the server has answered; any other id unchanged. */
export function resolveId(id: string): string {
  return realIds.get(id) ?? id
}

function mapNodes(nodes: TreeNode[], fn: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => fn(n.children.length > 0 ? { ...n, children: mapNodes(n.children, fn) } : n))
}

function mapView(view: TreeView, fn: (n: TreeNode) => TreeNode): TreeView {
  return { ...view, inbox: mapNodes(view.inbox, fn), projects: mapNodes(view.projects, fn) }
}

/** `view` with `node` inserted where `at` says: after `afterId`, else before `beforeId`, else last. */
export function insertNode(view: TreeView, node: TreeNode, at: Placement): TreeView {
  const place = (list: TreeNode[]): TreeNode[] => {
    const anchor = at.afterId ?? at.beforeId
    const i = anchor === undefined ? -1 : list.findIndex((n) => n.id === anchor)
    const k = i < 0 ? list.length : at.afterId !== undefined ? i + 1 : i
    return [...list.slice(0, k), node, ...list.slice(k)]
  }
  if (at.parentId === null) return { ...view, [at.section]: place(view[at.section]) }
  return mapView(view, (n) =>
    n.id === at.parentId ? { ...n, children: place(n.children), totalCount: n.totalCount + 1 } : n,
  )
}

/** `view` with the fields in `patch` (a title, or a placeholder's real id) applied to task `id`. */
export function updateNode(view: TreeView, id: string, patch: Partial<TreeNode>): TreeView {
  return mapView(view, (n) => (n.id === id ? { ...n, ...patch } : n))
}

/**
 * Optimistic edits to the cached tree, shown until the refetch after the writes drain replaces them
 * with the server's answer.
 */
export interface TreeCache {
  insert(node: TreeNode, at: Placement): void
  update(id: string, patch: Partial<TreeNode>): void
}

export function treeCache(qc: QueryClient): TreeCache {
  const edit = (fn: (v: TreeView) => TreeView) =>
    qc.setQueriesData<TreeView>({ queryKey: ['tree'] }, (v) => (v ? fn(v) : v))
  const resolved = (id: string | undefined) => (id === undefined ? undefined : resolveId(id))
  return {
    insert: (node, at) =>
      edit((v) =>
        insertNode(v, node, {
          section: at.section,
          parentId: at.parentId === null ? null : resolveId(at.parentId),
          afterId: resolved(at.afterId),
          beforeId: resolved(at.beforeId),
        }),
      ),
    update: (id, patch) => edit((v) => updateNode(v, resolveId(id), patch)),
  }
}
