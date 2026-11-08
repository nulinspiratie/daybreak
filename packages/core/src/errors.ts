export type ErrorCode = 'not_found' | 'invalid' | 'needs_confirmation'

export class DaybreakError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DaybreakError'
    this.code = code
    this.details = details
  }
}
