export class ApiError extends Error {
  status: number
  code: string
  // biome-ignore lint/suspicious/noExplicitAny: server-defined shape
  details?: any
  // biome-ignore lint/suspicious/noExplicitAny: server-defined shape
  constructor(status: number, code: string, message: string, details?: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** The request got no answer at all: the server is not running. */
export class Unreachable extends Error {
  constructor(cause: unknown) {
    super("Couldn't reach Daybreak", { cause })
    this.name = 'Unreachable'
  }
}

// Auth is the HttpOnly cookie the server sets when it serves `/`; no header is sent.
// Every write says application/json, bodiless ones too: the server refuses other writes (CSRF).
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' }
  if (method !== 'GET') init.headers = { 'Content-Type': 'application/json' }
  if (body !== undefined) init.body = JSON.stringify(body)
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (e) {
    throw new Unreachable(e)
  }
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; details?: unknown }
    throw new ApiError(
      res.status,
      e.error ?? 'http_error',
      e.message ?? `HTTP ${res.status}`,
      e.details,
    )
  }
  return data as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  send: <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> =>
    request<T>(method, path, body),
}

/**
 * No answer from Daybreak itself: the fetch failed, or something else answered without the
 * server's error body (the dev proxy, when the server is not running).
 */
export const isUnreachable = (e: unknown): boolean =>
  e instanceof Unreachable || (e instanceof ApiError && e.code === 'http_error')
