import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncer } from './debounce'
import { OLLAMA_CONTEXT_SIZES, type OllamaModelInfo } from '@shared/types'
import {
  NUMBER_SETTINGS,
  OLLAMA_CONTEXT_OPTIONS,
  RETENTION_MAX,
  RETENTION_MIN,
  apiKeyInputError,
  apiKeyStatus,
  formatModelSize,
  formatRetention,
  isMissingOllamaModel,
  ollamaModelLabel,
  ollamaModelOptions,
  ollamaStatus,
  parseContextSize,
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

describe('Ollama', () => {
  const qwen: OllamaModelInfo = { name: 'qwen3:8b', sizeBytes: 5_225_387_923, parameterSize: '8.2B', quantization: 'Q4_K_M' }
  const bare: OllamaModelInfo = { name: 'my-model:latest', sizeBytes: 0, parameterSize: null, quantization: ' ' }

  it('labels models with what Ollama reports, sized like `ollama list`', () => {
    expect(ollamaModelLabel(qwen)).toBe('qwen3:8b · 8.2B · Q4_K_M · 5.2 GB')
    expect(ollamaModelLabel(bare)).toBe('my-model:latest')
    expect(formatModelSize(980_000_000)).toBe('980 MB')
    expect(formatModelSize(Number.NaN)).toBeNull()
  })

  it('keeps the saved model in the list, marked when Ollama no longer has it', () => {
    expect(ollamaModelOptions([qwen], 'qwen3:8b', true)).toEqual([{ value: 'qwen3:8b', label: ollamaModelLabel(qwen) }])
    expect(ollamaModelOptions([qwen], 'llama3.2:latest', true)[0]).toEqual({
      value: 'llama3.2:latest',
      label: 'llama3.2:latest (not installed)'
    })
    // Ollama didn't answer: nothing is known about the saved model.
    expect(ollamaModelOptions([], 'llama3.2:latest', false)).toEqual([{ value: 'llama3.2:latest', label: 'llama3.2:latest' }])
    expect(ollamaModelOptions([], null, true)).toEqual([])
    expect(isMissingOllamaModel([qwen], 'qwen3:8b')).toBe(false)
    expect(isMissingOllamaModel([qwen], 'qwen3:4b')).toBe(true)
    expect(isMissingOllamaModel([qwen], null)).toBe(false)
  })

  it('says where the learner stands', () => {
    expect(ollamaStatus(undefined, null)).toBe('checking')
    expect(ollamaStatus({ ok: false, models: [] }, 'qwen3:8b')).toBe('unreachable')
    expect(ollamaStatus({ ok: true, models: [] }, null)).toBe('no-models')
    expect(ollamaStatus({ ok: true, models: [qwen] }, null)).toBe('choose')
    expect(ollamaStatus({ ok: true, models: [qwen] }, 'qwen3:4b')).toBe('missing')
    expect(ollamaStatus({ ok: true, models: [qwen, bare] }, 'qwen3:8b')).toBe('ready')
    // Demo mode doesn't use Ollama, so it isn't looked for or reported missing.
    expect(ollamaStatus(undefined, null, true)).toBe('demo')
    expect(ollamaStatus({ ok: false, models: [] }, null, true)).toBe('demo')
  })

  it('offers every context size and reads the choice back', () => {
    expect(OLLAMA_CONTEXT_OPTIONS.map((o) => Number(o.value))).toEqual([...OLLAMA_CONTEXT_SIZES])
    expect(OLLAMA_CONTEXT_OPTIONS[0]!.label).toBe('8K tokens (least memory)')
    expect(OLLAMA_CONTEXT_OPTIONS.at(-1)!.label).toBe('128K tokens (needs a lot of memory)')
    expect(parseContextSize('32768')).toBe(32768)
    expect(parseContextSize('4096')).toBeNull()
    expect(parseContextSize('')).toBeNull()
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
