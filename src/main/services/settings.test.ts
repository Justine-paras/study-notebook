import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@shared/errors'
import { OLLAMA_CONTEXT_SIZES } from '@shared/types'
import { createTestContext, type TestContext } from '../../../tests/unit/helpers/context'
import { forgetOllamaModelFacts } from '../ai/ollama'
import { closedPortUrl, FakeOllama } from '../ai/ollamaTestkit'
import {
  DEFAULT_SETTINGS,
  clearApiKey,
  exportBackup,
  getAiConfig,
  getSettings,
  getThemePreference,
  isLiveDatabaseFile,
  listOllamaModels,
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

function claudeApiKey(c: TestContext): string | null {
  const config = getAiConfig(c)
  if (config.provider !== 'claude') throw new Error('expected the Claude configuration')
  return config.apiKey
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
      aiProvider: 'claude',
      model: 'claude-opus-5-5',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: null,
      ollamaContextTokens: 16384,
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
    await expectInvalidAsync(setApiKey(ctx, `sk-ant-${'a'.repeat(1_000)}`))

    const settings = await setApiKey(ctx, '  sk-ant-test-123  ')
    expect(settings.hasApiKey).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('sk-ant-test-123')
    const stored = ctx.db.prepare("SELECT value FROM settings WHERE key = 'apiKey'").get() as { value: string }
    expect(stored.value).not.toContain('sk-ant-test-123')
    expect(getAiConfig(ctx)).toEqual({ provider: 'claude', apiKey: 'sk-ant-test-123', model: 'claude-opus-5-5', demo: false })

    expect((await clearApiKey(ctx)).hasApiKey).toBe(false)
    expect(claudeApiKey(ctx)).toBeNull()
  })

  it('falls back to ANTHROPIC_API_KEY, and a stored key wins over it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-from-env')
    expect(claudeApiKey(ctx)).toBe('sk-ant-from-env')
    expect((await getSettings(ctx)).hasApiKey).toBe(true)
    await setApiKey(ctx, 'sk-ant-stored')
    expect(claudeApiKey(ctx)).toBe('sk-ant-stored')
  })

  it('treats a key that no longer decrypts as missing', async () => {
    ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('apiKey', '\"enc:garbage\"')").run()
    expect(claudeApiKey(ctx)).toBeNull()
    // Settings must ask for the key again rather than claim one is saved.
    expect((await getSettings(ctx)).hasApiKey).toBe(false)
    expect((await setApiKey(ctx, 'sk-ant-again')).hasApiKey).toBe(true)
    expect(claudeApiKey(ctx)).toBe('sk-ant-again')
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
  })})

