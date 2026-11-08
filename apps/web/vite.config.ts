import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDataDir } from '@daybreak/server/paths'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const TARGET = 'http://127.0.0.1:47815'

function readToken(): string | undefined {
  const file = join(resolveDataDir(process.env, process.platform, homedir()), 'token')
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    console.warn(`Daybreak: no token at ${file}. Run the server once first (bun run dev), then restart Vite.`)
    return undefined
  }
}

export default defineConfig(({ command }) => {
  // Only the dev server proxies, so only it needs the token.
  const token = command === 'serve' ? readToken() : undefined
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: TARGET, headers },
        // SSE: stream straight through, with no timeout on the idle connection.
        '/events': {
          target: TARGET,
          headers,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('proxyRes', (res) => {
              res.headers['cache-control'] = 'no-cache'
              res.headers['x-accel-buffering'] = 'no'
            })
          },
        },
      },
    },
  }
})
