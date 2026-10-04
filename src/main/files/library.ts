// Keeps a private copy of every imported file under the app's library folder,
// so notebooks keep working if the original is moved or deleted.
// OWNER: files agent.

export interface StoredFile {
  storedPath: string
  sizeBytes: number
}

/**
 * Copies `srcPath` to `<libraryDir>/<notebookId>/<uniqueName>` keeping the
 * original file name where possible (adds " (2)", " (3)"... on collision).
 * Creates folders as needed.
 */
export async function copyIntoLibrary(libraryDir: string, notebookId: string, srcPath: string): Promise<StoredFile> {
  void libraryDir
  void notebookId
  void srcPath
  throw new Error('TODO')
}

/** Deletes a stored copy. Missing files are ignored. */
export async function removeFromLibrary(storedPath: string): Promise<void> {
  void storedPath
  throw new Error('TODO')
}

/** Deletes a notebook's whole library folder. Missing folders are ignored. */
export async function removeNotebookLibrary(libraryDir: string, notebookId: string): Promise<void> {
  void libraryDir
  void notebookId
  throw new Error('TODO')
}
