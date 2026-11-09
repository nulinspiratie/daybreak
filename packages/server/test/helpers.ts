import type { Daybreak } from '@daybreak/core'
import { createDaybreak, fixedClock, migrate, openDatabase, seed } from '@daybreak/core'
import type { Hono } from 'hono'
import { createApp } from '../src/app'
import type { BackupStatus } from '../src/backup'
import { ChangeBroker } from '../src/sse'

export const TEST_TOKEN = 'a'.repeat(64)
export const TEST_PORT = 47815

export async function testApp(
  opts: {
    now?: string
    seed?: boolean
    openLink?: (link: string) => void
    backupStatus?: () => BackupStatus
  } = {},
): Promise<{
  app: Hono
  daybreak: Daybreak
  broker: ChangeBroker
  clock: ReturnType<typeof fixedClock>
  req: (path: string, init?: RequestInit) => Promise<Response>
}> {
  const db = await openDatabase(':memory:')
  migrate(db)
  const clock = fixedClock(opts.now ?? '2026-11-10T09:00:00Z')
  const daybreak = createDaybreak({ db, clock, config: { dayStartsAt: '04:00' } })
  if (opts.seed) seed(daybreak)
  const broker = new ChangeBroker()
  daybreak.onChange(() => broker.publish('changed', {}))
  const app = createApp({
    daybreak,
    token: TEST_TOKEN,
    port: TEST_PORT,
    dayStartsAt: '04:00',
    backupStatus: opts.backupStatus,
    broker,
    openLink: opts.openLink ?? (() => {}),
  })
  const req = (path: string, init: RequestInit = {}) => {
    const headers = new Headers({
      Host: `127.0.0.1:${TEST_PORT}`,
      Authorization: `Bearer ${TEST_TOKEN}`,
    })
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value)
    })
    return Promise.resolve(
      app.request(`http://127.0.0.1:${TEST_PORT}${path}`, { ...init, headers }),
    )
  }
  return { app, daybreak, broker, clock, req }
}
