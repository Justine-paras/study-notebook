// Opens the SQLite database (node:sqlite, built into Electron's Node) and runs
// migrations. OWNER: backend agent.

import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations'
import { failInterruptedImports } from './repositories/sources'

/**
 * Opens (creating if needed) the database at `path` (":memory:" allowed),
 * enables WAL + foreign keys, migrates to the latest schema and fails imports
 * a previous run left unfinished.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    // Another process (a second app instance in e2e) may hold a lock briefly.
    // Set first: switching to WAL needs a lock too.
    db.exec('PRAGMA busy_timeout = 5000')
    // WAL keeps reads fast while a write is in flight; in-memory databases
    // ignore it and report "memory", which is fine.
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = NORMAL')
    migrate(db)
    // Nothing can be importing in a process that is only now opening the database.
    failInterruptedImports(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}
