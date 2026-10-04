// The service layer on its own: learning logic, file extraction and the AI
// are replaced by simple fakes (tests/unit/helpers), so these tests pin down
// what the backend itself does: persistence, validation, source selection,
// idempotency and the shape of every result.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuizSettings, TopicWithProgress } from '@shared/types'
import { services } from '../../src/main/services'
import { chooseQuizTopics, validateQuizSettings } from '../../src/main/services/quizzes'
import { NO_FILES_LABEL } from '../../src/main/services/sourceBudget'
import { createTestContext, type TestContext } from './helpers/context'
import { FakeAi } from './helpers/fakeAi'
import { failNextRemoval } from './helpers/fakeFiles'

vi.mock('@shared/learning', () => import('./helpers/fakeLearning'))
vi.mock('../../src/main/files/extract', () => import('./helpers/fakeFiles'))
vi.mock('../../src/main/files/library', () => import('./helpers/fakeFiles'))

const NOW = new Date(2026, 9, 4, 10, 0, 0)
let ctx: TestContext
let ai: FakeAi
let filesDir: string

function writeFile(name: string, content: string): string {
  const path = join(filesDir, name)
  writeFileSync(path, content)
  return path
}

const practiceSettings: QuizSettings = { types: ['mc', 'tf'], count: 4, difficulty: 'mixed', focusWeak: true, interleave: true, timeLimitMin: null }

beforeEach(() => {
  ai = new FakeAi()
  ctx = createTestContext({ now: NOW, ai })
  filesDir = join(ctx.tempDir, 'incoming')
  mkdirSync(filesDir, { recursive: true })
})
afterEach(() => ctx.cleanup())

async function notebookWithTopics(titles: string[] = ['Processes', 'Deadlocks', 'Paging']) {
  const notebook = await services.createNotebook(ctx, { name: 'Operating Systems', code: '', color: 'teal' })
  const topics = []
  for (const title of titles) topics.push(await services.createTopic(ctx, notebook.id, { title, description: `All about ${title}` }))
  return { notebook, topics }
}

