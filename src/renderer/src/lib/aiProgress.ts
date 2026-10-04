// Live progress of long AI calls (lesson, quiz, syllabus...). The main process
// streams AiProgressEvents over the bridge while a generation runs; this hook
// keeps the latest one for a task so <AiWorking> can show what is happening.

import { useEffect, useState } from 'react'
import type { AiProgressEvent, AiTask } from '@shared/types'

/** Subscribes to every AI progress event. Returns an unsubscribe function (a no-op outside Electron). */
export function subscribeAiProgress(listener: (event: AiProgressEvent) => void): () => void {
  if (typeof window === 'undefined' || !window.studyBridge) return () => {}
  return window.studyBridge.onAiProgress(listener)
}

/**
 * The latest progress event since the calling component mounted, optionally
 * only for one task. Null until the first event arrives. Mount it when the AI
 * call starts (e.g. render <AiWorking> while the mutation is pending) so an
 * earlier job's events never show up.
 */
export function useAiProgress(task?: AiTask): AiProgressEvent | null {
  const [event, setEvent] = useState<AiProgressEvent | null>(null)

  useEffect(() => {
    setEvent(null)
    return subscribeAiProgress((next) => {
      if (!task || next.task === task) setEvent(next)
    })
  }, [task])

  return event
}
