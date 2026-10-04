import { describe, expect, it } from 'vitest'
import { QUESTION_TYPES, type Question, type QuestionType } from '@shared/types'
import { demoExplanation, demoFlashcards, demoLesson, demoQuestions, demoSummary, demoSyllabus, findDate } from './demo'
import { StudyAi, type AiSourceDoc, type GenerateQuestionsInput, type TopicBrief } from './index'
import {
  rawExplanationSchema,
  rawFlashcardsSchema,
  rawLessonSchema,
  rawQuestionsSchema,
  rawSummarySchema,
  rawSyllabusSchema
} from './schemas'

const SYLLABUS = `CS 330 Operating Systems - Course Syllabus
Fall 2026

Grading: exams 50%, projects 50%.
Office hours: Tuesdays 2-4pm.

Schedule
Week 1: Processes and threads - process states, the process control block, context switching.
Week 2: CPU scheduling - FCFS, shortest job first, round robin, priority scheduling.
Week 3: Deadlocks - the four Coffman conditions, prevention, avoidance with the banker's algorithm, detection.
Week 4: Memory management and paging - page tables, TLBs, page faults.

Exams
Midterm exam: 2026-10-20, covers weeks 1-3 (processes, CPU scheduling, deadlocks).
Final exam: 2026-12-15, covers everything.
`

const LECTURE = `[Page 1]
Lecture 5: Deadlocks

A deadlock is a state in which every process in a set is waiting for an event that only another process in the set can cause.

[Page 2]
Deadlock can arise only if all four conditions hold at the same time:
1. Mutual exclusion: at least one resource is held in a non-shareable mode.
2. Hold and wait: a process holds at least one resource while waiting for others.
3. No preemption: resources cannot be forcibly taken away from a process.
4. Circular wait: a cycle of processes exists where each waits for a resource held by the next.

[Page 3]
Deadlock prevention breaks at least one of the four conditions, for example by ordering resources to rule out circular wait.
The banker's algorithm avoids deadlock by granting a request only if the system stays in a safe state.
`

const sources: AiSourceDoc[] = [
  { name: 'Lecture 5 - Deadlocks.pdf', kind: 'lecture', text: LECTURE },
  { name: 'CS330 Syllabus.txt', kind: 'syllabus', text: SYLLABUS }
]

const topics: TopicBrief[] = [
  { id: 'topic-procs', title: 'Processes and threads', description: 'Process states and context switching.', unitLabel: 'Week 1' },
  { id: 'topic-sched', title: 'CPU scheduling', description: 'FCFS, SJF, round robin.', unitLabel: 'Week 2' },
  { id: 'topic-dead', title: 'Deadlocks', description: 'The four Coffman conditions, prevention, avoidance, detection.', unitLabel: 'Week 3' }
]

const demoAi = new StudyAi(() => ({ apiKey: null, model: 'claude-opus-5-5', demo: true }))

function quizInput(overrides: Partial<GenerateQuestionsInput> = {}): GenerateQuestionsInput {
  return {
    notebookName: 'Operating Systems',
    topics,
    primaryTopicId: 'topic-dead',
    sources,
    types: [...QUESTION_TYPES],
    count: 10,
    difficulty: 'mixed',
    mode: 'practice',
    weakFocus: [],
    avoidPrompts: [],
    ...overrides
  }
}

function withoutIds(questions: Question[]): Omit<Question, 'id'>[] {
  return questions.map(({ id, ...rest }) => {
    void id
    return rest
  })
}

