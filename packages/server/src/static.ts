import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** Reads a file under `root` for a URL path; null when missing or outside `root`. */
export function readStatic(root: string, urlPath: string): { body: Buffer; type: string } | null {
  // Hono's c.req.path leaves %2F and %2e escapes encoded, so this decode is still needed;
  // the containment check below runs on the decoded result.
  let rel: string
  try {
    rel = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const base = resolve(root)
  const file = resolve(join(base, rel))
  if (file !== base && !file.startsWith(base + sep)) return null
  if (!existsSync(file) || !statSync(file).isFile()) return null
  return {
    body: readFileSync(file),
    type: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
  }
}
