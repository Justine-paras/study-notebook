import { describe, expect, it } from 'vitest'
import { AI_TASK_EXPLANATIONS, LOCAL_AI_DURATION, aiWorkingExplanation } from './AiWorking'

describe('aiWorkingExplanation', () => {
  it("keeps Claude's timing and says a local model takes longer", () => {
    expect(aiWorkingExplanation('lesson', undefined, false)).toBe(
      'Reading your files and writing an in-depth lesson in small parts. This usually takes one to two minutes.'
    )
    expect(aiWorkingExplanation('lesson', undefined, true)).toBe(`${AI_TASK_EXPLANATIONS.lesson} ${LOCAL_AI_DURATION}`)
  })

  it('adds the local timing to a custom explanation only for Ollama', () => {
    expect(aiWorkingExplanation('quiz', 'Writing your mock exam.', false)).toBe('Writing your mock exam.')
    expect(aiWorkingExplanation('quiz', 'Writing your mock exam.', true)).toBe(`Writing your mock exam. ${LOCAL_AI_DURATION}`)
  })
})
