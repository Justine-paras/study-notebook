// Local answers for a quiz that is being taken, autosaved with
// saveQuizAnswer. The backend grades only what was saved, so every change is
// written (picks right away, typing after a short pause) and `flush()` must
// finish before submitQuiz.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Confidence, ID, Quiz } from '@shared/types'
import { api, toApiError, type ApiError } from '../../lib/api'
import { draftsFromQuiz, EMPTY_DRAFT, sameDraft, type DraftAnswer, type DraftMap } from './quizModel'

const TYPING_SAVE_DELAY_MS = 700

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface QuizAnswers {
  drafts: DraftMap
  setResponse: (questionId: ID, response: string, options?: { typed?: boolean }) => void
  setConfidence: (questionId: ID, confidence: Confidence) => void
  /** Writes every unsaved answer; rejects with ApiError when a save fails. */
  flush: () => Promise<void>
  /** Stops autosaving (after the quiz is submitted). */
  lock: () => void
  status: SaveStatus
  saveError: ApiError | null
}

export function useQuizAnswers(quiz: Pick<Quiz, 'id' | 'answers'>): QuizAnswers {
  const quizId = quiz.id
  // Refs hold the truth (async saves read them); state mirrors drafts for rendering.
  const draftsRef = useRef<Record<ID, DraftAnswer>>(draftsFromQuiz(quiz))
  const savedRef = useRef<Record<ID, DraftAnswer>>(draftsFromQuiz(quiz))
  const timersRef = useRef(new Map<ID, ReturnType<typeof setTimeout>>())
  // Saves run one after another so a slow save can never overwrite a newer one.
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const lockedRef = useRef(false)
  const inFlightRef = useRef(0)
  const [drafts, setDrafts] = useState<DraftMap>(draftsRef.current)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<ApiError | null>(null)

  const persist = useCallback(
    (questionId: ID): Promise<void> => {
      const timer = timersRef.current.get(questionId)
      if (timer !== undefined) {
        clearTimeout(timer)
        timersRef.current.delete(questionId)
      }
      const run = async () => {
        const draft = draftsRef.current[questionId]
        if (lockedRef.current || !draft || sameDraft(draft, savedRef.current[questionId])) return
        inFlightRef.current++
        setStatus('saving')
        try {
          await api.saveQuizAnswer(quizId, { questionId, response: draft.response, confidence: draft.confidence })
          savedRef.current[questionId] = draft
        } finally {
          inFlightRef.current--
        }
      }
      const attempt = chainRef.current.then(run)
      chainRef.current = attempt.then(
        () => {
          setSaveError(null)
          if (inFlightRef.current === 0) setStatus('saved')
        },
        (err: unknown) => {
          setSaveError(toApiError(err))
          setStatus('error')
        }
      )
      return attempt
    },
    [quizId]
  )

  const update = useCallback(
    (questionId: ID, patch: Partial<DraftAnswer>, delay: number) => {
      if (lockedRef.current) return
      const next = { ...EMPTY_DRAFT, ...draftsRef.current[questionId], ...patch }
      draftsRef.current = { ...draftsRef.current, [questionId]: next }
      setDrafts(draftsRef.current)
      if (delay > 0) {
        const existing = timersRef.current.get(questionId)
        if (existing !== undefined) clearTimeout(existing)
        timersRef.current.set(
          questionId,
          setTimeout(() => void persist(questionId).catch(() => undefined), delay)
        )
      } else {
        void persist(questionId).catch(() => undefined)
      }
    },
    [persist]
  )

  const setResponse = useCallback(
    (questionId: ID, response: string, options?: { typed?: boolean }) =>
      update(questionId, { response }, options?.typed ? TYPING_SAVE_DELAY_MS : 0),
    [update]
  )

  const setConfidence = useCallback((questionId: ID, confidence: Confidence) => update(questionId, { confidence }, 0), [update])

  const flush = useCallback(async () => {
    const ids = Object.keys(draftsRef.current)
    await Promise.all(ids.map((id) => persist(id)))
  }, [persist])

  const lock = useCallback(() => {
    lockedRef.current = true
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  // Leaving the page mid-typing still saves what was typed.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      const pending = [...timers.keys()]
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const id of pending) void persist(id).catch(() => undefined)
    }
  }, [persist])

  return { drafts, setResponse, setConfidence, flush, lock, status, saveError }
}
