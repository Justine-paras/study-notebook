import type { AppErrorCode } from './types'

/** An error with a code the renderer can turn into a friendly message. */
export class AppError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}

/** Friendly, learner-facing text for each error code. */
export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  NO_API_KEY: 'Add your Anthropic API key in Settings to use AI features.',
  INVALID_API_KEY: 'Your API key was rejected. Check it in Settings.',
  RATE_LIMITED: 'The AI is busy right now. Try again in a minute.',
  AI_REFUSED: 'The AI declined this request. Try rewording it or using different files.',
  AI_BAD_OUTPUT: 'The AI returned something unexpected. Try again.',
  AI_UNAVAILABLE: 'The AI service is having problems. Try again shortly.',
  NETWORK: "Couldn't reach the AI service. Check your internet connection.",
  SOURCE_TOO_LARGE: 'These files are too large to send at once. Pick fewer files for this topic.',
  NO_SOURCES: 'Add files to this notebook (or link files to this topic) first.',
  UNSUPPORTED_FILE: 'That file type is not supported. Use PDF, PowerPoint, Word, text or Markdown files.',
  EXTRACT_FAILED: "Couldn't read text from that file.",
  NOT_FOUND: "That item doesn't exist anymore.",
  INVALID_INPUT: 'Something in that request was not valid.',
  UNKNOWN: 'Something went wrong.'
}