describe('demo outputs match the model output schemas', () => {
  it('lesson', () => {
    expect(rawLessonSchema.safeParse(demoLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: topics.slice(0, 2) })).success).toBe(true)
    expect(rawLessonSchema.safeParse(demoLesson({ notebookName: 'OS', topic: topics[0], sources: [], otherTopics: [] })).success).toBe(true)
  })

  it('questions', () => {
    expect(rawQuestionsSchema.safeParse(demoQuestions(quizInput())).success).toBe(true)
  })

  it('flashcards, explanation, syllabus and summary', async () => {
    const lesson = await demoAi.generateLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: [] })
    expect(rawFlashcardsSchema.safeParse(demoFlashcards({ notebookName: 'OS', topic: topics[2], lesson, sources, count: 12 })).success).toBe(true)
    expect(rawExplanationSchema.safeParse(demoExplanation({ topic: topics[2], rubric: lesson.explainRubric, explanation: 'A deadlock is a cycle of waiting.' })).success).toBe(true)
    expect(rawSyllabusSchema.safeParse(demoSyllabus({ notebookName: 'OS', syllabus: sources[1], existingTopicTitles: [], todayDate: '2026-10-04' })).success).toBe(true)
    expect(rawSummarySchema.safeParse(demoSummary({ notebookName: 'OS', source: sources[0] })).success).toBe(true)
  })
})

describe('demo lesson', () => {
  it('has the learning-path shape and cites the files', async () => {
    const lesson = await demoAi.generateLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: topics.slice(0, 2) })
    expect(lesson.warmup).toHaveLength(2)
    expect(lesson.chunks.length).toBeGreaterThanOrEqual(3)
    expect(lesson.chunks.length).toBeLessThanOrEqual(6)
    expect(lesson.keyTerms.length).toBeGreaterThanOrEqual(5)
    expect(lesson.keyTerms.length).toBeLessThanOrEqual(10)
    expect(lesson.explainRubric.length).toBeGreaterThanOrEqual(4)
    expect(lesson.explainRubric.length).toBeLessThanOrEqual(6)
    for (const q of [...lesson.warmup, ...lesson.chunks.map((c) => c.check)]) {
      expect(['mc', 'tf']).toContain(q.type)
      expect(q.options).toContain(q.answer)
      expect(q.topicId).toBe('topic-dead')
    }
    expect(lesson.chunks.some((c) => c.check.sourceRef.startsWith('Lecture 5 - Deadlocks.pdf, page'))).toBe(true)
    expect(lesson.chunks.map((c) => c.body).join(' ')).toMatch(/deadlock/i)
    expect(lesson.connections.join(' ')).toContain('Processes and threads')
    expect(lesson.sourcesUsed).toEqual(['CS330 Syllabus.txt', 'Lecture 5 - Deadlocks.pdf'])
  })

  it('works from the topic description when there are no files', async () => {
    const lesson = await demoAi.generateLesson({ notebookName: 'OS', topic: topics[1], sources: [], otherTopics: [] })
    expect(lesson.chunks.length).toBeGreaterThanOrEqual(3)
    expect(lesson.sourcesUsed).toEqual(['No files: based on the topic description'])
    expect(lesson.overview).toContain('CPU scheduling')
  })

  it('is deterministic apart from ids', async () => {
    const a = demoLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: [] })
    const b = demoLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: [] })
    expect(a).toEqual(b)
  })
})

