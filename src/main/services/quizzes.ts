// Quizzes and mock exams: generation, autosave, grading and results.

import type { CreateQuizInput } from '@shared/api'
import { gradeResponse, localDate, newCardSchedule } from '@shared/learning'
import {
  QUESTION_TYPES,
  type AnswerRecord,
  type Confidence,
  type Difficulty,
  type Exam,
  type ID,
  type Question,
  type QuestionType,
  type Quiz,
  type QuizAnswer,
  type QuizKind,
  type QuizResult,
  type QuizSettings,
  type TopicWithProgress
} from '@shared/types'
import type { GenerateQuestionsInput } from '../ai'
import type { AppContext } from '../context'
import { insertAnswer, listTopicAnswers } from '../db/repositories/answers'
import { listUpcomingExamRows } from '../db/repositories/exams'
import { deleteQuizRow, findQuizRecord, insertQuiz, listQuizRows, recentQuizPrompts, updateQuizProgress, type QuizRecord } from '../db/repositories/quizzes'
import { listTopicRows } from '../db/repositories/topics'
import { transaction } from '../db/sql'
import { insertDedupedCards, type NewCardInput } from './cards'
import { DAY_MS, invalid, newId, notFound, nowIso, optionalText, requireConfidence, requireIdList, requireNotebook, runAiJob, topicBrief } from './common'
import { hasProgressData as hasData, isWeakTopic, loadNotebookTopics } from './progress'
import { selectQuizSources } from './topicSources'

const QUIZ_KINDS: readonly QuizKind[] = ['practice', 'weak_spots', 'mock_exam']
const DIFFICULTIES: readonly (Difficulty | 'mixed')[] = ['easy', 'medium', 'hard', 'mixed']
const MAX_INTERLEAVED = 3
const MAX_WEAK_TOPICS = 4
const MAX_UNSCOPED_PRACTICE = 6
const RECENT_MISTAKES_PER_TOPIC = 3
const AVOID_PROMPTS_FROM_QUIZZES = 5
const RESPONSE_MAX = 5_000

function requireKind(value: unknown): QuizKind {
  if (typeof value !== 'string' || !(QUIZ_KINDS as readonly string[]).includes(value)) {
    throw invalid('Quiz kind must be practice, weak_spots or mock_exam.')
  }
  return value as QuizKind
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw invalid(`${field} must be true or false.`)
  return value
}

/** Validates quiz settings: 1-60 questions, at least one known type, a known difficulty, a sane time limit. */
export function validateQuizSettings(value: unknown): QuizSettings {
  if (typeof value !== 'object' || value === null) throw invalid('Quiz settings are required.')
  const s = value as Partial<QuizSettings>
  if (!Array.isArray(s.types)) throw invalid('Pick at least one question type.')
  const types = [...new Set(s.types)]
  if (types.length === 0) throw invalid('Pick at least one question type.')
  if (types.some((t) => !(QUESTION_TYPES as readonly string[]).includes(t))) throw invalid('Unknown question type.')
  if (typeof s.count !== 'number' || !Number.isInteger(s.count) || s.count < 1 || s.count > 60) {
    throw invalid('Number of questions must be from 1 to 60.')
  }
  if (typeof s.difficulty !== 'string' || !DIFFICULTIES.includes(s.difficulty)) throw invalid('Difficulty must be easy, medium, hard or mixed.')
  let timeLimitMin: number | null = null
  if (s.timeLimitMin !== null && s.timeLimitMin !== undefined) {
    if (typeof s.timeLimitMin !== 'number' || !Number.isInteger(s.timeLimitMin) || s.timeLimitMin < 1 || s.timeLimitMin > 300) {
      throw invalid('Time limit must be from 1 to 300 minutes.')
    }
    timeLimitMin = s.timeLimitMin
  }
  return {
    types: types as QuestionType[],
    count: s.count,
    difficulty: s.difficulty,
    focusWeak: optionalBoolean(s.focusWeak, 'Focus on weak spots'),
    interleave: optionalBoolean(s.interleave, 'Mix in earlier topics'),
    timeLimitMin
  }
}

