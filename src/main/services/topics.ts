// Topics: the units of learning inside a notebook, in course order.

import type { SyllabusResult } from '@shared/api'
import { AppError } from '@shared/errors'
import { localDate } from '@shared/learning'
import { PATH_STEPS, type Exam, type ID, type PathStep, type Topic, type TopicWithProgress } from '@shared/types'
import type { AppContext } from '../context'
import { listExamRows, insertExam, updateExamRow } from '../db/repositories/exams'
import { findNotebook, updateNotebookRow } from '../db/repositories/notebooks'
import { findSource, getSourceTextRow, listSourceRows } from '../db/repositories/sources'
import {
  deleteTopicRow,
  insertTopic,
  listTopicRows,
  nextTopicOrderIndex,
  setTopicOrderIndex,
  updateTopicRow
} from '../db/repositories/topics'
import { transaction } from '../db/sql'
import { invalid, isLocalDate, newId, notFound, nowIso, optionalText, requireIdList, requireNotebook, requireText, requireTopic, runAiJob } from './common'
import { loadNotebookTopics } from './progress'
import { selectWholeFile } from './topicSources'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 2_000
const UNIT_MAX = 60

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Source ids must belong to the topic's notebook; unknown ids are an input error, not silently dropped. */
function requireNotebookSourceIds(ctx: AppContext, notebookId: ID, value: unknown): ID[] {
  const ids = requireIdList(value, 'Sources')
  if (ids.length === 0) return ids
  const known = new Set(listSourceRows(ctx.db, notebookId).map((s) => s.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw invalid('Some of the chosen files are not in this notebook.')
  return ids
}

export async function listTopics(ctx: AppContext, notebookId: ID): Promise<TopicWithProgress[]> {
  requireNotebook(ctx, notebookId)
  return loadNotebookTopics(ctx, notebookId)
}

export async function getTopic(ctx: AppContext, id: ID): Promise<TopicWithProgress> {
  const topic = requireTopic(ctx, id)
  const withProgress = loadNotebookTopics(ctx, topic.notebookId).find((t) => t.id === id)
  if (!withProgress) throw notFound('Topic')
  return withProgress
}

export async function createTopic(
  ctx: AppContext,
  notebookId: ID,
  input: { title: string; description?: string; unitLabel?: string; sourceIds?: ID[] }
): Promise<Topic> {
  requireNotebook(ctx, notebookId)
  if (typeof input !== 'object' || input === null) throw invalid('Topic details are required.')
  const title = requireText(input.title, 'Topic title', TITLE_MAX)
  const description = optionalText(input.description, 'Description', DESCRIPTION_MAX)
  const unitLabel = optionalText(input.unitLabel, 'Unit label', UNIT_MAX)
  const sourceIds = requireNotebookSourceIds(ctx, notebookId, input.sourceIds)
  return transaction(ctx.db, () => {
    const topic: Topic = {
      id: newId(),
      notebookId,
      title,
      description,
      unitLabel,
      orderIndex: nextTopicOrderIndex(ctx.db, notebookId),
      sourceIds,
      pathStep: null,
      chunkIndex: 0,
      startedAt: null,
      completedAt: null,
      createdAt: nowIso(ctx)
    }
    insertTopic(ctx.db, topic)
    return topic
  })
}

export async function updateTopic(
  ctx: AppContext,
  id: ID,
  patch: Partial<Pick<Topic, 'title' | 'description' | 'unitLabel' | 'sourceIds'>>
): Promise<Topic> {
  const topic = requireTopic(ctx, id)
  if (typeof patch !== 'object' || patch === null) throw invalid('Nothing to update.')
  const updated: Topic = {
    ...topic,
    title: patch.title !== undefined ? requireText(patch.title, 'Topic title', TITLE_MAX) : topic.title,
    description: patch.description !== undefined ? optionalText(patch.description, 'Description', DESCRIPTION_MAX) : topic.description,
    unitLabel: patch.unitLabel !== undefined ? optionalText(patch.unitLabel, 'Unit label', UNIT_MAX) : topic.unitLabel,
    sourceIds: patch.sourceIds !== undefined ? requireNotebookSourceIds(ctx, topic.notebookId, patch.sourceIds) : topic.sourceIds
  }
  updateTopicRow(ctx.db, updated)
  return updated
}

export async function deleteTopic(ctx: AppContext, id: ID): Promise<void> {
  const topic = requireTopic(ctx, id)
  transaction(ctx.db, () => {
    // Exams list covered topics as JSON, which no foreign key can clean up.
    for (const exam of listExamRows(ctx.db, topic.notebookId)) {
      if (exam.topicIds.includes(id)) updateExamRow(ctx.db, { ...exam, topicIds: exam.topicIds.filter((t) => t !== id) })
    }
    deleteTopicRow(ctx.db, id)
  })
}

/**
 * Puts `orderedIds` first, in that order; topics not listed keep their
 * relative order after them, so a stale list from the renderer can't lose topics.
 */
export async function reorderTopics(ctx: AppContext, notebookId: ID, orderedIds: ID[]): Promise<void> {
  requireNotebook(ctx, notebookId)
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) throw invalid('Topic order must be a list of ids.')
  if (new Set(orderedIds).size !== orderedIds.length) throw invalid('Topic order lists a topic twice.')
  const topics = listTopicRows(ctx.db, notebookId)
  const known = new Set(topics.map((t) => t.id))
  if (orderedIds.some((id) => !known.has(id))) throw invalid('Topic order includes topics from another notebook.')
  const listed = new Set(orderedIds)
  const finalOrder = [...orderedIds, ...topics.filter((t) => !listed.has(t.id)).map((t) => t.id)]
  transaction(ctx.db, () => {
    finalOrder.forEach((id, index) => setTopicOrderIndex(ctx.db, id, index))
  })
}

export async function setTopicStep(ctx: AppContext, topicId: ID, step: PathStep, chunkIndex?: number): Promise<Topic> {
  const topic = requireTopic(ctx, topicId)
  if (!(PATH_STEPS as readonly string[]).includes(step)) throw invalid(`Step must be one of: ${PATH_STEPS.join(', ')}.`)
  if (chunkIndex !== undefined && (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100)) {
    throw invalid('Lesson part must be a whole number from 0.')
  }
  const updated: Topic = {
    ...topic,
    // A finished topic stays finished while the learner revisits its steps;
    // only finishTopic marks 'done', and only a new path start would undo it.
    pathStep: topic.pathStep === 'done' ? 'done' : step,
    chunkIndex: chunkIndex ?? topic.chunkIndex,
    startedAt: topic.startedAt ?? nowIso(ctx)
  }
  updateTopicRow(ctx.db, updated)
  return updated
}

export async function extractTopicsFromSyllabus(ctx: AppContext, notebookId: ID, sourceId: ID): Promise<SyllabusResult> {
  const notebook = requireNotebook(ctx, notebookId)
  const source = typeof sourceId === 'string' ? findSource(ctx.db, sourceId) : null
  if (!source || source.notebookId !== notebookId) throw notFound('Syllabus file')
  const text = getSourceTextRow(ctx.db, sourceId) ?? ''
  if (source.status !== 'ready' || !text.trim()) throw new AppError('EXTRACT_FAILED', `${source.fileName} has no readable text.`)

  const before = listTopicRows(ctx.db, notebookId)
  // With an empty query the cut keeps the opening pages, where syllabi list their schedule.
  const selection = selectWholeFile(ctx, { id: source.id, fileName: source.fileName, kind: source.kind, text })
  const extraction = await runAiJob(ctx, { task: 'syllabus', subjectId: notebookId }, `Reading ${source.fileName}`, (options) =>
    ctx.ai.extractSyllabus(
      {
        notebookName: notebook.name,
        syllabus: selection.docs[0],
        existingTopicTitles: before.map((t) => t.title),
        todayDate: localDate(ctx.now())
      },
      options
    )
  )

  const now = nowIso(ctx)
  return transaction(ctx.db, () => {
    // Re-read inside the transaction: the notebook and its topics may have changed during the AI call.
    const fresh = findNotebook(ctx.db, notebookId)
    if (!fresh) throw notFound('Notebook')
    const current = listTopicRows(ctx.db, notebookId)
    const byTitle = new Map(current.map((t) => [titleKey(t.title), t]))
    const result: SyllabusResult = { topicsAdded: [], examsAdded: [], topicsSkipped: [] }
    let orderIndex = nextTopicOrderIndex(ctx.db, notebookId)

    for (const extracted of extraction.topics) {
      const title = extracted.title.trim().slice(0, TITLE_MAX)
      if (!title) continue
      const key = titleKey(title)
      if (byTitle.has(key)) {
        result.topicsSkipped.push(title)
        continue
      }
      const topic: Topic = {
        id: newId(),
        notebookId,
        title,
        description: extracted.description.trim().slice(0, DESCRIPTION_MAX),
        unitLabel: extracted.unitLabel.trim().slice(0, UNIT_MAX),
        orderIndex: orderIndex++,
        // Left empty on purpose: the backend ranks all notebook sources by relevance per call.
        sourceIds: [],
        pathStep: null,
        chunkIndex: 0,
        startedAt: null,
        completedAt: null,
        createdAt: now
      }
      insertTopic(ctx.db, topic)
      byTitle.set(key, topic)
      result.topicsAdded.push(topic)
    }

    const existingExams = new Set(listExamRows(ctx.db, notebookId).map((e) => `${titleKey(e.name)}|${e.examDate}`))
    for (const extracted of extraction.exams) {
      const name = extracted.name.trim().slice(0, TITLE_MAX)
      if (!name || !isLocalDate(extracted.examDate)) continue
      const examKey = `${titleKey(name)}|${extracted.examDate}`
      // Running the extraction twice must not duplicate exams.
      if (existingExams.has(examKey)) continue
      const topicIds = [
        ...new Set(
          extracted.coversTopicTitles.map((t) => byTitle.get(titleKey(t))?.id).filter((id): id is ID => typeof id === 'string')
        )
      ]
      const exam: Exam = { id: newId(), notebookId, name, examDate: extracted.examDate, topicIds, createdAt: now }
      insertExam(ctx.db, exam)
      existingExams.add(examKey)
      result.examsAdded.push(exam)
    }

    const courseCode = extraction.courseCode.trim().slice(0, 40)
    if (!fresh.code.trim() && courseCode) updateNotebookRow(ctx.db, { ...fresh, code: courseCode })
    return result
  })
}