describe('demo questions', () => {
  const combos: { types: QuestionType[]; count: number }[] = [
    { types: ['mc'], count: 5 },
    { types: ['tf'], count: 10 },
    { types: ['fill'], count: 5 },
    { types: ['identification'], count: 5 },
    { types: ['mc', 'fill'], count: 20 },
    { types: [...QUESTION_TYPES], count: 10 }
  ]

  for (const { types, count } of combos) {
    it(`returns exactly ${count} questions of types ${types.join('/')}`, async () => {
      const questions = await demoAi.generateQuestions(quizInput({ types, count }))
      expect(questions).toHaveLength(count)
      expect(questions.every((q) => types.includes(q.type))).toBe(true)
      expect(new Set(questions.map((q) => q.id)).size).toBe(count)
      expect(new Set(questions.map((q) => q.prompt.toLowerCase())).size).toBe(count)
      for (const q of questions) {
        if (q.type === 'tf') expect(q.options).toEqual(['True', 'False'])
        if (q.type === 'mc' || q.type === 'tf') expect(q.options).toContain(q.answer)
        if (q.type === 'fill') expect(q.prompt).toContain('____')
      }
    })
  }

  it('maps every question to an input topic, mostly the primary one', async () => {
    const questions = await demoAi.generateQuestions(quizInput({ count: 9 }))
    const ids = new Set(topics.map((t) => t.id))
    expect(questions.every((q) => q.topicId !== null && ids.has(q.topicId))).toBe(true)
    expect(questions.filter((q) => q.topicId === 'topic-dead').length).toBe(6)
  })

  it('spreads cross-topic quizzes and gives weak topics extra questions', async () => {
    const questions = await demoAi.generateQuestions(
      quizInput({ primaryTopicId: null, count: 8, mode: 'weak_spots', weakFocus: [{ topicId: 'topic-sched', title: 'CPU scheduling', recentMistakes: [] }] })
    )
    const per = (id: string): number => questions.filter((q) => q.topicId === id).length
    expect(per('topic-sched')).toBeGreaterThan(per('topic-procs'))
    expect(per('topic-procs')).toBeGreaterThan(0)
  })

  it('honours a fixed difficulty and spreads mixed difficulty', async () => {
    const hard = await demoAi.generateQuestions(quizInput({ difficulty: 'hard', count: 6 }))
    expect(hard.every((q) => q.difficulty === 'hard')).toBe(true)
    const mixed = await demoAi.generateQuestions(quizInput({ difficulty: 'mixed', count: 6 }))
    expect(new Set(mixed.map((q) => q.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']))
  })

  it('does not repeat recently asked prompts', async () => {
    const first = await demoAi.generateQuestions(quizInput({ count: 5 }))
    const second = await demoAi.generateQuestions(quizInput({ count: 5, avoidPrompts: first.map((q) => q.prompt) }))
    const before = new Set(first.map((q) => q.prompt))
    expect(second.some((q) => before.has(q.prompt))).toBe(false)
  })

  it('works without any files', async () => {
    const questions = await demoAi.generateQuestions(quizInput({ sources: [], count: 12 }))
    expect(questions).toHaveLength(12)
  })

  it('is deterministic apart from ids', async () => {
    const a = await demoAi.generateQuestions(quizInput())
    const b = await demoAi.generateQuestions(quizInput())
    expect(withoutIds(a)).toEqual(withoutIds(b))
  })
})

describe('demo flashcards, grading and summary', () => {
  it('makes distinct cards up to the requested count', async () => {
    const lesson = await demoAi.generateLesson({ notebookName: 'OS', topic: topics[2], sources, otherTopics: [] })
    const cards = await demoAi.generateFlashcards({ notebookName: 'OS', topic: topics[2], lesson, sources, count: 8 })
    expect(cards).toHaveLength(8)
    expect(new Set(cards.map((c) => c.front)).size).toBe(8)
  })

  it('scores a thorough explanation above a one-liner', async () => {
    const rubric = ['States what a deadlock is', 'Names the four Coffman conditions', 'Gives a concrete example', 'Names a common mistake or limitation']
    const input = { topic: topics[2], prompt: 'Explain deadlocks.', rubric, sources }
    const short = await demoAi.gradeExplanation({ ...input, explanation: 'It is when things get stuck.' })
    const good = await demoAi.gradeExplanation({
      ...input,
      explanation:
        'A deadlock is when each process in a set waits for a resource another one holds, so none can continue. The four Coffman conditions are mutual exclusion, hold and wait, no preemption and circular wait. For example, two threads each lock one mutex and then wait for the other. A common mistake is thinking one condition is enough, but all four must hold.'
    })
    expect(short.score).toBeLessThanOrEqual(30)
    expect(good.score).toBeGreaterThan(short.score)
    expect(good.covered.length).toBeGreaterThan(short.covered.length)
    expect(good.score).toBeGreaterThanOrEqual(0)
    expect(good.score).toBeLessThanOrEqual(100)
    expect(short.suggestion).not.toBe('')
  })

  it('summarises a file into the three sections with page citations', async () => {
    const { title, summary } = await demoAi.summarizeSource({ notebookName: 'OS', source: sources[0] })
    expect(title).toBe('Summary: Lecture 5 - Deadlocks')
    expect(summary).toContain('## Key ideas')
    expect(summary).toContain('## Definitions')
    expect(summary).toContain('## Likely exam points')
    expect(summary).toMatch(/\(page \d\)/)
  })
})

describe('demo syllabus extraction', () => {
  it('reads weekly topics, skips admin lines and resolves exams', async () => {
    const result = await demoAi.extractSyllabus({ notebookName: 'OS', syllabus: sources[1], existingTopicTitles: [], todayDate: '2026-10-04' })
    expect(result.courseCode).toBe('CS 330')
    expect(result.topics).toEqual([
      { title: 'Processes and threads', description: 'Process states, the process control block, context switching.', unitLabel: 'Week 1' },
      { title: 'CPU scheduling', description: 'FCFS, shortest job first, round robin, priority scheduling.', unitLabel: 'Week 2' },
      { title: 'Deadlocks', description: "The four Coffman conditions, prevention, avoidance with the banker's algorithm, detection.", unitLabel: 'Week 3' },
      { title: 'Memory management and paging', description: 'Page tables, TLBs, page faults.', unitLabel: 'Week 4' }
    ])
    expect(result.exams).toEqual([
      { name: 'Midterm exam', examDate: '2026-10-20', coversTopicTitles: ['Processes and threads', 'CPU scheduling', 'Deadlocks'] },
      {
        name: 'Final exam',
        examDate: '2026-12-15',
        coversTopicTitles: ['Processes and threads', 'CPU scheduling', 'Deadlocks', 'Memory management and paging']
      }
    ])
  })

  it('handles units, bullets, written dates and existing topics', async () => {
    const syllabus = `Data Structures (CSC-2110)
Unit 1 - Arrays and linked lists
Unit 2 - Stacks and queues
  - array-based stacks
  - circular queues
Unit 3: Trees (Oct 5)
Midterm exam: October 12, 2026
Unit 4: Graphs
Final Exam - 2026-12-10
Quiz 3: Nov 3`
    const result = await demoAi.extractSyllabus({
      notebookName: 'DS',
      syllabus: { name: 'syllabus.md', kind: 'syllabus', text: syllabus },
      existingTopicTitles: ['arrays and linked lists'],
      todayDate: '2026-09-01'
    })
    expect(result.courseCode).toBe('CSC 2110')
    expect(result.topics.map((t) => [t.unitLabel, t.title])).toEqual([
      ['Unit 2', 'Stacks and queues'],
      ['Unit 3', 'Trees'],
      ['Unit 4', 'Graphs']
    ])
    expect(result.topics[0].description).toBe('Array-based stacks; circular queues.')
    expect(result.exams.map((e) => [e.name, e.examDate])).toEqual([
      ['Midterm exam', '2026-10-12'],
      ['Final Exam', '2026-12-10'],
      ['Quiz 3', '2026-11-03']
    ])
    // Exams may cover a topic that already exists in the notebook.
    expect(result.exams[0].coversTopicTitles).toEqual(['arrays and linked lists', 'Stacks and queues', 'Trees'])
    expect(result.exams[1].coversTopicTitles).toHaveLength(4)
  })

  it('parses the common date formats', () => {
    expect(findDate('Midterm exam: October 12, 2026', 2025)).toBe('2026-10-12')
    expect(findDate('Final Exam - 2026-12-10', 2025)).toBe('2026-12-10')
    expect(findDate('Quiz on 3 March', 2027)).toBe('2027-03-03')
    expect(findDate('Test 2: Sept. 9th', 2026)).toBe('2026-09-09')
    expect(findDate('Exam 11/24/2026', 2025)).toBe('2026-11-24')
    expect(findDate('Final exam: TBA', 2026)).toBeNull()
    expect(findDate('Exam 2026-02-30', 2026)).toBeNull()
  })
})
