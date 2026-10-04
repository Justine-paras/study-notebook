import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncer } from './debounce'
import {
  NUMBER_SETTINGS,
  RETENTION_MAX,
  RETENTION_MIN,
  apiKeyInputError,
  apiKeyStatus,
  formatRetention,
  parseWholeNumber,
  retentionHint
} from './settingsModel'

describe('parseWholeNumber', () => {
  it('accepts whole numbers in range, ignoring surrounding spaces', () => {
    expect(parseWholeNumber(' 25 ', 5, 90)).toEqual({ ok: true, value: 25 })
    expect(parseWholeNumber('5', 5, 90)).toEqual({ ok: true, value: 5 })
    expect(parseWholeNumber('90', 5, 90)).toEqual({ ok: true, value: 90 })
  })

  it('rejects empty, fractional and out-of-range input', () => {
    expect(parseWholeNumber('', 5, 90)).toEqual({ ok: false, error: 'Enter a number from 5 to 90.' })
    expect(parseWholeNumber('2.5', 1, 30)).toEqual({ ok: false, error: 'Use a whole number.' })
    expect(parseWholeNumber('1e2', 10, 500)).toEqual({ ok: false, error: 'Use a whole number.' })
    expect(parseWholeNumber('4', 5, 90)).toEqual({ ok: false, error: 'Use a number from 5 to 90.' })
    expect(parseWholeNumber('-1', 0, 5)).toEqual({ ok: false, error: 'Use a number from 0 to 5.' })
  })

  it('uses the backend ranges', () => {
    expect([NUMBER_SETTINGS.focusMinutes.min, NUMBER_SETTINGS.focusMinutes.max]).toEqual([5, 90])
    expect([NUMBER_SETTINGS.breakMinutes.min, NUMBER_SETTINGS.breakMinutes.max]).toEqual([1, 30])
    expect([NUMBER_SETTINGS.newTopicsPerDay.min, NUMBER_SETTINGS.newTopicsPerDay.max]).toEqual([0, 5])
    expect([NUMBER_SETTINGS.maxReviewsPerDay.min, NUMBER_SETTINGS.maxReviewsPerDay.max]).toEqual([10, 500])
    expect([RETENTION_MIN, RETENTION_MAX]).toEqual([0.8, 0.97])
  })
})

describe('retention', () => {
  it('formats as a whole percent', () => {
    expect(formatRetention(0.9)).toBe('90%')
    expect(formatRetention(0.9000000000000001)).toBe('90%')
  })

  it('explains the trade-off at each end', () => {
    expect(retentionHint(0.9)).toMatch(/9 in 10.*good balance/)
    expect(retentionHint(0.97)).toMatch(/many more reviews/)
    expect(retentionHint(0.8)).toMatch(/8 in 10.*Fewer reviews/)
  })
})

describe('API key', () => {
  it('validates pasted keys loosely', () => {
    expect(apiKeyInputError('')).toMatch(/Paste/)
    expect(apiKeyInputError('sk-ant-abc def-0123456789')).toMatch(/space/)
    expect(apiKeyInputError('sk-short')).toMatch(/too short/)
    expect(apiKeyInputError('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ')).toBeNull()
  })

  it('reports the key status', () => {
    expect(apiKeyStatus({ hasApiKey: true, demoAi: true })).toBe('saved')
    expect(apiKeyStatus({ hasApiKey: false, demoAi: true })).toBe('demo')
    expect(apiKeyStatus({ hasApiKey: false, demoAi: false })).toBe('missing')
  })
})

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls once with the last value after the delay', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 500)
    d.schedule(1)
    vi.advanceTimersByTime(300)
    d.schedule(2)
    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()
    expect(d.isPending()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(2)
    expect(d.isPending()).toBe(false)
  })

  it('flushes a pending call immediately and only once', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 500)
    d.schedule('a')
    d.flush()
    d.flush()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
  })

  it('drops a cancelled call', () => {
    const fn = vi.fn()
    const d = createDebouncer(fn, 500)
    d.schedule(1)
    d.cancel()
    d.flush()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
