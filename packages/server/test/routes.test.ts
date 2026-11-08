import type { Task, TreeNode, TreeView } from '@daybreak/core'
import { describe, expect, it } from 'vitest'
import { testApp } from './helpers'

type Harness = Awaited<ReturnType<typeof testApp>>

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const post = (body: unknown): RequestInit => ({ method: 'POST', ...json(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', ...json(body) })

function walk(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    out.push(n)
    walk(n.children, out)
  }
  return out
}
function byTitle(h: Harness, title: string): TreeNode {
  const tree = h.daybreak.tree('all')
  const hit = walk([...tree.inbox, ...tree.projects]).find((n) => n.title === title)
  if (!hit) throw new Error(`no seed task titled ${title}`)
  return hit
}

const INBOX_TASK = 'Check whether the spare HEMT amplifier arrived'
const LINKED = 'Install TWPA on the mixing chamber plate'
const PARENT = 'Milestone 2 — Install and cooldown'
const PROJECT = 'Fridge 3 readout upgrade'

describe('status, tree and day routes', () => {
  it('GET /api/status', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ today: '2026-11-10', needsReview: true, dayStartsAt: '04:00' })
  })
  it('GET /api/tree honours ?completed=', async () => {
    const h = await testApp({ seed: true })
    const all = (await (await h.req('/api/tree?completed=all')).json()) as TreeView
    const none = (await (await h.req('/api/tree?completed=none')).json()) as TreeView
    expect(all.today).toBe('2026-11-10')
    expect(walk(all.inbox).length).toBeGreaterThan(walk(none.inbox).length)
    expect((await h.req('/api/tree?completed=bogus')).status).toBe(400)
  })
  it('GET /api/day/:date', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req('/api/day/2026-11-10')
    expect(res.status).toBe(200)
    const view = (await res.json()) as { date: string; items: { task: Task }[] }
    expect(view.date).toBe('2026-11-10')
    expect(view.items.map((i) => i.task.title)).toContain('Call facilities about the helium delivery')
  })
  it('GET /api/days?from=&to=', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req('/api/days?from=2026-11-10&to=2026-11-12')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(h.daybreak.dayCounts('2026-11-10', '2026-11-12'))
    expect((await h.req('/api/days?from=2026-11-10')).status).toBe(400)
  })
  it('invalid date param gives 400', async () => {
    const h = await testApp({ seed: true })
    for (const bad of ['2026-13-01', '2026-02-30', 'tomorrow', '2026-1-1']) {
      const res = await h.req(`/api/day/${bad}`)
      expect(res.status, bad).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid')
    }
    expect((await h.req('/api/days?from=2026-02-30&to=2026-03-01')).status).toBe(400)
    expect((await h.req('/api/review/2026-13-01')).status).toBe(400)
  })
})

