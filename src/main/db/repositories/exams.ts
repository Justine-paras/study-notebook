import type { DatabaseSync } from 'node:sqlite'
import type { Exam, ID } from '@shared/types'
import { json, prepare, str, toJson, type Row } from '../sql'

function toExam(row: Row): Exam {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    name: str(row, 'name'),
    examDate: str(row, 'exam_date'),
    topicIds: json<ID[]>(row, 'topic_ids', []),
    createdAt: str(row, 'created_at')
  }
}

export function insertExam(db: DatabaseSync, exam: Exam): void {
  prepare(db, 'INSERT INTO exams (id, notebook_id, name, exam_date, topic_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    exam.id,
    exam.notebookId,
    exam.name,
    exam.examDate,
    toJson(exam.topicIds),
    exam.createdAt
  )
}

export function updateExamRow(db: DatabaseSync, exam: Exam): void {
  prepare(db, 'UPDATE exams SET name = ?, exam_date = ?, topic_ids = ? WHERE id = ?').run(exam.name, exam.examDate, toJson(exam.topicIds), exam.id)
}

export function findExam(db: DatabaseSync, id: ID): Exam | null {
  const row = prepare(db, 'SELECT * FROM exams WHERE id = ?').get(id)
  return row ? toExam(row) : null
}

/** Soonest first. One notebook, or every notebook when `notebookId` is omitted. */
export function listExamRows(db: DatabaseSync, notebookId?: ID): Exam[] {
  const rows = notebookId
    ? prepare(db, 'SELECT * FROM exams WHERE notebook_id = ? ORDER BY exam_date ASC, name ASC').all(notebookId)
    : prepare(db, 'SELECT * FROM exams ORDER BY exam_date ASC, name ASC').all()
  return rows.map(toExam)
}

/** Exams on or after `fromDate` (YYYY-MM-DD), soonest first. */
export function listUpcomingExamRows(db: DatabaseSync, fromDate: string): Exam[] {
  return prepare(db, 'SELECT * FROM exams WHERE exam_date >= ? ORDER BY exam_date ASC, name ASC').all(fromDate).map(toExam)
}

export function deleteExamRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM exams WHERE id = ?').run(id).changes) > 0
}
