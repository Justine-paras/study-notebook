// Pure logic for the topic learning path: which step to show, which steps
// count as done, when to persist progress, and small lesson helpers. No DOM or
// React here (unit-tested in Node).

import {
  PATH_STEPS,
  type CardOrigin,
  type ID,
  type KeyTerm,
  type PathStep,
  type Source,
  type Topic
} from '@shared/types'

type PathState = Topic['pathStep']

export function parseStep(value: string | null | undefined): PathStep | null {
  return (PATH_STEPS as readonly string[]).includes(value ?? '') ? (value as PathStep) : null
}

export function stepIndex(step: PathStep): number {
  return PATH_STEPS.indexOf(step)
}

/** Index of the furthest step reached: -1 not started, 0-4 a step, 5 when the path is done. */
export function furthestIndex(pathStep: PathState): number {
  if (pathStep === null) return -1
  if (pathStep === 'done') return PATH_STEPS.length
  return stepIndex(pathStep)
}

/** The step to open when the URL names none: where the learner left off. */
export function defaultStep(pathStep: PathState): PathStep {
  if (pathStep === null) return 'warmup'
  if (pathStep === 'done') return 'remember'
  return pathStep
}

/** The step the URL asks for, or where the learner left off. */
export function resolveStep(param: string | null, pathStep: PathState): PathStep {
  return parseStep(param) ?? defaultStep(pathStep)
}

export type StepStatus = 'done' | 'current' | 'upcoming'

export interface StepView {
  step: PathStep
  number: number
  status: StepStatus
  /** The step the learner should do next (emphasised, never locked). */
  recommended: boolean
}

export function stepViews(current: PathStep, pathStep: PathState): StepView[] {
  const furthest = furthestIndex(pathStep)
  const recommendedIndex = pathStep === 'done' ? -1 : Math.max(0, furthest)
  return PATH_STEPS.map((step, index) => ({
    step,
    number: index + 1,
    status: step === current ? 'current' : index < furthest ? 'done' : 'upcoming',
    recommended: index === recommendedIndex && step !== current
  }))
}

/**
 * Progress is saved forward only: the topic remembers the furthest step
 * reached, so revisiting an earlier step never makes later ones look undone,
 * and "Continue" resumes where the learner actually got to. A finished topic
 * stays finished.
 */
export function shouldPersistStep(target: PathStep, pathStep: PathState): boolean {
  return pathStep !== 'done' && stepIndex(target) > furthestIndex(pathStep)
}

/**
 * Chunk progress is saved while Learn is (or is about to become) the
 * furthest step; rereading a finished lesson doesn't move the bookmark.
 */
export function shouldPersistChunk(pathStep: PathState): boolean {
  return pathStep !== 'done' && furthestIndex(pathStep) <= stepIndex('learn')
}

/** Lesson parts already passed (their checks need not be answered again). */
export function passedChunks(pathStep: PathState, chunkIndex: number, chunkCount: number): number {
  const furthest = furthestIndex(pathStep)
  if (furthest > stepIndex('learn')) return chunkCount
  if (pathStep === 'learn') return Math.min(Math.max(0, chunkIndex), chunkCount)
  return 0
}

/** The part to open in Learn: the saved part while learning, the first part when rereading. */
export function initialChunk(pathStep: PathState, chunkIndex: number, chunkCount: number): number {
  if (chunkCount <= 0) return 0
  if (pathStep !== 'learn') return 0
  return Math.min(Math.max(0, chunkIndex), chunkCount - 1)
}

// ---------------------------------------------------------------------------
// Lesson helpers
// ---------------------------------------------------------------------------

/** Key terms that appear in a lesson part, for the handwritten margin notes. */
export function termsInText(terms: readonly KeyTerm[], text: string, max = 3): KeyTerm[] {
  const haystack = text.toLowerCase()
  return terms.filter((t) => t.term.trim().length > 1 && haystack.includes(t.term.trim().toLowerCase())).slice(0, max)
}

/** Shortens a definition for a margin note, cutting at a word boundary. */
export function shortNote(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

export interface LinkedConnection {
  text: string
  topics: { id: ID; title: string }[]
}

/** Matches "Connects to" notes with topics of the notebook named in them, so they can link there. */
export function linkConnections(
  connections: readonly string[],
  topics: readonly { id: ID; title: string }[],
  selfId: ID
): LinkedConnection[] {
  const candidates = topics.filter((t) => t.id !== selfId && t.title.trim().length >= 3)
  return connections.map((text) => {
    const lower = text.toLowerCase()
    return { text, topics: candidates.filter((t) => lower.includes(t.title.trim().toLowerCase())).map(({ id, title }) => ({ id, title })) }
  })
}

/**
 * The files a new lesson will be built from, mirroring the backend: the
 * topic's own files when set, otherwise every ready file of the notebook
 * except past exams and quizzes (those shape quiz questions, not lessons).
 */
export function lessonSourcesPreview(topic: Pick<Topic, 'sourceIds'>, sources: readonly Source[]): Source[] {
  if (topic.sourceIds.length > 0) {
    const wanted = new Set(topic.sourceIds)
    return sources.filter((s) => wanted.has(s.id) && s.status === 'ready')
  }
  return sources.filter((s) => s.status === 'ready' && s.kind !== 'exam' && s.kind !== 'quiz')
}

export type OriginTone = 'info' | 'bad' | 'warn' | 'neutral'

export const CARD_ORIGIN_TAGS: Record<CardOrigin, { label: string; tone: OriginTone }> = {
  lesson: { label: 'from the lesson', tone: 'info' },
  mistake: { label: 'you missed this', tone: 'bad' },
  explanation: { label: 'from your explanation', tone: 'warn' },
  manual: { label: 'added by you', tone: 'neutral' }
}

// ---------------------------------------------------------------------------
// Instant answers (warm-up and checks)
// ---------------------------------------------------------------------------

export interface InstantAnswer {
  response: string
  correct: boolean
}

export type InstantAnswers = Readonly<Record<string, InstantAnswer>>

/** Stable key of a lesson question (ids are normally present; the prompt is a fallback). */
export function questionKey(question: { id: ID; prompt: string }): string {
  return question.id || question.prompt
}

/** localStorage key holding the warm-up and check answers of one lesson. */
export function lessonAnswersStorageKey(lessonId: ID): string {
  return `study:lesson-answers:${lessonId}`
}

export function explainDraftStorageKey(lessonId: ID): string {
  return `study:explain:${lessonId}`
}

/** Accepts only well-formed stored answers (storage may hold anything). */
export function parseInstantAnswers(value: unknown): Record<string, InstantAnswer> {
  if (typeof value !== 'object' || value === null) return {}
  const result: Record<string, InstantAnswer> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { response, correct } = entry as Partial<InstantAnswer>
    if (typeof response === 'string' && typeof correct === 'boolean') result[key] = { response, correct }
  }
  return result
}
