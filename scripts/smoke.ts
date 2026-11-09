// End-to-end smoke test: build the web app, start the real server on a
// scratch data folder and a spare port, and check it answers.
//
//   bun run smoke
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 47899
const dataDir = mkdtempSync(join(tmpdir(), 'daybreak-smoke-'))
// With DAYBREAK_DATA_DIR set, the server reads its settings from this folder, not ~/.daybreak.toml.
writeFileSync(join(dataDir, 'daybreak.toml'), `[server]\nport = ${port}\n`)

const build = spawnSync('bun', ['run', '--cwd', 'apps/web', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) throw new Error('web build failed')

const server = spawn('bun', ['packages/server/src/main.ts'], {
  env: { ...process.env, DAYBREAK_DATA_DIR: dataDir },
  stdio: 'inherit',
})

async function check(): Promise<void> {
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    try {
      await fetch(base)
      break
    } catch {
      if (i > 100) throw new Error('server did not start within 20 s')
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const page = await fetch(base)
  const html = await page.text()
  if (page.status !== 200 || !html.includes('<div id="root">'))
    throw new Error(`GET / returned ${page.status}`)

  const manifest = await fetch(`${base}/manifest.webmanifest`)
  if (manifest.status !== 200 || ((await manifest.json()) as { name?: string }).name !== 'Daybreak')
    throw new Error(`/manifest.webmanifest returned ${manifest.status}`)
  const sw = await fetch(`${base}/sw.js`)
  // Registered as a classic script, so the build must not leave module syntax in it.
  if (sw.status !== 200 || /^(import|export)\b/m.test(await sw.text()))
    throw new Error(`/sw.js returned ${sw.status} or contains import/export`)

  const token = readFileSync(join(dataDir, 'token'), 'utf8').trim()
  const auth = { Authorization: `Bearer ${token}` }
  const ping = await fetch(`${base}/api/ping`, { headers: auth })
  if (ping.status !== 200) throw new Error(`/api/ping returned ${ping.status}`)
  const unauth = await fetch(`${base}/api/ping`)
  if (unauth.status !== 401) throw new Error(`/api/ping without a token returned ${unauth.status}`)
  const status = await fetch(`${base}/api/status`, { headers: auth })
  if (status.status !== 200) throw new Error(`/api/status returned ${status.status}`)
  const { backup } = (await status.json()) as { backup: { error: string | null } | null }
  if (backup?.error !== null) throw new Error(`backup status: ${JSON.stringify(backup)}`)
  if (!readdirSync(join(dataDir, 'backups')).some((f) => /^daybreak-.*\.db$/.test(f)))
    throw new Error('no backup in the data folder’s backups folder')
  console.log(
    'Smoke test passed: page, manifest, service worker, ping, token check, status and backup all answer.',
  )
}

let failed = false
try {
  await check()
} catch (e) {
  console.error(`Smoke test failed: ${(e as Error).message}`)
  failed = true
} finally {
  server.kill()
  await new Promise((r) => setTimeout(r, 500))
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // Windows can hold the database open a moment longer; the temp folder is harmless.
  }
}
process.exit(failed ? 1 : 0)
