// Pure formatting helpers and display constants shared by every screen.
// No DOM access here: this module is unit-tested in Node.

import type { CSSProperties } from 'react'
import {
  NOTEBOOK_COLORS,
  type Confidence,
  type MasteryState,
  type NotebookColor,
  type PathStep,
  type Rating,
  type SourceKind
} from '@shared/types'

export const LEARNER_NAME = 'Justine'

// A fixed locale keeps dates identical across machines (and in tests).
const LOCALE = 'en-US'

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

export function timeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours()
  // Late-night study (midnight to 4am) still reads as "evening".
  if (hour >= 4 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** "Good afternoon, Justine". */
export function greeting(date: Date = new Date(), name: string = LEARNER_NAME): string {
  return `Good ${timeOfDay(date)}, ${name}`
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type DateInput = Date | string | number

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Parses an ISO timestamp, a local calendar date ("YYYY-MM-DD"), epoch ms or a
 * Date. Calendar dates are read as local midnight: `new Date('2026-10-12')`
 * would be UTC midnight and show the previous day west of Greenwich.
 */
export function parseDate(input: DateInput): Date {
  if (input instanceof Date) return new Date(input.getTime())
  if (typeof input === 'number') return new Date(input)
  const match = LOCAL_DATE_RE.exec(input)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Date(input)
}

export function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar date "YYYY-MM-DD" (the format of `Exam.examDate`). */
export function toLocalDateKey(input: DateInput = new Date()): string {
  const d = parseDate(input)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Whole calendar days from `from` to `to` in local time (negative when `to` is earlier). */
export function daysBetween(from: DateInput, to: DateInput): number {
  const a = parseDate(from)
  const b = parseDate(to)
  // Date.UTC on the local y/m/d ignores DST shifts that would make a day 23 or 25 hours.
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / 86_400_000)
}

export function addDays(input: DateInput, days: number): Date {
  const d = parseDate(input)
  d.setDate(d.getDate() + days)
  return d
}

export type DateStyle =
  /** "Saturday, October 3" */
  | 'full'
  /** "Oct 3" */
  | 'medium'
  /** "Sat" */
  | 'weekday'
  /** "Sat, Oct 3" */
  | 'weekday-short'
  /** "3:45 PM" */
  | 'time'
  /** "Oct 3, 3:45 PM" */
  | 'datetime'

/**
 * Formats a date for display. The year is added when it differs from `now`'s
 * year, so "Oct 3" never silently means a different year.
 * Returns an empty string for invalid input.
 */
export function formatDate(input: DateInput, style: DateStyle = 'medium', now: Date = new Date()): string {
  const d = parseDate(input)
  if (!isValidDate(d)) return ''
  const otherYear = d.getFullYear() !== now.getFullYear()
  const year = otherYear ? ({ year: 'numeric' } as const) : {}
  switch (style) {
    case 'full':
      return d.toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', ...year })
    case 'medium':
      return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', ...year })
    case 'weekday':
      return d.toLocaleDateString(LOCALE, { weekday: 'short' })
    case 'weekday-short':
      return d.toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', ...year })
    case 'time':
      return d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })
    case 'datetime':
      return d.toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...year })
  }
}

/**
 * Relative calendar distance: "today", "tomorrow", "yesterday", "in 3 days",
 * "3 days ago", "in 2 weeks", "in 3 months".
 */
export function formatRelativeDays(input: DateInput, now: Date = new Date()): string {
  const d = parseDate(input)
  if (!isValidDate(d)) return ''
  return formatDayCount(daysBetween(now, d))
}

/** Same wording as formatRelativeDays for a precomputed day count (e.g. `UpcomingExam.daysLeft`). */
export function formatDayCount(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const abs = Math.abs(days)
  let amount: string
  if (abs < 14) amount = pluralize(abs, 'day')
  else if (abs < 60) amount = pluralize(Math.round(abs / 7), 'week')
  else if (abs < 365) amount = pluralize(Math.round(abs / 30), 'month')
  else amount = pluralize(Math.round(abs / 365), 'year')
  return days > 0 ? `in ${amount}` : `${amount} ago`
}

// ---------------------------------------------------------------------------
// Numbers, durations, text
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * "1 card", "3 cards", "1 quiz", "2 quizzes" (pass the plural for irregular
 * words). `includeCount: false` returns just the word.
 */
export function pluralize(count: number, singular: string, plural?: string, includeCount = true): string {
  const word = count === 1 ? singular : (plural ?? defaultPlural(singular))
  return includeCount ? `${count.toLocaleString(LOCALE)} ${word}` : word
}