describe('notebooks', () => {
  it('creates, validates, updates, summarises and deletes', async () => {
    await expect(services.createNotebook(ctx, { name: '  ', code: '', color: 'blue' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(services.createNotebook(ctx, { name: 'X', code: '', color: 'red' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const nb = await services.createNotebook(ctx, { name: ' Algorithms ', code: ' CS 310 ', color: 'blue' })
    expect(nb).toMatchObject({ name: 'Algorithms', code: 'CS 310', color: 'blue', archived: false })
    const summary = await services.getNotebook(ctx, nb.id)
    expect(summary).toMatchObject({ sourceCount: 0, topicCount: 0, mastery: 0, dueCards: 0, nextExam: null, nextExamReadiness: null, lastStudiedAt: null })

    const updated = await services.updateNotebook(ctx, nb.id, { archived: true, name: 'Algos' })
    expect(updated).toMatchObject({ archived: true, name: 'Algos', code: 'CS 310' })
    expect((await services.listNotebooks(ctx)).map((n) => n.id)).toEqual([nb.id])

    await expect(services.getNotebook(ctx, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await services.deleteNotebook(ctx, nb.id)
    await expect(services.getNotebook(ctx, nb.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('summaries count due cards, the next exam with readiness and last study time', async () => {
    const { notebook, topics } = await notebookWithTopics()
    await services.createCard(ctx, { notebookId: notebook.id, topicId: topics[0].id, front: 'Q', back: 'A' })
    await services.createExam(ctx, { notebookId: notebook.id, name: 'Old quiz', examDate: '2026-09-01', topicIds: [] })
    await services.createExam(ctx, { notebookId: notebook.id, name: 'Midterm', examDate: '2026-10-20', topicIds: [topics[0].id] })
    await services.logFocusSession(ctx, {
      notebookId: notebook.id,
      kind: 'focus',
      startedAt: '2026-10-04T07:00:00.000Z',
      endedAt: '2026-10-04T07:25:00.000Z',
      minutes: 25
    })
    const summary = await services.getNotebook(ctx, notebook.id)
    expect(summary).toMatchObject({ topicCount: 3, dueCards: 1, nextExamReadiness: 0, lastStudiedAt: '2026-10-04T07:25:00.000Z' })
    expect(summary.nextExam?.name).toBe('Midterm')
  })
})

describe('sources', () => {
  it('imports supported files, reports failures and keeps extraction errors visible', async () => {
    const { notebook } = await notebookWithTopics([])
    const lecture = writeFile('Lecture 3 - Deadlocks.md', '# Deadlocks\n\nA deadlock needs four conditions.')
    const scanned = writeFile('Scanned.pdf', 'CORRUPT')
    const image = writeFile('photo.png', 'binary')
    const result = await services.importSources(ctx, notebook.id, [
      { path: lecture },
      { path: scanned, kind: 'exam' },
      { path: image },
      { path: join(filesDir, 'missing.txt') }
    ])
    expect(result.failed.map((f) => f.path)).toEqual([image, join(filesDir, 'missing.txt')])
    expect(result.sources).toHaveLength(2)
    const [ready, broken] = result.sources
    expect(ready).toMatchObject({ fileName: 'Lecture 3 - Deadlocks.md', ext: 'md', kind: 'lecture', status: 'ready', error: null })
    expect(ready.charCount).toBe('# Deadlocks\n\nA deadlock needs four conditions.'.length)
    expect(existsSync(ready.storedPath)).toBe(true)
    expect(broken).toMatchObject({ kind: 'exam', status: 'error', error: 'This PDF has no text layer (it may be scanned).' })

    expect((await services.getSourceText(ctx, ready.id)).text).toContain('four conditions')
    expect(await services.updateSource(ctx, ready.id, { kind: 'notes' })).toMatchObject({ kind: 'notes' })
    await expect(services.updateSource(ctx, ready.id, { kind: 'bogus' as never })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await services.openSource(ctx, ready.id)
    expect(ctx.desktop.opened).toEqual([ready.storedPath])
  })

  it('deleting a source removes the stored copy and unlinks it from topics', async () => {
    const { notebook } = await notebookWithTopics([])
    const { sources } = await services.importSources(ctx, notebook.id, [{ path: writeFile('Week 1.txt', 'Processes and threads') }])
    const topic = await services.createTopic(ctx, notebook.id, { title: 'Processes', sourceIds: [sources[0].id] })
    await services.deleteSource(ctx, sources[0].id)
    expect(existsSync(sources[0].storedPath)).toBe(false)
    expect((await services.getTopic(ctx, topic.id)).sourceIds).toEqual([])
    await expect(services.createTopic(ctx, notebook.id, { title: 'X', sourceIds: ['ghost'] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('summarizes a source into the source and a single summary note', async () => {
    const { notebook } = await notebookWithTopics([])
    const { sources } = await services.importSources(ctx, notebook.id, [{ path: writeFile('notes.md', 'Some notes') }])
    const note = await services.summarizeSource(ctx, sources[0].id)
    expect(note).toMatchObject({ kind: 'summary', sourceId: sources[0].id, title: 'Summary of notes.md', body: '- key point' })
    await services.summarizeSource(ctx, sources[0].id)
    expect((await services.listNotes(ctx, notebook.id)).filter((n) => n.kind === 'summary')).toHaveLength(1)
    expect((await services.listSources(ctx, notebook.id))[0].summary).toBe('- key point')
  })

  it('deleting a notebook removes its library folder', async () => {
    const { notebook } = await notebookWithTopics([])
    const { sources } = await services.importSources(ctx, notebook.id, [{ path: writeFile('a.txt', 'text') }])
    await services.deleteNotebook(ctx, notebook.id)
    expect(existsSync(sources[0].storedPath)).toBe(false)
    expect(existsSync(join(ctx.paths.libraryDir, notebook.id))).toBe(false)
  })

  it('reports a delete as done when Windows keeps the stored copy locked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { notebook } = await notebookWithTopics([])
    const { sources } = await services.importSources(ctx, notebook.id, [{ path: writeFile('a.txt', 'text') }, { path: writeFile('b.txt', 'more') }])
    failNextRemoval()
    await expect(services.deleteSource(ctx, sources[0].id)).resolves.toBeUndefined()
    expect(await services.listSources(ctx, notebook.id)).toHaveLength(1)
    failNextRemoval()
    await expect(services.deleteNotebook(ctx, notebook.id)).resolves.toBeUndefined()
    expect(await services.listNotebooks(ctx)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('topics and syllabus', () => {
  it('extracts topics in order, skips existing titles, adds dated exams and the course code', async () => {
    const notebook = await services.createNotebook(ctx, { name: 'OS', code: '', color: 'teal' })
    await services.createTopic(ctx, notebook.id, { title: 'Processes' })
    const { sources } = await services.importSources(ctx, notebook.id, [{ path: writeFile('Syllabus.txt', 'Week 1 Processes; Week 2 Deadlocks') }])
    ai.syllabus = {
      courseCode: 'CS 330',
      topics: [
        { title: 'PROCESSES', description: 'dup', unitLabel: 'Week 1' },
        { title: 'Deadlocks', description: 'Coffman conditions', unitLabel: 'Week 2' },
        { title: 'Paging', description: 'Virtual memory', unitLabel: 'Week 3' }
      ],
      exams: [
        { name: 'Midterm', examDate: '2026-10-20', coversTopicTitles: ['processes', 'deadlocks', 'unknown'] },
        { name: 'Final', examDate: null, coversTopicTitles: [] }
      ]
    }
    const result = await services.extractTopicsFromSyllabus(ctx, notebook.id, sources[0].id)
    expect(result.topicsSkipped).toEqual(['PROCESSES'])
    expect(result.topicsAdded.map((t) => [t.title, t.orderIndex, t.sourceIds])).toEqual([
      ['Deadlocks', 1, []],
      ['Paging', 2, []]
    ])
    expect(result.examsAdded).toHaveLength(1)
    const topics = await services.listTopics(ctx, notebook.id)
    expect(result.examsAdded[0].topicIds).toEqual([topics[0].id, topics[1].id])
    expect((await services.getNotebook(ctx, notebook.id)).code).toBe('CS 330')
    expect(ai.callsTo('extractSyllabus')[0].input).toMatchObject({ existingTopicTitles: ['Processes'], todayDate: '2026-10-04' })

    const again = await services.extractTopicsFromSyllabus(ctx, notebook.id, sources[0].id)
    expect(again.topicsAdded).toEqual([])
    expect(again.examsAdded).toEqual([])
    expect(await services.listExams(ctx, notebook.id)).toHaveLength(1)
  })

  it('reorders, keeps unlisted topics, rejects foreign ids and cleans exams on delete', async () => {
    const { notebook, topics } = await notebookWithTopics()
    const [a, b, c] = topics
    await services.reorderTopics(ctx, notebook.id, [c.id, a.id])
    expect((await services.listTopics(ctx, notebook.id)).map((t) => t.title)).toEqual(['Paging', 'Processes', 'Deadlocks'])
    await expect(services.reorderTopics(ctx, notebook.id, ['other'])).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(services.reorderTopics(ctx, notebook.id, [a.id, a.id])).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const exam = await services.createExam(ctx, { notebookId: notebook.id, name: 'Quiz', examDate: '2026-10-10', topicIds: [a.id, b.id] })
    await services.deleteTopic(ctx, a.id)
    expect((await services.listExams(ctx, notebook.id)).find((e) => e.id === exam.id)?.topicIds).toEqual([b.id])
  })

  it('sets the step without un-finishing a done topic', async () => {
    const { topics } = await notebookWithTopics(['One'])
    const learning = await services.setTopicStep(ctx, topics[0].id, 'learn', 2)
    expect(learning).toMatchObject({ pathStep: 'learn', chunkIndex: 2, startedAt: NOW.toISOString() })
    await expect(services.setTopicStep(ctx, topics[0].id, 'done' as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(services.setTopicStep(ctx, topics[0].id, 'learn', -1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('learning path', () => {
  it('generates a lesson from ranked sources, stores it once and reports progress', async () => {
    const { notebook, topics } = await notebookWithTopics()
    await services.importSources(ctx, notebook.id, [
      { path: writeFile('Lecture 1.md', 'Processes and threads.') },
      { path: writeFile('Lecture 2.md', 'Deadlocks: mutual exclusion, hold and wait.') },
      { path: writeFile('Midterm 2025.pdf', 'Old exam about deadlocks') }
    ])
    const deadlocks = topics[1]
    const lesson = await services.generateLesson(ctx, deadlocks.id)
    expect(lesson.content.sourcesUsed).toEqual(['Lecture 2.md', 'Lecture 1.md'])
    expect(ai.callsTo('generateLesson')[0].sources.map((s) => s.name)).toEqual(['Lecture 2.md', 'Lecture 1.md'])
    expect((ai.callsTo('generateLesson')[0].input as { otherTopics: { title: string }[] }).otherTopics.map((t) => t.title)).toEqual([
      'Processes',
      'Paging'
    ])
    expect((await services.getTopic(ctx, deadlocks.id)).pathStep).toBe('warmup')

    const jobIds = new Set(ctx.progressEvents.map((e) => e.jobId))
    expect(jobIds.size).toBe(1)
    expect(ctx.progressEvents.map((e) => e.progress)).toEqual([0, 0.5, 1])
    expect(ctx.progressEvents.every((e) => e.task === 'lesson')).toBe(true)
    // Each event names the topic, so lessons written for two topics at once keep their own progress.
    expect(ctx.progressEvents.every((e) => e.subjectId === deadlocks.id)).toBe(true)

    expect((await services.generateLesson(ctx, deadlocks.id)).id).toBe(lesson.id)
    expect(ai.callsTo('generateLesson')).toHaveLength(1)
    const regenerated = await services.generateLesson(ctx, deadlocks.id, { regenerate: true })
    expect(regenerated.id).not.toBe(lesson.id)
    expect((await services.getLesson(ctx, deadlocks.id))?.id).toBe(regenerated.id)
  })

  it('falls back to the description without files, and needs one or the other', async () => {
    const notebook = await services.createNotebook(ctx, { name: 'Empty', code: '', color: 'gold' })
    const described = await services.createTopic(ctx, notebook.id, { title: 'Recursion', description: 'Functions calling themselves' })
    const bare = await services.createTopic(ctx, notebook.id, { title: 'Bare' })
    expect((await services.generateLesson(ctx, described.id)).content.sourcesUsed).toEqual([NO_FILES_LABEL])
    await expect(services.generateLesson(ctx, bare.id)).rejects.toMatchObject({ code: 'NO_SOURCES' })
  })

  it('records answers, grades explanations into one note, and finishes the topic idempotently', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks'])
    const topic = topics[0]
    const lesson = await services.generateLesson(ctx, topic.id)
    const [warm1, warm2] = lesson.content.warmup

    const wrong = await services.recordAnswer(ctx, { topicId: topic.id, source: 'warmup', question: warm2, response: 'Wrong A', confidence: 'sure' })
    expect(wrong.correct).toBe(false)
    expect(wrong.record).toMatchObject({ notebookId: notebook.id, source: 'warmup', questionType: 'mc', correctAnswer: 'Right', confidence: 'sure' })
    expect((await services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question: warm1, response: 'true', confidence: null })).correct).toBe(true)
    await expect(
      services.recordAnswer(ctx, { topicId: topic.id, source: 'practice' as never, question: warm1, response: 'x', confidence: null })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    // A question type nothing can grade, or an absurdly long prompt, is refused instead of logged.
    for (const question of [{ ...warm1, type: 'essay' as never }, { ...warm1, prompt: 'x'.repeat(20_001) }, { ...warm1, prompt: '  ' }]) {
      await expect(services.recordAnswer(ctx, { topicId: topic.id, source: 'check', question, response: 'x', confidence: null })).rejects.toMatchObject({
        code: 'INVALID_INPUT'
      })
    }
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM answers').get()).toEqual({ n: 2 })

    await expect(services.gradeExplanation(ctx, topic.id, '   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const feedback = await services.gradeExplanation(ctx, topic.id, 'A deadlock is when processes wait forever.')
    expect(feedback.score).toBe(70)
    await services.gradeExplanation(ctx, topic.id, 'Second try.')
    const notes = (await services.listNotes(ctx, notebook.id, topic.id)).filter((n) => n.kind === 'explanation')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('My explanation: Deadlocks')
    expect(notes[0].body).toMatch(/^Second try\.\n\n## Feedback/)
    expect(notes[0].body).toContain('- point two')

    const finished = await services.finishTopic(ctx, topic.id)
    expect(finished.topic).toMatchObject({ pathStep: 'done', completedAt: NOW.toISOString() })
    const lessonCards = finished.cardsCreated.filter((c) => c.origin === 'lesson')
    const mistakeCards = finished.cardsCreated.filter((c) => c.origin === 'mistake')
    expect(lessonCards).toHaveLength(8)
    expect(mistakeCards).toHaveLength(1)
    expect(mistakeCards[0]).toMatchObject({ front: warm2.prompt, back: 'Right\n\nBecause Right.' })
    const tomorrow = new Date(2026, 9, 5).toISOString()
    expect(finished.cardsCreated.every((c) => c.due === tomorrow)).toBe(true)
    expect(finished.reviewPlan).toHaveLength(5)
    expect(finished.reviewPlan[0].date).toBe('2026-10-05')
    expect(new Set(finished.reviewPlan.map((p) => p.date)).size).toBe(5)

    const again = await services.finishTopic(ctx, topic.id)
    expect(ai.callsTo('generateFlashcards')).toHaveLength(1)
    expect(again.cardsCreated.map((c) => c.id).sort()).toEqual(lessonCards.map((c) => c.id).sort())
    expect(await services.listCards(ctx, notebook.id, topic.id)).toHaveLength(9)
    await expect(services.setTopicStep(ctx, topic.id, 'learn')).resolves.toMatchObject({ pathStep: 'done' })
  })

  it('dedupes flashcards by normalised front', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks'])
    await services.generateLesson(ctx, topics[0].id)
    await services.createCard(ctx, { notebookId: notebook.id, topicId: topics[0].id, front: 'What is a deadlock?', back: 'x' })
    ai.flashcards = [
      { front: 'what is a DEADLOCK', back: 'dup of manual', sourceRef: '' },
      { front: 'Name the 4 conditions.', back: 'a', sourceRef: '' },
      { front: 'name the 4 conditions', back: 'dup in batch', sourceRef: '' }
    ]
    const result = await services.finishTopic(ctx, topics[0].id)
    expect(result.cardsCreated.map((c) => c.front)).toEqual(['Name the 4 conditions.'])
  })

  it('requires a lesson before explaining or finishing', async () => {
    const { topics } = await notebookWithTopics(['A'])
    await expect(services.finishTopic(ctx, topics[0].id)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(services.gradeExplanation(ctx, topics[0].id, 'x')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(services.finishTopic(ctx, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('quizzes', () => {
  it('validates settings', () => {
    expect(validateQuizSettings({ ...practiceSettings, types: ['mc', 'mc'] }).types).toEqual(['mc'])
    for (const bad of [
      { ...practiceSettings, types: [] },
      { ...practiceSettings, types: ['essay'] },
      { ...practiceSettings, count: 0 },
      { ...practiceSettings, count: 61 },
      { ...practiceSettings, difficulty: 'brutal' },
      { ...practiceSettings, timeLimitMin: 0 }
    ]) {
      expect(() => validateQuizSettings(bad)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
    }
  })

  it('practice interleaves up to 3 earlier started topics and avoids recent prompts', async () => {
    const { notebook, topics } = await notebookWithTopics(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'])
    await services.importSources(ctx, notebook.id, [{ path: writeFile('Lecture.md', 'T1 T2 T3 T4 T5 T6 content') }])
    for (const t of topics.slice(0, 5)) await services.setTopicStep(ctx, t.id, 'learn')
    const first = await services.createQuiz(ctx, { notebookId: notebook.id, topicId: topics[4].id, kind: 'practice', settings: practiceSettings, topicIds: [] })
    expect(first.title).toBe('Practice: T5')
    expect(first.questions).toHaveLength(4)
    const request = ai.callsTo('generateQuestions')[0].input as { topics: { title: string }[]; primaryTopicId: string; avoidPrompts: string[] }
    expect(request.topics.map((t) => t.title)).toEqual(['T5', 'T4', 'T3', 'T2'])
    expect(request.primaryTopicId).toBe(topics[4].id)
    expect(request.avoidPrompts).toEqual([])

    await services.createQuiz(ctx, {
      notebookId: notebook.id,
      topicId: topics[4].id,
      kind: 'practice',
      settings: { ...practiceSettings, interleave: false },
      topicIds: []
    })
    const second = ai.callsTo('generateQuestions')[1].input as { topics: { title: string }[]; avoidPrompts: string[] }
    expect(second.topics.map((t) => t.title)).toEqual(['T5'])
    expect(second.avoidPrompts).toEqual(first.questions.map((q) => q.prompt))
  })

  it('mock exams use the next exam, its name and past-exam sources for style', async () => {
    const { notebook, topics } = await notebookWithTopics()
    await services.importSources(ctx, notebook.id, [
      { path: writeFile('Lecture.md', 'Processes and deadlocks') },
      { path: writeFile('Midterm 2025.txt', 'Past exam questions on deadlocks') }
    ])
    await services.createExam(ctx, { notebookId: notebook.id, name: 'Midterm', examDate: '2026-10-07', topicIds: [topics[0].id, topics[1].id] })
    const quiz = await services.createQuiz(ctx, {
      notebookId: notebook.id,
      topicId: null,
      kind: 'mock_exam',
      settings: { ...practiceSettings, count: 6, timeLimitMin: 45 },
      topicIds: []
    })
    expect(quiz.title).toBe('Mock exam: Midterm')
    expect(quiz.settings.timeLimitMin).toBe(45)
    const call = ai.callsTo('generateQuestions')[0]
    expect((call.input as { topics: { id: string }[] }).topics.map((t) => t.id)).toEqual([topics[0].id, topics[1].id])
    expect(call.sources.map((s) => s.name)).toEqual(['Lecture.md', 'Midterm 2025.txt'])
  })

  it('saves answers, grades on submit, turns mistakes into cards and submits once', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks'])
    await services.importSources(ctx, notebook.id, [{ path: writeFile('Lecture.md', 'Deadlocks') }])
    const quiz = await services.createQuiz(ctx, {
      notebookId: notebook.id,
      topicId: topics[0].id,
      kind: 'practice',
      settings: { ...practiceSettings, count: 3 },
      topicIds: []
    })
    const [q1, q2, q3] = quiz.questions
    expect([q1.type, q2.type, q3.type]).toEqual(['mc', 'tf', 'mc'])
    await services.saveQuizAnswer(ctx, quiz.id, { questionId: q1.id, response: 'nope', confidence: 'unsure' })
    const saved = await services.saveQuizAnswer(ctx, quiz.id, { questionId: q1.id, response: q1.answer, confidence: 'sure' })
    expect(saved.answers).toEqual([{ questionId: q1.id, response: q1.answer, confidence: 'sure', correct: false }])
    expect(saved.startedAt).toBe(NOW.toISOString())
    await services.saveQuizAnswer(ctx, quiz.id, { questionId: q2.id, response: 'wrong', confidence: 'sure' })
    await expect(services.saveQuizAnswer(ctx, quiz.id, { questionId: 'ghost', response: 'x', confidence: null })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    await expect(services.getQuizResult(ctx, quiz.id)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const result = await services.submitQuiz(ctx, quiz.id)
    expect(result).toMatchObject({ correct: 1, total: 3, overconfident: [q2.id], cardsCreated: 2 })
    expect(result.byTopic).toEqual([{ topicId: topics[0].id, topicTitle: 'Deadlocks', correct: 1, total: 3 }])
    expect(result.quiz.score).toBe(1)
    const cards = await services.listCards(ctx, notebook.id)
    expect(cards.map((c) => c.origin)).toEqual(['mistake', 'mistake'])
    // Options are listed on the card only for multiple choice.
    expect(cards[0].front).toBe(q2.prompt)
    expect(cards[1].front).toBe(`${q3.prompt}\n\n- ${q3.options.join('\n- ')}`)
    expect(cards[0].back).toBe(`${q2.answer}\n\n${q2.explanation}`)
    // "Sure but wrong" comes back before the plain mistake.
    expect(cards[0].due < cards[1].due).toBe(true)

    const again = await services.submitQuiz(ctx, quiz.id)
    expect(again).toEqual(result)
    expect(await services.getQuizResult(ctx, quiz.id)).toEqual(result)
    expect(await services.listCards(ctx, notebook.id)).toHaveLength(2)
    const answers = ctx.db.prepare('SELECT source, correct FROM answers WHERE quiz_id = ?').all(quiz.id)
    expect(answers).toHaveLength(3)
    expect(answers.every((a) => a.source === 'practice')).toBe(true)
    await expect(services.saveQuizAnswer(ctx, quiz.id, { questionId: q1.id, response: 'x', confidence: null })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })

    expect((await services.listQuizzes(ctx, notebook.id, 'practice')).map((q) => q.id)).toEqual([quiz.id])
    await services.deleteQuiz(ctx, quiz.id)
    await expect(services.getQuiz(ctx, quiz.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM answers').get()).toEqual({ n: 3 })
  })

  it('brings an existing card back when its question is missed again, instead of leaving it weeks away', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks'])
    await services.importSources(ctx, notebook.id, [{ path: writeFile('Lecture.md', 'Deadlocks') }])
    const input = { notebookId: notebook.id, topicId: topics[0].id, kind: 'practice' as const, settings: { ...practiceSettings, count: 3 }, topicIds: [] }
    const first = await services.createQuiz(ctx, input)
    expect((await services.submitQuiz(ctx, first.id)).cardsCreated).toBe(3)
    const [c1, c2, c3] = await services.listCards(ctx, notebook.id)
    for (const card of [c1, c2, c3]) await services.reviewCard(ctx, { cardId: card.id, rating: 4, confidence: 'sure', response: '' })
    const setAside = await services.updateCard(ctx, c3.id, { suspended: true })
    const later = new Date(NOW.getTime() + 60_000)
    ctx.setNow(later)

    // The fake AI asks the same questions again: q1 missed plainly, q2 missed while sure, q3 (suspended card) missed.
    const second = await services.createQuiz(ctx, input)
    await services.saveQuizAnswer(ctx, second.id, { questionId: second.questions[1].id, response: 'False', confidence: 'sure' })
    expect((await services.submitQuiz(ctx, second.id)).cardsCreated).toBe(0)
    const after = new Map((await services.listCards(ctx, notebook.id)).map((c) => [c.id, c]))
    expect(after.get(c1.id)?.due).toBe(later.toISOString())
    expect(after.get(c2.id)?.due).toBe(new Date(later.getTime() - 24 * 60 * 60 * 1000).toISOString())
    expect(after.get(c3.id)?.due).toBe(setAside.due)
    expect(setAside.due > later.toISOString()).toBe(true)
    // Only the due date moved: the memory state is kept for FSRS.
    expect(after.get(c1.id)).toMatchObject({ reps: 1, state: 'review' })
  })
})

describe('chooseQuizTopics', () => {
  const topic = (id: string, orderIndex: number, state: TopicWithProgress['progress']['state'], mastery: number, answered = 0): TopicWithProgress =>
    ({
      id,
      orderIndex,
      notebookId: 'n',
      pathStep: state === 'not_started' ? null : 'learn',
      progress: { state, mastery, answeredCount: answered, lastPracticedAt: answered ? 'x' : null }
    }) as TopicWithProgress
  const topics = [topic('a', 0, 'weak', 30, 5), topic('b', 1, 'reviewing', 80, 5), topic('c', 2, 'weak', 10, 5), topic('d', 3, 'not_started', 0)]

  it('weak spots: weakest weak topics first', () => {
    expect(chooseQuizTopics('weak_spots', topics, { topicId: null, topicIds: [], interleave: false }, []).topics.map((t) => t.id)).toEqual(['c', 'a'])
    expect(chooseQuizTopics('weak_spots', topics, { topicId: null, topicIds: ['b'], interleave: false }, []).topics.map((t) => t.id)).toEqual(['b'])
  })

  it('mock exam: exam topics, all topics for an exam without a list, else started topics', () => {
    const exam = { id: 'e', notebookId: 'n', name: 'Final', examDate: '2026-12-01', topicIds: ['b', 'd'], createdAt: '' }
    expect(chooseQuizTopics('mock_exam', topics, { topicId: null, topicIds: [], interleave: false }, [exam])).toMatchObject({ exam })
    expect(chooseQuizTopics('mock_exam', topics, { topicId: null, topicIds: [], interleave: false }, [exam]).topics.map((t) => t.id)).toEqual(['b', 'd'])
    expect(chooseQuizTopics('mock_exam', topics, { topicId: null, topicIds: [], interleave: false }, [{ ...exam, topicIds: [] }]).topics).toHaveLength(4)
    expect(chooseQuizTopics('mock_exam', topics, { topicId: null, topicIds: [], interleave: false }, []).topics.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(chooseQuizTopics('mock_exam', topics, { topicId: null, topicIds: ['d', 'b'], interleave: false }, [exam]).exam).toEqual(exam)
  })
})

describe('reviews', () => {
  it('queues due cards with previews, reviews them and logs an answer', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks'])
    const c1 = await services.createCard(ctx, { notebookId: notebook.id, topicId: topics[0].id, front: 'F1', back: 'B1' })
    const c2 = await services.createCard(ctx, { notebookId: notebook.id, topicId: null, front: 'F2', back: 'B2' })
    const queue = await services.getReviewQueue(ctx)
    expect(queue.map((c) => c.id)).toEqual([c1.id, c2.id])
    expect(queue[0]).toMatchObject({ notebookName: 'Operating Systems', notebookColor: 'teal', topicTitle: 'Deadlocks' })
    expect(queue[0].previews).toHaveLength(4)
    expect(queue[1].topicTitle).toBeNull()
    expect(await services.getReviewQueue(ctx, { limit: 1 })).toHaveLength(1)

    // A guess rated Good counts as Hard.
    const reviewed = await services.reviewCard(ctx, { cardId: c1.id, rating: 3, confidence: 'guess', response: 'my try' })
    expect(reviewed.reps).toBe(1)
    expect(ctx.db.prepare('SELECT rating, confidence FROM review_logs').all()).toEqual([{ rating: 2, confidence: 'guess' }])
    expect(ctx.db.prepare("SELECT source, question_type, prompt, user_answer, correct_answer, correct FROM answers").get()).toEqual({
      source: 'review',
      question_type: 'recall',
      prompt: 'F1',
      user_answer: 'my try',
      correct_answer: 'B1',
      correct: 1
    })
    expect((await services.getReviewQueue(ctx)).map((c) => c.id)).toEqual([c2.id])
    expect((await services.getReviewQueue(ctx, { cardIds: [c1.id, 'gone', c2.id] })).map((c) => c.id)).toEqual([c1.id, c2.id])

    await services.updateCard(ctx, c2.id, { suspended: true })
    expect(await services.getReviewQueue(ctx)).toEqual([])
    await expect(services.reviewCard(ctx, { cardId: c1.id, rating: 5 as never, confidence: null, response: '' })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await services.deleteCard(ctx, c1.id)
    await expect(services.reviewCard(ctx, { cardId: c1.id, rating: 3, confidence: null, response: '' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('notes, exams and focus', () => {
  it('validates and stores', async () => {
    const { notebook, topics } = await notebookWithTopics(['A'])
    const note = await services.createNote(ctx, { notebookId: notebook.id, topicId: topics[0].id, title: '', body: '# Hi' })
    expect(note).toMatchObject({ title: 'Untitled note', kind: 'note' })
    expect(await services.listNotes(ctx, notebook.id, null as never)).toHaveLength(1)
    // A topic filter that isn't an id is an input error, not a SQLite binding error.
    for (const bad of [{}, [], 5, true]) {
      await expect(services.listNotes(ctx, notebook.id, bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      await expect(services.listCards(ctx, notebook.id, bad as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }
    ctx.setNow(new Date(NOW.getTime() + 60_000))
    expect(await services.updateNote(ctx, note.id, { body: 'Edited' })).toMatchObject({ body: 'Edited', updatedAt: new Date(NOW.getTime() + 60_000).toISOString() })

    await expect(services.createExam(ctx, { notebookId: notebook.id, name: 'X', examDate: '2026-02-30', topicIds: [] })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await expect(services.createExam(ctx, { notebookId: notebook.id, name: 'X', examDate: '10/12/2026', topicIds: [] })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    const exam = await services.createExam(ctx, { notebookId: notebook.id, name: 'Final', examDate: '2026-12-10', topicIds: [] })
    expect(await services.updateExam(ctx, exam.id, { examDate: '2026-12-11' })).toMatchObject({ examDate: '2026-12-11' })
    expect(await services.listExams(ctx)).toHaveLength(1)

    await expect(
      services.logFocusSession(ctx, { notebookId: null, kind: 'focus', startedAt: 'yesterday', endedAt: NOW.toISOString(), minutes: 25 })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const session = await services.logFocusSession(ctx, {
      notebookId: null,
      kind: 'break',
      startedAt: '2026-10-04T08:00:00+02:00',
      endedAt: '2026-10-04T08:05:00+02:00',
      minutes: 5
    })
    expect(session.startedAt).toBe('2026-10-04T06:00:00.000Z')
    await services.notify(ctx, 'Break over', 'Back to it')
    expect(ctx.desktop.notifications).toEqual([{ title: 'Break over', body: 'Back to it' }])
  })
})

describe('today and insights', () => {
  it('builds the overview and insights from stored activity', async () => {
    const { notebook, topics } = await notebookWithTopics(['Deadlocks', 'Paging'])
    const archived = await services.createNotebook(ctx, { name: 'Old', code: '', color: 'slate' })
    await services.updateNotebook(ctx, archived.id, { archived: true })
    await services.createCard(ctx, { notebookId: archived.id, topicId: null, front: 'old', back: 'old' })
    const card = await services.createCard(ctx, { notebookId: notebook.id, topicId: topics[0].id, front: 'F', back: 'B' })
    await services.createExam(ctx, { notebookId: notebook.id, name: 'Quiz 3', examDate: '2026-10-08', topicIds: [topics[0].id] })
    await services.createExam(ctx, { notebookId: notebook.id, name: 'Past', examDate: '2026-10-01', topicIds: [] })
    for (let i = 0; i < 4; i++) {
      await services.recordAnswer(ctx, {
        topicId: topics[0].id,
        source: 'check',
        question: { id: `q${i}`, type: 'tf', prompt: `P${i}`, options: ['True', 'False'], answer: 'True', acceptable: [], explanation: '', topicId: topics[0].id, difficulty: 'easy', sourceRef: '' },
        response: 'False',
        confidence: 'sure'
      })
    }
    await services.reviewCard(ctx, { cardId: card.id, rating: 3, confidence: 'sure', response: '' })
    await services.logFocusSession(ctx, { notebookId: notebook.id, kind: 'focus', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), minutes: 25 })

    const today = await services.getToday(ctx)
    expect(today.notebooks.map((n) => n.id)).toEqual([notebook.id])
    expect(today.exams).toHaveLength(1)
    expect(today.exams[0]).toMatchObject({ name: 'Quiz 3', notebookName: 'Operating Systems', notebookColor: 'teal', daysLeft: 4, notStartedCount: 0 })
    expect(today.plan.dueCount).toBe(0)
    expect(today).toMatchObject({ recallRate7d: 100, studyMinutesToday: 25, streakDays: 1 })

    const insights = await services.getInsights(ctx)
    expect(insights.weakTopics.map((w) => w.title)).toEqual(['Deadlocks'])
    expect(insights.weakTopics[0]).toMatchObject({ notebookCode: '', missedCount: 4, overconfidentCount: 4, why: 'on Quiz 3 in 4 days' })
    expect(insights.calibration[0]).toMatchObject({ confidence: 'sure', answered: 5, correct: 1 })
    expect(insights.overconfidentLast7Days).toBe(4)
    expect(insights.mistakes).toHaveLength(4)
    expect(insights.forecast).toHaveLength(7)
    expect(insights.studyMinutesByDay).toHaveLength(14)
    expect(insights.studyMinutesByDay.at(-1)).toEqual({ date: '2026-10-04', minutes: 25 })
    expect(insights.studyMinutesByDay[0].date).toBe('2026-09-21')
    expect(insights.studyMinutesBySubject).toEqual([{ notebookId: notebook.id, name: 'Operating Systems', color: 'teal', minutes: 25 }])
  })
})

describe('backup and desktop', () => {
  it('exports a consistent copy of the database or returns null when cancelled', async () => {
    await services.createNotebook(ctx, { name: 'Keep me', code: '', color: 'blue' })
    expect(await services.exportBackup(ctx)).toBeNull()
    ctx.desktop.savePath = join(ctx.tempDir, "it's a backup.db")
    expect(await services.exportBackup(ctx)).toEqual({ path: ctx.desktop.savePath })
    expect(await services.exportBackup(ctx)).toEqual({ path: ctx.desktop.savePath })
    const { DatabaseSync } = await import('node:sqlite')
    const copy = new DatabaseSync(ctx.desktop.savePath)
    expect(copy.prepare('SELECT name FROM notebooks').all()).toEqual([{ name: 'Keep me' }])
    copy.close()
  })

  it('passes desktop actions through', async () => {
    ctx.desktop.pickedFiles = ['/a.pdf']
    expect(await services.pickFiles(ctx)).toEqual(['/a.pdf'])
    expect(await services.testApiKey(ctx)).toEqual({ ok: true, message: 'Connected (fake).' })
  })
})
