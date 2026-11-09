// @vitest-environment happy-dom
import type { Section, TreeNode, TreeView } from '@daybreak/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client'
import { queue, useDrainInvalidation, useLiveUpdates } from '../src/api/hooks'
import { IS_MAC } from '../src/keyboard/platform'
import { useKeyboard } from '../src/keyboard/useKeyboard'
import { Toast } from '../src/shell/Toast'
import { toast } from '../src/shell/toastStore'
import { resetPendingIds } from '../src/tree/optimistic'
import { TreePane } from '../src/tree/TreePane'
import { useUi } from '../src/ui/store'
import { type FakeApi, node } from './helpers'

// Components import `api` directly, so the module is swapped for the shared fake api.
const shared = vi.hoisted(() => ({ fake: null as FakeApi | null }))
vi.mock('../src/api/client', async (importOriginal) => {
  const { createFakeApi } = await import('./helpers')
  shared.fake = createFakeApi()
  return { ...(await importOriginal<typeof import('../src/api/client')>()), api: shared.fake.api }
})
const fake = () => shared.fake!

// The SSE feed is replaced by a handle the test fires, as the server would after each write.
const sse = vi.hoisted(() => ({ changed: () => {} }))
vi.mock('../src/api/sse', () => ({
  connectEvents: (onChanged: () => void) => {
    sse.changed = onChanged
    return () => {}
  },
}))

const TODAY = '2026-11-09'

// A small in-memory server: sibling order is array order, as the real one keeps by position.
interface Row {
  id: string
  parentId: string | null
  section: Section
  title: string
  collapsed: boolean
  deleted: boolean
}
let db: Row[]
let seq: number
/** While set, writes wait for it, so a test can type faster than the server answers. */
let gate: Promise<void> | null
/** Opens every gate a test left shut, so a failed test can't hang the next one. */
let releasers: Array<() => void> = []

const normalizeTitle = (raw: string) => raw.replace(/[\r\n\t]+/g, ' ').trim()
const live = () => db.filter((r) => !r.deleted)
const siblings = (parentId: string | null, section: Section) =>
  live().filter((r) => r.parentId === parentId && r.section === section)
const get = (id: string) => {
  const r = live().find((t) => t.id === id)
  if (!r) throw new ApiError(404, 'not_found', `#${id} not found`)
  return r
}
const toNode = (r: Row): TreeNode =>
  node(r.id, kids(r.id, r.section), { parentId: r.parentId, section: r.section, title: r.title, collapsed: r.collapsed })
const kids = (parentId: string | null, section: Section): TreeNode[] => siblings(parentId, section).map(toNode)
const view = (): TreeView => ({ today: TODAY, inbox: kids(null, 'inbox'), projects: kids(null, 'projects'), hiddenCompletedCount: 0 })
const titlesUnder = (parentId: string | null, section: Section = 'projects') => siblings(parentId, section).map((r) => r.title)
const idOf = (title: string) => live().find((r) => r.title === title)!.id
const subtree = (id: string): Row[] => [get(id), ...live().filter((r) => r.parentId === id).flatMap((r) => subtree(r.id))]

function place(row: Row, at: { afterId?: string; beforeId?: string }): void {
  const sibs = siblings(row.parentId, row.section)
  const anchor = at.afterId ?? at.beforeId
  if (anchor === undefined) return void db.push(row)
  const i = sibs.findIndex((s) => s.id === anchor)
  if (i < 0) throw new ApiError(400, 'invalid', `#${anchor} is not among the siblings`)
  db.splice(db.indexOf(sibs[i]!) + (at.afterId !== undefined ? 1 : 0), 0, row)
}

