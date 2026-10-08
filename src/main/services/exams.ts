// Exams: dates and the topics they cover (drive readiness and the Today plan).

import type { Exam, ID } from '@shared/types'
import type { AppContext } from '../context'
import { deleteExamRow, findExam, insertExam, listExamRows, updateExamRow } from '../db/repositories/exams'
import { listTopicRows } from '../db/repositories/topics'
import { invalid, newId, notFound, nowIso, requireIdList, requireLocalDate, requireNotebook, requireText } from './common'

function requireExam(ctx: AppContext, id: ID): Exam {
  const exam = typeof id === 'string' ? findExam(ctx.db, id) : null
  if (!exam) throw notFound('Exam')
  return exam
}

function requireNotebookTopicIds(ctx: AppContext, notebookId: ID, value: unknown): ID[] {
  const ids = requireIdList(value, 'Topics')
  if (ids.length === 0) return ids
  const known = new Set(listTopicRows(ctx.db, notebookId).map((t) => t.id))
  if (ids.some((id) => !known.has(id))) throw invalid('Some of the chosen topics are not in this notebook.')
  return ids
}

export async function listExams(ctx: AppContext, notebookId?: ID): Promise<Exam[]> {
  if (notebookId !== undefined && notebookId !== null) {
    requireNotebook(ctx, notebookId)
    return listExamRows(ctx.db, notebookId)
  }
  return listExamRows(ctx.db)
}

export async function createExam(ctx: AppContext, input: { notebookId: ID; name: string; examDate: string; topicIds: ID[] }): Promise<Exam> {
  if (typeof input !== 'object' || input === null) throw invalid('Exam details are required.')
  requireNotebook(ctx, input.notebookId)
  const exam: Exam = {
    id: newId(),
    notebookId: input.notebookId,
    name: requireText(input.name, 'Exam name', 200),
    examDate: requireLocalDate(input.examDate, 'Exam date'),
    topicIds: requireNotebookTopicIds(ctx, input.notebookId, input.topicIds),
    createdAt: nowIso(ctx)
  }
  insertExam(ctx.db, exam)
  return exam
}

export async function updateExam(ctx: AppContext, id: ID, patch: Partial<Pick<Exam, 'name' | 'examDate' | 'topicIds'>>): Promise<Exam> {
  const exam = requireExam(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  const updated: Exam = {
    ...exam,
    name: patch.name !== undefined ? requireText(patch.name, 'Exam name', 200) : exam.name,
    examDate: patch.examDate !== undefined ? requireLocalDate(patch.examDate, 'Exam date') : exam.examDate,
    topicIds: patch.topicIds !== undefined ? requireNotebookTopicIds(ctx, exam.notebookId, patch.topicIds) : exam.topicIds
  }
  updateExamRow(ctx.db, updated)
  return updated
}

export async function deleteExam(ctx: AppContext, id: ID): Promise<void> {
  requireExam(ctx, id)
  deleteExamRow(ctx.db, id)
}
