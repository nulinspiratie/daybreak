// @vitest-environment happy-dom
import type { Task, TreeNode } from '@daybreak/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { queue, useDrainInvalidation } from '../src/api/hooks'
import { DetailPanel } from '../src/detail/DetailPanel'
import { useKeyboard } from '../src/keyboard/useKeyboard'
import { ConfirmLive } from '../src/shell/ConfirmNote'
import { resetPendingIds } from '../src/tree/optimistic'
import { TreePane } from '../src/tree/TreePane'
import { useUi } from '../src/ui/store'
import { type FakeApi, node } from './helpers'

const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})
const fake = () => shared.fake!

const TODAY = '2026-11-09'
let inbox: TreeNode[]
let projects: TreeNode[]

function Harness() {
  useDrainInvalidation()
  useKeyboard()
  return (
    <>
      <TreePane />
      <DetailPanel />
      <ConfirmLive />
    </>
  )
}

const ui = () => useUi.getState()
const writes = () => fake().calls.filter((c) => c[0] !== 'GET')
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
  })
}

async function start(
  detailId: string | null,
  tasks: { inbox?: TreeNode[]; projects?: TreeNode[] },
) {
  inbox = tasks.inbox ?? []
  projects = tasks.projects ?? []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await flush()
  act(() => ui().set({ detailId, treeSel: detailId, pane: 'tree' }))
  await flush()
}

beforeEach(() => {
  resetPendingIds()
  fake().calls.length = 0
  fake().reply = async (method, path) => {
    if (method === 'GET' && path === '/api/status')
      return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (method === 'GET' && path.startsWith('/api/day/'))
      return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
    if (method === 'GET' && path.startsWith('/api/tree'))
      return { today: TODAY, inbox, projects, hiddenCompletedCount: 0 }
    return {}
  }
  useUi.getState().set({
    pane: 'tree',
    treeSel: null,
    daySel: null,
    editing: null,
    draft: null,
    confirm: null,
    detailId: null,
    picker: null,
  })
})
afterEach(async () => {
  await act(async () => {
    await queue.idle()
  })
  cleanup()
})

const panel = () => screen.getByRole('region', { name: 'Task detail' })
const kid = (id: string, over: Partial<Task> = {}) =>
  node(id, [], { title: `Kid ${id}`, parentId: 'p', ...over })
const parent = (over: Partial<Task> = {}) =>
  node('p', [kid('k1'), kid('k2', { status: 'done' })], {
    title: 'Parent',
    notes: 'Some **notes**',
    ...over,
  })

describe('status segments', () => {
  it('Done on a parent goes through the same confirm flow as Space', async () => {
    fake().reply = async (method, path, body) => {
      if (method === 'GET' && path === '/api/status')
        return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
      if (method === 'GET' && path.startsWith('/api/day/'))
        return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
      if (method === 'GET') return { today: TODAY, inbox, projects, hiddenCompletedCount: 0 }
      const b = body as { withOpenDescendants?: boolean } | undefined
      if (method === 'PATCH' && !b?.withOpenDescendants)
        throw new ApiError(409, 'needs_confirmation', 'x', { openCount: 1 })
      return { changedIds: ['p', 'k1'] }
    }
    await start('p', { projects: [parent()] })
    const done = () => within(panel()).getByRole('button', { name: 'Done Space' })
    fireEvent.click(done())
    await flush()
    expect(ui().confirm).toMatchObject({ id: 'p', status: 'done', openCount: 1 })
    expect(
      screen.getAllByText('1 open subtask. Press Space again to close them all.').length,
    ).toBeGreaterThan(0)
    fireEvent.click(done())
    await flush()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/p', { status: 'done' }],
      ['PATCH', '/api/tasks/p', { status: 'done', withOpenDescendants: true }],
    ])
    expect(ui().confirm).toBeNull()
  })

  it('Doing and Worked on use mark', async () => {
    await start('p', { projects: [parent({ children: [] } as never)] })
    const seg = (name: RegExp) => within(panel()).getByRole('button', { name })
    fireEvent.click(seg(/^Doing/))
    await flush()
    fireEvent.click(seg(/^Worked on/))
    await flush()
    expect(writes()).toEqual([
      ['POST', '/api/tasks/p/mark', { mark: 'doing' }],
      ['POST', '/api/tasks/p/mark', { mark: 'worked' }],
    ])
  })

  it('shows the mark and status as the pressed segment; Open clears a mark or reopens; marks are disabled on a closed task', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent', mark: 'doing' })] })
    const pressed = () =>
      within(panel())
        .getAllByRole('button', { pressed: true })
        .map((b) => b.textContent)
    expect(pressed().some((t) => t?.startsWith('Doing'))).toBe(true)
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open' }))
    await flush()
    expect(writes()).toEqual([['POST', '/api/tasks/p/mark', { mark: null }]])
    cleanup()
    fake().calls.length = 0
    await start('p', { projects: [node('p', [], { title: 'Parent', status: 'done' })] })
    expect(
      (within(panel()).getByRole('button', { name: /^Doing/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open' }))
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/p', { status: 'open' }]])
  })
})

describe('scheduling', () => {
  it('Today, Tomorrow and No day schedule directly; Pick a day opens the picker with No day', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent', scheduledOn: '2026-11-12' })] })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Today' }))
    await flush()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Tomorrow' }))
    await flush()
    fireEvent.click(within(panel()).getByRole('button', { name: 'No day' }))
    await flush()
    expect(writes()).toEqual([
      ['POST', '/api/tasks/p/schedule', { date: TODAY }],
      ['POST', '/api/tasks/p/schedule', { date: '2026-11-10' }],
      ['POST', '/api/tasks/p/schedule', { date: null }],
    ])
    fireEvent.click(within(panel()).getByRole('button', { name: 'Thu 12 Nov' }))
    expect(ui().picker).toEqual({ taskId: 'p', allowNoDay: true })
  })
})

