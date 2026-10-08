// Ollama: a local model server the learner can use instead of Claude.
// Talks to Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md)
// with fetch, so it needs no extra dependency.

import { AppError } from '@shared/errors'
import type { OllamaModelInfo } from '@shared/types'

export interface OllamaModelsResult {
  ok: boolean
  /** What to tell the learner: how many models were found, or what to do when none could be listed. */
  message: string
  models: OllamaModelInfo[]
}

const MAX_URL_LENGTH = 200

/**
 * Checks and tidies an Ollama server address typed by the learner: http or
 * https only, no user name or password, no query or fragment, no trailing
 * slash. "localhost:11434" gets "http://" added. Throws
 * AppError('INVALID_INPUT') with a friendly sentence otherwise.
 */
export function normalizeOllamaUrl(input: unknown): string {
  if (typeof input !== 'string') throw new AppError('INVALID_INPUT', 'The Ollama address must be text, like http://127.0.0.1:11434.')
  let text = input.trim()
  if (!text || text.length > MAX_URL_LENGTH) throw new AppError('INVALID_INPUT', 'Enter the Ollama address, like http://127.0.0.1:11434.')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new AppError('INVALID_INPUT', "That isn't a valid address. Use something like http://127.0.0.1:11434.")
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_INPUT', 'The Ollama address must start with http:// or https://.')
  }
  if (url.username || url.password) throw new AppError('INVALID_INPUT', "The Ollama address can't include a user name or password.")
  if (url.search || url.hash) throw new AppError('INVALID_INPUT', "The Ollama address can't include ? or # parts.")
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Lists the models installed in the Ollama server at `baseUrl` (already
 * normalized). Never throws: an unreachable server or a bad answer gives
 * ok false and a message saying what to do.
 */
export async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<OllamaModelsResult> {
  void baseUrl
  void signal
  return { ok: false, message: 'Ollama support is not finished yet.', models: [] }
}
