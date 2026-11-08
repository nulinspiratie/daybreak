import type { TreeView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import { flatten } from '../src/tree/flatten'
import { insertNode, pendingId, resolveId, settlePendingId, updateNode } from '../src/tree/optimistic'
import { useUi } from '../src/ui/store'
import { node } from './helpers'

const view = (): TreeView => ({
  today: '2026-11-09',
  inbox: [node('i1', [], { section: 'inbox' })],
  projects: [node('p1', [node('c1'), node('c2')]), node('p2')],
  hiddenCompletedCount: 0,
})
const ids = (v: TreeView) => flatten(v).map((r) => `${r.id}@${r.depth}`)

describe('optimistic tree updates', () => {
  it('insertNode places a task after a sibling, before one, or last', () => {
    expect(ids(insertNode(view(), node('x'), { section: 'projects', parentId: 'p1', afterId: 'c1' }))).toEqual([
      'i1@0', 'p1@0', 'c1@1', 'x@1', 'c2@1', 'p2@0',
    ])
    expect(ids(insertNode(view(), node('x'), { section: 'projects', parentId: null, beforeId: 'p2' }))).toEqual([
      'i1@0', 'p1@0', 'c1@1', 'c2@1', 'x@0', 'p2@0',
    ])
    expect(ids(insertNode(view(), node('x'), { section: 'inbox', parentId: null }))).toEqual([
      'i1@0', 'x@0', 'p1@0', 'c1@1', 'c2@1', 'p2@0',
    ])
    expect(ids(insertNode(view(), node('x'), { section: 'projects', parentId: 'c2' }))).toContain('x@2')
  })

  it('updateNode patches one task anywhere in the tree, including its id', () => {
    const v = updateNode(view(), 'c2', { id: 'k9', title: 'Renamed' })
    expect(flatten(v).find((r) => r.id === 'k9')?.node.title).toBe('Renamed')
    expect(ids(v)).toContain('k9@1')
  })

  it('placeholder ids resolve once settled', () => {
    const p = pendingId()
    expect(p).toMatch(/^new:\d+$/)
    expect(resolveId(p)).toBe(p)
    settlePendingId(p, 'abc123')
    expect(resolveId(p)).toBe('abc123')
    expect(resolveId('zzz999')).toBe('zzz999')
  })

  it('replaceId points the selection, editing, draft and detail at the real id', () => {
    const ui = useUi.getState()
    ui.set({
      treeSel: 'new:7', daySel: 'd1', detailId: 'new:7', editing: { id: 'new:7', initial: 'a', text: 'a' },
      draft: { section: 'projects', parentId: 'new:7', afterId: 'new:7' }, confirm: null,
    })
    ui.replaceId('new:7', 'k3f9a2')
    expect(useUi.getState()).toMatchObject({
      treeSel: 'k3f9a2', daySel: 'd1', detailId: 'k3f9a2', editing: { id: 'k3f9a2' },
      draft: { parentId: 'k3f9a2', afterId: 'k3f9a2' },
    })
    expect(useUi.getState().draft).not.toHaveProperty('beforeId')
  })
})