function serve(method: string, path: string, body: Record<string, unknown> = {}): unknown {
  if (method === 'GET') {
    if (path === '/api/status') return { today: TODAY, needsReview: false, dayStartsAt: '04:00' }
    if (path.startsWith('/api/tree')) return view()
    if (path.startsWith('/api/day/')) return { date: TODAY, items: [], doneCount: 0, totalCount: 0 }
  }
  if (method === 'POST' && path === '/api/tasks') {
    const title = normalizeTitle(body.title as string)
    if (title === '') throw new ApiError(400, 'invalid', 'Title cannot be empty')
    const row: Row = {
      id: `n${++seq}`, parentId: (body.parentId as string | undefined) ?? null, section: body.section as Section,
      title, collapsed: false, deleted: false,
    }
    if (row.parentId !== null) get(row.parentId)
    place(row, body as { afterId?: string; beforeId?: string })
    return toNode(row)
  }
  const [, , , id, action] = path.split('/')
  if (method === 'POST' && action === 'restore') {
    const root = db.find((r) => r.id === id)
    if (!root) throw new ApiError(404, 'not_found', `#${id} not found`)
    const back = (r: Row): void => {
      r.deleted = false
      for (const k of db.filter((t) => t.parentId === r.id)) back(k)
    }
    back(root)
    return toNode(root)
  }
  const row = get(id!)
  if (method === 'PATCH') {
    if (body.title !== undefined) {
      const title = normalizeTitle(body.title as string)
      if (title === '') throw new ApiError(400, 'invalid', 'Title cannot be empty')
      row.title = title
    }
    if (body.collapsed !== undefined) row.collapsed = body.collapsed as boolean
    if (body.status !== undefined) return { changedIds: [row.id] }
    return toNode(row)
  }
  if (method === 'DELETE') {
    const gone = subtree(row.id)
    for (const r of gone) r.deleted = true
    return { deletedIds: gone.map((r) => r.id) }
  }
  if (method === 'POST' && action === 'nudge') {
    const sibs = siblings(row.parentId, row.section)
    const i = sibs.indexOf(row)
    const was = db.indexOf(row)
    db.splice(was, 1)
    if (body.direction === 'indent' && i > 0 && row.section === 'projects') {
      row.parentId = sibs[i - 1]!.id
      db.push(row)
    } else if (body.direction === 'outdent' && row.parentId !== null) {
      const parent = get(row.parentId)
      row.parentId = parent.parentId
      db.splice(db.indexOf(parent) + 1, 0, row)
    } else if (body.direction === 'down' && sibs[i + 1]) {
      db.splice(db.indexOf(sibs[i + 1]!) + 1, 0, row)
    } else if (body.direction === 'up' && i > 0) {
      db.splice(db.indexOf(sibs[i - 1]!), 0, row)
    } else {
      db.splice(was, 0, row) // nothing to do: put it back
    }
    return toNode(row)
  }
  throw new Error(`fake server: no route for ${method} ${path}`)
}

function Harness() {
  useDrainInvalidation()
  useLiveUpdates()
  useKeyboard()
  return (
    <>
      <TreePane />
      <Toast />
    </>
  )
}

const ui = () => useUi.getState()
const writes = () => fake().calls.filter((c) => c[0] !== 'GET')
const editor = () => screen.getByRole('textbox') as HTMLInputElement
const noEditor = () => expect(screen.queryByRole('textbox')).toBeNull()
const MOD = IS_MAC ? { altKey: true } : { ctrlKey: true }

/** A key press on the focused element (or the body), with React and pending microtasks flushed. */
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
  })
}
async function type(text: string) {
  await act(async () => {
    fireEvent.change(editor(), { target: { value: text } })
  })
}
/** Holds every write until the returned function is called. */
function hold(): () => void {
  let answer = () => {}
  gate = new Promise((r) => {
    answer = r
  })
  releasers.push(answer)
  return () => {
    gate = null
    answer()
  }
}
/** Lets queued writes that are not held run, and React catch up. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}
/** Waits until every write has been answered and the tree has refetched. */
async function settle() {
  await act(async () => {
    await queue.idle()
  })
  await waitFor(() => expect(fake().calls.at(-1)?.[0]).toBe('GET'))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

let client: QueryClient

async function start(selected: string | null) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  await screen.findByText('Child one')
  act(() => ui().set({ pane: 'tree', treeSel: selected }))
}

