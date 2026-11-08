import { fixedClock, openDatabase, migrate } from '../src/index'
import type { Config, Ctx } from '../src/index'

/** In-memory database with the schema applied and a fixed clock. */
export async function makeCtx(
  nowIso = '2026-11-10T08:00:00Z',
  config: Config = { dayStartsAt: '04:00' },
): Promise<Ctx & { clock: ReturnType<typeof fixedClock> }> {
  const db = await openDatabase(':memory:')
  migrate(db)
  return { db, clock: fixedClock(nowIso), config }
}
