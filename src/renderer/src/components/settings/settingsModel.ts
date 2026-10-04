// Pure rules for the Settings screen (unit-tested in Node, no DOM).
// Ranges match the backend validators in src/main/services/settings.ts.

import type { Settings } from '@shared/types'

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