describe('segments', () => {
  it('clicking the segment that shows the state does nothing', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent', mark: 'doing' })] })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Doing S' }))
    await flush()
    expect(writes()).toEqual([])
    cleanup()
    await start('p', { projects: [node('p', [], { title: 'Parent', status: 'done' })] })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Done Space' }))
    await flush()
    expect(writes()).toEqual([])
    // the checkbox still toggles
    fireEvent.click(within(panel()).getByRole('button', { name: 'Done, untick' }))
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/p', { status: 'open' }]])
  })

  it('Pick a day shows a day other than today and tomorrow', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent', scheduledOn: '2026-11-10' })] })
    expect(
      within(panel()).getByRole('button', { name: 'Tomorrow' }).getAttribute('aria-pressed'),
    ).toBe('true')
    cleanup()
    await start('p', { projects: [node('p', [], { title: 'Parent', scheduledOn: '2026-11-17' })] })
    expect(
      within(panel()).getByRole('button', { name: 'Tue 17 Nov' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })
})

describe('keys act on the shown task (R35)', () => {
  const hiddenTree = () => {
    const hidden = node('h', [], { title: 'Hidden', parentId: 'c' })
    return { projects: [node('c', [hidden], { title: 'Collapsed', collapsed: true })] }
  }
  async function showHidden() {
    await start(null, hiddenTree())
    act(() => ui().set({ treeSel: 'c' }))
    act(() => ui().set({ detailId: 'h' }))
    await flush()
  }

  it('Space, X, S and D act on the hidden task, not the tree selection', async () => {
    await showHidden()
    await press(' ')
    await press('x')
    await press('s')
    await press('d')
    await flush()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/h', { status: 'done' }],
      ['PATCH', '/api/tasks/h', { status: 'cancelled' }],
      ['POST', '/api/tasks/h/mark', { mark: 'doing' }],
    ])
    expect(ui().picker).toEqual({ taskId: 'h', allowNoDay: true })
    expect(ui().treeSel).toBe('c')
  })

  it('Del deletes the shown task and keeps the tree selection', async () => {
    fake().reply = async (method, path) => {
      if (method === 'DELETE') return { deletedIds: ['h'] }
      if (method === 'GET' && path === '/api/status')
        return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
      if (method === 'GET' && path.startsWith('/api/day/'))
        return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
      if (method === 'GET') return { today: TODAY, inbox, projects, hiddenCompletedCount: 0 }
      return {}
    }
    await showHidden()
    await press('Delete')
    await flush()
    expect(writes()).toEqual([['DELETE', '/api/tasks/h', undefined]])
    expect(ui().treeSel).toBe('c')
    expect(ui().detailId).toBeNull()
  })
})