describe('task routes', () => {
  it('POST /api/tasks creates', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req('/api/tasks', post({ title: 'New thing', section: 'inbox' }))
    expect(res.status).toBe(201)
    const task = (await res.json()) as Task
    expect(task.title).toBe('New thing')
    expect(h.daybreak.getTask(task.id).section).toBe('inbox')
    expect((await h.req('/api/tasks', post({ section: 'inbox' }))).status).toBe(400)
    expect((await h.req('/api/tasks', post({ title: 'x', section: 'nope' }))).status).toBe(400)
  })
  it('PATCH updates fields and returns the Task', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}`, patch({ title: 'Renamed', notes: 'n', tags: ['a'], collapsed: true, link: null }))
    expect(res.status).toBe(200)
    const task = (await res.json()) as Task
    expect(task).toMatchObject({ title: 'Renamed', notes: 'n', tags: ['a'], collapsed: true, link: null })
    expect((await h.req(`/api/tasks/${t.id}`, patch({}))).status).toBe(400)
    expect((await h.req(`/api/tasks/${t.id}`, patch({ title: 5 }))).status).toBe(400)
  })
  it('PATCH status done on a parent with open children gives 409 with details.openCount, then 200 with withOpenDescendants', async () => {
    const h = await testApp({ seed: true })
    const parent = byTitle(h, PARENT)
    const res = await h.req(`/api/tasks/${parent.id}`, patch({ status: 'done' }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; details: { openCount: number } }
    expect(body.error).toBe('needs_confirmation')
    expect(body.details.openCount).toBeGreaterThan(0)
    const ok = await h.req(`/api/tasks/${parent.id}`, patch({ status: 'done', withOpenDescendants: true }))
    expect(ok.status).toBe(200)
    const out = (await ok.json()) as { task: Task; changedIds: string[] }
    expect(out.task.status).toBe('done')
    expect(out.changedIds.length).toBe(body.details.openCount + 1)
  })
  it('PATCH applies fields before status in one request', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}`, patch({ title: 'Both', status: 'cancelled' }))
    const out = (await res.json()) as { task: Task; changedIds: string[] }
    expect(out.task).toMatchObject({ title: 'Both', status: 'cancelled' })
    expect(out.changedIds).toEqual([t.id])
    expect((await h.req(`/api/tasks/${t.id}`, patch({ status: 'weird' }))).status).toBe(400)
  })
  it('POST move', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const project = byTitle(h, PROJECT)
    const res = await h.req(`/api/tasks/${t.id}/move`, post({ parentId: project.id, section: 'projects' }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as Task).parentId).toBe(project.id)
    expect((await h.req(`/api/tasks/${t.id}/move`, post({ section: 'projects' }))).status).toBe(400)
  })
  it('move into own descendant gives 400 and GET /api/tree is unchanged', async () => {
    const h = await testApp({ seed: true })
    const before = await (await h.req('/api/tree?completed=all')).text()
    const project = byTitle(h, PROJECT)
    const child = byTitle(h, PARENT)
    const res = await h.req(`/api/tasks/${project.id}/move`, post({ parentId: child.id, section: 'projects' }))
    expect(res.status).toBe(400)
    expect(await (await h.req('/api/tree?completed=all')).text()).toBe(before)
  })
  it('POST nudge', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, 'Reply to Marcus re: wire-bonding quote')
    const before = h.daybreak.getTask(t.id).position
    const res = await h.req(`/api/tasks/${t.id}/nudge`, post({ direction: 'up' }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as Task).position).not.toBe(before)
    expect((await h.req(`/api/tasks/${t.id}/nudge`, post({ direction: 'sideways' }))).status).toBe(400)
  })
  it('POST schedule sets and clears the date', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}/schedule`, post({ date: '2026-11-12' }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as Task).scheduledOn).toBe('2026-11-12')
    const clear = await h.req(`/api/tasks/${t.id}/schedule`, post({ date: null }))
    expect(((await clear.json()) as Task).scheduledOn).toBeNull()
    expect((await h.req(`/api/tasks/${t.id}/schedule`, post({ date: '2026-02-30' }))).status).toBe(400)
    expect((await h.req(`/api/tasks/${t.id}/schedule`, post({}))).status).toBe(400)
  })
  it('POST mark returns 204', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}/mark`, post({ mark: 'worked' }))
    expect(res.status).toBe(204)
    expect(byTitle(h, INBOX_TASK).mark).toBe('worked')
    expect((await h.req(`/api/tasks/${t.id}/mark`, post({ mark: null }))).status).toBe(204)
    expect(byTitle(h, INBOX_TASK).mark).toBeNull()
    expect((await h.req(`/api/tasks/${t.id}/mark`, post({ mark: 'busy' }))).status).toBe(400)
  })
  it('DELETE then restore', async () => {
    const h = await testApp({ seed: true })
    const parent = byTitle(h, PARENT)
    const del = await h.req(`/api/tasks/${parent.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const { deletedIds } = (await del.json()) as { deletedIds: string[] }
    expect(deletedIds).toContain(parent.id)
    const res = await h.req(`/api/tasks/${parent.id}/restore`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { restoredIds: string[] }).restoredIds.sort()).toEqual([...deletedIds].sort())
  })
  it('unknown id gives 404', async () => {
    const h = await testApp({ seed: true })
    expect((await h.req('/api/tasks/zzzzzz', patch({ title: 'x' }))).status).toBe(404)
    expect((await h.req('/api/tasks/zzzzzz', { method: 'DELETE' })).status).toBe(404)
    expect((await h.req('/api/tasks/zzzzzz/open-link', { method: 'POST' })).status).toBe(404)
    expect((await h.req('/api/projects/zzzzzz/export.md')).status).toBe(404)
  })
  it('malformed JSON body gives 400', async () => {
    const h = await testApp({ seed: true })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{nope' })
    expect(res.status).toBe(400)
  })
  it('POST open-link opens the link and returns 204', async () => {
    const opened: string[] = []
    const h = await testApp({ seed: true, openLink: (l) => opened.push(l) })
    const t = byTitle(h, LINKED)
    const res = await h.req(`/api/tasks/${t.id}/open-link`, { method: 'POST' })
    expect(res.status).toBe(204)
    expect(opened).toEqual([t.link])
  })
  it('open-link on a task with no link gives 400 and opens nothing', async () => {
    const opened: string[] = []
    const h = await testApp({ seed: true, openLink: (l) => opened.push(l) })
    const t = byTitle(h, INBOX_TASK)
    const res = await h.req(`/api/tasks/${t.id}/open-link`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid')
    expect(opened).toEqual([])
  })
})

describe('review routes', () => {
  const DATE = '2026-11-10'
  it('GET /api/review/:date', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req(`/api/review/${DATE}`)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { leftovers: unknown[]; date: string }
    expect(view.date).toBe(DATE)
    expect(view.leftovers.length).toBeGreaterThan(0)
  })
  it('decide, undo, skip and finish', async () => {
    const h = await testApp({ seed: true })
    const first = h.daybreak.review(DATE).leftovers[0]!.task
    const dec = await h.req(`/api/review/${DATE}/decide`, post({ taskId: first.id, choice: 'today' }))
    expect(dec.status).toBe(200)
    expect(((await dec.json()) as { sortedCount: number }).sortedCount).toBe(1)
    expect(h.daybreak.getTask(first.id).scheduledOn).toBe(DATE)

    const undo = await h.req(`/api/review/${DATE}/undo`, { method: 'POST' })
    expect(undo.status).toBe(200)
    expect(((await undo.json()) as { sortedCount: number }).sortedCount).toBe(0)

    const day = await h.req(`/api/review/${DATE}/decide`, post({ taskId: first.id, choice: 'day', targetDate: '2026-11-12' }))
    expect(day.status).toBe(200)
    expect(h.daybreak.getTask(first.id).scheduledOn).toBe('2026-11-12')

    const fin = await h.req(`/api/review/${DATE}/finish`, { method: 'POST' })
    expect(fin.status).toBe(204)
    expect(h.daybreak.review(DATE).finished).toBe(true)
  })
  it('skip returns 204', async () => {
    const h = await testApp({ seed: true })
    const res = await h.req(`/api/review/${DATE}/skip`, { method: 'POST' })
    expect(res.status).toBe(204)
    expect(h.daybreak.review(DATE).skipped).toBe(true)
  })
  it('decide rejects unknown choices and bad targetDate', async () => {
    const h = await testApp({ seed: true })
    const first = h.daybreak.review(DATE).leftovers[0]!.task
    expect((await h.req(`/api/review/${DATE}/decide`, post({ taskId: first.id, choice: 'later' }))).status).toBe(400)
    expect((await h.req(`/api/review/${DATE}/decide`, post({ choice: 'today' }))).status).toBe(400)
    expect((await h.req(`/api/review/${DATE}/decide`, post({ taskId: first.id, choice: 'day', targetDate: '2026-02-30' }))).status).toBe(400)
  })
})

describe('export route', () => {
  it('GET /api/projects/:id/export.md is text/markdown', async () => {
    const h = await testApp({ seed: true })
    const project = byTitle(h, PROJECT)
    const res = await h.req(`/api/projects/${project.id}/export.md`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/)
    expect(await res.text()).toBe(h.daybreak.exportProject(project.id))
  })
})
