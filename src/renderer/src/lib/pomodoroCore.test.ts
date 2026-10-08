import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DURATIONS,
  attachNotebook,
  deserializeState,
  durationsFromMinutes,
  elapsedMs,
  initialPomodoroState,
  pause,
  progress,
  remainingMs,
  reset,
  serializeState,
  skip,
  start,
  tick,
  totalMs,
  type PomodoroState
} from './pomodoroCore'

const MIN = 60_000
const d = { focusMs: 25 * MIN, breakMs: 5 * MIN }
const T0 = Date.UTC(2026, 9, 3, 14, 0, 0)

function running(notebookId: string | null = 'nb1'): PomodoroState {
  return start(initialPomodoroState(), d, T0, notebookId)
}

describe('durations', () => {
  it('reads minutes from settings with safe defaults', () => {
    expect(durationsFromMinutes(50, 10)).toEqual({ focusMs: 50 * MIN, breakMs: 10 * MIN })
    expect(durationsFromMinutes(undefined, undefined)).toEqual(DEFAULT_DURATIONS)
    expect(durationsFromMinutes(0, -1)).toEqual(DEFAULT_DURATIONS)
  })
})

describe('start, pause and remaining time', () => {
  it('shows the full phase while idle', () => {
    const s = initialPomodoroState()
    expect(remainingMs(s, d, T0)).toBe(25 * MIN)
    expect(progress(s, d, T0)).toBe(0)
  })

  it('counts down from the end timestamp (drift-free)', () => {
    const s = running()
    expect(s.status).toBe('running')
    expect(s.endsAt).toBe(T0 + 25 * MIN)
    expect(s.notebookId).toBe('nb1')
    expect(remainingMs(s, d, T0 + 10 * MIN + 500)).toBe(15 * MIN - 500)
    expect(progress(s, d, T0 + 5 * MIN)).toBeCloseTo(0.2)
  })

  it('freezes while paused and resumes where it stopped', () => {
    const paused = pause(running(), T0 + 10 * MIN)
    expect(paused.status).toBe('paused')
    expect(remainingMs(paused, d, T0 + 60 * MIN)).toBe(15 * MIN)
    const resumed = start(paused, d, T0 + 60 * MIN, null)
    expect(resumed.endsAt).toBe(T0 + 75 * MIN)
    expect(resumed.phaseStartedAt).toBe(T0)
    expect(elapsedMs(resumed, d, T0 + 61 * MIN)).toBe(11 * MIN)
  })

  it('keeps the phase length it started with when settings change', () => {
    const s = running()
    const longer = { focusMs: 50 * MIN, breakMs: 10 * MIN }
    expect(totalMs(s, longer)).toBe(25 * MIN)
    expect(remainingMs(s, longer, T0 + MIN)).toBe(24 * MIN)
  })

  it('ignores start while running and pause while not running', () => {
    const s = running()
    expect(start(s, d, T0 + MIN, 'other')).toBe(s)
    const idle = initialPomodoroState()
    expect(pause(idle, T0)).toBe(idle)
  })
})

