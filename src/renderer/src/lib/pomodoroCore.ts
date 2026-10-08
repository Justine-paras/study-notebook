// Pure Pomodoro state machine used by lib/pomodoro.tsx. Time is passed in as
// epoch milliseconds, never read here, so every transition is unit-testable.
//
// Timing is drift-free: a running phase stores the wall-clock time it ends
// (`endsAt`) and the remaining time is always `endsAt - now`, so slow or
// throttled timers (background windows, sleep) never make the clock lag.

import type { ID } from '@shared/types'

export type PomodoroPhase = 'focus' | 'break'
export type PomodoroStatus = 'idle' | 'running' | 'paused'

export interface PomodoroDurations {
  focusMs: number
  breakMs: number
}

export interface PomodoroState {
  phase: PomodoroPhase
  status: PomodoroStatus
  /** Wall-clock ms when the running phase ends. Only set while running. */
  endsAt: number | null
  /** Remaining ms. Only set while paused. */
  pausedRemainingMs: number | null
  /** Length of the current phase, fixed when it starts (settings may change mid-phase). Null while idle. */
  phaseMs: number | null
  /** Wall-clock ms when the current phase first started. Null while idle. */
  phaseStartedAt: number | null
  /** Notebook credited for the current focus phase. */
  notebookId: ID | null
}

export interface FocusLogEntry {
  notebookId: ID | null
  startedAt: number
  endedAt: number
  minutes: number
}

export type PomodoroEvent =
  /** A focus session (complete or partial) to save with api.logFocusSession. */
  | { kind: 'log'; entry: FocusLogEntry }
  /** A phase ran out. `stale` when it ended long ago (the app was closed): log it, don't notify. */
  | { kind: 'phaseEnd'; phase: PomodoroPhase; endedAt: number; stale: boolean }

export interface Transition {
  state: PomodoroState
  events: PomodoroEvent[]
}

/** Partial focus sessions shorter than this are not logged. */
export const MIN_LOGGED_FOCUS_MS = 60_000

/** Phase ends older than this when noticed are treated as stale (no notification). */
export const STALE_AFTER_MS = 60_000

export const DEFAULT_DURATIONS: PomodoroDurations = { focusMs: 25 * 60_000, breakMs: 5 * 60_000 }

export function durationsFromMinutes(focusMinutes: number | undefined, breakMinutes: number | undefined): PomodoroDurations {
  const toMs = (minutes: number | undefined, fallback: number) =>
    minutes !== undefined && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : fallback
  return {
    focusMs: toMs(focusMinutes, DEFAULT_DURATIONS.focusMs),
    breakMs: toMs(breakMinutes, DEFAULT_DURATIONS.breakMs)
  }
}

export function initialPomodoroState(): PomodoroState {
  return {
    phase: 'focus',
    status: 'idle',
    endsAt: null,
    pausedRemainingMs: null,
    phaseMs: null,
    phaseStartedAt: null,
    notebookId: null
  }
}

function idleState(phase: PomodoroPhase, notebookId: ID | null = null): PomodoroState {
  return { ...initialPomodoroState(), phase, notebookId }
}

export function phaseLength(phase: PomodoroPhase, durations: PomodoroDurations): number {
  return phase === 'focus' ? durations.focusMs : durations.breakMs
}

/** Length of the current phase (fixed once started, otherwise from settings). */
export function totalMs(state: PomodoroState, durations: PomodoroDurations): number {
  return state.phaseMs ?? phaseLength(state.phase, durations)
}

export function remainingMs(state: PomodoroState, durations: PomodoroDurations, now: number): number {
  switch (state.status) {
    case 'running':
      return Math.max(0, (state.endsAt ?? now) - now)
    case 'paused':
      return Math.max(0, state.pausedRemainingMs ?? 0)
    case 'idle':
      return phaseLength(state.phase, durations)
  }
}

/** Active (not paused) time spent in the current phase. */
export function elapsedMs(state: PomodoroState, durations: PomodoroDurations, now: number): number {
  if (state.status === 'idle') return 0
  return Math.max(0, totalMs(state, durations) - remainingMs(state, durations, now))
}

/** 0 at the start of a phase, 1 at its end. */
export function progress(state: PomodoroState, durations: PomodoroDurations, now: number): number {
  const total = totalMs(state, durations)
  return total > 0 ? Math.min(1, elapsedMs(state, durations, now) / total) : 0
}

export function start(
  state: PomodoroState,
  durations: PomodoroDurations,
  now: number,
  currentNotebookId: ID | null
): PomodoroState {
  if (state.status === 'running') return state
  if (state.status === 'paused') {
    return { ...state, status: 'running', endsAt: now + (state.pausedRemainingMs ?? 0), pausedRemainingMs: null }
  }
  const length = phaseLength(state.phase, durations)
  return {
    ...state,
    status: 'running',
    endsAt: now + length,
    pausedRemainingMs: null,
    phaseMs: length,
    phaseStartedAt: now,
    notebookId: currentNotebookId ?? state.notebookId
  }
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', pausedRemainingMs: Math.max(0, (state.endsAt ?? now) - now), endsAt: null }
}

