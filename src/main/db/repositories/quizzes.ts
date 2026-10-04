import type { DatabaseSync } from 'node:sqlite'
import type { ID, Question, Quiz, QuizAnswer, QuizKind, QuizSettings } from '@shared/types'
import { json, num, numOrNull, prepare, str, strOrNull, toJson, type Row } from '../sql'

/** A stored quiz plus bookkeeping the domain type doesn't carry. */
export interface QuizRecord {
  quiz: Quiz
  /** Flashcards created from this quiz's mistakes when it was submitted. */
  cardsCreated: number
}

const DEFAULT_SETTINGS: QuizSettings = {
  types: ['mc'],
  count: 0,
  difficulty: 'mixed',
  focusWeak: false,
  interleave: false,
  timeLimitMin: null
}

function toQuizRecord(row: Row): QuizRecord {
  return {
    quiz: {
      id: str(row, 'id'),
      notebookId: str(row, 'notebook_id'),
      topicId: strOrNull(row, 'topic_id'),
      kind: str(row, 'kind') as QuizKind,
      title: str(row, 'title'),
      settings: json<QuizSettings>(row, 'settings', DEFAULT_SETTINGS),
      questions: json<Question[]>(row, 'questions', []),
      createdAt: str(row, 'created_at'),
      startedAt: strOrNull(row, 'started_at'),
      submittedAt: strOrNull(row, 'submitted_at'),
      answers: json<QuizAnswer[]>(row, 'answers', []),
      score: numOrNull(row, 'score')
    },
    cardsCreated: num(row, 'cards_created')
  }
}

export function insertQuiz(db: DatabaseSync, quiz: Quiz): void {
  prepare(
    db,
    `INSERT INTO quizzes (id, notebook_id, topic_id, kind, title, settings, questions, answers, score, created_at, started_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    quiz.id,
    quiz.notebookId,
    quiz.topicId,
    quiz.kind,
    quiz.title,
    toJson(quiz.settings),
    toJson(quiz.questions),
    toJson(quiz.answers),
    quiz.score,
    quiz.createdAt,
    quiz.startedAt,
    quiz.submittedAt
  )
}

export function updateQuizProgress(db: DatabaseSync, quiz: Quiz, cardsCreated?: number): void {
  prepare(
    db,
    `UPDATE quizzes SET answers = ?, score = ?, started_at = ?, submitted_at = ?,
       cards_created = COALESCE(?, cards_created) WHERE id = ?`
  ).run(toJson(quiz.answers), quiz.score, quiz.startedAt, quiz.submittedAt, cardsCreated ?? null, quiz.id)
}

export function findQuizRecord(db: DatabaseSync, id: ID): QuizRecord | null {
  const row = prepare(db, 'SELECT * FROM quizzes WHERE id = ?').get(id)
  return row ? toQuizRecord(row) : null
}

/** Newest first. */
export function listQuizRows(db: DatabaseSync, notebookId: ID, kind?: QuizKind): Quiz[] {
  const rows = kind
    ? prepare(db, 'SELECT * FROM quizzes WHERE notebook_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC').all(notebookId, kind)
    : prepare(db, 'SELECT * FROM quizzes WHERE notebook_id = ? ORDER BY created_at DESC, rowid DESC').all(notebookId)
  return rows.map((row) => toQuizRecord(row).quiz)
}

/** Question prompts of the notebook's most recent quizzes, so new quizzes can avoid repeating them. */
export function recentQuizPrompts(db: DatabaseSync, notebookId: ID, quizLimit: number): string[] {
  const rows = prepare(db, 'SELECT questions FROM quizzes WHERE notebook_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(
    notebookId,
    quizLimit
  )
  return rows.flatMap((row) => json<Question[]>(row, 'questions', []).map((q) => q.prompt))
}

export function deleteQuizRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM quizzes WHERE id = ?').run(id).changes) > 0
}
