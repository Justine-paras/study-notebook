// Typed client for the main process. Every StudyApi method becomes
// `api.<method>(...args)`, which calls `window.studyBridge.invoke`, unwraps the
// ApiResult envelope and throws ApiError on failure.

import { STUDY_API_METHODS, type StudyApi, type StudyApiMethod, type StudyBridge } from '@shared/api'
import { ERROR_MESSAGES } from '@shared/errors'
import type { AppErrorCode } from '@shared/types'

/** Code used when the page runs without the Electron preload (e.g. opened in a browser). */
export const NO_BRIDGE_CODE = 'NO_BRIDGE'

/** Error codes that mean "the same call will fail again": never retried automatically. */
export const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set<AppErrorCode | typeof NO_BRIDGE_CODE>([
  NO_BRIDGE_CODE,
  'NO_API_KEY',
  'INVALID_API_KEY',
  'AI_REFUSED',
  'SOURCE_TOO_LARGE',
  'NO_SOURCES',
  'UNSUPPORTED_FILE',
  'EXTRACT_FAILED',
  'NOT_FOUND',
  'INVALID_INPUT'
])

/** Codes that are fixed in Settings (ErrorNotice shows a Settings button). */
export const SETTINGS_ERROR_CODES: ReadonlySet<string> = new Set<AppErrorCode>(['NO_API_KEY', 'INVALID_API_KEY'])

export class ApiError extends Error {
  /** An AppErrorCode from the main process, or another string for renderer-side failures. */
  readonly code: AppErrorCode | string
  /** Learner-facing text from ERROR_MESSAGES (UNKNOWN's text for unknown codes). */
  readonly friendly: string
  /** The api method that failed, when known. */
  readonly method: StudyApiMethod | null

  constructor(code: AppErrorCode | string, message: string, method: StudyApiMethod | null = null, friendly?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.method = method
    this.friendly = friendly ?? friendlyForCode(code)
  }

  /** True when retrying the same call could succeed (network, rate limit, AI hiccups). */
  get retryable(): boolean {
    return !NON_RETRYABLE_CODES.has(this.code)
  }

  /** True when the fix is in Settings (missing or rejected API key). */
  get needsSettings(): boolean {
    return SETTINGS_ERROR_CODES.has(this.code)
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

function isKnownCode(code: string): code is AppErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
}

export function friendlyForCode(code: string): string {
  if (code === NO_BRIDGE_CODE) return 'Study Notebook needs to run as the desktop app to load your data.'
  return isKnownCode(code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.UNKNOWN
}

/** Normalizes anything thrown (ApiError, Error, string) into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof Error) return new ApiError('UNKNOWN', err.message)
  if (typeof err === 'string') return new ApiError('UNKNOWN', err)
  return new ApiError('UNKNOWN', 'Unknown error')
}

/** Learner-facing text for any error. */
export function friendlyMessage(err: unknown): string {
  return toApiError(err).friendly
}

function getBridge(): StudyBridge | null {
  if (typeof window === 'undefined') return null
  return window.studyBridge ?? null
}

/** True when running inside Electron with the preload bridge available. */
export function hasBridge(): boolean {
  return getBridge() !== null
}

async function call(method: StudyApiMethod, args: unknown[]): Promise<unknown> {
  const bridge = getBridge()
  if (!bridge) {
    throw new ApiError(
      NO_BRIDGE_CODE,
      `window.studyBridge is missing, so "${method}" cannot reach the main process. ` +
        'Open the app with Electron (npm run dev), not in a plain browser.',
      method
    )
  }
  let result
  try {
    result = await bridge.invoke(method, args)
  } catch (err) {
    // invoke itself only rejects for bridge-level problems (no handler, uncloneable args).
    throw new ApiError('UNKNOWN', err instanceof Error ? err.message : String(err), method)
  }
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new ApiError('UNKNOWN', `Malformed response from "${method}"`, method)
  }
  if (result.ok) return result.data
  throw new ApiError(result.error.code, result.error.message, method)
}

function buildApi(): StudyApi {
  const entries = STUDY_API_METHODS.map((method) => [method, (...args: unknown[]) => call(method, args)] as const)
  // The cast is safe: every method in the contract is listed in STUDY_API_METHODS
  // (checked at compile time in shared/api.ts) and forwards its arguments as-is.
  return Object.freeze(Object.fromEntries(entries)) as unknown as StudyApi
}

/** The typed client: `await api.listNotebooks()`. Throws ApiError. */
export const api: StudyApi = buildApi()
