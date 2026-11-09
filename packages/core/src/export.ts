import type { Ctx } from './ctx'
import { today } from './ctx'
import { dayLabel } from './dates'
import { getTask, liveChildren } from './tasks/rows'
import type { Task } from './types'

const MARKER = { open: '[ ]', done: '[x]', cancelled: '[-]' } as const

/**
 * A task and its live subtree as Markdown: the task is the `# ` heading, children
 * are nested `- [ ]` items (2 spaces per level) with their notes indented under them.
 */
export function exportProject(ctx: Ctx, id: string): string {
  const root = getTask(ctx, id)
  const now = today(ctx)
  const suffix = (t: Task) => (t.scheduledOn ? ` · ${dayLabel(t.scheduledOn, now).text}` : '')
  const lines: string[] = [`# ${root.title} (#${root.id})${suffix(root)}`]
  if (root.notes.trim() !== '') lines.push('', root.notes.trimEnd())
  lines.push('')

  const walk = (parentId: string, level: number) => {
    const pad = '  '.repeat(level)
    for (const t of liveChildren(ctx, parentId, root.section)) {
      lines.push(`${pad}- ${MARKER[t.status]} ${t.title} (#${t.id})${suffix(t)}`)
      if (t.notes.trim() !== '') {
        for (const line of t.notes.trimEnd().split('\n')) {
          lines.push(line === '' ? '' : `${pad}  ${line}`)
        }
      }
      walk(t.id, level + 1)
    }
  }
  walk(root.id, 0)
  return `${lines.join('\n')}\n`
}
