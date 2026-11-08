import { createTask, fixedClock, liveChildren, openDatabase, migrate } from '../src/index'
import type { Config, Ctx, Section } from '../src/index'

/** In-memory database with the schema applied and a fixed clock. */
export async function makeCtx(
  nowIso = '2026-11-10T08:00:00Z',
  config: Config = { dayStartsAt: '04:00' },
): Promise<Ctx & { clock: ReturnType<typeof fixedClock> }> {
  const db = await openDatabase(':memory:')
  migrate(db)
  return { db, clock: fixedClock(nowIso), config }
}

/**
 * Build a tree from an indented outline (2 spaces per level) under `projects:`
 * and `inbox:` headers. Returns { title: id }. Titles must be unique.
 */
export function build(ctx: Ctx, text: string): Record<string, string> {
  const ids: Record<string, string> = {}
  let section: Section = 'projects'
  const stack: string[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    const spaces = raw.length - raw.trimStart().length
    const title = raw.trim()
    if (spaces === 0) {
      if (title !== 'projects:' && title !== 'inbox:') throw new Error(`bad header: ${title}`)
      section = title === 'inbox:' ? 'inbox' : 'projects'
      stack.length = 0
      continue
    }
    const depth = spaces / 2 - 1
    if (!Number.isInteger(depth) || depth > stack.length) throw new Error(`bad indent: ${raw}`)
    if (ids[title]) throw new Error(`duplicate title: ${title}`)
    stack.length = depth
    const task = createTask(ctx, { title, section, parentId: stack[depth - 1] ?? null })
    ids[title] = task.id
    stack.push(task.id)
  }
  return ids
}

/** All live tasks in sibling order, in the format `build` reads (both headers always shown). */
export function outline(ctx: Ctx): string {
  const lines: string[] = []
  for (const section of ['projects', 'inbox'] as const) {
    lines.push(`${section}:`)
    const walk = (parentId: string | null, level: number) => {
      for (const t of liveChildren(ctx, parentId, section)) {
        lines.push(`${'  '.repeat(level)}${t.title}`)
        walk(t.id, level + 1)
      }
    }
    walk(null, 1)
  }
  return lines.join('\n')
}
