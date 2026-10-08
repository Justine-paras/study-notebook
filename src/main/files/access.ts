// Which files the app may touch on the renderer's behalf. The renderer is
// treated as untrusted: it may only import files the learner chose (file
// picker or drag and drop), and "open" actions only reach the app's own data
// folder. OWNER: files agent.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { AppError } from '@shared/errors'

type PathApi = Pick<typeof path, 'isAbsolute' | 'relative' | 'resolve' | 'sep'>

/**
 * True when `target` is `folder` itself or somewhere inside it. Relative
 * targets, other drives and UNC paths are outside. `pathApi` lets tests check
 * Windows rules (case-insensitive, drive letters) on any OS.
 */
export function isInsideFolder(folder: string, target: unknown, pathApi: PathApi = path): boolean {
  if (typeof target !== 'string' || !target || typeof folder !== 'string' || !folder) return false
  if (!pathApi.isAbsolute(target)) return false
  const rel = pathApi.relative(pathApi.resolve(folder), pathApi.resolve(target))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel)
}

/**
 * Guards "open with the default app" actions: the target must be inside the
 * data folder (a stored copy, the folder itself) and still exist. Anything
 * else, such as a path from a database restored on another computer, throws
 * NOT_FOUND instead of reaching the shell.
 */
export function requireOwnPath(dataDir: string, target: unknown, exists: (path: string) => boolean = existsSync): string {
  if (!isInsideFolder(dataDir, target)) throw new AppError('NOT_FOUND', 'Study Notebook only opens files in its own data folder.')
  if (!exists(target as string)) {
    throw new AppError('NOT_FOUND', "The app's copy of this file is missing. Delete it from the notebook and add it again.")
  }
  return target as string
}

/**
 * Paths the learner handed to the app this session: everything the file
 * picker returned and every file dropped on the window. importSources only
 * reads these, so a compromised page can't pull arbitrary files (or a
 * \\attacker\share path, which makes Windows leak the login hash) into a
 * notebook.
 */
export class FileGrants {
  readonly #paths = new Set<string>()
  readonly #pathApi: PathApi
  readonly #caseInsensitive: boolean

  constructor(pathApi: PathApi = path, caseInsensitive = process.platform === 'win32') {
    this.#pathApi = pathApi
    this.#caseInsensitive = caseInsensitive
  }

  #key(target: string): string {
    const resolved = this.#pathApi.resolve(target)
    return this.#caseInsensitive ? resolved.toLowerCase() : resolved
  }

  grant(target: unknown): void {
    if (typeof target === 'string' && target && this.#pathApi.isAbsolute(target)) this.#paths.add(this.#key(target))
  }

  has(target: unknown): boolean {
    return typeof target === 'string' && !!target && this.#pathApi.isAbsolute(target) && this.#paths.has(this.#key(target))
  }
}