describe('exportBackup', () => {
  it('never writes the backup over the live database or its WAL files', async () => {
    const dbPath = join(ctx.tempDir, 'study.db')
    writeFileSync(dbPath, 'live database')
    ctx.paths.dbPath = dbPath
    for (const target of [dbPath, `${dbPath}-wal`, join(ctx.tempDir, '.', 'study.db')]) {
      ctx.desktop.savePath = target
      await expectInvalidAsync(exportBackup(ctx))
    }
    expect(readFileSync(dbPath, 'utf8')).toBe('live database')
    expect(isLiveDatabaseFile(':memory:', ':memory:')).toBe(false)
    expect(isLiveDatabaseFile(dbPath, join(ctx.tempDir, 'backup.db'))).toBe(false)
  })

  it('replaces an older backup only once the new one is written, leaving no temporary files', async () => {
    const target = join(ctx.tempDir, 'backup.db')
    writeFileSync(target, 'older backup')
    // VACUUM can't run inside a transaction, so this backup fails.
    ctx.db.exec('BEGIN')
    ctx.desktop.savePath = target
    await expect(exportBackup(ctx)).rejects.toMatchObject({ code: 'UNKNOWN' })
    ctx.db.exec('ROLLBACK')
    expect(readFileSync(target, 'utf8')).toBe('older backup')

    await setApiKey(ctx, 'sk-ant-in-backup')
    expect(await exportBackup(ctx)).toEqual({ path: target })
    const copy = new DatabaseSync(target)
    expect(copy.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'apiKey'").get()).toEqual({ n: 1 })
    copy.close()
    expect(readdirSync(ctx.tempDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('AI provider settings', () => {
  it('builds the Ollama configuration from the saved settings', async () => {
    await updateSettings(ctx, { aiProvider: 'ollama', ollamaUrl: ' localhost:11500/ ', ollamaModel: ' qwen3:8b ', ollamaContextTokens: 32768 })
    expect(getAiConfig(ctx)).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11500', model: 'qwen3:8b', contextTokens: 32768, demo: false })
    expect(readStoredSettings(ctx)).toMatchObject({ aiProvider: 'ollama', ollamaUrl: 'http://localhost:11500', ollamaModel: 'qwen3:8b' })
    await updateSettings(ctx, { ollamaModel: null })
    expect(getAiConfig(ctx)).toMatchObject({ provider: 'ollama', model: null })

    // Switching back to Claude keeps the Ollama choices for later.
    await updateSettings(ctx, { aiProvider: 'claude' })
    expect(getAiConfig(ctx)).toEqual({ provider: 'claude', apiKey: null, model: 'claude-opus-5-5', demo: false })
    expect(readStoredSettings(ctx).ollamaUrl).toBe('http://localhost:11500')
  })

  it('keeps hasApiKey meaning a Claude key is available, whatever the provider', async () => {
    await updateSettings(ctx, { aiProvider: 'ollama' })
    expect((await getSettings(ctx)).hasApiKey).toBe(false)
    await setApiKey(ctx, 'sk-ant-kept')
    expect((await getSettings(ctx)).hasApiKey).toBe(true)
    expect(getAiConfig(ctx)).not.toHaveProperty('apiKey')
    await updateSettings(ctx, { aiProvider: 'claude' })
    expect(claudeApiKey(ctx)).toBe('sk-ant-kept')
  })

  it('reports demo mode for Ollama too', async () => {
    const demo = createTestContext({ demoAi: true })
    await updateSettings(demo, { aiProvider: 'ollama' })
    expect(getAiConfig(demo)).toMatchObject({ provider: 'ollama', demo: true })
    demo.cleanup()
  })

  it('accepts every listed context size and valid model names', () => {
    for (const size of OLLAMA_CONTEXT_SIZES) expect(validateSettingsUpdate({ ollamaContextTokens: size })).toEqual({ ollamaContextTokens: size })
    for (const name of ['qwen3:8b', 'llama3.2', 'hf.co/user/repo:Q4_K_M', 'my-model_v2.1:latest', 'library/gemma3@sha256']) {
      expect(validateSettingsUpdate({ ollamaModel: name })).toEqual({ ollamaModel: name })
    }
    expect(validateSettingsUpdate({ aiProvider: 'ollama', ollamaUrl: 'https://box.local:8443' })).toEqual({ aiProvider: 'ollama', ollamaUrl: 'https://box.local:8443' })
  })

  const junk: unknown[] = [null, true, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', ' ', [], {}, ['ollama'], () => 'ollama', Symbol('x'), 'x'.repeat(10_000)]
  const cases: [string, unknown[]][] = [
    ['aiProvider', [...junk, 'Claude', 'OLLAMA', 'openai', 'claude ']],
    ['ollamaUrl', [...junk.filter((v) => v !== null), 'ftp://host', 'file:///etc/passwd', 'http://user:pass@host', 'http://host?x=1', 'http://host/#frag', 'http://', `http://${'a'.repeat(300)}.com`, 'javascript:alert(1)']],
    ['ollamaModel', [...junk.filter((v) => v !== null), 'qwen3 8b', 'model;rm -rf', 'a\nb', '<script>', 'café', 'x'.repeat(201)]],
    ['ollamaContextTokens', [...junk, 4096, 8191, 8192.5, 262144, '8192', 2 ** 53]]
  ]
  it.each(cases)('rejects bad values for %s', (field, values) => {
    for (const value of values) expectInvalid(() => validateSettingsUpdate({ [field]: value }))
  })

  it('falls back to the defaults for corrupt stored Ollama values', () => {
    ctx.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('aiProvider', '\"gpt\"'), ('ollamaUrl', '\"ftp://x\"'), ('ollamaModel', '42'), ('ollamaContextTokens', '1234')"
      )
      .run()
    expect(readStoredSettings(ctx)).toMatchObject({ aiProvider: 'claude', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: null, ollamaContextTokens: 16384 })
  })
})

describe('listOllamaModels', () => {
  let fake: FakeOllama

  beforeEach(async () => {
    fake = await FakeOllama.start()
    fake.tags = { status: 200, body: { models: [{ name: 'qwen3:8b', size: 5, details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M' } }] } }
  })
  afterEach(async () => {
    await fake.close()
    forgetOllamaModelFacts()
  })

  it('normalizes an address typed before saving it', async () => {
    const typed = ` ${fake.url.replace('http://', '')}/ `
    await expect(listOllamaModels(ctx, typed)).resolves.toEqual({
      ok: true,
      message: 'Found 1 model in Ollama.',
      models: [{ name: 'qwen3:8b', sizeBytes: 5, parameterSize: '8.2B', quantization: 'Q4_K_M' }]
    })
    expect(fake.requests.map((r) => r.path)).toEqual(['/api/tags'])
  })

  it('uses the saved address when none is given', async () => {
    await updateSettings(ctx, { ollamaUrl: fake.url })
    await expect(listOllamaModels(ctx)).resolves.toMatchObject({ ok: true })
  })

  it('rejects a bad address and reports an unreachable one without throwing', async () => {
    await expectInvalidAsync(listOllamaModels(ctx, 'ftp://example.com'))
    const url = await closedPortUrl()
    await expect(listOllamaModels(ctx, url)).resolves.toMatchObject({ ok: false, message: expect.stringContaining(url), models: [] })
  })
})
