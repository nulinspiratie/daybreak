import type { TreeView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import { flatten } from '../src/tree/flatten'
import { isUnchanged, PROJECTS_HEAD, projectDayDrop, projectDrop } from '../src/tree/projectDrop'
import { node } from './helpers'

// Rows (id@depth): i1@0 i2@0 | p@0 a@1 w@2 r@1 r1@2 q@0 (collapsed: q1, q2) x@0
const view: TreeView = {
  today: '2026-11-09',
  inbox: [node('i1', [], { section: 'inbox' }), node('i2', [], { section: 'inbox' })],
  projects: [
    node('p', [
      node('a', [node('w', [], { title: 'Write loader for HDF5 v2 files' })], { title: 'Port fit routines to the new data format' }),
      node('r', [node('r1')], { title: 'Regression tests against the March datasets' }),
    ], { title: 'Parity-readout calibration pipeline' }),
    node('q', [node('q1'), node('q2')], { title: 'Quarterly', collapsed: true }),
    node('x', [], { title: 'Thermal anchoring check' }),
  ],
  hiddenCompletedCount: 0,
}
const rows = flatten(view)

describe('projectDrop', () => {
  it('no offset keeps the active task’s depth', () => {
    expect(projectDrop(rows, 'r', 'r', 0)).toEqual({
      parentId: 'p', section: 'projects', depth: 1, afterId: 'a',
      label: "Level 2 · becomes a sibling of 'Port fit routine…'",
    })
    // Moved up past the collapsed q: still top level, after p.
    expect(projectDrop(rows, 'x', 'q', 0)).toMatchObject({ parentId: null, depth: 0, afterId: 'p' })
  })

  it('+22 px goes one level deeper under the row above', () => {
    expect(projectDrop(rows, 'r', 'r', 22)).toMatchObject({ parentId: 'a', depth: 2, afterId: 'w' })
  })

  it('+66 px is clamped to the previous row’s depth + 1', () => {
    expect(projectDrop(rows, 'r', 'r', 66)).toEqual({
      parentId: 'w', section: 'projects', depth: 3,
      label: "Level 4 · becomes a child of 'Write loader for…'",
    })
  })

  it('−44 px is clamped to the next row’s depth', () => {
    // w@2 is followed by r@1.
    expect(projectDrop(rows, 'w', 'w', -44)).toMatchObject({ parentId: 'p', depth: 1, afterId: 'a' })
  })

  it('a dragged subtree’s children are excluded', () => {
    // Without r1@2 below it, r can go up to the top level (the next row is q@0).
    expect(projectDrop(rows, 'r', 'r', -22)).toMatchObject({ parentId: null, depth: 0, afterId: 'p' })
  })

  it('dropping on own descendant is impossible because they are excluded', () => {
    expect(projectDrop(rows, 'r', 'r1', 0)).toBeNull()
    expect(projectDrop(rows, 'p', 'w', 44)).toBeNull()
  })

  it('a parent dropped into Inbox gives null', () => {
    expect(projectDrop(rows, 'r', 'i2', 0)).toBeNull()
  })

  it('Inbox rows clamp to depth 0', () => {
    expect(projectDrop(rows, 'w', 'i2', 44)).toEqual({
      parentId: null, section: 'inbox', depth: 0, afterId: 'i1', label: "Level 1 · becomes a sibling of 'i1'",
    })
  })

  it('the label matches the design', () => {
    // x moved up above r, two levels in: a sibling of w under a.
    expect(projectDrop(rows, 'x', 'r', 44)).toEqual({
      parentId: 'a', section: 'projects', depth: 2, afterId: 'w',
      label: "Level 3 · becomes a sibling of 'Write loader for…'",
    })
  })

  it('a collapsed parent above takes the task as its last child', () => {
    expect(projectDrop(rows, 'x', 'x', 22)).toEqual({
      parentId: 'q', section: 'projects', depth: 1, afterId: 'q2', label: "Level 2 · becomes a child of 'Quarterly'",
    })
  })

  it('the top of a section ignores the row above it in the other section', () => {
    expect(projectDrop(rows, 'x', 'p', 22)).toEqual({
      parentId: null, section: 'projects', depth: 0, beforeId: 'p', label: 'Level 1 · goes to the top of Projects',
    })
  })

  it('a first child goes before the parent’s first visible child', () => {
    // r moved up above w, one level in: the first child of a.
    expect(projectDrop(rows, 'r', 'w', 22)).toMatchObject({ parentId: 'a', depth: 2, beforeId: 'w' })
  })

  it('an Inbox row entering Projects takes the slot after the first project', () => {
    // As the sortable list shows it: below p, above p's first child, so it can only be p's child.
    expect(projectDrop(rows, 'i2', 'p', -22)).toMatchObject({ section: 'projects', parentId: 'p', depth: 1, beforeId: 'a' })
  })

  it('a Projects row entering Inbox takes the slot before the last Inbox row', () => {
    expect(projectDrop(rows, 'x', 'i2', 0)).toMatchObject({ section: 'inbox', parentId: null, depth: 0, afterId: 'i1' })
  })

  it('unknown rows give null', () => {
    expect(projectDrop(rows, 'nope', 'x', 0)).toBeNull()
    expect(projectDrop(rows, 'x', 'nope', 0)).toBeNull()
  })
})

describe('the Projects heading as a drop target', () => {
  it('an Inbox task dropped on it goes to the top of Projects', () => {
    expect(projectDrop(rows, 'i2', PROJECTS_HEAD, 44)).toEqual({
      parentId: null, section: 'projects', depth: 0, beforeId: 'p', label: 'Level 1 · goes to the top of Projects',
    })
  })

  it('a Projects leaf dropped on it goes to the end of Inbox', () => {
    expect(projectDrop(rows, 'x', PROJECTS_HEAD, 22)).toEqual({
      parentId: null, section: 'inbox', depth: 0, afterId: 'i2', label: "Level 1 · becomes a sibling of 'i2'",
    })
  })

  it('a parent dropped on it gives null: Inbox is flat', () => {
    expect(projectDrop(rows, 'r', PROJECTS_HEAD, 0)).toBeNull()
  })

  it('reaches an empty Inbox', () => {
    expect(projectDrop(flatten({ ...view, inbox: [] }), 'x', PROJECTS_HEAD, 0)).toEqual({
      parentId: null, section: 'inbox', depth: 0, label: 'Level 1 · goes to the top of Inbox',
    })
  })

  it('reaches an empty Projects', () => {
    expect(projectDrop(flatten({ ...view, projects: [] }), 'i1', PROJECTS_HEAD, 22)).toEqual({
      parentId: null, section: 'projects', depth: 0, label: 'Level 1 · goes to the top of Projects',
    })
  })
})

describe('a parent whose subtasks are all hidden', () => {
  // Closed long ago, so not in the recent view; the counts still show them.
  const hidden = flatten({
    today: '2026-11-09',
    inbox: [node('i1', [], { section: 'inbox' })],
    projects: [node('h', [], { totalCount: 1, doneCount: 1 })],
    hiddenCompletedCount: 1,
  })

  it('still cannot go into Inbox', () => {
    expect(projectDrop(hidden, 'h', 'i1', 0)).toBeNull()
    expect(projectDrop(hidden, 'h', PROJECTS_HEAD, 0)).toBeNull()
  })
})

describe('isUnchanged', () => {
  it('is true only for the same parent after the same sibling', () => {
    expect(isUnchanged(rows, 'r', projectDrop(rows, 'r', 'r', 0)!)).toBe(true)
    expect(isUnchanged(rows, 'p', projectDrop(rows, 'p', 'p', 0)!)).toBe(true)
    expect(isUnchanged(rows, 'r', projectDrop(rows, 'r', 'r', 22)!)).toBe(false)
    expect(isUnchanged(rows, 'x', projectDrop(rows, 'x', 'q', 0)!)).toBe(false)
  })
})

describe('projectDayDrop', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('places the task after or before the row it is over', () => {
    expect(projectDayDrop(ids, 'a', 'c', 'after')).toEqual({ afterId: 'c' })
    expect(projectDayDrop(ids, 'd', 'b', 'before')).toEqual({ beforeId: 'b' })
    expect(projectDayDrop(ids, 'z', 'b', 'before')).toEqual({ beforeId: 'b' })
  })

  it('with no row under the pointer it goes to the end', () => {
    expect(projectDayDrop(ids, 'z', null, 'after')).toEqual({ afterId: 'd' })
    expect(projectDayDrop(ids, 'b', null, 'after')).toEqual({ afterId: 'd' })
    expect(projectDayDrop([], 'z', null, 'after')).toEqual({})
  })

  it('gives null when the order would not change', () => {
    expect(projectDayDrop(ids, 'b', 'b', 'after')).toBeNull()
    expect(projectDayDrop(ids, 'b', 'c', 'before')).toBeNull()
    expect(projectDayDrop(ids, 'b', 'a', 'after')).toBeNull()
    expect(projectDayDrop(ids, 'd', null, 'after')).toBeNull()
  })
})
