// Opens the SQLite database (node:sqlite, built into Electron's Node) and runs
// migrations. OWNER: backend agent.

import { DatabaseSync } from 'node:sqlite'

/** Opens (creating if needed) the database at `path` (":memory:" allowed), enables WAL + foreign keys, and migrates to the latest schema. */
export function openDatabase(path: string): DatabaseSync {
  void path
  void DatabaseSync
  throw new Error('TODO')
}
