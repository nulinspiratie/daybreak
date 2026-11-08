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

// Auth is the HttpOnly cookie the server sets when it serves `/`; no header is sent.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; details?: unknown }
    throw new ApiError(res.status, e.error ?? 'http_error', e.message ?? `HTTP ${res.status}`, e.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  send: <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> =>
    request<T>(method, path, body),
}
