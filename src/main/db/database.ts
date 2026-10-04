// Opens the SQLite database (node:sqlite, built into Electron's Node) and runs
// migrations. OWNER: backend agent.

import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations'

/** Opens (creating if needed) the database at `path` (":memory:" allowed), enables WAL + foreign keys, and migrates to the latest schema. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    // WAL keeps reads fast while a write is in flight; in-memory databases
    // ignore it and report "memory", which is fine.
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = NORMAL')
    // Another process (a second app instance in e2e) may hold a lock briefly.
    db.exec('PRAGMA busy_timeout = 5000')
    migrate(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}