function defaultPlural(word: string): string {
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es'
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies'
  return word + 's'
}

/** "45 min", "1 h", "1 h 20 min". Rounds to whole minutes. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * Clock display for timers: "25:00", "4:59", "1:02:03".
 * Takes seconds; pass Math.ceil(ms / 1000) for countdowns so 0:00 shows only at the end.
 */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`
}

/** "68%", or the fallback for null/NaN. Rounds to a whole percent. */
export function formatPercent(value: number | null | undefined, fallback = '–'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  return `${Math.round(value)}%`
}

/** "820 B", "12 KB", "3.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

/** "A", "A and B", "A, B and C". */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Number of Pomodoros a plan of `totalMinutes` takes (at least 1 when there is anything to do). */
export function pomodoroCount(totalMinutes: number, focusMinutes: number): number {
  if (totalMinutes <= 0 || focusMinutes <= 0) return 0
  return Math.ceil(totalMinutes / focusMinutes)
}

// ---------------------------------------------------------------------------
// Notebook colors
// ---------------------------------------------------------------------------

export const NOTEBOOK_COLOR_LABELS: Record<NotebookColor, string> = {
  blue: 'Blue',
  orange: 'Orange',
  teal: 'Teal',
  purple: 'Purple',
  green: 'Green',
  pink: 'Pink',
  slate: 'Slate',
  gold: 'Gold'
}

export function isNotebookColor(value: string): value is NotebookColor {
  return (NOTEBOOK_COLORS as readonly string[]).includes(value)
}

export interface NotebookColorVars {
  /** Cover color (same in both themes). */
  cover: string
  /** Light background tint (darker in dark mode). */
  tint: string
  /** Text color to use on the tint. */
  ink: string
}

/** CSS var() references for a notebook color, e.g. cover = "var(--nb-blue)". */
export function notebookColorVars(color: NotebookColor): NotebookColorVars {
  return {
    cover: `var(--nb-${color})`,
    tint: `var(--nb-${color}-tint)`,
    ink: `var(--nb-${color}-ink)`
  }
}

/**
 * Inline style that sets --notebook, --notebook-tint and --notebook-ink, so
 * CSS inside the element can use the notebook's colors without knowing which
 * one it is: `<div style={notebookStyle(nb.color)} className="x">` and
 * `.x { background: var(--notebook-tint); color: var(--notebook-ink) }`.
 */
export function notebookStyle(color: NotebookColor): CSSProperties {
  const vars = notebookColorVars(color)
  return {
    '--notebook': vars.cover,
    '--notebook-tint': vars.tint,
    '--notebook-ink': vars.ink
  } as CSSProperties
}

// ---------------------------------------------------------------------------
// Learning labels
// ---------------------------------------------------------------------------

export const MASTERY_LABELS: Record<MasteryState, string> = {
  not_started: 'Not started',
  learning: 'Learning',
  weak: 'Weak',
  reviewing: 'Reviewing',
  mastered: 'Mastered'
}

/** Order used by legends (strongest first, as in the prototype). */
export const MASTERY_LEGEND_ORDER: readonly MasteryState[] = ['mastered', 'reviewing', 'learning', 'weak', 'not_started']

export interface MasteryColorVars {
  /** Pill background. */
  bg: string
  /** Bars, dots and borders. */
  fg: string
  /** Text on the pill background (meets 4.5:1). */
  ink: string
}

export function masteryColorVars(state: MasteryState): MasteryColorVars {
  const key = state.replace('_', '-')
  return {
    bg: `var(--mastery-${key}-bg)`,
    fg: `var(--mastery-${key}-fg)`,
    ink: `var(--mastery-${key}-ink)`
  }
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  sure: 'Sure',
  unsure: 'Unsure',
  guess: 'Guessing'
}

export const CONFIDENCE_ORDER: readonly Confidence[] = ['sure', 'unsure', 'guess']

export const RATING_LABELS: Record<Rating, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy'
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  syllabus: 'Syllabus',
  lecture: 'Lecture',
  slides: 'Slides',
  quiz: 'Quiz',
  exam: 'Past exam',
  notes: 'Notes',
  other: 'Other'
}

export const PATH_STEP_LABELS: Record<PathStep, { label: string; hint: string }> = {
  warmup: { label: 'Warm-up', hint: 'Guess first' },
  learn: { label: 'Learn', hint: 'In small parts' },
  explain: { label: 'Explain it', hint: 'In your words' },
  practice: { label: 'Practice', hint: 'Mixed questions' },
  remember: { label: 'Remember', hint: 'Review plan' }
}
