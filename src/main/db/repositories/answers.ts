import type { DatabaseSync } from 'node:sqlite'
import type { AnswerRecord, AnswerSource, Confidence, ID, QuestionType } from '@shared/types'
import { bool, fromBool, prepare, str, strOrNull, type Row } from '../sql'

function toAnswer(row: Row): AnswerRecord {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    topicId: strOrNull(row, 'topic_id'),
    quizId: strOrNull(row, 'quiz_id'),
    cardId: strOrNull(row, 'card_id'),
    source: str(row, 'source') as AnswerSource,
    questionType: str(row, 'question_type') as QuestionType | 'recall',
    prompt: str(row, 'prompt'),
    userAnswer: str(row, 'user_answer'),
    correctAnswer: str(row, 'correct_answer'),
    correct: bool(row, 'correct'),
    confidence: strOrNull(row, 'confidence') as Confidence | null,
    answeredAt: str(row, 'answered_at')
  }
}

export function insertAnswer(db: DatabaseSync, answer: AnswerRecord): void {
  prepare(
    db,
    `INSERT INTO answers (id, notebook_id, topic_id, quiz_id, card_id, source, question_type, prompt, user_answer, correct_answer, correct, confidence, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    answer.id,
    answer.notebookId,
    answer.topicId,
    answer.quizId,
    answer.cardId,
    answer.source,
    answer.questionType,
    answer.prompt,
    answer.userAnswer,
    answer.correctAnswer,
    fromBool(answer.correct),
    answer.confidence,
    answer.answeredAt
  )
}

/** Answers tied to a topic, for mastery. Scoped to one notebook, or every notebook when `notebookId` is null. */
export function listTopicAnswers(db: DatabaseSync, notebookId: ID | null): AnswerRecord[] {
  const rows = notebookId
    ? prepare(db, 'SELECT * FROM answers WHERE notebook_id = ? AND topic_id IS NOT NULL ORDER BY answered_at ASC').all(notebookId)
    : prepare(db, 'SELECT * FROM answers WHERE topic_id IS NOT NULL ORDER BY answered_at ASC').all()
  return rows.map(toAnswer)
}

export function listAnswersForTopic(db: DatabaseSync, topicId: ID): AnswerRecord[] {
  return prepare(db, 'SELECT * FROM answers WHERE topic_id = ? ORDER BY answered_at ASC, rowid ASC').all(topicId).map(toAnswer)
}

export function listAnswersSince(db: DatabaseSync, sinceIso: string): AnswerRecord[] {
  return prepare(db, 'SELECT * FROM answers WHERE answered_at >= ? ORDER BY answered_at ASC').all(sinceIso).map(toAnswer)
}

/** Most recent wrong answers, newest first. */
export function listRecentMistakes(db: DatabaseSync, limit: number): AnswerRecord[] {
  return prepare(db, 'SELECT * FROM answers WHERE correct = 0 ORDER BY answered_at DESC, rowid DESC LIMIT ?').all(limit).map(toAnswer)
}

export function listAnswersForQuiz(db: DatabaseSync, quizId: ID): AnswerRecord[] {
  return prepare(db, 'SELECT * FROM answers WHERE quiz_id = ? ORDER BY rowid ASC').all(quizId).map(toAnswer)
}

export function answerTimestampsSince(db: DatabaseSync, sinceIso: string): string[] {
  return prepare(db, 'SELECT answered_at FROM answers WHERE answered_at >= ?')
    .all(sinceIso)
    .map((row) => str(row, 'answered_at'))
}
