// Schema migrations, applied in order and tracked with PRAGMA user_version.
// Never edit a migration that has shipped: append a new one instead, because
// learners' databases already ran the old ones.

import type { DatabaseSync } from 'node:sqlite'

export const MIGRATIONS: readonly string[] = [
  // 1: initial schema
  `
  CREATE TABLE notebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    stored_path TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    text TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER,
    summary TEXT,
    added_at TEXT NOT NULL
  );
  CREATE INDEX idx_sources_notebook ON sources(notebook_id);

  CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    unit_label TEXT NOT NULL DEFAULT '',
    order_index INTEGER NOT NULL,
    source_ids TEXT NOT NULL DEFAULT '[]',
    path_step TEXT,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_topics_notebook ON topics(notebook_id, order_index);

  CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE quizzes (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    settings TEXT NOT NULL,
    questions TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '[]',
    score INTEGER,
    cards_created INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    submitted_at TEXT
  );
  CREATE INDEX idx_quizzes_notebook ON quizzes(notebook_id, created_at);

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    origin TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'new',
    last_review TEXT
  );
  CREATE INDEX idx_cards_notebook ON cards(notebook_id);
  CREATE INDEX idx_cards_topic ON cards(topic_id);
  CREATE INDEX idx_cards_due ON cards(due);

  CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    confidence TEXT,
    state_before TEXT NOT NULL,
    scheduled_days REAL NOT NULL,
    elapsed_days REAL NOT NULL,
    reviewed_at TEXT NOT NULL
  );
  CREATE INDEX idx_review_logs_card ON review_logs(card_id);
  CREATE INDEX idx_review_logs_notebook ON review_logs(notebook_id);
  CREATE INDEX idx_review_logs_reviewed ON review_logs(reviewed_at);

  CREATE TABLE answers (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    quiz_id TEXT REFERENCES quizzes(id) ON DELETE SET NULL,
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    question_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    correct INTEGER NOT NULL,
    confidence TEXT,
    answered_at TEXT NOT NULL
  );
  CREATE INDEX idx_answers_notebook ON answers(notebook_id);
  CREATE INDEX idx_answers_topic ON answers(topic_id);
  CREATE INDEX idx_answers_answered ON answers(answered_at);

  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_notes_notebook ON notes(notebook_id);
  CREATE INDEX idx_notes_topic ON notes(topic_id);

  CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    topic_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_exams_notebook ON exams(notebook_id);
  CREATE INDEX idx_exams_date ON exams(exam_date);

  CREATE TABLE focus_sessions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    minutes REAL NOT NULL
  );
  CREATE INDEX idx_focus_started ON focus_sessions(started_at);
  CREATE INDEX idx_focus_notebook ON focus_sessions(notebook_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

/**
 * Applies every migration newer than the database's user_version. Each runs
 * in its own transaction together with its version bump, so a crash midway
 * leaves the database at the last fully applied version.
 */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): void {
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(
      `The database was created by a newer version of Study Notebook (schema ${current}, this app knows ${migrations.length}). Update the app.`
    )
  }
  for (let version = current + 1; version <= migrations.length; version++) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migrations[version - 1])
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