describe('tick', () => {
  it('does nothing before the phase ends', () => {
    const s = running()
    const result = tick(s, d, T0 + 24 * MIN)
    expect(result.state).toBe(s)
    expect(result.events).toEqual([])
  })

  it('logs a finished focus phase and starts the break on its own', () => {
    const result = tick(running(), d, T0 + 25 * MIN + 200)
    expect(result.events).toEqual([
      { kind: 'phaseEnd', phase: 'focus', endedAt: T0 + 25 * MIN, stale: false },
      { kind: 'log', entry: { notebookId: 'nb1', startedAt: T0, endedAt: T0 + 25 * MIN, minutes: 25 } }
    ])
    expect(result.state.phase).toBe('break')
    expect(result.state.status).toBe('running')
    // The break is timed from when focus ended, not when the tick noticed.
    expect(result.state.endsAt).toBe(T0 + 30 * MIN)
  })

  it('waits for the learner after a break', () => {
    const inBreak = tick(running(), d, T0 + 25 * MIN).state
    const result = tick(inBreak, d, T0 + 30 * MIN)
    expect(result.events).toEqual([{ kind: 'phaseEnd', phase: 'break', endedAt: T0 + 30 * MIN, stale: false }])
    expect(result.state).toEqual({ ...initialPomodoroState(), phase: 'focus' })
  })

  it('catches up on phases that ended while the app was closed, without notifying', () => {
    const result = tick(running(), d, T0 + 3 * 60 * MIN)
    expect(result.events.map((e) => e.kind)).toEqual(['phaseEnd', 'log', 'phaseEnd'])
    expect(result.events.filter((e) => e.kind === 'phaseEnd').every((e) => e.kind === 'phaseEnd' && e.stale)).toBe(true)
    expect(result.state.status).toBe('idle')
    expect(result.state.phase).toBe('focus')
  })
})

describe('reset and skip', () => {
  it('logs a partial focus session of at least a minute on reset', () => {
    const result = reset(running(), d, T0 + 12 * MIN + 40_000)
    expect(result.events).toEqual([
      { kind: 'log', entry: { notebookId: 'nb1', startedAt: T0, endedAt: T0 + 12 * MIN + 40_000, minutes: 13 } }
    ])
    expect(result.state).toEqual({ ...initialPomodoroState(), phase: 'focus' })
  })

  it('does not log under a minute, or paused time', () => {
    expect(reset(running(), d, T0 + 59_000).events).toEqual([])
    const paused = pause(running(), T0 + 30_000)
    expect(reset(paused, d, T0 + 30 * MIN).events).toEqual([])
  })

  it('never logs breaks', () => {
    const inBreak = tick(running(), d, T0 + 25 * MIN).state
    expect(reset(inBreak, d, T0 + 29 * MIN).events).toEqual([])
    expect(reset(inBreak, d, T0 + 29 * MIN).state.phase).toBe('break')
  })

  it('skips focus to a running break and logs the time so far', () => {
    const result = skip(running(), d, T0 + 10 * MIN)
    expect(result.events).toHaveLength(1)
    expect(result.state.phase).toBe('break')
    expect(result.state.status).toBe('running')
    expect(result.state.endsAt).toBe(T0 + 15 * MIN)
  })

  it('skips an idle break to an idle focus phase', () => {
    const idleBreak = { ...initialPomodoroState(), phase: 'break' as const }
    const result = skip(idleBreak, d, T0)
    expect(result.state.phase).toBe('focus')
    expect(result.state.status).toBe('idle')
    expect(result.events).toEqual([])
  })
})

describe('notebook credit', () => {
  it('credits the first notebook opened during a phase that started without one', () => {
    const s = running(null)
    const withNb = attachNotebook(s, 'nb2')
    expect(withNb.notebookId).toBe('nb2')
    expect(attachNotebook(withNb, 'nb3')).toBe(withNb)
  })

  it('does not attach while idle', () => {
    const idle = initialPomodoroState()
    expect(attachNotebook(idle, 'nb1')).toBe(idle)
  })
})

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const s = pause(running(), T0 + MIN)
    expect(deserializeState(serializeState(s))).toEqual(s)
  })

  it('falls back to a fresh timer for missing or malformed data', () => {
    expect(deserializeState(null)).toEqual(initialPomodoroState())
    expect(deserializeState('{oops')).toEqual(initialPomodoroState())
    expect(deserializeState('{"phase":"nap","status":"idle"}')).toEqual(initialPomodoroState())
    expect(deserializeState('{"phase":"focus","status":"running","endsAt":"soon"}')).toEqual(initialPomodoroState())
  })

  it('repairs inconsistent states', () => {
    const raw = JSON.stringify({ ...initialPomodoroState(), phase: 'break', status: 'running', endsAt: null })
    expect(deserializeState(raw)).toEqual({ ...initialPomodoroState(), phase: 'break' })
  })
})
