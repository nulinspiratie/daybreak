// Fill a fresh Daybreak database with fictional data: DAYBREAK_DATA_DIR=<dir> bun run seed
import { mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDaybreak, migrate, openDatabase, seed, systemClock } from '../packages/core/src/index'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const dirEnv = process.env.DAYBREAK_DATA_DIR
if (!dirEnv) fail('DAYBREAK_DATA_DIR is not set. Point it at an empty scratch directory outside the repo.')
const dataDir = resolve(dirEnv)
const rel = relative(repoRoot, dataDir)
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
  fail(`Refusing to use ${dataDir}: it is inside the repository. Work data never goes in the repo.`)
}

mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'daybreak.db')
const db = await openDatabase(dbPath)
migrate(db)

const existing = db.get<{ n: number }>(
  "SELECT COUNT(*) AS n FROM tasks WHERE NOT (section = 'inbox' AND title = 'Inbox')",
)!.n
if (existing > 0) {
  db.close()
  fail(`Refusing to seed ${dbPath}: it already holds ${existing} task(s).`)
}

const d = createDaybreak({ db, clock: systemClock, config: { dayStartsAt: '04:00' } })
seed(d)
const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n
db.close()
console.log(`Seeded ${count} tasks into ${dbPath}`)
