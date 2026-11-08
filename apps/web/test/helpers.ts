import type { TreeNode } from '@daybreak/core'

export function node(id: string, children: TreeNode[] = [], over: Partial<TreeNode> = {}): TreeNode {
  return {
    id, parentId: null, section: 'projects', position: 'a0', title: id, notes: '', link: null,
    scheduledOn: null, dayPosition: null, status: 'open', closedAt: null, deletedAt: null,
    collapsed: false, tags: [], createdAt: '', updatedAt: '', children, mark: null,
    doneCount: 0, totalCount: children.length, ...over,
  }
}
