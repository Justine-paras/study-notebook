// End-to-end service flow with the real modules: SQLite in memory, real file
// extraction and library copies in a temp folder, real learning logic, and
// the offline demo AI. Follows one learner from an empty notebook to a
// backup and deletion. Assertions avoid depending on the exact demo content.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Lesson, Notebook, Quiz, Source, Topic } from '@shared/types'
import { services } from '../../src/main/services'
import { createTestContext, type TestContext } from './helpers/context'

const START = new Date(2026, 9, 4, 9, 30, 0)
const DAY = 24 * 60 * 60 * 1000

const SYLLABUS = `CS 330 Operating Systems - Course Syllabus
Fall 2026

Schedule
Week 1: Processes and threads - process states, the process control block, context switching.
Week 2: CPU scheduling - FCFS, shortest job first, round robin, priority scheduling.
Week 3: Deadlocks - the four Coffman conditions, prevention, avoidance with the banker's algorithm, detection.
Week 4: Memory management and paging - page tables, TLBs, page faults.

Exams
Midterm exam: 2026-10-20, covers weeks 1-3 (processes, CPU scheduling, deadlocks).
Final exam: 2026-12-15, covers everything.
`

const LECTURE = `# Lecture 5: Deadlocks

A deadlock is a state in which every process in a set is waiting for an event that only another process in the set can cause.

## The four Coffman conditions

Deadlock can arise only if all four conditions hold at the same time:

1. Mutual exclusion: at least one resource is held in a non-shareable mode.
2. Hold and wait: a process holds at least one resource while waiting for others.
3. No preemption: resources cannot be forcibly taken away from a process.
4. Circular wait: a cycle of processes exists where each waits for a resource held by the next.

## Prevention

Deadlock prevention breaks at least one of the four conditions, for example by ordering resources to rule out circular wait.

## Avoidance

The banker's algorithm avoids deadlock by granting a request only if the system stays in a safe state.

\`\`\`c
if (request <= need && request <= available) grant_if_safe(request);
\`\`\`
`

