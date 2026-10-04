import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { MIGRATIONS, migrate, schemaVersion } from './migrations'
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