beforeEach(() => {
  // Inbox: i1. Projects: p1 [c1, c2], p2.
  db = [
    { id: 'i1', parentId: null, section: 'inbox', title: 'Inbox one', collapsed: false, deleted: false },
    { id: 'p1', parentId: null, section: 'projects', title: 'Project one', collapsed: false, deleted: false },
    { id: 'c1', parentId: 'p1', section: 'projects', title: 'Child one', collapsed: false, deleted: false },
    { id: 'c2', parentId: 'p1', section: 'projects', title: 'Child two', collapsed: false, deleted: false },
    { id: 'p2', parentId: null, section: 'projects', title: 'Project two', collapsed: false, deleted: false },
  ]
  seq = 0
  gate = null
  resetPendingIds()
  fake().calls.length = 0
  fake().reply = async (method, path, body) => {
    if (method !== 'GET' && gate) await gate
    return serve(method, path, body as Record<string, unknown>)
  }
  useUi.getState().set({ pane: 'tree', treeSel: null, daySel: null, editing: null, draft: null, confirm: null, detailId: null })
  toast.dismiss()
})
afterEach(async () => {
  for (const r of releasers) r()
  releasers = []
  gate = null
  await act(async () => {
    await queue.idle()
  })
  cleanup()
})

describe('drafts', () => {
  it('typing a list: N, "a", Enter, "b", Enter, Enter creates two tasks in order and ends with "b" selected', async () => {
    await start('c1')
    await press('n')
    expect(editor().placeholder).toBe('New task')
    await type('a')
    await press('Enter')
    await type('b')
    await press('Enter')
    expect(editor().value).toBe('')
    await press('Enter')
    await settle()

    expect(writes()).toEqual([
      ['POST', '/api/tasks', { title: 'a', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'b', section: 'projects', parentId: 'p1', afterId: idOf('a') }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child one', 'a', 'b', 'Child two'])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, draft: null, treeSel: idOf('b') })
    expect(screen.getAllByRole('treeitem').map((r) => r.textContent)).toEqual(
      expect.arrayContaining(['Child one', 'a', 'b', 'Child two'].map((t) => expect.stringContaining(t))),
    )
  })

  it('typed faster than the server answers, the list keeps its order and selection moves to the real id', async () => {
    await start('c1')
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    await type('b')
    await press('Enter')
    await press('Enter')
    // Nothing has been answered yet; "b" is selected under a placeholder id until it exists.
    expect(writes()).toHaveLength(1)
    expect(ui().treeSel).not.toBeNull()
    expect(screen.getByText('b')).toBeTruthy()
    answer()
    await settle()

    const a = idOf('a')
    expect(writes()).toEqual([
      ['POST', '/api/tasks', { title: 'a', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'b', section: 'projects', parentId: 'p1', afterId: a }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child one', 'a', 'b', 'Child two'])
    expect(ui().treeSel).toBe(idOf('b'))
  })

  it('Tab while typing a draft nests it under the previous sibling', async () => {
    await start('c1')
    await press('n')
    await press('Tab')
    expect(ui().draft).toMatchObject({ parentId: 'c1', section: 'projects' })
    expect(editor().closest('[role=treeitem]')!.getAttribute('aria-level')).toBe('3')
    await type('nested')
    await press('Enter')
    await press('Escape')
    await settle()

    expect(writes()).toEqual([['POST', '/api/tasks', { title: 'nested', section: 'projects', parentId: 'c1' }]])
    expect(titlesUnder('c1')).toEqual(['nested'])
  })

  it('Tab and Shift+Tab keep the text already typed in a draft', async () => {
    await start('c1')
    await press('n')
    await type('Design')
    await press('Tab')
    expect(ui().draft).toMatchObject({ parentId: 'c1', section: 'projects' })
    expect((editor() as HTMLInputElement).value).toBe('Design')
    await press('Tab', { shiftKey: true })
    expect(ui().draft).toMatchObject({ parentId: 'p1', section: 'projects', afterId: 'c1' })
    expect((editor() as HTMLInputElement).value).toBe('Design')
    await press('Escape')
    await settle()
    expect(writes()).toEqual([['POST', '/api/tasks', { title: 'Design', section: 'projects', parentId: 'p1', afterId: 'c1' }]])
  })

  it('Shift+Tab on a draft moves it to the grandparent, after the old parent', async () => {
    await start('c2')
    await press('n')
    await press('Tab', { shiftKey: true })
    expect(ui().draft).toMatchObject({ parentId: null, section: 'projects', afterId: 'p1' })
    await type('sibling')
    await press('Escape')
    await settle()
    expect(writes()).toEqual([['POST', '/api/tasks', { title: 'sibling', section: 'projects', afterId: 'p1' }]])
    expect(titlesUnder(null)).toEqual(['Project one', 'sibling', 'Project two'])
    expect(ui().treeSel).toBe(idOf('sibling'))
  })

  it('Tab on a draft in Inbox does nothing; Mod+↑↓ on a draft is ignored', async () => {
    await start('i1')
    await press('n')
    await press('Tab')
    await press('ArrowDown', MOD)
    await press('ArrowUp', MOD)
    expect(ui().draft).toEqual({ section: 'inbox', parentId: null, afterId: 'i1' })
    expect(ui().editing?.id).toBe('draft')
    expect(writes()).toEqual([])
  })

  it('Esc on an empty draft discards and calls nothing', async () => {
    await start('i1')
    await press('n')
    await press('Escape')
    await settle()
    expect(writes()).toEqual([])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, draft: null, treeSel: 'i1' })
  })

  it('Backspace on an empty draft discards it and edits the row above', async () => {
    await start('c1')
    await press('n')
    await press('Backspace')
    expect(writes()).toEqual([])
    expect(ui()).toMatchObject({ draft: null, editing: { id: 'c1' }, treeSel: 'c1' })
    expect(editor().value).toBe('Child one')
  })

  it('ArrowUp on a draft with text creates it and edits the row above', async () => {
    await start('c1')
    await press('n')
    await type('kept')
    await press('ArrowUp')
    expect(ui()).toMatchObject({ draft: null, editing: { id: 'c1' }, treeSel: 'c1' })
    await press('Escape')
    await settle()
    expect(writes()).toEqual([['POST', '/api/tasks', { title: 'kept', section: 'projects', parentId: 'p1', afterId: 'c1' }]])
    expect(titlesUnder('p1')).toEqual(['Child one', 'kept', 'Child two'])
  })

  it('a pasted multi-line title is sent as typed and rendered as the server returns it', async () => {
    // A real input can't hold a line break (Chromium turns pasted ones into spaces), so the text is
    // set through the store: whatever the editor holds is sent unchanged, and the server cleans it.
    const pasted = '  line one\r\nline two\tthree  '
    await start('i1')
    await press('n')
    act(() => ui().set({ editing: { ...ui().editing!, text: pasted } }))
    await press('Enter')
    await press('Escape')
    await settle()
    expect(writes()).toEqual([['POST', '/api/tasks', { title: pasted, section: 'inbox', afterId: 'i1' }]])
    expect(screen.getByText('line one line two three')).toBeTruthy()
  })

  it('N with nothing selected and the New task button open a draft at the end of Inbox', async () => {
    await start(null)
    await press('n')
    expect(ui().draft).toEqual({ section: 'inbox', parentId: null })
    await press('Escape')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /New task/ }))
    })
    expect(ui().draft).toEqual({ section: 'inbox', parentId: null })
    await type('from the button')
    await press('Escape')
    await settle()
    expect(titlesUnder(null, 'inbox')).toEqual(['Inbox one', 'from the button'])
  })
})