describe('editing fields', () => {
  it('typing "s" in the notes textarea does not mark Doing', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent' })] })
    fireEvent.click(screen.getByText('Add notes — **bold**, - lists and `code` work.'))
    const area = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    area.focus()
    await press('s')
    await press('w')
    await press(' ')
    await press('x')
    await flush()
    expect(writes()).toEqual([])
  })

  it('notes: Ctrl+Enter saves only when changed; Esc saves and leaves, the second Esc closes', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent', notes: 'old' })] })
    fireEvent.click(screen.getByText('old'))
    let area = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true })
    await flush()
    expect(writes()).toEqual([])
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull()

    fireEvent.click(screen.getByText('old'))
    area = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: '**new**\n\n- a' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/p', { notes: '**new**\n\n- a' }]])
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull()
    expect(ui().detailId).toBe('p')
    await press('Escape')
    expect(ui().detailId).toBeNull()
  })

  it('Ctrl+O opens the panel, a second Ctrl+O edits the notes, Esc saves and returns to the tree, a second Esc closes', async () => {
    await start(null, { projects: [node('p', [], { title: 'Parent', notes: 'old' })] })
    act(() => ui().set({ treeSel: 'p' }))
    await press('o', { ctrlKey: true })
    expect(ui().detailId).toBe('p')
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull()
    await press('o', { ctrlKey: true })
    const area = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    expect(document.activeElement).toBe(area)
    // Keys typed in the notes never reach the tree.
    for (const key of ['t', 'd', 'Tab', ' ', 'Delete', 'ArrowDown']) await press(key)
    expect(ui().treeSel).toBe('p')
    fireEvent.change(area, { target: { value: 'old and new' } })
    await press('Escape')
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/p', { notes: 'old and new' }]])
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(ui().detailId).toBe('p')
    await press('Escape')
    expect(ui().detailId).toBeNull()
  })

  describe.each([
    ['another row', 'q'],
    ['nothing', null],
  ])('opened from My Day for a task under a collapsed parent, tree selection on %s', (_name, sel) => {
    it("a second Ctrl+O edits that task's notes", async () => {
      const kid = node('c', [], { title: 'Kid', notes: 'kid notes' })
      await start(null, {
        projects: [
          node('p', [kid], { title: 'Parent', collapsed: true }),
          node('q', [], { title: 'Other' }),
        ],
      })
      act(() => ui().set({ pane: 'tree', treeSel: sel }))
      await flush()
      act(() => ui().set({ detailId: 'c' })) // as Ctrl+O from My Day leaves it: the tree selection did not follow
      await flush()
      await press('o', { ctrlKey: true })
      expect(ui().detailId).toBe('c')
      expect(ui().treeSel).toBe(sel)
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Notes' }))
    })
  })

  it('title: saves on Enter only when changed, reverts when empty, Esc reverts and blurs', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent' })] })
    const input = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    input().focus()
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    expect(writes()).toEqual([])

    fireEvent.change(input(), { target: { value: '   ' } })
    fireEvent.blur(input())
    await flush()
    expect(writes()).toEqual([])
    expect(input().value).toBe('Parent')

    fireEvent.change(input(), { target: { value: 'Renamed' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    expect(writes()).toEqual([['PATCH', '/api/tasks/p', { title: 'Renamed' }]])

    input().focus()
    fireEvent.change(input(), { target: { value: 'Discard me' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    await flush()
    expect(input().value).toBe('Renamed')
    expect(document.activeElement).not.toBe(input())
    expect(writes()).toHaveLength(1)
    expect(ui().detailId).toBe('p')
  })

  it('link: saves on Enter, Open is disabled while empty and calls open-link', async () => {
    await start('p', { projects: [node('p', [], { title: 'Parent' })] })
    const link = screen.getByPlaceholderText('Paste a file, folder or URL') as HTMLInputElement
    const open = screen.getByRole('button', { name: 'Open link' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    fireEvent.change(link, { target: { value: ' C:\\docs ' } })
    expect(open.disabled).toBe(false)
    fireEvent.keyDown(link, { key: 'Enter' })
    await flush()
    fireEvent.click(open)
    await flush()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/p', { link: 'C:\\docs' }],
      ['POST', '/api/tasks/p/open-link', undefined],
    ])
  })

  it('a click on a notes link goes through open-link, not a window', async () => {
    await start('p', {
      projects: [node('p', [], { title: 'Parent', notes: '[d](https://example.com)' })],
    })
    fireEvent.click(screen.getByRole('link', { name: 'd' }))
    await flush()
    expect(writes()).toEqual([['POST', '/api/open-link', { target: 'https://example.com' }]])
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull()
  })
})

describe('following and closing', () => {
  it('follows the tree selection', async () => {
    await start('a', {
      projects: [node('a', [], { title: 'Alpha' }), node('b', [], { title: 'Beta' })],
    })
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Alpha')
    act(() => ui().set({ treeSel: 'b' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Beta')
  })

  it('keeps showing a task hidden under a collapsed ancestor and leaves the selection alone', async () => {
    const hidden = node('h', [], { title: 'Hidden', parentId: 'c' })
    await start(null, { projects: [node('c', [hidden], { title: 'Collapsed', collapsed: true })] })
    act(() => ui().set({ treeSel: 'c' }))
    act(() => ui().set({ detailId: 'h' }))
    await flush()
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Hidden')
    expect(ui().treeSel).toBe('c')
  })

  it('closes when the task is gone', async () => {
    await start('a', { projects: [node('a', [], { title: 'Alpha' })] })
    projects = []
    act(() => ui().set({ detailId: 'zzz' }))
    await flush()
    expect(ui().detailId).toBeNull()
  })

  it('subtasks: lists N of M done; the title selects, the checkbox toggles', async () => {
    await start('p', { projects: [parent()] })
    expect(within(panel()).getByText('Subtasks · 1 of 2 done')).toBeTruthy()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Kid k1' }))
    await flush()
    expect(ui().detailId).toBe('k1')
    expect(ui().treeSel).toBe('k1')
    act(() => ui().set({ detailId: 'p', treeSel: 'p' }))
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Tick off' }).at(-1)!)
    await flush()
    expect(writes()).toContainEqual(['PATCH', '/api/tasks/k1', { status: 'done' }])
  })
})
