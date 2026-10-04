import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@shared/errors'
import { createTestContext, type TestContext } from '../../../tests/unit/helpers/context'
import {
  DEFAULT_SETTINGS,
  clearApiKey,
  getAiConfig,
  getSettings,
  getThemePreference,
  openDataFolder,
  readStoredSettings,
  setApiKey,
  sqlStringLiteral,
  updateSettings,
  validateSettingsUpdate
} from './settings'

let ctx: TestContext

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  ctx = createTestContext({ demoAi: false })
})
afterEach(() => {
  ctx.cleanup()
  vi.unstubAllEnvs()
})

function expectInvalid(fn: () => unknown): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('INVALID_INPUT')
    return
  }
  throw new Error('expected INVALID_INPUT')
}

async function expectInvalidAsync(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: 'INVALID_INPUT' })
}

describe('validateSettingsUpdate', () => {
  it('accepts values at the edges of every range', () => {
    expect(
      validateSettingsUpdate({ focusMinutes: 5, breakMinutes: 30, newTopicsPerDay: 0, maxReviewsPerDay: 500, desiredRetention: 0.97 })
    ).toEqual({ focusMinutes: 5, breakMinutes: 30, newTopicsPerDay: 0, maxReviewsPerDay: 500, desiredRetention: 0.97 })
    expect(validateSettingsUpdate({ focusMinutes: 90, breakMinutes: 1, newTopicsPerDay: 5, maxReviewsPerDay: 10, desiredRetention: 0.8 })).toEqual({
      focusMinutes: 90,
      breakMinutes: 1,
      newTopicsPerDay: 5,
      maxReviewsPerDay: 10,
      desiredRetention: 0.8
    })
  })

  it.each([
    { focusMinutes: 4 },
    { focusMinutes: 91 },
    { focusMinutes: 25.5 },
    { breakMinutes: 0 },
    { breakMinutes: 31 },
    { newTopicsPerDay: -1 },
    { newTopicsPerDay: 6 },
    { maxReviewsPerDay: 9 },
    { maxReviewsPerDay: 501 },
    { desiredRetention: 0.79 },
    { desiredRetention: 0.98 },
    { desiredRetention: Number.NaN },
    { focusMinutes: '25' },
    { model: 'gpt-4' },
    { theme: 'blue' }
  ])('rejects %o', (patch) => {
    expectInvalid(() => validateSettingsUpdate(patch))
  })

  it('ignores read-only and unknown fields and rounds retention', () => {
    expect(validateSettingsUpdate({ hasApiKey: true, dataDir: '/x', extra: 1, desiredRetention: 0.9000000000000001 })).toEqual({
      desiredRetention: 0.9
    })
    expectInvalid(() => validateSettingsUpdate(null))
  })
})

describe('settings service', () => {
  it('returns defaults with read-only fields', async () => {
    expect(await getSettings(ctx)).toEqual({ ...DEFAULT_SETTINGS, hasApiKey: false, demoAi: false, dataDir: ctx.tempDir })
    expect(DEFAULT_SETTINGS).toEqual({
      model: 'claude-opus-5-5',
      theme: 'system',
      focusMinutes: 25,
      breakMinutes: 5,
      newTopicsPerDay: 1,
      maxReviewsPerDay: 60,
      desiredRetention: 0.9
    })
  })

  it('stores updates and applies a theme change to the window', async () => {
    const updated = await updateSettings(ctx, { theme: 'dark', focusMinutes: 50, model: 'claude-haiku-4-5' })
    expect(updated).toMatchObject({ theme: 'dark', focusMinutes: 50, model: 'claude-haiku-4-5', breakMinutes: 5 })
    expect(ctx.desktop.themes).toEqual(['dark'])
    await updateSettings(ctx, { theme: 'dark' })
    expect(ctx.desktop.themes).toEqual(['dark'])
    expect(getThemePreference(ctx)).toBe('dark')
    expect(readStoredSettings(ctx).focusMinutes).toBe(50)
  })

  it('does not store anything when one field is invalid', async () => {
    await expectInvalidAsync(updateSettings(ctx, { focusMinutes: 30, breakMinutes: 99 }))
    expect(readStoredSettings(ctx).focusMinutes).toBe(25)
  })

  it('falls back to defaults for corrupt stored values', () => {
    ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('focusMinutes', '999'), ('theme', '\"neon\"')").run()
    expect(readStoredSettings(ctx)).toMatchObject({ focusMinutes: 25, theme: 'system' })
  })
})

describe('API key', () => {
  it('validates, stores encrypted, never returns the key, and clears', async () => {
    await expectInvalidAsync(setApiKey(ctx, '   '))
    await expectInvalidAsync(setApiKey(ctx, 'not-a-key'))
    await expectInvalidAsync(setApiKey(ctx, 'sk-ant-has space'))

    const settings = await setApiKey(ctx, '  sk-ant-test-123  ')
    expect(settings.hasApiKey).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('sk-ant-test-123')
    const stored = ctx.db.prepare("SELECT value FROM settings WHERE key = 'apiKey'").get() as { value: string }
    expect(stored.value).not.toContain('sk-ant-test-123')
    expect(getAiConfig(ctx)).toEqual({ apiKey: 'sk-ant-test-123', model: 'claude-opus-5-5', demo: false })

    expect((await clearApiKey(ctx)).hasApiKey).toBe(false)
    expect(getAiConfig(ctx).apiKey).toBeNull()
  })

  it('falls back to ANTHROPIC_API_KEY, and a stored key wins over it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-from-env')
    expect(getAiConfig(ctx).apiKey).toBe('sk-ant-from-env')
    expect((await getSettings(ctx)).hasApiKey).toBe(true)
    await setApiKey(ctx, 'sk-ant-stored')
    expect(getAiConfig(ctx).apiKey).toBe('sk-ant-stored')
  })

  it('treats a key that no longer decrypts as missing', () => {
    ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('apiKey', '\"enc:garbage\"')").run()
    expect(getAiConfig(ctx).apiKey).toBeNull()
  })

  it('reports demo mode from the context', () => {
    const demo = createTestContext({ demoAi: true })
    expect(getAiConfig(demo).demo).toBe(true)
    demo.cleanup()
  })
})

describe('desktop actions', () => {
  it('opens the data folder', async () => {
    await openDataFolder(ctx)
    expect(ctx.desktop.opened).toEqual([ctx.tempDir])
  })

  it('escapes quotes in SQL string literals', () => {
    expect(sqlStringLiteral("C:\\Users\\O'Brien\\backup.db")).toBe("'C:\\Users\\O''Brien\\backup.db'")
  })
})
