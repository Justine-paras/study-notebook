// Live progress of long AI calls (lesson, quiz, syllabus...). The main process
// streams AiProgressEvents over the bridge while a generation runs; this hook
// keeps the latest one for a task so <AiWorking> can show what is happening.

import { useEffect, useState } from 'react'
import type { AiProgressEvent, AiTask, ID } from '@shared/types'

/** Subscribes to every AI progress event. Returns an unsubscribe function (a no-op outside Electron). */
export function subscribeAiProgress(listener: (event: AiProgressEvent) => void): () => void {
  if (typeof window === 'undefined' || !window.studyBridge) return () => {}
  return window.studyBridge.onAiProgress(listener)
}

export interface ReceivedProgress {
  event: AiProgressEvent
  /** Renderer clock (epoch ms) when the event arrived. */
  receivedAt: number
}

// The latest event of each task (and of each task and subject), kept for the
// whole app session: a progress panel that mounts while a job is already
// running (the learner left the page and came back) shows where the job is at
// once instead of "Starting…".
const latestEvents = new Map<string, ReceivedProgress>()
let listening = false

function progressKey(task: AiTask, subjectId?: ID | null): string {
  return subjectId ? `${task}:${subjectId}` : task
}

/**
 * True when `event` belongs to the panel asking: same task (when given) and,
 * when the panel names a subject, the same subject. Events without a subject
 * match any panel of their task.
 */
export function isProgressFor(event: AiProgressEvent, task?: AiTask, subjectId?: ID | null): boolean {
  if (task && event.task !== task) return false
  return !subjectId || !event.subjectId || event.subjectId === subjectId
}

/** Records one event (exported for tests; the listener calls it). */
export function recordAiProgress(event: AiProgressEvent, receivedAt = Date.now()): void {
  const received = { event, receivedAt }
  latestEvents.set(progressKey(event.task), received)
  if (event.subjectId) latestEvents.set(progressKey(event.task, event.subjectId), received)
}

/** Starts recording the latest event per task and subject (idempotent; called when an AI job starts). */
export function ensureAiProgressListener(): void {
  if (listening) return
  listening = true
  subscribeAiProgress((event) => recordAiProgress(event))
}

/** The latest recorded event for `task` (and `subjectId`, when given) that arrived at or after `since`, if any. */
export function latestAiProgress(task: AiTask, since: number, subjectId?: ID | null): AiProgressEvent | null {
  const latest = latestEvents.get(progressKey(task, subjectId))
  return latest && latest.receivedAt >= since ? latest.event : null
}

/**
 * The latest progress event for a task, null until one arrives. Only events
 * received at or after `since` count (default: when the calling component
 * mounted), so an earlier job's events never show up. Pass the job's start
 * time to pick up a running job's progress after a remount, and the job's
 * subject (topic, file or notebook id, see AiProgressEvent.subjectId) so a
 * second job of the same task elsewhere doesn't show up here.
 */
export function useAiProgress(task?: AiTask, since?: number, subjectId?: ID | null): AiProgressEvent | null {
  const [mountedAt] = useState(() => Date.now())
  const from = since ?? mountedAt
  const [event, setEvent] = useState<AiProgressEvent | null>(() => (task ? latestAiProgress(task, from, subjectId) : null))

  useEffect(() => {
    ensureAiProgressListener()
    setEvent(task ? latestAiProgress(task, from, subjectId) : null)
    return subscribeAiProgress((next) => {
      if (isProgressFor(next, task, subjectId)) setEvent(next)
    })
  }, [task, from, subjectId])

  return event
}
