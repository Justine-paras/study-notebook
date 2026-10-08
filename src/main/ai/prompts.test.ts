import { describe, expect, it } from 'vitest'
import type { AiSourceDoc, GenerateQuestionsInput, TopicBrief } from './index'
import { explanationInstruction, lessonInstruction, questionsInstruction, SYSTEM_PROMPT } from './prompts'

const topic: TopicBrief = { id: 't1', title: 'Hash tables', description: 'Hashing and collision resolution.', unitLabel: 'Week 4' }
const sources: AiSourceDoc[] = [{ name: 'Week 4.pdf', kind: 'lecture', text: '[Page 1]\nA hash function maps keys to buckets.' }]

describe('SYSTEM_PROMPT', () => {
  it('asks for Markdown code and KaTeX math, and forbids trivia questions', () => {
    expect(SYSTEM_PROMPT).toMatch(/fenced code blocks with a language tag/)
    expect(SYSTEM_PROMPT).toMatch(/\$\.\.\.\$ inline and \$\$\.\.\.\$\$/)
    expect(SYSTEM_PROMPT).toContain('Never use \\( \\) or \\[ \\]')
    expect(SYSTEM_PROMPT).toMatch(/never about the documents themselves/)
  })

  it('never asks the model to write out its own reasoning (that is declined as reasoning extraction)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/think step by step|show your (reasoning|thinking)|scratchpad|<thinking>/i)
  })
})

describe('lessonInstruction', () => {
  it('asks every part to name the files and pages it draws on, and to cover all the topic material', () => {
    const text = lessonInstruction({ notebookName: 'Data Structures', topic, sources, otherTopics: [] })
    expect(text).toContain('*Source: Lecture 05 - Deadlocks.pdf, pages 3-6*')
    expect(text).toMatch(/cover all of them/)
  })

  it('does not ask for source lines when there are no files', () => {
    const text = lessonInstruction({ notebookName: 'Data Structures', topic, sources: [], otherTopics: [] })
    expect(text).not.toContain('*Source:')
    expect(text).toContain('No course files are attached')
  })
})

describe('questionsInstruction', () => {
  const input: GenerateQuestionsInput = {
    notebookName: 'Data Structures',
    topics: [topic],
    primaryTopicId: 't1',
    sources,
    types: ['mc', 'tf', 'fill', 'identification'],
    count: 4,
    difficulty: 'mixed',
    mode: 'practice',
    weakFocus: [],
    avoidPrompts: []
  }

  it('gives a quality rule for each requested type', () => {
    const text = questionsInstruction(input, { count: 4, alreadyWritten: [] })
    expect(text).toMatch(/Each distractor is a specific mistake/)
    expect(text).toMatch(/not a trick word, a negation or a double negative/)
    expect(text).toMatch(/not inside code or math/)
    expect(text).toMatch(/not its textbook definition reworded/)
  })

  it('only describes the requested types', () => {
    const text = questionsInstruction({ ...input, types: ['tf'] }, { count: 4, alreadyWritten: [] })
    expect(text).toContain('"tf" (true or false)')
    expect(text).not.toContain('"mc" (multiple choice)')
  })
})

describe('explanationInstruction', () => {
  it('grades Feynman-style: gaps phrased as what is missing, and one actionable next step', () => {
    const text = explanationInstruction({ topic, prompt: 'Explain hashing.', rubric: ['Buckets'], explanation: 'Keys go to buckets.', sources })
    expect(text).toMatch(/Feynman test/)
    expect(text).toMatch(/a term used without saying what it means/)
    expect(text).toMatch(/"missing": each gap/)
    expect(text).toMatch(/"suggestion": the single most useful next step/)
    expect(text).toContain('<explanation>\nKeys go to buckets.\n</explanation>')
  })
})
