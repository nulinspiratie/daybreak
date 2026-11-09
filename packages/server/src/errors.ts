import { DaybreakError } from '@daybreak/core'
import type { ErrorCode } from '@daybreak/core'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  invalid: 400,
  needs_confirmation: 409,
}

/** A request the server will not take, whatever its content (403). */
export class Forbidden extends Error {}

export function errorResponse(err: unknown, c: Context): Response {
  if (err instanceof Forbidden) return c.json({ error: 'forbidden', message: err.message }, 403)
  if (err instanceof DaybreakError) {
    const body: { error: ErrorCode; message: string; details?: Record<string, unknown> } = {
      error: err.code,
      message: err.message,
    }
    if (err.details) body.details = err.details
    return c.json(body, STATUS[err.code])
  }
  console.error(err)
  return c.json({ error: 'internal', message: 'Internal server error' }, 500)
}