describe('study flow (real modules, demo AI)', () => {
  let ctx: TestContext
  let filesDir: string
  let notebook: Notebook
  let syllabus: Source
  let lecture: Source
  let topic: Topic
  let lesson: Lesson
  let quiz: Quiz

  beforeAll(() => {
    ctx = createTestContext({ now: START })
    filesDir = join(ctx.tempDir, 'incoming')
    mkdirSync(filesDir, { recursive: true })
    writeFileSync(join(filesDir, 'CS330 Syllabus.txt'), SYLLABUS)
    writeFileSync(join(filesDir, 'Lecture 5 - Deadlocks.md'), LECTURE)
  })
  afterAll(() => ctx.cleanup())

  it('creates a notebook', async () => {
    notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
    expect((await services.listNotebooks(ctx)).map((n) => n.id)).toEqual([notebook.id])
  })

  it('imports a syllabus and a lecture into the library', async () => {
    const result = await services.importSources(ctx, notebook.id, [
      { path: join(filesDir, 'CS330 Syllabus.txt') },
      { path: join(filesDir, 'Lecture 5 - Deadlocks.md'), kind: 'lecture' },
      { path: join(filesDir, 'diagram.png') }
    ])
    expect(result.failed.map((f) => f.path)).toEqual([join(filesDir, 'diagram.png')])
    expect(result.sources.map((s) => s.status)).toEqual(['ready', 'ready'])
    ;[syllabus, lecture] = result.sources
    expect(syllabus.kind).toBe('syllabus')
    expect(lecture.kind).toBe('lecture')
    expect(existsSync(syllabus.storedPath)).toBe(true)
    expect(syllabus.storedPath.startsWith(ctx.paths.libraryDir)).toBe(true)
    expect((await services.getSourceText(ctx, lecture.id)).text).toContain('Coffman')
  })

  it('extracts topics and exams from the syllabus', async () => {
    const result = await services.extractTopicsFromSyllabus(ctx, notebook.id, syllabus.id)
    expect(result.topicsAdded.length).toBeGreaterThan(0)
    const topics = await services.listTopics(ctx, notebook.id)
    expect(topics.map((t) => t.orderIndex)).toEqual(topics.map((_, i) => i))
    expect(topics.every((t) => t.progress.state === 'not_started')).toBe(true)
    topic = topics.find((t) => /deadlock/i.test(t.title)) ?? topics[0]

    // Running it again adds nothing new.
    const again = await services.extractTopicsFromSyllabus(ctx, notebook.id, syllabus.id)
    expect(again.topicsAdded).toEqual([])
    expect(await services.listTopics(ctx, notebook.id)).toHaveLength(topics.length)
    expect(ctx.progressEvents.some((e) => e.task === 'syllabus')).toBe(true)
  })

  it('generates a lesson from the sources and starts the path', async () => {
    lesson = await services.generateLesson(ctx, topic.id)
    expect(lesson.content.chunks.length).toBeGreaterThanOrEqual(1)
    expect(lesson.content.warmup.length).toBeGreaterThanOrEqual(1)
    expect(lesson.content.sourcesUsed.length).toBeGreaterThan(0)
    for (const label of lesson.content.sourcesUsed) expect(label).toMatch(/^(CS330 Syllabus\.txt|Lecture 5 - Deadlocks\.md)/)
    expect((await services.getTopic(ctx, topic.id)).pathStep).toBe('warmup')
    expect((await services.generateLesson(ctx, topic.id)).id).toBe(lesson.id)
    const lessonEvents = ctx.progressEvents.filter((e) => e.task === 'lesson')
    expect(new Set(lessonEvents.map((e) => e.jobId)).size).toBe(1)
  })

  it('records warm-up and check answers', async () => {
    const [warmup] = lesson.content.warmup
    const right = await services.recordAnswer(ctx, { topicId: topic.id, source: 'warmup', question: warmup, response: warmup.answer, confidence: 'unsure' })
    expect(right.correct).toBe(true)
    const check = lesson.content.chunks[0].check
    const wrong = await services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question: check, response: 'definitely not it', confidence: 'sure' })
    expect(wrong.correct).toBe(false)
    expect(wrong.record).toMatchObject({ notebookId: notebook.id, topicId: topic.id, source: 'check', confidence: 'sure' })
    await services.setTopicStep(ctx, topic.id, 'explain', lesson.content.chunks.length - 1)
  })

  it('grades an explanation and saves it as a note', async () => {
    const feedback = await services.gradeExplanation(
      ctx,
      topic.id,
      'A deadlock happens when processes each hold a resource and wait for one held by another, so none can continue. It needs mutual exclusion, hold and wait, no preemption and circular wait.'
    )
    expect(feedback.score).toBeGreaterThanOrEqual(0)
    expect(feedback.score).toBeLessThanOrEqual(100)
    const notes = await services.listNotes(ctx, notebook.id, topic.id)
    expect(notes.filter((n) => n.kind === 'explanation')).toHaveLength(1)
    expect(notes[0].body).toContain('## Feedback')
  })

  it('finishes the topic with flashcards and a review plan, idempotently', async () => {
    const result = await services.finishTopic(ctx, topic.id)
    expect(result.topic.pathStep).toBe('done')
    expect(result.cardsCreated.length).toBeGreaterThan(0)
    expect(result.cardsCreated.some((c) => c.origin === 'mistake')).toBe(true)
    const tomorrow = new Date(2026, 9, 5).toISOString()
    expect(result.cardsCreated.every((c) => c.due === tomorrow)).toBe(true)
    expect(result.reviewPlan.length).toBeGreaterThan(0)
    expect(result.reviewPlan[0].date).toBe('2026-10-05')

    const cardCount = (await services.listCards(ctx, notebook.id)).length
    await services.finishTopic(ctx, topic.id)
    expect(await services.listCards(ctx, notebook.id)).toHaveLength(cardCount)
  })

  it('reviews the cards when they come due', async () => {
    expect(await services.getReviewQueue(ctx)).toEqual([])
    ctx.setNow(new Date(START.getTime() + DAY))
    const queue = await services.getReviewQueue(ctx)
    expect(queue.length).toBeGreaterThan(0)
    expect(queue[0]).toMatchObject({ notebookName: 'Operating Systems', notebookColor: 'teal' })
    expect(queue[0].previews.map((p) => p.rating)).toEqual([1, 2, 3, 4])

    const reviewed = await services.reviewCard(ctx, { cardId: queue[0].id, rating: 3, confidence: 'sure', response: '' })
    expect(new Date(reviewed.due).getTime()).toBeGreaterThan(ctx.now().getTime())
    expect(reviewed.reps).toBe(1)
    expect((await services.getReviewQueue(ctx)).map((c) => c.id)).not.toContain(queue[0].id)
    expect((await services.getReviewQueue(ctx, { cardIds: [queue[0].id] })).map((c) => c.id)).toEqual([queue[0].id])
  })

  it('creates, answers and submits a practice quiz', async () => {
    quiz = await services.createQuiz(ctx, {
      notebookId: notebook.id,
      topicId: topic.id,
      kind: 'practice',
      settings: { types: ['mc', 'tf', 'fill', 'identification'], count: 5, difficulty: 'mixed', focusWeak: true, interleave: true, timeLimitMin: null },
      topicIds: []
    })
    expect(quiz.questions).toHaveLength(5)
    expect(quiz.title).toBe(`Practice: ${topic.title}`)
    await services.startQuiz(ctx, quiz.id)
    const [first, second] = quiz.questions
    await services.saveQuizAnswer(ctx, quiz.id, { questionId: first.id, response: first.answer, confidence: 'sure' })
    await services.saveQuizAnswer(ctx, quiz.id, { questionId: second.id, response: 'zzz not an answer', confidence: 'sure' })

    const result = await services.submitQuiz(ctx, quiz.id)
    expect(result.total).toBe(5)
    expect(result.correct).toBeGreaterThanOrEqual(1)
    expect(result.overconfident).toContain(second.id)
    expect(result.cardsCreated).toBeGreaterThan(0)
    expect(result.cardsCreated).toBeLessThanOrEqual(5 - result.correct)
    expect(await services.submitQuiz(ctx, quiz.id)).toEqual(result)
    expect(await services.getQuizResult(ctx, quiz.id)).toEqual(result)
  })

  it('builds Today and Insights', async () => {
    await services.logFocusSession(ctx, {
      notebookId: notebook.id,
      kind: 'focus',
      startedAt: new Date(ctx.now().getTime() - 25 * 60_000).toISOString(),
      endedAt: ctx.now().toISOString(),
      minutes: 25
    })
    const today = await services.getToday(ctx)
    expect(today.notebooks.map((n) => n.id)).toEqual([notebook.id])
    expect(today.notebooks[0].topicCount).toBeGreaterThan(0)
    expect(today.studyMinutesToday).toBe(25)
    expect(today.streakDays).toBeGreaterThanOrEqual(1)
    expect(today.plan.date).toBe('2026-10-05')
    expect(today.exams.every((e) => e.daysLeft >= 0)).toBe(true)

    const insights = await services.getInsights(ctx)
    expect(insights.calibration.map((c) => c.confidence)).toEqual(['sure', 'unsure', 'guess'])
    expect(insights.overconfidentLast7Days).toBeGreaterThan(0)
    expect(insights.mistakes.length).toBeGreaterThan(0)
    expect(insights.forecast).toHaveLength(7)
    expect(insights.studyMinutesByDay).toHaveLength(14)
    expect(insights.studyMinutesBySubject[0]).toMatchObject({ notebookId: notebook.id, minutes: 25 })
  })

  it('exports a backup', async () => {
    ctx.desktop.savePath = join(ctx.tempDir, 'backup.db')
    expect(await services.exportBackup(ctx)).toEqual({ path: ctx.desktop.savePath })
    const copy = new DatabaseSync(ctx.desktop.savePath)
    expect(copy.prepare('SELECT COUNT(*) AS n FROM quizzes').get()).toEqual({ n: 1 })
    copy.close()
  })

  it('deletes the notebook with everything in it', async () => {
    await services.deleteNotebook(ctx, notebook.id)
    expect(await services.listNotebooks(ctx)).toEqual([])
    expect(existsSync(join(ctx.paths.libraryDir, notebook.id))).toBe(false)
    for (const table of ['sources', 'topics', 'lessons', 'quizzes', 'answers', 'cards', 'review_logs', 'notes', 'exams']) {
      expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })
})
