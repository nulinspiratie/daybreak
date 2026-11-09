import type { Daybreak, Section, Status, TaskPatch } from '@daybreak/core'
import { Hono } from 'hono'
import { openLink as realOpenLink } from '../openLink'
import {
  invalid,
  isBoolean,
  isDateOrNull,
  isString,
  isStringArray,
  isStringOrNull,
  maybe,
  need,
  oneOf,
  readBody,
} from '../validate'

const isSection = oneOf<Section>('inbox', 'projects')
const isStatus = oneOf<Status>('open', 'done', 'cancelled')
const isMark = (v: unknown): v is 'doing' | 'worked' | null =>
  v === null || v === 'doing' || v === 'worked'
const isDirection = oneOf<'up' | 'down' | 'indent' | 'outdent'>('up', 'down', 'indent', 'outdent')

export function taskRoutes(d: Daybreak, openLink: (link: string) => void = realOpenLink): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const b = await readBody(c)
    const task = d.create({
      title: need(b, 'title', isString, 'a string'),
      section: need(b, 'section', isSection, '"inbox" or "projects"'),
      parentId: maybe(b, 'parentId', isStringOrNull, 'a task id or null'),
      afterId: maybe(b, 'afterId', isString, 'a task id'),
      beforeId: maybe(b, 'beforeId', isString, 'a task id'),
      scheduledOn: maybe(b, 'scheduledOn', isDateOrNull, 'a date as YYYY-MM-DD or null'),
    })
    return c.json(task, 201)
  })

  app.patch('/:id', async (c) => {
    const id = c.req.param('id')
    const b = await readBody(c)
    const fields: TaskPatch = {}
    const title = maybe(b, 'title', isString, 'a string')
    if (title !== undefined) fields.title = title
    const notes = maybe(b, 'notes', isString, 'a string')
    if (notes !== undefined) fields.notes = notes
    const link = maybe(b, 'link', isStringOrNull, 'a string or null')
    if (link !== undefined) fields.link = link
    const collapsed = maybe(b, 'collapsed', isBoolean, 'a boolean')
    if (collapsed !== undefined) fields.collapsed = collapsed
    const tags = maybe(b, 'tags', isStringArray, 'an array of strings')
    if (tags !== undefined) fields.tags = tags
    const status = maybe(b, 'status', isStatus, '"open", "done" or "cancelled"')
    const withOpenDescendants = maybe(b, 'withOpenDescendants', isBoolean, 'a boolean')
    if (Object.keys(fields).length === 0 && status === undefined) throw invalid('Nothing to update')

    if (status !== undefined) {
      if (Object.keys(fields).length > 0) throw invalid('Send status on its own')
      return c.json(d.setStatus(id, status, { withOpenDescendants }))
    }
    return c.json(d.update(id, fields))
  })

  app.post('/:id/move', async (c) => {
    const b = await readBody(c)
    return c.json(
      d.move(c.req.param('id'), {
        parentId: need(b, 'parentId', isStringOrNull, 'a task id or null'),
        section: need(b, 'section', isSection, '"inbox" or "projects"'),
        afterId: maybe(b, 'afterId', isString, 'a task id'),
        beforeId: maybe(b, 'beforeId', isString, 'a task id'),
      }),
    )
  })

  app.post('/:id/nudge', async (c) => {
    const b = await readBody(c)
    return c.json(
      d.nudge(c.req.param('id'), need(b, 'direction', isDirection, 'up, down, indent or outdent')),
    )
  })

  app.post('/:id/schedule', async (c) => {
    const b = await readBody(c)
    const date = need(b, 'date', isDateOrNull, 'a date as YYYY-MM-DD or null')
    const afterId = maybe(b, 'afterId', isString, 'a task id')
    const beforeId = maybe(b, 'beforeId', isString, 'a task id')
    return c.json(d.schedule(c.req.param('id'), date, { afterId, beforeId }))
  })

  app.post('/:id/mark', async (c) => {
    const b = await readBody(c)
    d.setMark(c.req.param('id'), need(b, 'mark', isMark, '"doing", "worked" or null'))
    return c.body(null, 204)
  })

  app.delete('/:id', (c) => c.json(d.delete(c.req.param('id'))))
  app.post('/:id/restore', (c) => c.json(d.restore(c.req.param('id'))))

  app.post('/:id/open-link', (c) => {
    const { link } = d.getTask(c.req.param('id'))
    if (link === null || link.trim() === '') throw invalid('This task has no link')
    openLink(link)
    return c.body(null, 204)
  })

  return app
}