function isStarted(topic: TopicWithProgress): boolean {
  return topic.pathStep !== null || topic.progress.state !== 'not_started'
}

function byMastery(a: TopicWithProgress, b: TopicWithProgress): number {
  return a.progress.mastery - b.progress.mastery || a.orderIndex - b.orderIndex
}

export interface QuizTopicChoice {
  topics: TopicWithProgress[]
  /** The exam a mock exam is for, when one applies. */
  exam: Exam | null
}

/**
 * Which topics a quiz covers (see CreateQuizInput):
 * - practice: the primary topic plus, with interleaving, up to 3 of the
 *   closest earlier topics already started; or the given topicIds.
 * - weak_spots: the given topicIds, else up to 4 weak topics (weakest first),
 *   else the weakest started topics.
 * - mock_exam: the given topicIds, else the next exam's topics (all topics
 *   when the exam lists none), else every started topic, else every topic.
 */
export function chooseQuizTopics(
  kind: QuizKind,
  topics: TopicWithProgress[],
  input: { topicId: ID | null; topicIds: ID[]; interleave: boolean },
  upcomingExams: Exam[]
): QuizTopicChoice {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const given = input.topicIds.map((id) => byId.get(id)).filter((t): t is TopicWithProgress => t !== undefined)
  const primary = input.topicId ? (byId.get(input.topicId) ?? null) : null
  const started = topics.filter(isStarted)

  if (kind === 'practice') {
    if (given.length > 0) return { topics: primary && !given.includes(primary) ? [primary, ...given] : given, exam: null }
    if (primary) {
      const earlier = input.interleave
        ? started.filter((t) => t.orderIndex < primary.orderIndex && t.id !== primary.id).slice(-MAX_INTERLEAVED)
        : []
      return { topics: [primary, ...earlier.reverse()], exam: null }
    }
    return { topics: (started.length > 0 ? started : topics).slice(-MAX_UNSCOPED_PRACTICE), exam: null }
  }

  if (kind === 'weak_spots') {
    if (given.length > 0) return { topics: given, exam: null }
    const weak = topics.filter((t) => t.progress.state === 'weak').sort(byMastery)
    const fallback = weak.length > 0 ? weak : started.filter(hasData).sort(byMastery)
    const chosen = fallback.length > 0 ? fallback : [...started].sort(byMastery)
    return { topics: chosen.slice(0, MAX_WEAK_TOPICS), exam: null }
  }

  // mock_exam
  if (given.length > 0) {
    const wanted = new Set(given.map((t) => t.id))
    const exam =
      upcomingExams.find((e) => e.topicIds.length === wanted.size && e.topicIds.every((id) => wanted.has(id))) ?? null
    return { topics: given, exam }
  }
  const nextExam = upcomingExams[0] ?? null
  if (nextExam) {
    const covered = nextExam.topicIds.map((id) => byId.get(id)).filter((t): t is TopicWithProgress => t !== undefined)
    return { topics: covered.length > 0 ? covered : topics, exam: nextExam }
  }
  return { topics: started.length > 0 ? started : topics, exam: null }
}

function quizTitle(kind: QuizKind, choice: QuizTopicChoice, primary: TopicWithProgress | null, notebookName: string): string {
  if (kind === 'weak_spots') return 'Weak spots'
  if (kind === 'mock_exam') return `Mock exam: ${choice.exam?.name ?? notebookName}`
  const focus = primary ?? (choice.topics.length === 1 ? choice.topics[0] : null)
  return `Practice: ${focus?.title ?? notebookName}`
}

