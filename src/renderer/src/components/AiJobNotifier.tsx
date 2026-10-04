import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { AiTask } from '@shared/types'
import { aiJobs, type AiJob } from '../lib/aiJobs'
import { ROUTES } from '../lib/routes'
import { useToast, type ToastInput } from './ui/Toast'

const READY_TITLES: Record<AiTask, string> = {
  syllabus: 'Your syllabus has been read',
  lesson: 'Your lesson is ready',
  quiz: 'Your questions are ready',
  flashcards: 'Your flashcards are ready',
  explanation: 'Your feedback is ready',
  summary: 'Your summary is ready'
}

const FAILED_TITLES: Record<AiTask, string> = {
  syllabus: "Your syllabus couldn't be read",
  lesson: "Your lesson couldn't be written",
  quiz: "Your questions couldn't be written",
  flashcards: "Your flashcards couldn't be made",
  explanation: "Your explanation couldn't be checked",
  summary: "Your summary couldn't be written"
}

/**
 * The toast for a job that finished while no screen showed it, or null when
 * there is nothing to say (the caller announces successes itself).
 */
export function finishedJobToast(job: AiJob, go: (to: string) => void): ToastInput | null {
  if (job.status === 'success') {
    if (!job.announceSuccess) return null
    const href = job.href
    return {
      tone: 'good',
      title: READY_TITLES[job.task],
      message: job.label,
      duration: 10_000,
      action: href ? { label: 'Open', onClick: () => go(href) } : undefined
    }
  }
  if (job.status !== 'error' || !job.error) return null
  const error = job.error
  const href = job.href
  const action = error.needsSettings
    ? { label: 'Open Settings', onClick: () => go(ROUTES.settings) }
    : href
      ? { label: 'Go there', onClick: () => go(href) }
      : undefined
  return {
    tone: 'bad',
    title: FAILED_TITLES[job.task],
    message: `${job.label}: ${error.friendly}`,
    // Stays until dismissed: the learner was elsewhere and should not miss it.
    duration: 0,
    action
  }
}

/**
 * Announces AI jobs (lesson, quiz, summary...) that finish while the learner
 * is on another page, with a link back to the result. Mounted once in App.
 */
export function AiJobNotifier() {
  const toast = useToast()
  const navigate = useNavigate()
  useEffect(
    () =>
      aiJobs.onFinish((job, shown) => {
        if (shown) return
        const input = finishedJobToast(job, (to) => navigate(to))
        if (input) toast.show(input)
      }),
    [toast, navigate]
  )
  return null
}
