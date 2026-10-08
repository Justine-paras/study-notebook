import { describe, expect, it } from 'vitest'
import type { AiProgressEvent } from '@shared/types'
import { isProgressFor, latestAiProgress, recordAiProgress } from './aiProgress'

function event(task: AiProgressEvent['task'], subjectId: string | null, message: string): AiProgressEvent {
  return { jobId: `job-${message}`, task, subjectId, progress: 0.5, message }
}

describe('isProgressFor', () => {
  it('keeps two jobs of the same task apart by subject', () => {
    const a = event('summary', 'src-a', 'Summarizing A.pdf')
    expect(isProgressFor(a, 'summary', 'src-a')).toBe(true)
    expect(isProgressFor(a, 'summary', 'src-b')).toBe(false)
    expect(isProgressFor(a, 'lesson', 'src-a')).toBe(false)
    // A panel that names no subject takes any job of its task.
    expect(isProgressFor(a, 'summary')).toBe(true)
    expect(isProgressFor(a)).toBe(true)
  })

  it('lets an event without a subject reach every panel of its task', () => {
    expect(isProgressFor(event('quiz', null, 'Writing'), 'quiz', 'topic-1')).toBe(true)
  })
})

describe('latestAiProgress', () => {
  it('remembers the latest event per task and per subject, from a start time on', () => {
    recordAiProgress(event('summary', 'src-a', 'A at 10'), 10)
    recordAiProgress(event('summary', 'src-b', 'B at 20'), 20)
    expect(latestAiProgress('summary', 0, 'src-a')?.message).toBe('A at 10')
    expect(latestAiProgress('summary', 0, 'src-b')?.message).toBe('B at 20')
    expect(latestAiProgress('summary', 0)?.message).toBe('B at 20')
    // Events from before the job started belong to an earlier job.
    expect(latestAiProgress('summary', 15, 'src-a')).toBeNull()
    expect(latestAiProgress('summary', 0, 'src-c')).toBeNull()
  })
})