describe('editing a saved title', () => {
  it('ArrowDown in edit saves and edits the next row', async () => {
    await start('c1')
    await press('Enter')
    expect(editor().value).toBe('Child one')
    await type('Child one, renamed')
    await press('ArrowDown')
    expect(ui()).toMatchObject({ editing: { id: 'c2' }, treeSel: 'c2' })
    expect(editor().value).toBe('Child two')
    // Unchanged: moving on sends nothing for c2.
    await press('ArrowUp')
    await settle()
    expect(writes()).toEqual([['PATCH', '/api/tasks/c1', { title: 'Child one, renamed' }]])
    expect(editor().value).toBe('Child one, renamed')
  })

  it('Backspace on an emptied persisted title deletes with toast and edits the row above', async () => {
    await start('c2')
    await press('F2')
    await type('')
    await press('Backspace')
    await settle()
    expect(writes()).toEqual([['DELETE', '/api/tasks/c2', undefined]])
    expect(screen.getByRole('status').textContent).toBe("Deleted 'Child two' · Undo (Z)")
    expect(ui()).toMatchObject({ editing: { id: 'c1' }, treeSel: 'c1' })
    expect(editor().value).toBe('Child one')
  })

  it('Backspace on the first row deletes it and returns to navigate mode', async () => {
    await start('i1')
    await press('Enter')
    await type('')
    await press('Backspace')
    await settle()
    expect(writes()).toEqual([['DELETE', '/api/tasks/i1', undefined]])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, treeSel: 'p1' })
  })

  it('Enter saves, then opens a draft after the task', async () => {
    await start('c1')
    await press('Enter')
    await type('Child one!')
    await press('Enter')
    expect(ui()).toMatchObject({ editing: { id: 'draft' }, draft: { section: 'projects', parentId: 'p1', afterId: 'c1' } })
    await type('after')
    await press('Escape')
    await settle()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/c1', { title: 'Child one!' }],
      ['POST', '/api/tasks', { title: 'after', section: 'projects', parentId: 'p1', afterId: 'c1' }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child one!', 'after', 'Child two'])
  })

  it('Esc saves only when changed and keeps the row selected; an emptied title reverts', async () => {
    await start('c1')
    await press('Enter')
    await press('Escape')
    expect(ui()).toMatchObject({ editing: null, treeSel: 'c1' })
    await press('Enter')
    await type('   ')
    await press('Escape')
    await press('Enter')
    await type('')
    await press('Enter') // empty: reverts, then the draft below
    await press('Escape')
    await settle()
    expect(writes()).toEqual([])
    expect(screen.getByText('Child one')).toBeTruthy()
    expect(ui().treeSel).toBe('c1')
  })

  it('Tab and Shift+Tab save, nudge, and editing continues', async () => {
    await start('c2')
    await press('Enter')
    await type('Child two!')
    await press('Tab')
    await press('Tab', { shiftKey: true })
    await settle()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/c2', { title: 'Child two!' }],
      ['POST', '/api/tasks/c2/nudge', { direction: 'indent' }],
      ['POST', '/api/tasks/c2/nudge', { direction: 'outdent' }],
    ])
    expect(ui().editing?.id).toBe('c2')
    expect(editor().value).toBe('Child two!')
    expect(document.activeElement).toBe(editor())
  })

  it('Mod+↓ saves, moves, and editing continues', async () => {
    await start('c1')
    await press('Enter')
    await type('moved')
    await press('ArrowDown', MOD)
    await settle()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/c1', { title: 'moved' }],
      ['POST', '/api/tasks/c1/nudge', { direction: 'down' }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child two', 'moved'])
    expect(ui().editing?.id).toBe('c1')
    expect(document.activeElement).toBe(editor())
  })

  it('leaving the row saves; a blur the app causes itself does not', async () => {
    await start('c1')
    await press('Enter')
    await type('blurred')
    // Focus lost with no pointer and the window still focused: a re-render moved the row. Keep editing.
    await act(async () => {
      fireEvent.blur(editor())
    })
    expect(ui().editing?.id).toBe('c1')
    // A click elsewhere saves and returns to navigate mode.
    await act(async () => {
      fireEvent.pointerDown(document.body)
      fireEvent.blur(editor())
      fireEvent.pointerUp(document.body)
    })
    await settle()
    expect(writes()).toEqual([['PATCH', '/api/tasks/c1', { title: 'blurred' }]])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, treeSel: 'c1' })
  })
})