/** A log event for the focus time spent so far, when it is long enough to count. */
function partialFocusLog(state: PomodoroState, durations: PomodoroDurations, now: number): PomodoroEvent[] {
  if (state.phase !== 'focus' || state.status === 'idle' || state.phaseStartedAt === null) return []
  const elapsed = elapsedMs(state, durations, now)
  if (elapsed < MIN_LOGGED_FOCUS_MS) return []
  return [
    {
      kind: 'log',
      entry: {
        notebookId: state.notebookId,
        startedAt: state.phaseStartedAt,
        endedAt: now,
        minutes: Math.max(1, Math.round(elapsed / 60_000))
      }
    }
  ]
}

/** Stops and rewinds the current phase. Logs the focus time spent when it is at least a minute. */
export function reset(state: PomodoroState, durations: PomodoroDurations, now: number): Transition {
  return { state: idleState(state.phase), events: partialFocusLog(state, durations, now) }
}

/**
 * Ends the current phase early and moves to the next one. A running timer
 * keeps running into the next phase; otherwise the next phase waits.
 */
export function skip(state: PomodoroState, durations: PomodoroDurations, now: number): Transition {
  const events = partialFocusLog(state, durations, now)
  const nextPhase: PomodoroPhase = state.phase === 'focus' ? 'break' : 'focus'
  const keepNotebook = nextPhase === 'break' ? state.notebookId : null
  let next = idleState(nextPhase, keepNotebook)
  if (state.status === 'running') next = start(next, durations, now, keepNotebook)
  return { state: next, events }
}

/**
 * Advances a running timer to `now`. When a focus phase ends it is logged and
 * the break starts on its own (resting needs no click); when a break ends the
 * next focus phase waits for the learner. Handles several phase ends at once
 * (the app was closed through a focus phase and its break).
 */
export function tick(state: PomodoroState, durations: PomodoroDurations, now: number): Transition {
  const events: PomodoroEvent[] = []
  let current = state
  while (current.status === 'running' && current.endsAt !== null && current.endsAt <= now) {
    const endedAt = current.endsAt
    const stale = now - endedAt > STALE_AFTER_MS
    events.push({ kind: 'phaseEnd', phase: current.phase, endedAt, stale })
    if (current.phase === 'focus') {
      const length = current.phaseMs ?? durations.focusMs
      events.push({
        kind: 'log',
        entry: {
          notebookId: current.notebookId,
          startedAt: current.phaseStartedAt ?? endedAt - length,
          endedAt,
          minutes: Math.max(1, Math.round(length / 60_000))
        }
      })
      // The break starts when focus ended, not when we noticed, so time stays exact.
      current = start(idleState('break', current.notebookId), durations, endedAt, current.notebookId)
    } else {
      current = idleState('focus')
    }
  }
  return { state: current, events }
}

/**
 * Credits a notebook to the current phase if none is set yet: the first
 * notebook the learner opens during a focus phase gets the time.
 */
export function attachNotebook(state: PomodoroState, notebookId: ID | null): PomodoroState {
  if (!notebookId || state.status === 'idle' || state.notebookId) return state
  return { ...state, notebookId }
}

// ---------------------------------------------------------------------------
// Persistence (localStorage) so a reload or restart keeps the timer
// ---------------------------------------------------------------------------

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

/** Parses a stored state; anything malformed yields a fresh idle timer. */
export function deserializeState(raw: string | null): PomodoroState {
  if (!raw) return initialPomodoroState()
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof PomodoroState, unknown>>
    const phase = value.phase
    const status = value.status
    if (phase !== 'focus' && phase !== 'break') return initialPomodoroState()
    if (status !== 'idle' && status !== 'running' && status !== 'paused') return initialPomodoroState()
    const { endsAt, pausedRemainingMs, phaseMs, phaseStartedAt } = value
    if (![endsAt, pausedRemainingMs, phaseMs, phaseStartedAt].every(isNumberOrNull)) return initialPomodoroState()
    const notebookId = typeof value.notebookId === 'string' ? value.notebookId : null
    const state: PomodoroState = {
      phase,
      status,
      endsAt: endsAt as number | null,
      pausedRemainingMs: pausedRemainingMs as number | null,
      phaseMs: phaseMs as number | null,
      phaseStartedAt: phaseStartedAt as number | null,
      notebookId
    }
    if (status === 'running' && state.endsAt === null) return idleState(phase)
    if (status === 'paused' && state.pausedRemainingMs === null) return idleState(phase)
    return state
  } catch {
    return initialPomodoroState()
  }
}

export function serializeState(state: PomodoroState): string {
  return JSON.stringify(state)
}
