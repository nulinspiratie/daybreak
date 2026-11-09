import type { DayView, TreeNode, TreeView } from '@daybreak/core'
import type { QueryClient } from '@tanstack/react-query'
import type { Draft } from '../ui/store'

// A task created from a draft is shown at once under a placeholder id. Writes run one at a time,
// so a later write that names it (the next draft's afterId, a Tab, a rename) reads the real id
// through resolveId when its turn comes, not when the key was pressed. A create the server refuses
// leaves a fallback instead: where its own draft would have gone.

/** Where a refused task would have gone, in real ids. */
export interface Fallback {
  parentId: string | null
  afterId?: string
  beforeId?: string
}

/** A write that names a task the server refused to create; it is dropped, not sent elsewhere. */
export class SkippedWrite extends Error {
  constructor(id: string) {
    super(`${id} was never created`)
    this.name = 'SkippedWrite'
  }
}

// One entry per task created this session, a few bytes each; never pruned, because a row keeps
// its placeholder as its React key for as long as it is shown.
let pendingSeq = 0
const realIds = new Map<string, string>()
const refused = new Map<string, Fallback>()
const keys = new Map<string, string>()

/** Forgets every placeholder (tests start from a clean slate). */
export function resetPendingIds(): void {
  pendingSeq = 0
  realIds.clear()
  refused.clear()
  keys.clear()
}

/** A placeholder id; real ids are six characters from [0-9a-z], so the two never clash. */
export function pendingId(): string {
  return `new:${++pendingSeq}`
}

/** Records the real id the server gave a placeholder. */
export function settlePendingId(placeholder: string, id: string): void {
  realIds.set(placeholder, id)
  keys.set(id, placeholder)
}

/** Records that the server refused to create a placeholder's task, and where it would have gone. */
export function failPendingId(placeholder: string, fallback: Fallback): void {
  refused.set(placeholder, fallback)
}

/** The real id for a placeholder the server has answered; any other id unchanged. */
export function resolveId(id: string): string {
  return realIds.get(id) ?? id
}

/** The id to send in a request path; throws SkippedWrite for a task that was never created. */
export function liveId(id: string): string {
  if (refused.has(id)) throw new SkippedWrite(id)
  return resolveId(id)
}

/** A row's React key: the placeholder it was first shown under, so its DOM (and editor) survives. */
export function rowKey(id: string): string {
  return keys.get(id) ?? id
}

/**
 * A draft's place in real ids, as sent in the create. A parent the server refused gives way to
 * that task's own parent; a refused task to follow gives way to the place it would have taken.
 */
export function placementFor(d: Draft): Draft {
  let parentId = d.parentId === null ? null : resolveId(d.parentId)
  let afterId = d.afterId === undefined ? undefined : resolveId(d.afterId)
  let beforeId = d.beforeId === undefined ? undefined : resolveId(d.beforeId)
  const parentGone = parentId === null ? undefined : refused.get(parentId)
  if (parentGone) parentId = parentGone.parentId
  const afterGone = afterId === undefined ? undefined : refused.get(afterId)
  if (afterGone) ({ afterId, beforeId } = afterGone)
  if (beforeId !== undefined && refused.has(beforeId)) beforeId = undefined
  return {
    section: d.section,
    parentId,
    ...(afterId !== undefined && { afterId }),
    ...(beforeId !== undefined && { beforeId }),
  }
}

function mapNodes(nodes: TreeNode[], fn: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => fn(n.children.length > 0 ? { ...n, children: mapNodes(n.children, fn) } : n))
}

function mapView(view: TreeView, fn: (n: TreeNode) => TreeNode): TreeView {
  return { ...view, inbox: mapNodes(view.inbox, fn), projects: mapNodes(view.projects, fn) }
}

/** `view` with `node` inserted where `at` says: after `afterId`, else before `beforeId`, else last. */
export function insertNode(view: TreeView, node: TreeNode, at: Draft): TreeView {
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
export function updateNode(view: TreeView, id: string, patch: Partial<TreeNode> | ((n: TreeNode) => TreeNode)): TreeView {
  const apply = typeof patch === 'function' ? patch : (n: TreeNode) => ({ ...n, ...patch })
  return mapView(view, (n) => (n.id === id ? apply(n) : n))
}

/** `view` without task `id`; its children move to the end of its parent, where their creates now go. */
export function removeNode(view: TreeView, id: string): TreeView {
  const drop = (list: TreeNode[]): TreeNode[] => {
    const i = list.findIndex((n) => n.id === id)
    if (i >= 0) return [...list.slice(0, i), ...list.slice(i + 1), ...list[i]!.children]
    return list.map((n) => {
      const children = drop(n.children)
      return children === n.children ? n : { ...n, children, totalCount: children.length }
    })
  }
  const inbox = drop(view.inbox)
  const projects = drop(view.projects)
  return inbox === view.inbox && projects === view.projects ? view : { ...view, inbox, projects }
}

/**
 * Optimistic edits to the cached tree. Each one first cancels a tree fetch in flight, whose answer
 * would predate it; fetches made while writes are queued are held back (see useTree), so the
 * refetch after the queue drains is the one that reconciles.
 */
export interface TreeCache {
  insert(node: TreeNode, at: Draft): void
  update(id: string, patch: Partial<TreeNode>): void
  /** The server answered a create: the row takes its real id, keeping a title renamed since. */
  created(placeholder: string, task: Partial<TreeNode>, sentTitle: string): void
  remove(id: string): void
}

export function treeCache(qc: QueryClient): TreeCache {
  const edit = (fn: (v: TreeView) => TreeView) => {
    void qc.cancelQueries({ queryKey: ['tree'] })
    qc.setQueriesData<TreeView>({ queryKey: ['tree'] }, (v) => (v ? fn(v) : v))
  }
  return {
    insert: (node, at) => edit((v) => insertNode(v, node, placementFor(at))),
    update: (id, patch) => {
      edit((v) => updateNode(v, resolveId(id), patch))
      // My Day lists the same tasks; show the change there too.
      const real = resolveId(id)
      void qc.cancelQueries({ queryKey: ['day'] })
      qc.setQueriesData<DayView>({ queryKey: ['day'] }, (d) =>
        d && { ...d, items: d.items.map((i) => (i.task.id === real ? { ...i, task: { ...i.task, ...patch } } : i)) },
      )
    },
    created: (placeholder, task, sentTitle) =>
      edit((v) =>
        updateNode(v, placeholder, (n) => ({ ...n, ...task, title: n.title === sentTitle ? (task.title ?? n.title) : n.title })),
      ),
    remove: (id) => edit((v) => removeNode(v, id)),
  }
}
