// Pomodoro timer shared by the whole app (the TopBar widget, "Start today's
// session", pages that credit study time to a notebook). The state machine is
// in pomodoroCore.ts; this provider adds the clock, persistence, logging and
// notifications.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ID } from '@shared/types'
import { api, friendlyMessage } from './api'
import { formatMinutes } from './format'
import { queryKeys, useSettings } from './queries'
import { useToast } from '../components/ui/Toast'
import {
  attachNotebook,
  deserializeState,
  durationsFromMinutes,
  pause as pauseState,
  progress as progressOf,
  remainingMs as remainingOf,
  reset as resetState,
  serializeState,
  skip as skipState,
  start as startState,
  tick,
  totalMs as totalOf,
  type PomodoroEvent,
  type PomodoroPhase,
  type PomodoroState,
  type PomodoroStatus,
  type Transition
} from './pomodoroCore'

export type { PomodoroPhase, PomodoroStatus } from './pomodoroCore'

const STORAGE_KEY = 'study-notebook:pomodoro:v1'
const TICK_MS = 250

export interface PomodoroContextValue {
  phase: PomodoroPhase
  status: PomodoroStatus
  isRunning: boolean
  /** "Focus" or "Break". */
  label: string
  remainingMs: number
  /** Whole seconds left, rounded up (what the clock shows). */
  remainingSeconds: number
  totalMs: number
  /** 0-1 through the current phase. */
  progress: number
  /** Focus and break lengths from Settings (defaults 25 and 5). */
  focusMinutes: number
  breakMinutes: number
  /** Notebook the current focus phase is credited to. */
  notebookId: ID | null
  /** Notebook of the page on screen (set with usePomodoroNotebook). */
  currentNotebookId: ID | null
  start: () => void
  pause: () => void
  toggle: () => void
  /** Rewinds the current phase; a focus phase of at least a minute is logged first. */
  reset: () => void
  /** Ends the current phase now and moves on (focus -> break -> focus). */
  skip: () => void
  /** Low-level: usually call usePomodoroNotebook(id) instead. */
  setCurrentNotebook: (id: ID | null) => void
}

const PomodoroContext = createContext<PomodoroContextValue | null>(null)

