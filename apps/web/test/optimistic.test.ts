import type { DayItem, DayView, TreeView } from '@daybreak/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { flatten } from '../src/tree/flatten'
import {
  failPendingId,
  insertNode,
  liveId,
  moveDayItem,
  moveNode,
  pendingId,
  placementFor,
  removeNode,
  resetPendingIds,
  resolveId,
  rowKey,
  SkippedWrite,
  settlePendingId,
  updateNode,
} from '../src/tree/optimistic'
import { useUi } from '../src/ui/store'
import { node } from './helpers'

const view = (): TreeView => ({
  today: '2026-11-09',
  inbox: [node('i1', [], { section: 'inbox' })],
  projects: [node('p1', [node('c1'), node('c2')]), node('p2')],
  hiddenCompletedCount: 0,
})
const ids = (v: TreeView) => flatten(v).map((r) => `${r.id}@${r.depth}`)

beforeEach(() => resetPendingIds())

describe('optimistic tree updates', () => {
  it('insertNode places a task after a sibling, before one, or last', () => {
    expect(
      ids(insertNode(view(), node('x'), { section: 'projects', parentId: 'p1', afterId: 'c1' })),
    ).toEqual(['i1@0', 'p1@0', 'c1@1', 'x@1', 'c2@1', 'p2@0'])
    expect(
      ids(insertNode(view(), node('x'), { section: 'projects', parentId: null, beforeId: 'p2' })),
    ).toEqual(['i1@0', 'p1@0', 'c1@1', 'c2@1', 'x@0', 'p2@0'])
    expect(ids(insertNode(view(), node('x'), { section: 'inbox', parentId: null }))).toEqual([
      'i1@0',
      'x@0',
      'p1@0',
      'c1@1',
      'c2@1',
      'p2@0',
    ])
    expect(ids(insertNode(view(), node('x'), { section: 'projects', parentId: 'c2' }))).toContain(
      'x@2',
    )
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

  it('removeNode drops a task and lifts its children to the end of its parent', () => {
    const v: TreeView = {
      ...view(),
      projects: [node('p1', [node('x', [node('k1'), node('k2')]), node('c2')]), node('p2')],
    }
    expect(ids(removeNode(v, 'x'))).toEqual(['i1@0', 'p1@0', 'c2@1', 'k1@1', 'k2@1', 'p2@0'])
    expect(ids(removeNode(view(), 'p2'))).toEqual(['i1@0', 'p1@0', 'c1@1', 'c2@1'])
  })

  it('moveNode carries the subtree to its new place and section', () => {
    const v: TreeView = {
      ...view(),
      projects: [node('p1', [node('c1', [node('k1')]), node('c2')]), node('p2')],
    }
    expect(ids(moveNode(v, 'c1', { section: 'projects', parentId: 'p2' }))).toEqual([
      'i1@0',
      'p1@0',
      'c2@1',
      'p2@0',
      'c1@1',
      'k1@2',
    ])
    expect(ids(moveNode(v, 'c1', { section: 'projects', parentId: null, beforeId: 'p1' }))).toEqual(
      ['i1@0', 'c1@0', 'k1@1', 'p1@0', 'c2@1', 'p2@0'],
    )
    const toInbox = moveNode(view(), 'c2', { section: 'inbox', parentId: null, afterId: 'i1' })
    expect(ids(toInbox)).toEqual(['i1@0', 'c2@0', 'p1@0', 'c1@1', 'p2@0'])
    expect(toInbox.inbox[1]).toMatchObject({ id: 'c2', section: 'inbox', parentId: null })
    expect(moveNode(view(), 'nope', { section: 'projects', parentId: null })).toEqual(view())
  })

  it('moveDayItem reorders the day list', () => {
    const item = (id: string): DayItem => ({
      task: node(id),
      path: [],
      mark: null,
      doneCount: 0,
      totalCount: 0,
    })
    const day: DayView = {
      date: '2026-11-09',
      items: ['a', 'b', 'c'].map(item),
      doneCount: 0,
      totalCount: 3,
    }
    const order = (d: DayView) => d.items.map((i) => i.task.id)
    expect(order(moveDayItem(day, 'a', { afterId: 'c' }))).toEqual(['b', 'c', 'a'])
    expect(order(moveDayItem(day, 'c', { beforeId: 'a' }))).toEqual(['c', 'a', 'b'])
    expect(order(moveDayItem(day, 'z', { beforeId: 'a' }))).toEqual(['a', 'b', 'c'])
  })

  it('a settled placeholder keeps its row key; a fresh state starts over', () => {
    const p = pendingId()
    settlePendingId(p, 'abc123')
    expect(rowKey('abc123')).toBe(p)
    expect(rowKey('zzz999')).toBe('zzz999')
    resetPendingIds()
    expect(resolveId(p)).toBe(p)
    expect(rowKey('abc123')).toBe('abc123')
    expect(pendingId()).toBe('new:1')
  })

  it('placementFor falls back past a refused placeholder; liveId refuses to name it', () => {
    const a = pendingId()
    const b = pendingId()
    failPendingId(a, { parentId: 'p1', afterId: 'c1' })
    settlePendingId(b, 'bbb111')
    expect(placementFor({ section: 'projects', parentId: 'p1', afterId: a })).toEqual({
      section: 'projects',
      parentId: 'p1',
      afterId: 'c1',
    })
    expect(placementFor({ section: 'projects', parentId: a })).toEqual({
      section: 'projects',
      parentId: 'p1',
    })
    expect(placementFor({ section: 'projects', parentId: 'p1', afterId: b })).toEqual({
      section: 'projects',
      parentId: 'p1',
      afterId: 'bbb111',
    })
    expect(placementFor({ section: 'projects', parentId: 'p1', beforeId: a })).toEqual({
      section: 'projects',
      parentId: 'p1',
    })
    expect(liveId(b)).toBe('bbb111')
    expect(() => liveId(a)).toThrow(SkippedWrite)
  })

  it('replaceId points the selection, editing, draft and detail at the real id', () => {
    const ui = useUi.getState()
    ui.set({
      treeSel: 'new:7',
      daySel: 'd1',
      detailId: 'new:7',
      editing: { id: 'new:7', initial: 'a', text: 'a' },
      draft: { section: 'projects', parentId: 'new:7', afterId: 'new:7' },
      confirm: null,
    })
    ui.replaceId('new:7', 'k3f9a2')
    expect(useUi.getState()).toMatchObject({
      treeSel: 'k3f9a2',
      daySel: 'd1',
      detailId: 'k3f9a2',
      editing: { id: 'k3f9a2' },
      draft: { parentId: 'k3f9a2', afterId: 'k3f9a2' },
    })
    expect(useUi.getState().draft).not.toHaveProperty('beforeId')
  })

  it('dropId forgets a refused task: selection to its anchor, a draft re-anchored, editing ended', () => {
    const ui = useUi.getState()
    ui.set({
      treeSel: 'new:7',
      daySel: null,
      detailId: 'new:7',
      editing: { id: 'new:7', initial: 'a', text: 'a2' },
      draft: null,
      confirm: null,
    })
    ui.dropId('new:7', { parentId: 'p1', afterId: 'c1' })
    expect(useUi.getState()).toMatchObject({ treeSel: 'c1', detailId: null, editing: null })
    ui.set({
      treeSel: 'draft',
      editing: { id: 'draft', initial: '', text: '' },
      draft: { section: 'projects', parentId: 'p1', afterId: 'new:8' },
    })
    ui.dropId('new:8', { parentId: 'p1' })
    expect(useUi.getState()).toMatchObject({ treeSel: 'draft', editing: { id: 'draft' } })
    expect(useUi.getState().draft).toEqual({ section: 'projects', parentId: 'p1' })
    ui.set({ draft: { section: 'projects', parentId: 'new:9' } })
    ui.dropId('new:9', { parentId: null, afterId: 'p1' })
    expect(useUi.getState().draft).toEqual({ section: 'projects', parentId: null })
  })
})
