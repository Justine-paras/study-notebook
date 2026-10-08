// Pure rules for the Settings screen (unit-tested in Node, no DOM).
// Ranges match the backend validators in src/main/services/settings.ts.

import {
  OLLAMA_CONTEXT_SIZES,
  type AiProvider,
  type OllamaContextSize,
  type OllamaModelInfo,
  type Settings
} from '@shared/types'
import type { SelectOption } from '../ui'

export type NumberSettingKey = 'focusMinutes' | 'breakMinutes' | 'newTopicsPerDay' | 'maxReviewsPerDay'

export interface NumberSettingSpec {
  key: NumberSettingKey
  label: string
  /** Used in the toast: "<noun> saved". */
  noun: string
  min: number
  max: number
  hint: string
}

export const NUMBER_SETTINGS: Record<NumberSettingKey, NumberSettingSpec> = {
  focusMinutes: {
    key: 'focusMinutes',
    label: 'Focus minutes',
    noun: 'Focus length',
    min: 5,
    max: 90,
    hint: '25 is the classic Pomodoro. From 5 to 90.'
  },
  breakMinutes: {
    key: 'breakMinutes',
    label: 'Break minutes',
    noun: 'Break length',
    min: 1,
    max: 30,
    hint: 'Starts on its own after each focus block. From 1 to 30.'
  },
  newTopicsPerDay: {
    key: 'newTopicsPerDay',
    label: 'New topics per day',
    noun: 'New topics per day',
    min: 0,
    max: 5,
    hint: 'How many topics to start in a day. 0 pauses new topics.'
  },
  maxReviewsPerDay: {
    key: 'maxReviewsPerDay',
    label: 'Most reviews per day',
    noun: 'Daily review limit',
    min: 10,
    max: 500,
    hint: 'The most overdue cards come first when there are more. From 10 to 500.'
  }
}

export type ParsedNumber = { ok: true; value: number } | { ok: false; error: string }

/** Reads a whole number typed into a field, with a learner-facing error when it is out of range. */
export function parseWholeNumber(raw: string, min: number, max: number): ParsedNumber {
  const text = raw.trim()
  if (text === '') return { ok: false, error: `Enter a number from ${min} to ${max}.` }
  if (!/^-?\d+$/.test(text)) return { ok: false, error: 'Use a whole number.' }
  const value = Number(text)
  if (value < min || value > max) return { ok: false, error: `Use a number from ${min} to ${max}.` }
  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// Desired retention
// ---------------------------------------------------------------------------

export const RETENTION_MIN = 0.8
export const RETENTION_MAX = 0.97
export const RETENTION_STEP = 0.01

export function formatRetention(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Explains what the chosen retention means in practice. */
export function retentionHint(value: number): string {
  const percent = Math.round(value * 100)
  const outOfTen = Math.round(value * 10)
  const base = `At ${percent}%, cards come back when you would still remember about ${outOfTen} in 10 of them.`
  if (percent >= 94) return `${base} Very safe, but expect many more reviews each day.`
  if (percent >= 88) return `${base} A good balance between remembering and time spent.`
  return `${base} Fewer reviews, but you will forget more before they come back.`
}

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------

/** Error text for a pasted key, or null when it looks usable (the backend and "Test connection" do the real check). */
export function apiKeyInputError(raw: string): string | null {
  const key = raw.trim()
  if (!key) return 'Paste your API key first.'
  if (/\s/.test(key)) return 'That has a space or line break in it. Copy the key again and paste only the key.'
  if (key.length < 20) return 'That looks too short to be an API key.'
  return null
}

export type ApiKeyStatus = 'saved' | 'missing' | 'demo'

export function apiKeyStatus(settings: Pick<Settings, 'hasApiKey' | 'demoAi'>): ApiKeyStatus {
  if (settings.hasApiKey) return 'saved'
  return settings.demoAi ? 'demo' : 'missing'
}

export const API_KEY_STATUS_TEXT: Record<ApiKeyStatus, string> = {
  saved: 'Saved on this computer',
  missing: 'No key added yet',
  demo: 'Not needed in demo mode'
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

export const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'ollama', label: 'Ollama' }
]

/** Model size the way `ollama list` prints it (decimal units), so the two match: "5.2 GB", "980 MB". */
export function formatModelSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** "qwen3:8b · 8.2B · Q4_K_M · 5.2 GB", leaving out what Ollama didn't report. */
export function ollamaModelLabel(model: OllamaModelInfo): string {
  const details = [model.parameterSize, model.quantization, formatModelSize(model.sizeBytes)].filter(
    (part): part is string => !!part && part.trim() !== ''
  )
  return [model.name, ...details].join(' · ')
}

/**
 * Options for the model select. The saved model stays listed even when it
 * is gone from Ollama, so the select never silently shows another model;
 * it is only called "not installed" when Ollama actually answered.
 */
export function ollamaModelOptions(models: readonly OllamaModelInfo[], saved: string | null, listed: boolean): SelectOption[] {
  const options = models.map((m) => ({ value: m.name, label: ollamaModelLabel(m) }))
  if (saved && !models.some((m) => m.name === saved)) {
    options.unshift({ value: saved, label: listed ? `${saved} (not installed)` : saved })
  }
  return options
}

/** True when Ollama answered and the saved model isn't among its models. */
export function isMissingOllamaModel(models: readonly OllamaModelInfo[], saved: string | null): boolean {
  return saved !== null && !models.some((m) => m.name === saved)
}

const CONTEXT_NOTES: Partial<Record<OllamaContextSize, string>> = {
  8192: 'least memory',
  16384: 'recommended',
  131072: 'needs a lot of memory'
}

export const OLLAMA_CONTEXT_OPTIONS: SelectOption[] = OLLAMA_CONTEXT_SIZES.map((size) => {
  const note = CONTEXT_NOTES[size]
  const label = `${size / 1024}K tokens`
  return { value: String(size), label: note ? `${label} (${note})` : label }
})

/** The context size picked in the select, or null for anything that isn't one of the sizes. */
export function parseContextSize(value: string): OllamaContextSize | null {
  const size = Number(value)
  return (OLLAMA_CONTEXT_SIZES as readonly number[]).includes(size) ? (size as OllamaContextSize) : null
}

/** Commands for the setup help: a mid-size model, and a smaller one for laptops with 8 GB of memory. */
export const OLLAMA_PULL_COMMAND = 'ollama pull qwen3:8b'
export const OLLAMA_PULL_COMMAND_SMALL = 'ollama pull qwen3:4b'

export type OllamaStatus = 'demo' | 'checking' | 'unreachable' | 'no-models' | 'choose' | 'missing' | 'ready'

/**
 * Where the learner stands with Ollama, from its model list (undefined while
 * it loads). In demo mode Ollama isn't used, so it isn't looked for either.
 */
export function ollamaStatus(
  list: { ok: boolean; models: readonly OllamaModelInfo[] } | undefined,
  saved: string | null,
  demo = false
): OllamaStatus {
  if (demo) return 'demo'
  if (!list) return 'checking'
  if (!list.ok) return 'unreachable'
  if (list.models.length === 0) return 'no-models'
  if (saved === null) return 'choose'
  return isMissingOllamaModel(list.models, saved) ? 'missing' : 'ready'
}

export const OLLAMA_STATUS_TEXT: Record<OllamaStatus, string> = {
  demo: 'Not needed in demo mode',
  checking: 'Looking for Ollama…',
  unreachable: "Can't reach Ollama",
  'no-models': 'Ollama is running, but has no models yet',
  choose: 'Ollama is running. Choose a model.',
  missing: "Your model isn't installed",
  ready: 'Ollama is running'
}
