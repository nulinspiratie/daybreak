// @vitest-environment happy-dom
import type { TreeNode } from '@daybreak/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlatRow } from '../src/tree/flatten'
import { TreeRow } from '../src/tree/TreeRow'
import { node } from './helpers'

afterEach(cleanup)

const TODAY = '2026-11-09'

function row(
  over: Partial<TreeNode> = {},
  depth = 0,
  section: FlatRow['section'] = 'inbox',
): FlatRow {
  const n = node('t1', [], { section, ...over })
  return { id: n.id, node: n, depth, section, parentId: null, hasChildren: n.children.length > 0 }
}

const noop = () => {}
function show(r: FlatRow, selected = false, handlers: Partial<Parameters<typeof TreeRow>[0]> = {}) {
  return render(
    <TreeRow
      row={r}
      today={TODAY}
      selected={selected}
      onSelect={noop}
      onToggleCollapse={noop}
      onToggleDone={noop}
      onScheduleToday={noop}
      onDoing={noop}
      onPickDay={noop}
      {...handlers}
    />,
  )
}
const item = () => screen.getByRole('treeitem')
const title = () => screen.getByText('t1')

describe('TreeRow', () => {
  it('shows the day label with its colour class and fade', () => {
    const { unmount } = show(row({ scheduledOn: '2026-11-06' }))
    expect(screen.getByTestId('day-cell').textContent).toBe('6 Nov')
    expect(screen.getByTestId('day-cell').className).toContain('day--overdue')
    unmount()
    show(row({ scheduledOn: TODAY }))
    expect(screen.getByTestId('day-cell').textContent).toBe('Today')
    expect(screen.getByTestId('day-cell').className).toContain('day--today')
  })

  it('later days carry the fade as a CSS variable', () => {
    show(row({ scheduledOn: '2026-11-20' }))
    const cell = screen.getByTestId('day-cell')
    expect(cell.textContent).toBe('20 Nov')
    expect(cell.className).toContain('day--later')
    expect(Number(cell.style.getPropertyValue('--fade'))).toBeCloseTo(10 / 13, 5)
  })

  it('has no day text for done or cancelled tasks, or unscheduled ones', () => {
    const { unmount } = show(row({ scheduledOn: TODAY, status: 'done' }))
    expect(screen.getByTestId('day-cell').textContent).toBe('')
    unmount()
    show(row({}))
    expect(screen.getByTestId('day-cell').textContent).toBe('')
  })

  it('Doing: doing fill, semibold title, 2px blue box', () => {
    show(row({ mark: 'doing' }))
    expect(item().className).toContain('row--doing')
    expect(title().className).toContain('row__title--strong')
    expect(screen.getByRole('button', { name: 'Doing now, tick off' }).className).toContain(
      'cb--doing',
    )
  })

  it('Done: struck through, filled checkbox', () => {
    show(row({ status: 'done' }))
    expect(title().className).toContain('row__title--struck')
    expect(screen.getByRole('button', { name: /done/i }).className).toContain('cb--done')
  })

  it('Cancelled: × in the box and struck through', () => {
    show(row({ status: 'cancelled' }))
    expect(title().className).toContain('row__title--struck')
    const cb = screen.getByRole('button', { name: /cancelled/i })
    expect(cb.className).toContain('cb--cancelled')
    expect(cb.querySelector('svg[data-icon="cross"]')).not.toBeNull()
  })

  it('Worked on: half-filled orange mark, task still open', () => {
    show(row({ mark: 'worked' }))
    expect(item().className).not.toContain('row--doing')
    const mark = screen.getByTestId('worked-mark')
    expect(mark.querySelector('path[fill="currentColor"]')).not.toBeNull()
    expect(mark.querySelector('circle')?.getAttribute('fill')).toBe('none')
    expect(title().className).not.toContain('struck')
  })

  it('a collapsed parent shows done/total and aria-expanded=false', () => {
    const r = row({ collapsed: true, doneCount: 2, totalCount: 5, children: [node('c')] })
    show(r)
    expect(screen.getByText('2/5')).toBeTruthy()
    expect(item().getAttribute('aria-expanded')).toBe('false')
  })

  it('an expanded parent shows no count', () => {
    show(row({ collapsed: false, doneCount: 2, totalCount: 5, children: [node('c')] }))
    expect(screen.queryByText('2/5')).toBeNull()
    expect(item().getAttribute('aria-expanded')).toBe('true')
  })

  it('selected: accent ring class, no doing fill', () => {
    show(row(), true)
    expect(item().className).toContain('row--selected')
    expect(item().className).not.toContain('row--doing')
    expect(item().getAttribute('aria-selected')).toBe('true')
  })

  it('exposes level, and top-level projects are semibold', () => {
    show(row({}, 0, 'projects'))
    expect(item().getAttribute('aria-level')).toBe('1')
    expect(title().className).toContain('row__title--strong')
  })

  it('shows note and link icons only when present', () => {
    const { unmount } = show(row())
    expect(screen.queryByLabelText('Has notes')).toBeNull()
    expect(screen.queryByLabelText('Has a link')).toBeNull()
    unmount()
    show(row({ notes: 'x', link: 'https://example.com' }))
    expect(screen.getByLabelText('Has notes')).toBeTruthy()
    expect(screen.getByLabelText('Has a link')).toBeTruthy()
  })

  it('quick actions S, T, D are labelled; closed rows have none', () => {
    const onScheduleToday = vi.fn()
    const onDoing = vi.fn()
    const onPickDay = vi.fn()
    const { unmount } = show(row(), false, { onScheduleToday, onDoing, onPickDay })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule for today (T)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Doing now (S)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick a day (D)' }))
    expect(onScheduleToday).toHaveBeenCalledWith('t1')
    expect(onDoing).toHaveBeenCalledWith('t1')
    expect(onPickDay).toHaveBeenCalledWith('t1')
    unmount()
    show(row({ status: 'done' }))
    expect(screen.queryByRole('button', { name: /\(T\)/ })).toBeNull()
  })

  it('click selects the row; the checkbox calls onToggleDone, not onSelect twice', () => {
    const onSelect = vi.fn()
    const onToggleDone = vi.fn()
    show(row(), false, { onSelect, onToggleDone })
    fireEvent.click(item())
    expect(onSelect).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getByRole('button', { name: 'Tick off' }))
    expect(onToggleDone).toHaveBeenCalledWith('t1')
  })

  it('only Done rows are dimmed; Cancelled is struck in the muted colour', () => {
    const { unmount } = show(row({ status: 'done' }))
    expect(item().className).toContain('row--done')
    unmount()
    show(row({ status: 'cancelled' }))
    expect(item().className).not.toContain('row--done')
    expect(title().className).toContain('row__title--cancelled')
  })

  it('the treeitem is labelled by its title', () => {
    show(row())
    expect(item().getAttribute('aria-labelledby')).toBe(title().id)
    expect(screen.getByRole('treeitem', { name: 't1' })).toBeTruthy()
  })

  it('row controls let go of focus after a mouse click, so Space and Enter reach the selected row', () => {
    show(row({ children: [node('c')] }))
    const controls = [
      screen.getByRole('button', { name: 'Tick off' }),
      screen.getByRole('button', { name: 'Collapse' }),
      screen.getByRole('button', { name: 'Doing now (S)' }),
      screen.getByRole('button', { name: 'Schedule for today (T)' }),
      screen.getByRole('button', { name: 'Pick a day (D)' }),
    ]
    for (const b of controls) {
      b.focus()
      fireEvent.click(b, { detail: 1 }) // a mouse click
      expect(document.activeElement).not.toBe(b)
      b.focus()
      fireEvent.click(b, { detail: 0 }) // keyboard activation of a tabbed-to button
      expect(document.activeElement).toBe(b)
    }
  })

  it('points aria-describedby at the confirm note when it shows', () => {
    const { unmount } = show(row())
    expect(item().getAttribute('aria-describedby')).toBeNull()
    unmount()
    show(row(), true, { describedBy: 'confirm-note' })
    expect(item().getAttribute('aria-describedby')).toBe('confirm-note')
  })
})