describe('while writes are still queued', () => {
  it('Tab on a draft whose predecessor is still pending nests it under that task', async () => {
    await start('c1')
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    await press('Tab')
    expect(editor().closest('[role=treeitem]')!.getAttribute('aria-level')).toBe('3')
    await type('kid')
    await press('Escape')
    answer()
    await settle()
    expect(writes()).toEqual([
      ['POST', '/api/tasks', { title: 'a', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'kid', section: 'projects', parentId: idOf('a') }],
    ])
    expect(titlesUnder(idOf('a'))).toEqual(['kid'])
    expect(ui().treeSel).toBe(idOf('kid'))
  })

  it('a refetch that lands mid-chain does not drop pending rows, so Tab still nests under the right task', async () => {
    await start('c1')
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    await type('b')
    await press('Enter')
    // The server says something changed (another write, another window) before it has answered.
    await act(async () => {
      sse.changed()
      await new Promise((r) => setTimeout(r, 150))
    })
    await act(async () => {
      await client.invalidateQueries()
    })
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    await press('Tab')
    await type('c')
    await press('Escape')
    answer()
    await settle()
    expect(titlesUnder('p1')).toEqual(['Child one', 'a', 'b', 'Child two'])
    expect(titlesUnder(idOf('b'))).toEqual(['c'])
    expect(titlesUnder('c2')).toEqual([])
  })

  it('editing a pending row keeps the same input when it gets its real id, and the answer keeps a newer title', async () => {
    await start('c1')
    let answerPost = () => {}
    let answerPatch = () => {}
    const posted = new Promise<void>((r) => (answerPost = r))
    const patched = new Promise<void>((r) => (answerPatch = r))
    releasers.push(() => answerPost(), () => answerPatch())
    fake().reply = async (method, path, body) => {
      if (method === 'POST' && path === '/api/tasks') await posted
      if (method === 'PATCH') await patched
      return serve(method, path, body as Record<string, unknown>)
    }
    await press('n')
    await type('a')
    await press('Enter')
    await press('ArrowUp') // the empty draft is dropped and the pending "a" is edited
    const input = editor()
    expect(input.value).toBe('a')
    await type('a, renamed')
    await act(async () => {
      answerPost()
    })
    await flush()
    expect(ui().editing?.id).toBe(idOf('a'))
    expect(editor()).toBe(input)
    await press('Escape')
    expect(screen.getByText('a, renamed')).toBeTruthy()
    expect(screen.queryByText('a')).toBeNull()
    answerPatch()
    await settle()
    expect(titlesUnder('p1')).toEqual(['Child one', 'a, renamed', 'Child two'])
  })

  it('undoing the delete of a task created moments ago selects it by its real id', async () => {
    await start('c1')
    const answer = hold()
    await press('n')
    await type('oops')
    await press('Escape')
    await press('Delete')
    answer()
    await settle()
    expect(screen.getByRole('status').textContent).toBe("Deleted 'oops' · Undo (Z)")
    await press('z')
    await settle()
    expect(titlesUnder('p1')).toEqual(['Child one', 'oops', 'Child two'])
    expect(ui().treeSel).toBe(idOf('oops'))
  })
})

