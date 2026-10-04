import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { MIGRATIONS, migrate, schemaVersion } from './migrations'
import { INTERRUPTED_IMPORT_ERROR } from './repositories/sources'
import { json, placeholders, prepare, transaction } from './sql'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('migrates a new database to the latest version with foreign keys on', () => {
    const db = openDatabase(':memory:')
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name)
    expect(tables).toEqual(
      expect.arrayContaining(['notebooks', 'sources', 'topics', 'lessons', 'quizzes', 'answers', 'cards', 'review_logs', 'notes', 'exams', 'focus_sessions', 'settings'])
    )
    db.close()
  })

  it('waits for locks instead of failing at once', () => {
    const db = openDatabase(':memory:')
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    db.close()
  })

  it('uses WAL for file databases and reopens without re-running migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'study.db')
    const first = openDatabase(path)
    expect(first.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    first.exec("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"')")
    first.close()

    const second = openDatabase(path)
    expect(schemaVersion(second)).toBe(MIGRATIONS.length)
    expect(second.prepare('SELECT value FROM settings WHERE key = ?').get('theme')).toEqual({ value: '"dark"' })
    second.close()
  })

  it('fails imports that a previous run left processing, so they never spin forever', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'study.db')
    const first = openDatabase(path)
    first.exec(`
      INSERT INTO notebooks (id, name, color, created_at) VALUES ('n', 'OS', 'teal', '2026-09-01T00:00:00.000Z');
      INSERT INTO sources (id, notebook_id, file_name, ext, kind, stored_path, status, added_at)
        VALUES ('stuck', 'n', 'Big.pdf', 'pdf', 'lecture', '/lib/n/Big.pdf', 'processing', '2026-09-01'),
               ('done', 'n', 'Small.pdf', 'pdf', 'lecture', '/lib/n/Small.pdf', 'ready', '2026-09-01');
    `)
    first.close()
    const second = openDatabase(path)
    expect(second.prepare('SELECT id, status, error FROM sources ORDER BY id').all()).toEqual([
      { id: 'done', status: 'ready', error: null },
      { id: 'stuck', status: 'error', error: INTERRUPTED_IMPORT_ERROR }
    ])
    second.close()
  })

  it('refuses a database from a newer app version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'future.db')
    const raw = new DatabaseSync(path)
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`)
    raw.close()
    expect(() => openDatabase(path)).toThrow(/newer version/)
  })
})

describe('migration 2', () => {
  it('upgrades a version 1 database without touching its data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'study.db')
    const v1 = new DatabaseSync(path)
    migrate(v1, MIGRATIONS.slice(0, 1))
    v1.exec(`
      INSERT INTO notebooks (id, name, color, created_at) VALUES ('n', 'OS', 'teal', '2026-09-01T00:00:00.000Z');
      INSERT INTO cards (id, notebook_id, front, back, origin, created_at, due) VALUES ('c', 'n', 'Q', 'A', 'lesson', '2026-09-01', '2026-09-02');
      INSERT INTO answers (id, notebook_id, card_id, source, question_type, prompt, user_answer, correct_answer, correct, answered_at)
        VALUES ('a', 'n', 'c', 'review', 'recall', 'Q', '', 'A', 1, '2026-09-02T00:00:00.000Z');
    `)
    v1.close()

    const db = openDatabase(path)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT id FROM answers').all()).toEqual([{ id: 'a' }])
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_answers_card', 'idx_answers_quiz', 'idx_cards_notebook_due']))
    expect(indexes).not.toContain('idx_cards_notebook')
    db.close()
  })

  it('can run again over an already indexed schema', () => {
    const db = openDatabase(':memory:')
    expect(() => db.exec(MIGRATIONS[1])).not.toThrow()
    db.close()
  })

  it('indexes every foreign-key child column, so deletes never scan a whole table per row', () => {
    const db = openDatabase(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name))
    const missing: string[] = []
    for (const table of tables) {
      const leading = new Set(
        db
          .prepare(`SELECT name FROM pragma_index_list('${table}')`)
          .all()
          .map((index) => db.prepare(`SELECT name FROM pragma_index_info('${String(index.name)}') WHERE seqno = 0`).get()?.name)
      )
      for (const fk of db.prepare(`SELECT "from" FROM pragma_foreign_key_list('${table}')`).all()) {
        if (!leading.has(fk.from)) missing.push(`${table}.${String(fk.from)}`)
      }
    }
    expect(missing).toEqual([])
    db.close()
  })

  it('serves the due-card and per-notebook time queries from indexes', () => {
    const db = openDatabase(':memory:')
    const plan = (sql: string): string =>
      db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((r) => String(r.detail))
        .join('; ')
    expect(plan("SELECT * FROM cards WHERE notebook_id = 'n' AND suspended = 0 AND due <= '2026' ORDER BY due")).toMatch(/idx_cards_notebook_due/)
    expect(plan("SELECT id FROM answers WHERE card_id = 'c'")).toMatch(/idx_answers_card/)
    expect(plan("SELECT 1 FROM answers WHERE answered_at >= '2026' AND answered_at < '2027' LIMIT 1")).toMatch(/idx_answers_answered/)
    db.close()
  })
})

describe('migrate', () => {
  it('rolls back a failing migration and keeps the previous version', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (y); THIS IS NOT SQL'])).toThrow()
    expect(schemaVersion(db)).toBe(1)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined()
    db.close()
  })
})

describe('transaction', () => {
  it('commits on success and rolls back on error, including nested savepoints', () => {
    const db = openDatabase(':memory:')
    const insert = (key: string): void => {
      prepare(db, 'INSERT INTO settings (key, value) VALUES (?, ?)').run(key, '1')
    }
    transaction(db, () => insert('a'))
    expect(() =>
      transaction(db, () => {
        insert('b')
        throw new Error('boom')
      })
    ).toThrow('boom')

    transaction(db, () => {
      insert('c')
      expect(() =>
        transaction(db, () => {
          insert('d')
          throw new Error('inner')
        })
      ).toThrow('inner')
    })
    const keys = db.prepare('SELECT key FROM settings ORDER BY key').all().map((r) => r.key)
    expect(keys).toEqual(['a', 'c'])
    expect(db.isTransaction).toBe(false)
    db.close()
  })
})

describe('sql helpers', () => {
  it('caches prepared statements per connection', () => {
    const db = openDatabase(':memory:')
    expect(prepare(db, 'SELECT 1')).toBe(prepare(db, 'SELECT 1'))
    db.close()
  })

  it('falls back on corrupt JSON and builds placeholder lists', () => {
    expect(json({ v: '{oops' }, 'v', [1])).toEqual([1])
    expect(json({ v: '[2]' }, 'v', [])).toEqual([2])
    expect(placeholders(3)).toBe('?, ?, ?')
  })
})
