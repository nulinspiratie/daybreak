import { DaybreakError } from '@daybreak/core'
import type { Context } from 'hono'
import { Forbidden } from './errors'

export const invalid = (message: string): DaybreakError => new DaybreakError('invalid', message)

/** YYYY-MM-DD and a real calendar day. */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d
}

export function dateParam(value: string | undefined, name: string): string {
  if (!isDate(value)) throw invalid(`${name} must be a date as YYYY-MM-DD`)
  return value
}

export const isString = (v: unknown): v is string => typeof v === 'string'
export const oneOf =
  <T extends string>(...allowed: T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (allowed as string[]).includes(v)

export type Body = Record<string, unknown>

/**
 * The JSON body as an object; a missing, malformed or non-object body is `invalid`. It must be
 * sent as application/json: a browser sends text/plain or a form cross-origin without asking first.
 */
export async function readBody(c: Context): Promise<Body> {
  const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (type !== 'application/json') throw new Forbidden('Content-Type must be application/json')
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw invalid('Request body must be valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('Request body must be a JSON object')
  return raw as Body
}

/** Required field passing `guard`. */
export function need<T>(body: Body, key: string, guard: (v: unknown) => v is T, what: string): T {
  const v = body[key]
  if (!guard(v)) throw invalid(`"${key}" must be ${what}`)
  return v
}

/** Optional field: undefined when absent, else it must pass `guard`. */
export function maybe<T>(body: Body, key: string, guard: (v: unknown) => v is T, what: string): T | undefined {
  if (body[key] === undefined) return undefined
  return need(body, key, guard, what)
}

export const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
export const isDateOrNull = (v: unknown): v is string | null => v === null || isDate(v)
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)
