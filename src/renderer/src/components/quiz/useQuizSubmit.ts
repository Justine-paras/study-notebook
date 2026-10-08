import { useCallback, useRef, useState } from 'react'
import type { Quiz, QuizResult } from '@shared/types'
import { toApiError, type ApiError } from '../../lib/api'
import { useApiMutation } from '../../lib/queries'
import type { QuizAnswers } from './useQuizAnswers'

export interface QuizSubmit {
  /** Resolves true once graded (onSubmitted has run), false when saving or grading failed. */
  submit: () => Promise<boolean>
  pending: boolean
  /** Why the last attempt failed (an answer couldn't be saved, or grading failed). */
  error: ApiError | null
}

/**
 * Saves every answer, then grades the quiz. Guards against double submits
 * (a double click, or the exam timer racing the Submit button).
 */
export function useQuizSubmit(quiz: Pick<Quiz, 'id'>, answers: QuizAnswers, onSubmitted: (result: QuizResult) => void): QuizSubmit {
  const { mutateAsync } = useApiMutation('submitQuiz')
  const runningRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const { flush, lock } = answers

  const submit = useCallback(async () => {
    if (runningRef.current) return false
    runningRef.current = true
    setPending(true)
    setError(null)
    try {
      await flush()
      const result = await mutateAsync([quiz.id])
      lock()
      onSubmitted(result)
      return true
    } catch (err) {
      setError(toApiError(err))
      return false
    } finally {
      runningRef.current = false
      setPending(false)
    }
  }, [flush, lock, mutateAsync, onSubmitted, quiz.id])

  return { submit, pending, error }
}
