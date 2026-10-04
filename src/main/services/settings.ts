// Settings service helpers. OWNER: backend agent.

import { rm } from 'node:fs/promises'
import { AppError } from '@shared/errors'
import { localDate } from '@shared/learning'
import { AI_MODELS, type AiModelId, type Settings, type SettingsUpdate, type ThemePref } from '@shared/types'
import type { AiConfig } from '../ai'
import type { AppContext } from '../context'
import { deleteSetting, readSetting, readSettingRows, writeSetting } from '../db/repositories/settings'
import { transaction } from '../db/sql'
import { invalid } from './common'

/** The learner-editable settings (everything in Settings except the read-only fields). */
export type StoredSettings = Required<SettingsUpdate>

export const DEFAULT_SETTINGS: StoredSettings = {
  model: 'claude-opus-5-5',
  theme: 'system',
  focusMinutes: 25,
  breakMinutes: 5,
  newTopicsPerDay: 1,
  maxReviewsPerDay: 60,
  desiredRetention: 0.9
}

const API_KEY_SETTING = 'apiKey'
const THEMES: readonly ThemePref[] = ['system', 'light', 'dark']
const MODEL_IDS = AI_MODELS.map((m) => m.id) as readonly string[]

type Validator<K extends keyof StoredSettings> = (value: unknown) => StoredSettings[K]

function integerIn(field: string, min: number, max: number): (value: unknown) => number {
  return (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw invalid(`${field} must be a whole number from ${min} to ${max}.`)
    }
    return value
  }
}

const VALIDATORS: { [K in keyof StoredSettings]: Validator<K> } = {
  model: (value) => {
    if (typeof value !== 'string' || !MODEL_IDS.includes(value)) throw invalid('Choose one of the listed AI models.')
    return value as AiModelId
  },
  theme: (value) => {
    if (typeof value !== 'string' || !(THEMES as readonly string[]).includes(value)) throw invalid('Theme must be system, light or dark.')
    return value as ThemePref
  },
  focusMinutes: integerIn('Focus minutes', 5, 90),
  breakMinutes: integerIn('Break minutes', 1, 30),
  newTopicsPerDay: integerIn('New topics per day', 0, 5),
  maxReviewsPerDay: integerIn('Max reviews per day', 10, 500),
  desiredRetention: (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.8 || value > 0.97) {
      throw invalid('Desired retention must be between 0.80 and 0.97.')
    }
    // Store two decimals: a slider can emit 0.9000000000000001.
    return Math.round(value * 100) / 100
  }
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof StoredSettings)[]

/**
 * Validates a settings patch and returns only the editable fields it sets.
 * Read-only fields (hasApiKey, demoAi, dataDir) and unknown keys are ignored
 * so the renderer can send back a whole Settings object safely.
 */
export function validateSettingsUpdate(patch: unknown): SettingsUpdate {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw invalid('Settings update must be an object.')
  const source = patch as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    if (source[key] === undefined) continue
    clean[key] = VALIDATORS[key](source[key])
  }
  return clean as SettingsUpdate
}

/** Stored settings merged over the defaults. An invalid stored value falls back to its default. */
export function readStoredSettings(ctx: AppContext): StoredSettings {
  const stored = readSettingRows(ctx.db)
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of SETTING_KEYS) {
    if (!stored.has(key)) continue
    try {
      result[key] = VALIDATORS[key](stored.get(key))
    } catch {
      // Keep the default.
    }
  }
  return result as StoredSettings
}

function storedApiKey(ctx: AppContext): string | null {
  const cipher = readSetting(ctx.db, API_KEY_SETTING)
  if (typeof cipher !== 'string' || !cipher) return null
  try {
    const key = ctx.desktop.decrypt(cipher)
    return key ? key : null
  } catch {
    // The OS keychain changed (new Windows profile, restored backup): treat as no key.
    return null
  }
}

function envApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  return key ? key : null
}

/** Current AI configuration: stored (decrypted) API key or ANTHROPIC_API_KEY, chosen model, demo flag. */
export function getAiConfig(ctx: AppContext): AiConfig {
  return {
    apiKey: storedApiKey(ctx) ?? envApiKey(),
    model: readStoredSettings(ctx).model,
    demo: ctx.demoAi
  }
}

/** Applies the stored theme preference to the native window chrome at startup. */
export function getThemePreference(ctx: AppContext): 'system' | 'light' | 'dark' {
  return readStoredSettings(ctx).theme
}

export async function getSettings(ctx: AppContext): Promise<Settings> {
  const stored = readStoredSettings(ctx)
  const hasStoredKey = typeof readSetting(ctx.db, API_KEY_SETTING) === 'string'
  return {
    ...stored,
    hasApiKey: hasStoredKey || envApiKey() !== null,
    demoAi: ctx.demoAi,
    dataDir: ctx.paths.dataDir
  }
}

export async function updateSettings(ctx: AppContext, patch: SettingsUpdate): Promise<Settings> {
  const clean = validateSettingsUpdate(patch)
  const before = readStoredSettings(ctx)
  transaction(ctx.db, () => {
    for (const [key, value] of Object.entries(clean)) writeSetting(ctx.db, key, value)
  })
  if (clean.theme !== undefined && clean.theme !== before.theme) ctx.desktop.setTheme(clean.theme)
  return getSettings(ctx)
}

export async function setApiKey(ctx: AppContext, key: string): Promise<Settings> {
  const trimmed = typeof key === 'string' ? key.trim() : ''
  if (!trimmed) throw invalid('Paste your Anthropic API key first.')
  if (!trimmed.startsWith('sk-ant-') || /\s/.test(trimmed)) {
    throw invalid('That does not look like an Anthropic API key (they start with "sk-ant-").')
  }
  writeSetting(ctx.db, API_KEY_SETTING, ctx.desktop.encrypt(trimmed))
  return getSettings(ctx)
}

export async function clearApiKey(ctx: AppContext): Promise<Settings> {
  deleteSetting(ctx.db, API_KEY_SETTING)
  return getSettings(ctx)
}

export async function testApiKey(ctx: AppContext): Promise<{ ok: boolean; message: string }> {
  return ctx.ai.testConnection()
}

/** SQL string literal for a file path (VACUUM INTO does not accept bound parameters on every SQLite build). */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export async function exportBackup(ctx: AppContext): Promise<{ path: string } | null> {
  const path = await ctx.desktop.saveDialog(`study-notebook-backup-${localDate(ctx.now())}.db`)
  if (!path) return null
  // VACUUM INTO refuses to overwrite; the save dialog already confirmed replacing the file.
  await rm(path, { force: true })
  try {
    ctx.db.exec(`VACUUM INTO ${sqlStringLiteral(path)}`)
  } catch (err) {
    throw new AppError('UNKNOWN', `Couldn't write the backup: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { path }
}

export async function openDataFolder(ctx: AppContext): Promise<void> {
  await ctx.desktop.openPath(ctx.paths.dataDir)
}
