// Fill a fresh Daybreak database with fictional data: bun run seed
// Uses the real data dir (DAYBREAK_DATA_DIR, else the platform default); refuses a dir inside the repo
// or a database that already holds tasks. Point DAYBREAK_DATA_DIR at a scratch dir for dev.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDaybreak, migrate, openDatabase, seed, systemClock } from '../packages/core/src/index'
import { assertOutsideRepo, resolveDataDir } from '../packages/server/src/paths'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const dataDir = resolveDataDir(process.env, process.platform, homedir())
try {
  assertOutsideRepo(dataDir, repoRoot)
} catch (e) {
  fail((e as Error).message)
}

mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'daybreak.db')
const db = await openDatabase(dbPath)
migrate(db)

const existing = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n
if (existing > 0) {
  db.close()
  fail(`Refusing to seed ${dbPath}: it already holds ${existing} task(s).`)
}

const d = createDaybreak({ db, clock: systemClock, config: { dayStartsAt: '04:00' } })
seed(d)
const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n
db.close()
console.log(`Seeded ${count} tasks into ${dbPath}`)
