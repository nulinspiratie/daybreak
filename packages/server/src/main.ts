import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Daybreak, Db } from '@daybreak/core'
import { createDaybreak, migrate, openDatabase, systemClock } from '@daybreak/core'
import { createApp } from './app'
import type { ServerConfig } from './paths'
import { assertOutsideRepo, loadConfig, loadOrCreateToken, resolveDataDir } from './paths'
import { startRollover } from './rollover'
import { ChangeBroker } from './sse'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const dev = process.argv.includes('--dev')

const dataDir = resolveDataDir(process.env, process.platform, homedir())
try {
  assertOutsideRepo(dataDir, repoRoot)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}

function fail(message: string): never {
  console.error(`Daybreak could not start: ${message}`)
  process.exit(1)
}

let db: Db | undefined
let config: ServerConfig
let token: string
let daybreak: Daybreak
const broker = new ChangeBroker()
try {
  config = loadConfig(dataDir)
  token = loadOrCreateToken(dataDir)
  const logsDir = join(dataDir, 'logs')
  mkdirSync(logsDir, { recursive: true })
  db = await openDatabase(join(dataDir, 'daybreak.db'))
  migrate(db)
  daybreak = createDaybreak({
    db,
    clock: systemClock,
    config: { dayStartsAt: config.dayStartsAt },
    logsDir,
  })
  daybreak.autoFinishEmptyReview()
} catch (e) {
  db?.close()
  fail((e as Error).message)
}
const openDb = db

daybreak.onChange(() => broker.publish('changed', {}))
const stopRollover = startRollover(daybreak, broker)

const app = createApp({
  daybreak,
  token,
  port: config.port,
  dayStartsAt: config.dayStartsAt,
  broker,
  extraHosts: dev ? ['localhost:5173', '127.0.0.1:5173'] : [],
  webDist: join(repoRoot, 'apps', 'web', 'dist'),
})

let server: ReturnType<typeof Bun.serve>
try {
  server = Bun.serve({ hostname: '127.0.0.1', port: config.port, fetch: app.fetch, idleTimeout: 0 })
} catch (e) {
  stopRollover()
  openDb.close()
  if ((e as { code?: string }).code === 'EADDRINUSE') {
    console.error(`Daybreak is already running on port ${config.port}`)
    process.exit(1)
  }
  throw e
}

console.log(`Daybreak running at http://127.0.0.1:${config.port}`)

function shutdown(): void {
  stopRollover()
  void server.stop(true)
  openDb.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
