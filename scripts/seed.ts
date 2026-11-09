// Fill a fresh Daybreak database with fictional data: DAYBREAK_DATA_DIR=<scratch dir> bun run seed
// Needs DAYBREAK_DATA_DIR, so fictional tasks never land in the real data dir by default; refuses a
// dir inside the repo or a database that already holds tasks.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDaybreak,
  migrate,
  openDatabase,
  seed,
  systemClock,
} from '../packages/core/src/index'
import { assertOutsideRepo, resolveDataDir } from '../packages/server/src/paths'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (!process.env.DAYBREAK_DATA_DIR) {
  fail(
    'Refusing to seed: set DAYBREAK_DATA_DIR to a scratch folder (outside this repo) first, e.g. DAYBREAK_DATA_DIR=$(mktemp -d) bun run seed',
  )
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