/** Up to 3 distinct recent wrong prompts per topic, newest first. */
function recentMistakesByTopic(answers: AnswerRecord[]): Map<ID, string[]> {
  const result = new Map<ID, string[]>()
  for (let i = answers.length - 1; i >= 0; i--) {
    const answer = answers[i]
    if (answer.correct || !answer.topicId) continue
    const list = result.get(answer.topicId) ?? []
    if (list.length < RECENT_MISTAKES_PER_TOPIC && !list.includes(answer.prompt)) list.push(answer.prompt)
    result.set(answer.topicId, list)
  }
  return result
}

export async function createQuiz(ctx: AppContext, input: CreateQuizInput): Promise<Quiz> {
  if (typeof input !== 'object' || input === null) throw invalid('Quiz details are required.')
  const notebook = requireNotebook(ctx, input.notebookId)
  const kind = requireKind(input.kind)
  const settings = validateQuizSettings(input.settings)
  const topicIds = requireIdList(input.topicIds, 'Topics')
  const title = optionalText(input.title, 'Title', 200)

  const topics = loadNotebookTopics(ctx, notebook.id)
  const known = new Set(topics.map((t) => t.id))
  if (input.topicId !== null && input.topicId !== undefined && !known.has(input.topicId)) throw notFound('Topic')
  if (topicIds.some((id) => !known.has(id))) throw invalid('Some of the chosen topics are not in this notebook.')
  if (topics.length === 0) throw invalid('Add topics to this notebook before making a quiz.')

  const topicId = input.topicId ?? null
  const upcoming = listUpcomingExamRows(ctx.db, localDate(ctx.now())).filter((e) => e.notebookId === notebook.id)
  const choice = chooseQuizTopics(kind, topics, { topicId, topicIds, interleave: settings.interleave }, upcoming)
  if (choice.topics.length === 0) throw invalid('There are no topics to quiz yet. Start a topic first.')
  const primary = topicId ? (topics.find((t) => t.id === topicId) ?? null) : null

  const mistakes = settings.focusWeak ? recentMistakesByTopic(listTopicAnswers(ctx.db, notebook.id)) : new Map<ID, string[]>()
  const weakFocus = settings.focusWeak
    ? choice.topics.filter(isWeakTopic).map((t) => ({ topicId: t.id, title: t.title, recentMistakes: mistakes.get(t.id) ?? [] }))
    : []

  const selection = selectQuizSources(ctx, notebook.id, choice.topics, kind !== 'practice')
  const request: GenerateQuestionsInput = {
    notebookName: notebook.name,
    topics: choice.topics.map(topicBrief),
    primaryTopicId: kind === 'practice' ? (primary?.id ?? null) : null,
    sources: selection.docs,
    types: settings.types,
    count: settings.count,
    difficulty: settings.difficulty,
    mode: kind,
    weakFocus,
    avoidPrompts: recentQuizPrompts(ctx.db, notebook.id, AVOID_PROMPTS_FROM_QUIZZES)
  }
  const generated = await runAiJob(ctx, 'quiz', kind === 'mock_exam' ? 'Writing your mock exam' : 'Writing your questions', (options) =>
    ctx.ai.generateQuestions(request, options)
  )

  const chosenIds = new Set(choice.topics.map((t) => t.id))
  const fallbackTopicId = primary?.id ?? (choice.topics.length === 1 ? choice.topics[0].id : null)
  const questions: Question[] = generated.map((q) => ({
    ...q,
    id: q.id || newId(),
    topicId: q.topicId && chosenIds.has(q.topicId) ? q.topicId : fallbackTopicId
  }))

  const quiz: Quiz = {
    id: newId(),
    notebookId: notebook.id,
    topicId,
    kind,
    title: title || quizTitle(kind, choice, primary, notebook.name),
    settings,
    questions,
    createdAt: nowIso(ctx),
    startedAt: null,
    submittedAt: null,
    answers: [],
    score: null
  }
  transaction(ctx.db, () => {
    // The notebook or topic may have been deleted during the AI call.
    requireNotebook(ctx, notebook.id)
    const stillKnown = new Set(listTopicRows(ctx.db, notebook.id).map((t) => t.id))
    if (quiz.topicId && !stillKnown.has(quiz.topicId)) quiz.topicId = null
    for (const q of quiz.questions) if (q.topicId && !stillKnown.has(q.topicId)) q.topicId = null
    insertQuiz(ctx.db, quiz)
  })
  return quiz
}

