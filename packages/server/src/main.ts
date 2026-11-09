import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Daybreak, Db } from '@daybreak/core'
import { createDaybreak, migrate, openDatabase, systemClock } from '@daybreak/core'
import { createApp } from './app'
import { type BackupSchedule, createBackupSchedule, startBackups } from './backup'
import { loadConfig, resolveConfigFile, type ServerConfig } from './config'
import { assertOutsideRepo, loadOrCreateToken, resolveDataDir } from './paths'
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
let backups: BackupSchedule
const broker = new ChangeBroker()
try {
  const loaded = loadConfig({
    file: resolveConfigFile(process.env, dataDir, homedir()),
    dataDir,
    env: process.env,
    home: homedir(),
    platform: process.platform,
  })
  for (const warning of loaded.warnings) console.warn(`Daybreak: ${loaded.file}: ${warning}`)
  config = loaded.config
  assertOutsideRepo(config.backup.dir, repoRoot)
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
  const d = daybreak
  const { dir, retainDays } = config.backup
  backups = createBackupSchedule({
    dir,
    run: () => d.backup({ dir, retainDays, workDir: dataDir, logsDir }),
    today: () => d.today(),
    onStatusChange: () => broker.publish('changed', {}),
  })
} catch (e) {
  db?.close()
  fail((e as Error).message)
}
const openDb = db

daybreak.onChange(() => {
  backups.markDirty()
  broker.publish('changed', {})
})
const stopRollover = startRollover(daybreak, broker)

const app = createApp({
  daybreak,
  token,
  port: config.port,
  dayStartsAt: config.dayStartsAt,
  backupStatus: () => backups.status(),
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
console.log(`Backups go to ${config.backup.dir}`)
// Only once the port is ours: a second copy started by mistake stops above without backing up.
const stopBackups = startBackups(backups)

function shutdown(): void {
  stopRollover()
  stopBackups()
  void server.stop(true)
  openDb.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
