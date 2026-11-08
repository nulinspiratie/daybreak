import type { Section, TreeNode, TreeView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import { flatten, rowIndex } from '../src/tree/flatten'
import { node } from './helpers'

const view = (inbox: TreeNode[], projects: TreeNode[]): TreeView => ({
  today: '2026-11-09', inbox, projects, hiddenCompletedCount: 0,
})

describe('flatten', () => {
  it('skips children of collapsed nodes', () => {
    const v = view([], [node('p', [node('a', [node('a1')]), node('b')], { collapsed: false }), node('q', [node('q1')], { collapsed: true })])
    expect(flatten(v).map((r) => r.id)).toEqual(['p', 'a', 'a1', 'b', 'q'])
    expect(flatten(v).find((r) => r.id === 'q')?.hasChildren).toBe(true)
  })

  it('collapsing a middle node hides only its subtree', () => {
    const v = view([], [node('p', [node('a', [node('a1')], { collapsed: true }), node('b')])])
    expect(flatten(v).map((r) => r.id)).toEqual(['p', 'a', 'b'])
  })

  it('depth counts from 0 at section top level, inbox first', () => {
    const v = view([node('i1', [], { section: 'inbox' })], [node('p', [node('a', [node('a1')])])])
    const rows = flatten(v)
    expect(rows.map((r) => [r.id, r.depth, r.section, r.parentId])).toEqual([
      ['i1', 0, 'inbox', null],
      ['p', 0, 'projects', null],
      ['a', 1, 'projects', 'p'],
      ['a1', 2, 'projects', 'a'],
    ])
  })

  it("draft row appears after afterId's subtree at the draft's depth", () => {
    const v = view([], [node('p', [node('a', [node('a1'), node('a2')]), node('b')])])
    const rows = flatten(v, { section: 'projects', parentId: 'p', afterId: 'a' })
    expect(rows.map((r) => r.id)).toEqual(['p', 'a', 'a1', 'a2', 'draft', 'b'])
    const d = rows[rowIndex(rows, 'draft')]!
    expect(d.depth).toBe(1)
    expect(d.isDraft).toBe(true)
    expect(d.parentId).toBe('p')
  })

  it('draft after a collapsed node goes right after that one row', () => {
    const v = view([], [node('a', [node('a1')], { collapsed: true }), node('b')])
    expect(flatten(v, { section: 'projects', parentId: null, afterId: 'a' }).map((r) => r.id)).toEqual(['a', 'draft', 'b'])
  })

  it('draft with beforeId goes just above it; with only a parent goes to the end of its subtree', () => {
    const v = view([node('i', [], { section: 'inbox' })], [node('p', [node('a'), node('b')]), node('q')])
    expect(flatten(v, { section: 'projects', parentId: 'p', beforeId: 'b' }).map((r) => r.id)).toEqual(['i', 'p', 'a', 'draft', 'b', 'q'])
    expect(flatten(v, { section: 'projects', parentId: 'p' }).map((r) => r.id)).toEqual(['i', 'p', 'a', 'b', 'draft', 'q'])
  })

  it('draft in an empty section top level lands in that section', () => {
    const v = view([node('i', [], { section: 'inbox' })], [node('p')])
    const s: Section = 'inbox'
    expect(flatten(v, { section: s, parentId: null }).map((r) => r.id)).toEqual(['i', 'draft', 'p'])
  })

  it('rowIndex returns -1 for unknown ids', () => {
    expect(rowIndex(flatten(view([], [node('p')])), 'zzz')).toBe(-1)
  })
})