function requireQuizRecord(ctx: AppContext, id: ID): QuizRecord {
  const record = typeof id === 'string' ? findQuizRecord(ctx.db, id) : null
  if (!record) throw notFound('Quiz')
  return record
}

export async function getQuiz(ctx: AppContext, id: ID): Promise<Quiz> {
  return requireQuizRecord(ctx, id).quiz
}

export async function listQuizzes(ctx: AppContext, notebookId: ID, kind?: QuizKind): Promise<Quiz[]> {
  requireNotebook(ctx, notebookId)
  return listQuizRows(ctx.db, notebookId, kind === undefined || kind === null ? undefined : requireKind(kind))
}

export async function startQuiz(ctx: AppContext, id: ID): Promise<Quiz> {
  const { quiz } = requireQuizRecord(ctx, id)
  if (quiz.startedAt) return quiz
  const started: Quiz = { ...quiz, startedAt: nowIso(ctx) }
  updateQuizProgress(ctx.db, started)
  return started
}

export async function saveQuizAnswer(
  ctx: AppContext,
  id: ID,
  answer: { questionId: ID; response: string; confidence: Confidence | null }
): Promise<Quiz> {
  const { quiz } = requireQuizRecord(ctx, id)
  if (quiz.submittedAt) throw invalid('This quiz was already submitted.')
  if (typeof answer !== 'object' || answer === null) throw invalid('The answer is missing.')
  if (!quiz.questions.some((q) => q.id === answer.questionId)) throw notFound('Question')
  const response = typeof answer.response === 'string' ? answer.response.slice(0, RESPONSE_MAX) : ''
  const saved: QuizAnswer = { questionId: answer.questionId, response, confidence: requireConfidence(answer.confidence), correct: false }
  const answers = quiz.answers.some((a) => a.questionId === saved.questionId)
    ? quiz.answers.map((a) => (a.questionId === saved.questionId ? saved : a))
    : [...quiz.answers, saved]
  const updated: Quiz = { ...quiz, answers, startedAt: quiz.startedAt ?? nowIso(ctx) }
  updateQuizProgress(ctx.db, updated)
  return updated
}

/** Mistake card text: the prompt (with the options for multiple choice) and the answer with its explanation. */
export function mistakeCard(question: Question): NewCardInput {
  const options = question.type === 'mc' && question.options.length > 0 ? `\n\n${question.options.map((o) => `- ${o}`).join('\n')}` : ''
  const explanation = question.explanation.trim()
  return {
    front: question.prompt + options,
    back: explanation ? `${question.answer}\n\n${explanation}` : question.answer,
    sourceRef: question.sourceRef
  }
}

function buildResult(ctx: AppContext, record: QuizRecord): QuizResult {
  const { quiz } = record
  const titles = new Map(listTopicRows(ctx.db, quiz.notebookId).map((t) => [t.id, t.title]))
  const answers = new Map(quiz.answers.map((a) => [a.questionId, a]))
  const byTopic = new Map<string, QuizResult['byTopic'][number]>()
  let correct = 0
  const overconfident: ID[] = []
  for (const question of quiz.questions) {
    const answer = answers.get(question.id)
    const isCorrect = answer?.correct ?? false
    if (isCorrect) correct++
    if (!isCorrect && answer?.confidence === 'sure') overconfident.push(question.id)
    const topicId = question.topicId && titles.has(question.topicId) ? question.topicId : null
    const key = topicId ?? ''
    const entry = byTopic.get(key) ?? { topicId, topicTitle: topicId ? (titles.get(topicId) as string) : 'Other', correct: 0, total: 0 }
    entry.total++
    if (isCorrect) entry.correct++
    byTopic.set(key, entry)
  }
  return { quiz, correct, total: quiz.questions.length, byTopic: [...byTopic.values()], overconfident, cardsCreated: record.cardsCreated }
}

