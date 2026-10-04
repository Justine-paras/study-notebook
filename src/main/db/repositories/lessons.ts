import type { DatabaseSync } from 'node:sqlite'
import type { ID, Lesson, LessonContent } from '@shared/types'
import { json, prepare, str, toJson, type Row } from '../sql'

function toLesson(row: Row): Lesson {
  return {
    id: str(row, 'id'),
    topicId: str(row, 'topic_id'),
    content: json<LessonContent>(row, 'content', {
      title: '',
      overview: '',
      estMinutes: 0,
      warmup: [],
      chunks: [],
      keyTerms: [],
      connections: [],
      explainPrompt: '',
      explainRubric: [],
      sourcesUsed: []
    }),
    createdAt: str(row, 'created_at')
  }
}

export function findLessonByTopic(db: DatabaseSync, topicId: ID): Lesson | null {
  const row = prepare(db, 'SELECT * FROM lessons WHERE topic_id = ?').get(topicId)
  return row ? toLesson(row) : null
}

/** Stores the topic's current lesson, replacing any previous one (one lesson per topic). */
export function upsertLesson(db: DatabaseSync, lesson: Lesson): void {
  prepare(
    db,
    `INSERT INTO lessons (id, topic_id, content, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(topic_id) DO UPDATE SET id = excluded.id, content = excluded.content, created_at = excluded.created_at`
  ).run(lesson.id, lesson.topicId, toJson(lesson.content), lesson.createdAt)
}
