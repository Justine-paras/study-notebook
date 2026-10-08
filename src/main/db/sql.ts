// Small helpers over node:sqlite: cached prepared statements, transactions and
// typed reads of row values. Repositories build on these so they never deal
// with raw `SQLOutputValue`s or hand-written BEGIN/COMMIT blocks.

import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite'

export type Row = Record<string, SQLOutputValue>

/**
 * Which notebooks a bulk read covers: one notebook, every notebook that is not
 * archived (Today and Insights leave put-away subjects out, so they shouldn't
 * pay to load their history), or all of them.
 */
export type NotebookScope = { notebookId: string } | 'unarchived' | 'all'

const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>()

/** A prepared statement for `sql`, compiled once per database connection. */
export function prepare(db: DatabaseSync, sql: string): StatementSync {
  let cache = statementCache.get(db)
  if (!cache) {
    cache = new Map()
    statementCache.set(db, cache)
  }
  let statement = cache.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    cache.set(sql, statement)
  }
  return statement
}

let savepointCounter = 0

/**
 * Runs `fn` inside a transaction and commits, or rolls back if it throws.
 * Nested calls use savepoints so repositories can compose freely. `fn` must be
 * synchronous: awaiting inside it would let other IPC calls interleave with a
 * half-finished transaction on the shared connection.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    const name = `sp_${++savepointCounter}`
    db.exec(`SAVEPOINT ${name}`)
    try {
      const result = fn()
      db.exec(`RELEASE ${name}`)
      return result
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`)
      db.exec(`RELEASE ${name}`)
      throw err
    }
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}

export function str(row: Row, key: string): string {
  const value = row[key]
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

export function strOrNull(row: Row, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

export function num(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value)
  return 0
}

export function numOrNull(row: Row, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return num(row, key)
}

export function bool(row: Row, key: string): boolean {
  return num(row, key) !== 0
}

/** Parses a JSON column; a corrupt or empty value yields `fallback` instead of breaking a whole screen. */
export function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key]
  if (typeof value !== 'string' || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0
}

/** `?, ?, ?` for an IN (...) list of `count` values. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
