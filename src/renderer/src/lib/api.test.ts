import { afterEach, describe, expect, it, vi } from 'vitest'
import { STUDY_API_METHODS, type ApiResult, type StudyBridge } from '@shared/api'
import { ERROR_MESSAGES } from '@shared/errors'
import { ApiError, NO_BRIDGE_CODE, api, friendlyMessage, hasBridge, isApiError, toApiError } from './api'

type Invoke = StudyBridge['invoke']

function installBridge(invoke: Invoke): void {
  const bridge: StudyBridge = { invoke, onAiProgress: () => () => {}, pathForFile: () => '', platform: 'win32' }
  vi.stubGlobal('window', { studyBridge: bridge })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('exposes every StudyApi method', () => {
    for (const method of STUDY_API_METHODS) expect(typeof api[method]).toBe('function')
  })

  it('forwards the method name and arguments and unwraps data', async () => {
    const invoke = vi.fn<Invoke>(async () => ({ ok: true, data: { id: 'nb1' } }) as ApiResult<unknown>)
    installBridge(invoke)
    await expect(api.updateNotebook('nb1', { name: 'OS' })).resolves.toEqual({ id: 'nb1' })
    expect(invoke).toHaveBeenCalledWith('updateNotebook', ['nb1', { name: 'OS' }])
  })

  it('throws ApiError with the friendly text for error envelopes', async () => {
    installBridge(async () => ({ ok: false, error: { code: 'NO_API_KEY', message: 'No key configured' } }))
    const err = await api.generateLesson('t1').catch((e: unknown) => e)
    expect(isApiError(err)).toBe(true)
    const apiError = err as ApiError
    expect(apiError.code).toBe('NO_API_KEY')
    expect(apiError.message).toBe('No key configured')
    expect(apiError.friendly).toBe(ERROR_MESSAGES.NO_API_KEY)
    expect(apiError.method).toBe('generateLesson')
    expect(apiError.needsSettings).toBe(true)
    expect(apiError.retryable).toBe(false)
  })

  it("shows the main process's own sentence for refusals, oversized requests and invalid input", async () => {
    const refusal = 'The AI declined this request because it touches on security. Try fewer files.'
    installBridge(async () => ({ ok: false, error: { code: 'AI_REFUSED', message: refusal } }))
    expect(((await api.generateLesson('t1').catch((e: unknown) => e)) as ApiError).friendly).toBe(refusal)
    installBridge(async () => ({ ok: false, error: { code: 'INVALID_INPUT', message: 'Add topics to this notebook before making a quiz.' } }))
    expect(((await api.listNotebooks().catch((e: unknown) => e)) as ApiError).friendly).toBe('Add topics to this notebook before making a quiz.')
    // An empty message falls back to the generic text; other codes keep it too.
    installBridge(async () => ({ ok: false, error: { code: 'SOURCE_TOO_LARGE', message: ' ' } }))
    expect(((await api.listNotebooks().catch((e: unknown) => e)) as ApiError).friendly).toBe(ERROR_MESSAGES.SOURCE_TOO_LARGE)
    installBridge(async () => ({ ok: false, error: { code: 'AI_BAD_OUTPUT', message: 'The AI service rejected the request: max_tokens' } }))
    expect(((await api.listNotebooks().catch((e: unknown) => e)) as ApiError).friendly).toBe(ERROR_MESSAGES.AI_BAD_OUTPUT)
  })

  it('uses the UNKNOWN text for codes it does not know', async () => {
    installBridge(async () => ({ ok: false, error: { code: 'SQLITE_BUSY', message: 'database is locked' } }))
    const err = (await api.listNotebooks().catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('SQLITE_BUSY')
    expect(err.friendly).toBe(ERROR_MESSAGES.UNKNOWN)
    expect(err.retryable).toBe(true)
  })

  it('wraps bridge-level failures', async () => {
    installBridge(async () => {
      throw new Error('No handler registered for api:listNotebooks')
    })
    const err = (await api.listNotebooks().catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toContain('No handler')
  })

  it('explains clearly when there is no bridge', async () => {
    vi.stubGlobal('window', {})
    expect(hasBridge()).toBe(false)
    const err = (await api.getToday().catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe(NO_BRIDGE_CODE)
    expect(err.message).toContain('window.studyBridge is missing')
    expect(err.retryable).toBe(false)
  })
})

describe('error helpers', () => {
  it('normalizes anything thrown', () => {
    const original = new ApiError('NETWORK', 'offline')
    expect(toApiError(original)).toBe(original)
    expect(toApiError(new Error('boom')).code).toBe('UNKNOWN')
    expect(toApiError('plain').message).toBe('plain')
    expect(friendlyMessage(new ApiError('RATE_LIMITED', 'x'))).toBe(ERROR_MESSAGES.RATE_LIMITED)
    expect(friendlyMessage(undefined)).toBe(ERROR_MESSAGES.UNKNOWN)
  })
})