describe('a create the server refuses', () => {
  /** Fails the first create with a 400; everything else is served as usual once the gate opens. */
  function failFirstCreate() {
    let failed = false
    fake().reply = async (method, path, body) => {
      if (method !== 'GET' && gate) await gate
      if (method === 'POST' && path === '/api/tasks' && !failed) {
        failed = true
        throw new ApiError(400, 'invalid', 'refused')
      }
      return serve(method, path, body as Record<string, unknown>)
    }
  }

  it('shows a toast, and the creates chained after it still land in order', async () => {
    await start('c1')
    failFirstCreate()
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    await type('b')
    await press('Enter')
    await type('c')
    await press('Enter')
    await press('Enter')
    answer()
    await settle()
    expect(screen.getByRole('status').textContent).toBe("Couldn't save 'a'")
    expect(writes()).toEqual([
      ['POST', '/api/tasks', { title: 'a', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'b', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'c', section: 'projects', parentId: 'p1', afterId: idOf('b') }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child one', 'b', 'c', 'Child two'])
    expect(ui().treeSel).toBe(idOf('c'))
  })

  it('a draft nested under the refused task goes to its parent, and writes naming the refused task are skipped', async () => {
    await start('c1')
    failFirstCreate()
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    await press('Tab')
    await type('kid')
    await press('ArrowUp') // creates "kid", edits the pending "a"
    await type('a2')
    await press('Escape') // queues a rename of "a"
    answer()
    await settle()
    expect(screen.getByRole('status').textContent).toBe("Couldn't save 'a'")
    expect(writes()).toEqual([
      ['POST', '/api/tasks', { title: 'a', section: 'projects', parentId: 'p1', afterId: 'c1' }],
      ['POST', '/api/tasks', { title: 'kid', section: 'projects', parentId: 'p1' }],
    ])
    expect(titlesUnder('p1')).toEqual(['Child one', 'Child two', 'kid'])
    expect(ui()).toMatchObject({ editing: null, treeSel: 'c1' })
  })

  it('a draft still open after the refused task is re-anchored where that task would have gone', async () => {
    await start('c1')
    failFirstCreate()
    const answer = hold()
    await press('n')
    await type('a')
    await press('Enter')
    answer()
    await flush()
    expect(ui().draft).toEqual({ section: 'projects', parentId: 'p1', afterId: 'c1' })
    await type('b')
    await press('Escape')
    await settle()
    expect(titlesUnder('p1')).toEqual(['Child one', 'b', 'Child two'])
  })
})

describe('leaving the editor', () => {
  it("clicking another row's checkbox saves the title once, then ticks that row", async () => {
    await start('c1')
    await press('Enter')
    await type('clicked away')
    const box = within(screen.getByRole('treeitem', { name: 'Child two' })).getByRole('button', { name: 'Tick off' })
    await act(async () => {
      fireEvent.pointerDown(box)
      fireEvent.blur(editor(), { relatedTarget: box })
      fireEvent.pointerUp(box)
      fireEvent.click(box)
    })
    await settle()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/c1', { title: 'clicked away' }],
      ['PATCH', '/api/tasks/c2', { status: 'done' }],
    ])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, treeSel: 'c2' })
  })

  it('the window losing focus commits the draft', async () => {
    await start('c1')
    await press('n')
    await type('quick')
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await act(async () => {
      fireEvent.blur(editor())
    })
    hasFocus.mockRestore()
    await settle()
    expect(writes()).toEqual([['POST', '/api/tasks', { title: 'quick', section: 'projects', parentId: 'p1', afterId: 'c1' }]])
    noEditor()
    expect(ui()).toMatchObject({ editing: null, treeSel: idOf('quick') })
  })

  it('a failed rename before Tab is reported, and the nudge still goes out', async () => {
    await start('c2')
    fake().reply = async (method, path, body) => {
      if (method === 'PATCH') throw new ApiError(500, 'internal', 'disk full')
      return serve(method, path, body as Record<string, unknown>)
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await press('Enter')
    await type('renamed')
    await press('Tab')
    await settle()
    expect(writes()).toEqual([
      ['PATCH', '/api/tasks/c2', { title: 'renamed' }],
      ['POST', '/api/tasks/c2/nudge', { direction: 'indent' }],
    ])
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
    error.mockRestore()
  })
})
