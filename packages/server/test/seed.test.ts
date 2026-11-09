import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// The script runs on Bun, like `bun run seed`. HOME and XDG_DATA_HOME point at a scratch dir, so a
// seed that ignored the rule would land there and not in this machine's real data dir.
const scratch: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'daybreak-seed-'))
  scratch.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runSeed(env: Record<string, string>) {
  const { DAYBREAK_DATA_DIR: _, LOCALAPPDATA: __, ...rest } = process.env
  return spawnSync('bun', ['scripts/seed.ts'], { env: { ...rest, ...env }, encoding: 'utf8' })
}

describe('bun run seed', () => {
  it('refuses to run without DAYBREAK_DATA_DIR, and writes nothing', () => {
    const home = tempDir()
    const res = runSeed({ HOME: home, XDG_DATA_HOME: join(home, 'share'), USERPROFILE: home })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('DAYBREAK_DATA_DIR')
    expect(readdirSync(home).filter((name) => name !== '.bun')).toEqual([]) // Bun's own cache aside
  })

  it('seeds the dir DAYBREAK_DATA_DIR names', () => {
    const dir = tempDir()
    const res = runSeed({ DAYBREAK_DATA_DIR: dir })
    expect(res.status, res.stderr).toBe(0)
    expect(existsSync(join(dir, 'daybreak.db'))).toBe(true)
    expect(runSeed({ DAYBREAK_DATA_DIR: dir }).status).toBe(1) // it already holds tasks
  })
})
