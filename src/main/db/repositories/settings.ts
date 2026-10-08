import type { DatabaseSync } from 'node:sqlite'
import { prepare, str } from '../sql'

/** Raw stored settings, JSON-decoded. Values that fail to parse are skipped (defaults apply). */
export function readSettingRows(db: DatabaseSync): Map<string, unknown> {
  const values = new Map<string, unknown>()
  for (const row of prepare(db, 'SELECT key, value FROM settings').all()) {
    try {
      values.set(str(row, 'key'), JSON.parse(str(row, 'value')))
    } catch {
      // A corrupt value falls back to its default rather than breaking startup.
    }
  }
  return values
}

export function readSetting(db: DatabaseSync, key: string): unknown {
  const row = prepare(db, 'SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return undefined
  try {
    return JSON.parse(str(row, 'value'))
  } catch {
    return undefined
  }
}

export function writeSetting(db: DatabaseSync, key: string, value: unknown): void {
  prepare(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  )
}

export function deleteSetting(db: DatabaseSync, key: string): void {
  prepare(db, 'DELETE FROM settings WHERE key = ?').run(key)
}
