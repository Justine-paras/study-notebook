import type { DatabaseSync } from 'node:sqlite'
import type { ID, PathStep, Topic } from '@shared/types'
import { json, num, prepare, str, strOrNull, toJson, type Row } from '../sql'

function toTopic(row: Row): Topic {
  return {
    id: str(row, 'id'),
    notebookId: str(row, 'notebook_id'),
    title: str(row, 'title'),
    description: str(row, 'description'),
    unitLabel: str(row, 'unit_label'),
    orderIndex: num(row, 'order_index'),
    sourceIds: json<ID[]>(row, 'source_ids', []),
    pathStep: strOrNull(row, 'path_step') as PathStep | 'done' | null,
    chunkIndex: num(row, 'chunk_index'),
    startedAt: strOrNull(row, 'started_at'),
    completedAt: strOrNull(row, 'completed_at'),
    createdAt: str(row, 'created_at')
  }
}

export function insertTopic(db: DatabaseSync, topic: Topic): void {
  prepare(
    db,
    `INSERT INTO topics (id, notebook_id, title, description, unit_label, order_index, source_ids, path_step, chunk_index, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    topic.id,
    topic.notebookId,
    topic.title,
    topic.description,
    topic.unitLabel,
    topic.orderIndex,
    toJson(topic.sourceIds),
    topic.pathStep,
    topic.chunkIndex,
    topic.startedAt,
    topic.completedAt,
    topic.createdAt
  )
}

export function updateTopicRow(db: DatabaseSync, topic: Topic): void {
  prepare(
    db,
    `UPDATE topics SET title = ?, description = ?, unit_label = ?, order_index = ?, source_ids = ?, path_step = ?,
       chunk_index = ?, started_at = ?, completed_at = ? WHERE id = ?`
  ).run(
    topic.title,
    topic.description,
    topic.unitLabel,
    topic.orderIndex,
    toJson(topic.sourceIds),
    topic.pathStep,
    topic.chunkIndex,
    topic.startedAt,
    topic.completedAt,
    topic.id
  )
}

export function findTopic(db: DatabaseSync, id: ID): Topic | null {
  const row = prepare(db, 'SELECT * FROM topics WHERE id = ?').get(id)
  return row ? toTopic(row) : null
}

/** Topics of one notebook in course order. */
export function listTopicRows(db: DatabaseSync, notebookId: ID): Topic[] {
  return prepare(db, 'SELECT * FROM topics WHERE notebook_id = ? ORDER BY order_index ASC, created_at ASC, rowid ASC')
    .all(notebookId)
    .map(toTopic)
}

/** Every topic of every notebook, grouped by notebook and in course order. */
export function listAllTopicRows(db: DatabaseSync): Topic[] {
  return prepare(db, 'SELECT * FROM topics ORDER BY notebook_id, order_index ASC, created_at ASC, rowid ASC').all().map(toTopic)
}

export function nextTopicOrderIndex(db: DatabaseSync, notebookId: ID): number {
  const row = prepare(db, 'SELECT MAX(order_index) AS max_index FROM topics WHERE notebook_id = ?').get(notebookId)
  const max = row?.max_index
  return typeof max === 'number' ? max + 1 : 0
}

export function setTopicOrderIndex(db: DatabaseSync, id: ID, orderIndex: number): void {
  prepare(db, 'UPDATE topics SET order_index = ? WHERE id = ?').run(orderIndex, id)
}

export function deleteTopicRow(db: DatabaseSync, id: ID): boolean {
  return Number(prepare(db, 'DELETE FROM topics WHERE id = ?').run(id).changes) > 0
}

export function countTopicsByNotebook(db: DatabaseSync): Map<ID, number> {
  const counts = new Map<ID, number>()
  for (const row of prepare(db, 'SELECT notebook_id, COUNT(*) AS n FROM topics GROUP BY notebook_id').all()) {
    counts.set(str(row, 'notebook_id'), num(row, 'n'))
  }
  return counts
}
