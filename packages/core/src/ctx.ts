import type { Clock } from './clock'
import { type ISODate, localDate } from './dates'
import type { Db } from './db/adapter'
import type { Config } from './types'

export interface Ctx {
  db: Db
  clock: Clock
  config: Config
}

export function today(ctx: Ctx): ISODate {
  return localDate(ctx.clock.now(), ctx.config.dayStartsAt)
}

export function nowIso(ctx: Ctx): string {
  return ctx.clock.now().toISOString()
}