function loadState(): PomodoroState {
  try {
    return deserializeState(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return deserializeState(null)
  }
}

function saveState(state: PomodoroState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(state))
  } catch {
    // Without storage the timer still works; it just won't survive a reload.
  }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const settings = useSettings()
  const focusMinutes = settings.data?.focusMinutes
  const breakMinutes = settings.data?.breakMinutes
  const durations = useMemo(() => durationsFromMinutes(focusMinutes, breakMinutes), [focusMinutes, breakMinutes])

  const [state, setState] = useState<PomodoroState>(loadState)
  const [now, setNow] = useState(() => Date.now())
  const [currentNotebookId, setCurrentNotebookId] = useState<ID | null>(null)

  // Refs let interval callbacks and actions read the latest values without
  // re-creating timers, and keep event handling outside React state updaters
  // (StrictMode may call updaters twice, which would log sessions twice).
  const stateRef = useRef(state)
  const durationsRef = useRef(durations)
  const notebookRef = useRef(currentNotebookId)
  durationsRef.current = durations
  notebookRef.current = currentNotebookId

  const handleEvents = useCallback(
    (events: PomodoroEvent[]) => {
      for (const event of events) {
        if (event.kind === 'log') {
          const { entry } = event
          api
            .logFocusSession({
              notebookId: entry.notebookId,
              kind: 'focus',
              startedAt: new Date(entry.startedAt).toISOString(),
              endedAt: new Date(entry.endedAt).toISOString(),
              minutes: entry.minutes
            })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.today() })
              void queryClient.invalidateQueries({ queryKey: queryKeys.insights() })
            })
            .catch((err: unknown) => {
              toast.error(`Couldn't save your focus time. ${friendlyMessage(err)}`)
            })
        } else if (!event.stale) {
          const breakText = formatMinutes(durationsRef.current.breakMs / 60_000)
          const title = event.phase === 'focus' ? 'Focus session done' : 'Break is over'
          const body =
            event.phase === 'focus' ? `Nice work. Take a ${breakText} break.` : 'Ready for another focus session?'
          api.notify(title, body).catch(() => {
            // A missing desktop notification is not worth interrupting the learner for.
          })
          toast.show({ title, message: body, tone: event.phase === 'focus' ? 'good' : 'info' })
        }
      }
    },
    [queryClient, toast]
  )

  const commit = useCallback(
    (transition: Transition) => {
      stateRef.current = transition.state
      setState(transition.state)
      setNow(Date.now())
      if (transition.events.length > 0) handleEvents(transition.events)
    },
    [handleEvents]
  )

  useEffect(() => {
    saveState(state)
  }, [state])

  // The clock: only runs while the timer runs, and re-renders once per displayed second.
  useEffect(() => {
    if (state.status !== 'running') return
    let lastSecond = -1
    const step = () => {
      const t = Date.now()
      const result = tick(stateRef.current, durationsRef.current, t)
      if (result.events.length > 0 || result.state !== stateRef.current) {
        commit(result)
        return
      }
      const second = Math.ceil(remainingOf(stateRef.current, durationsRef.current, t) / 1000)
      if (second !== lastSecond) {
        lastSecond = second
        setNow(t)
      }
    }
    step()
    const id = window.setInterval(step, TICK_MS)
    return () => window.clearInterval(id)
  }, [state.status, state.phase, commit])

  // Credit the page's notebook to a phase that started without one.
  useEffect(() => {
    const next = attachNotebook(stateRef.current, currentNotebookId)
    if (next !== stateRef.current) commit({ state: next, events: [] })
  }, [currentNotebookId, state.status, commit])

  const start = useCallback(() => {
    commit({ state: startState(stateRef.current, durationsRef.current, Date.now(), notebookRef.current), events: [] })
  }, [commit])

  const pause = useCallback(() => {
    commit({ state: pauseState(stateRef.current, Date.now()), events: [] })
  }, [commit])

  const toggle = useCallback(() => {
    if (stateRef.current.status === 'running') pause()
    else start()
  }, [pause, start])

  const reset = useCallback(() => {
    commit(resetState(stateRef.current, durationsRef.current, Date.now()))
  }, [commit])

  const skip = useCallback(() => {
    commit(skipState(stateRef.current, durationsRef.current, Date.now()))
  }, [commit])

  const value = useMemo<PomodoroContextValue>(() => {
    const remaining = remainingOf(state, durations, now)
    return {
      phase: state.phase,
      status: state.status,
      isRunning: state.status === 'running',
      label: state.phase === 'focus' ? 'Focus' : 'Break',
      remainingMs: remaining,
      remainingSeconds: Math.ceil(remaining / 1000),
      totalMs: totalOf(state, durations),
      progress: progressOf(state, durations, now),
      focusMinutes: durations.focusMs / 60_000,
      breakMinutes: durations.breakMs / 60_000,
      notebookId: state.notebookId,
      currentNotebookId,
      start,
      pause,
      toggle,
      reset,
      skip,
      setCurrentNotebook: setCurrentNotebookId
    }
  }, [state, durations, now, currentNotebookId, start, pause, toggle, reset, skip])

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>
}

export function usePomodoro(): PomodoroContextValue {
  const value = useContext(PomodoroContext)
  if (!value) throw new Error('usePomodoro must be used inside <PomodoroProvider>')
  return value
}

/**
 * Tells the timer which notebook the learner is studying, so focus time is
 * credited to it. Call it in any page that belongs to one notebook:
 * `usePomodoroNotebook(topic?.notebookId)`.
 */
export function usePomodoroNotebook(notebookId: ID | null | undefined): void {
  const { setCurrentNotebook } = usePomodoro()
  useEffect(() => {
    if (!notebookId) return
    setCurrentNotebook(notebookId)
    return () => setCurrentNotebook(null)
  }, [notebookId, setCurrentNotebook])
}