export async function submitQuiz(ctx: AppContext, id: ID): Promise<QuizResult> {
  const record = requireQuizRecord(ctx, id)
  // Submitting twice (double click, auto-submit racing the button) returns the first result.
  if (record.quiz.submittedAt) return buildResult(ctx, record)
  const { quiz } = record
  const now = ctx.now()
  const submittedAt = now.toISOString()
  const knownTopics = new Set(listTopicRows(ctx.db, quiz.notebookId).map((t) => t.id))
  const saved = new Map(quiz.answers.map((a) => [a.questionId, a]))

  const graded: QuizAnswer[] = quiz.questions.map((q) => {
    const answer = saved.get(q.id)
    const response = answer?.response ?? ''
    return { questionId: q.id, response, confidence: answer?.confidence ?? null, correct: gradeResponse(q, response) }
  })
  const score = graded.filter((a) => a.correct).length

  const cardsCreated = transaction(ctx.db, () => {
    const mistakesByTopic = new Map<ID | null, { input: NewCardInput; overconfident: boolean }[]>()
    quiz.questions.forEach((question, index) => {
      const answer = graded[index]
      const topicId = question.topicId && knownTopics.has(question.topicId) ? question.topicId : null
      insertAnswer(ctx.db, {
        id: newId(),
        notebookId: quiz.notebookId,
        topicId,
        quizId: quiz.id,
        cardId: null,
        source: quiz.kind,
        questionType: question.type,
        prompt: question.prompt,
        userAnswer: answer.response,
        correctAnswer: question.answer,
        correct: answer.correct,
        confidence: answer.confidence,
        answeredAt: submittedAt
      })
      if (!answer.correct) {
        const list = mistakesByTopic.get(topicId) ?? []
        list.push({ input: mistakeCard(question), overconfident: answer.confidence === 'sure' })
        mistakesByTopic.set(topicId, list)
      }
    })

    let created = 0
    for (const [topicId, mistakes] of mistakesByTopic) {
      const overconfidentFronts = new Set(mistakes.filter((m) => m.overconfident).map((m) => m.input.front))
      const cards = insertDedupedCards(
        ctx,
        { notebookId: quiz.notebookId, topicId, origin: 'mistake' },
        mistakes.map((m) => m.input),
        (input) => {
          const schedule = newCardSchedule(now)
          // "Sure but wrong" cards come back first: due a day earlier sorts them ahead in the most-overdue-first queue.
          return overconfidentFronts.has(input.front) ? { ...schedule, due: new Date(now.getTime() - DAY_MS).toISOString() } : schedule
        }
      )
      created += cards.length
    }

    updateQuizProgress(ctx.db, { ...quiz, answers: graded, score, submittedAt, startedAt: quiz.startedAt ?? submittedAt }, created)
    return created
  })

  return buildResult(ctx, {
    quiz: { ...quiz, answers: graded, score, submittedAt, startedAt: quiz.startedAt ?? submittedAt },
    cardsCreated
  })
}

export async function getQuizResult(ctx: AppContext, id: ID): Promise<QuizResult> {
  const record = requireQuizRecord(ctx, id)
  if (!record.quiz.submittedAt) throw invalid('Submit the quiz to see its results.')
  return buildResult(ctx, record)
}

export async function deleteQuiz(ctx: AppContext, id: ID): Promise<void> {
  requireQuizRecord(ctx, id)
  // Answer records keep counting towards mastery; only their quiz link is cleared (ON DELETE SET NULL).
  deleteQuizRow(ctx.db, id)
}
