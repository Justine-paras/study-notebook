// Helpers shared by the services: lookups that throw NOT_FOUND, input
// validation that throws INVALID_INPUT, AI job progress, and small date maths.

import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import type { AiTask, Card, CardSchedule, Confidence, ID, Notebook, Topic } from '@shared/types'
import type { CallOptions, TopicBrief } from '../ai'
import type { AppContext } from '../context'
import { findNotebook } from '../db/repositories/notebooks'
import { findTopic } from '../db/repositories/topics'

export const DAY_MS = 24 * 60 * 60 * 1000

export function newId(): ID {
  return randomUUID()
}

export function nowIso(ctx: AppContext): string {
  return ctx.now().toISOString()
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `${what} was not found.`)
}

export function invalid(message: string): AppError {
  return new AppError('INVALID_INPUT', message)
}

export function requireNotebook(ctx: AppContext, id: ID): Notebook {
  const notebook = typeof id === 'string' ? findNotebook(ctx.db, id) : null
  if (!notebook) throw notFound('Notebook')
  return notebook
}

export function requireTopic(ctx: AppContext, id: ID): Topic {
  const topic = typeof id === 'string' ? findTopic(ctx.db, id) : null
  if (!topic) throw notFound('Topic')
  return topic
}

/** Trimmed non-empty string, or INVALID_INPUT naming the field. */
export function requireText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string') throw invalid(`${field} is required.`)
  const trimmed = value.trim()
  if (!trimmed) throw invalid(`${field} can't be empty.`)
  if (trimmed.length > maxLength) throw invalid(`${field} is too long (at most ${maxLength} characters).`)
  return trimmed
}

/** Trimmed string that may be empty; undefined becomes ''. */
export function optionalText(value: unknown, field: string, maxLength = 5_000): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid(`${field} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw invalid(`${field} is too long (at most ${maxLength} characters).`)
  return trimmed
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function requireLocalDate(value: unknown, field: string): string {
  if (!isLocalDate(value)) throw invalid(`${field} must be a date written as YYYY-MM-DD.`)
  return value
}

/** Normalises any parseable timestamp to the ISO form the database compares lexically. */
export function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw invalid(`${field} must be a date and time.`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw invalid(`${field} must be a date and time.`)
  return date.toISOString()
}

const CONFIDENCES: readonly Confidence[] = ['sure', 'unsure', 'guess']

export function requireConfidence(value: unknown): Confidence | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && (CONFIDENCES as readonly string[]).includes(value)) return value as Confidence
  throw invalid('Confidence must be sure, unsure or guess.')
}

/** An optional id filter: undefined or null means "no filter"; anything but a string is an input error. */
export function optionalId(value: unknown, field: string): ID | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalid(`${field} must be an id.`)
  return value
}

export function requireIdList(value: unknown, field: string): ID[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw invalid(`${field} must be a list of ids.`)
  return [...new Set(value as string[])]
}

/**
 * Deletes stored copies after their rows are gone. Best effort: on Windows a
 * file that is open in another app (a lecture PDF in a viewer) can't be
 * removed, and reporting the whole delete as failed would be wrong, since
 * the notebook or file is already gone from the app. The copy is left behind
 * in the library folder, where it is harmless.
 */
export async function removeStoredFiles(remove: () => Promise<void>, what: string): Promise<void> {
  try {
    await remove()
  } catch (err) {
    console.warn(`[library] could not remove ${what}:`, err instanceof Error ? err.message : err)
  }
}

export function topicBrief(topic: Topic): TopicBrief {
  return { id: topic.id, title: topic.title, description: topic.description, unitLabel: topic.unitLabel }
}

/** Local midnight at the start of the day after `now`. */
export function startOfNextLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
}

/** Local midnight `days` days before the start of today. */
export function startOfLocalDayOffset(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
}

/**
 * Normalised card front for de-duplication: case, whitespace and punctuation
 * differences shouldn't create a second copy of the same card.
 */
export function cardKey(front: string): string {
  return front
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function scheduleOf(card: Card): CardSchedule {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview
  }
}

/**
 * Runs one AI call as a "job": a fresh jobId, a start event, every streamed
 * progress update, and a final event, all sent to the renderer via
 * ctx.emitAiProgress so <AiWorking/> can show live progress.
 */
export async function runAiJob<T>(
  ctx: AppContext,
  job: { task: AiTask; subjectId: ID | null },
  startMessage: string,
  call: (options: CallOptions) => Promise<T>
): Promise<T> {
  const jobId = newId()
  const { task, subjectId } = job
  const emit = (progress: number | null, message: string): void => {
    try {
      ctx.emitAiProgress({ jobId, task, subjectId, progress, message })
    } catch {
      // A closed window must never fail the AI call itself.
    }
  }
  emit(0, startMessage)
  const result = await call({ onProgress: (_task, progress, message) => emit(progress, message || startMessage) })
  emit(1, 'Done')
  return result
}
