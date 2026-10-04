// The Claude transport: client cache, request building, streaming with
// progress, refusal / max_tokens / bad-output handling, and mapping SDK
// errors to AppError codes. Pure pieces (request builder, error mapper,
// progress tracker) are exported for unit tests.

import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { AppError, ERROR_MESSAGES } from '@shared/errors'
import type { AiModelId, AiTask } from '@shared/types'
import type { AiSourceDoc, CallOptions } from './index'
import { retryNote, SYSTEM_PROMPT } from './prompts'
import { OutputError, type JsonSchema } from './schemas'
import { documentBlocks } from './sources'

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Depth per task: lessons and syllabus reading are worth more thinking than the rest. */
export const TASK_EFFORT: Record<AiTask, Effort> = {
  lesson: 'high',
  syllabus: 'high',
  quiz: 'medium',
  flashcards: 'medium',
  summary: 'medium',
  explanation: 'medium'
}

/** [first attempt, retry after stop_reason "max_tokens"]. Thinking tokens count toward the limit. */
export const TASK_MAX_TOKENS: Record<AiTask, readonly [number, number]> = {
  lesson: [48_000, 64_000],
  quiz: [32_000, 64_000],
  syllabus: [24_000, 48_000],
  flashcards: [16_000, 32_000],
  summary: [16_000, 32_000],
  explanation: [12_000, 24_000]
}

/** Haiku 4.5 has no effort, adaptive thinking or server-side fallbacks. */
export function isHaiku(model: AiModelId): boolean {
  return model === 'claude-haiku-4-5'
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** The slice of the SDK client this module uses, so tests can pass a fake. */
export interface MessageStreamLike {
  on(event: 'text', listener: (delta: string, snapshot: string) => void): unknown
  on(event: 'streamEvent', listener: (event: BetaRawMessageStreamEvent, snapshot: BetaMessage) => void): unknown
  finalMessage(): Promise<BetaMessage>
}

export interface AiClient {
  beta: {
    messages: {
      stream(body: BetaMessageStreamParams, options?: { signal?: AbortSignal | null }): MessageStreamLike
    }
  }
  models: {
    retrieve(modelId: string): PromiseLike<{ id: string; display_name: string }>
  }
}

let cachedClient: { apiKey: string; client: Anthropic } | null = null

/** One client per key: reusing it keeps HTTP connections warm; a new key replaces the old client. */
export function clientForKey(apiKey: string): AiClient {
  if (cachedClient?.apiKey !== apiKey) {
    cachedClient = { apiKey, client: new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 }) }
  }
  return cachedClient.client
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export interface StructuredRequest {
  task: AiTask
  model: AiModelId
  /** Task-specific instruction; goes last, after the cached course files. */
  instruction: string
  sources: AiSourceDoc[]
  schema: JsonSchema
  maxTokens: number
}

/**
 * Layout for prompt caching: stable system prompt (breakpoint) -> course files
 * as document blocks (breakpoint on the last) -> the task instruction. Nothing
 * volatile appears before the breakpoints.
 */
export function buildMessageParams(request: StructuredRequest): BetaMessageStreamParams {
  const content: BetaContentBlockParam[] = [...documentBlocks(request.sources), { type: 'text', text: request.instruction }]
  const haiku = isHaiku(request.model)
  const params: BetaMessageStreamParams = {
    model: request.model,
    max_tokens: request.maxTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    // Thinking is omitted on purpose: Opus 5.5 always thinks (adaptive) and Sonnet 5.5 defaults to
    // adaptive; Haiku 4.5 runs without it. Depth is controlled with effort instead.
    output_config: haiku
      ? { format: { type: 'json_schema', schema: request.schema } }
      : { effort: TASK_EFFORT[request.task], format: { type: 'json_schema', schema: request.schema } }
  }
  if (!haiku) {
    // A policy decline is retried server-side on Anthropic's recommended model for that category.
    params.betas = [FALLBACK_BETA]
    params.fallbacks = 'default'
  }
  return params
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressPlan {
  /** Rough size of a complete answer in characters, for the 0-1 estimate. */
  expectedChars: number
  startMessage: string
  thinkingMessage: string
  /** Friendly message for the JSON streamed so far. */
  describe: (textSoFar: string) => string
}

const MIN_STEP = 0.02
const DESCRIBE_EVERY_CHARS = 200

/** Turns streamed text into throttled, monotonic progress events. */
export class ProgressTracker {
  private text = ''
  private floor = 0
  private lastFraction = -1
  private lastMessage = ''
  private lastDescribedAt = -Infinity
  private message: string

  constructor(
    private readonly task: AiTask,
    private readonly plan: ProgressPlan,
    private readonly onProgress?: CallOptions['onProgress']
  ) {
    this.message = plan.startMessage
  }

  start(): void {
    this.emit(this.floor, this.plan.startMessage)
  }

  /** A new attempt streams from scratch; progress never goes backwards. */
  restart(message: string): void {
    this.floor = Math.max(this.floor, this.lastFraction, 0)
    this.text = ''
    this.lastDescribedAt = -Infinity
    this.emit(this.floor, message)
  }

  thinking(): void {
    if (!this.text) this.emit(Math.max(this.lastFraction, this.floor), this.plan.thinkingMessage)
  }

  status(message: string): void {
    this.emit(Math.max(this.lastFraction, this.floor), message)
  }

  addText(delta: string): void {
    this.text += delta
    if (this.text.length - this.lastDescribedAt >= DESCRIBE_EVERY_CHARS) {
      this.lastDescribedAt = this.text.length
      this.message = this.plan.describe(this.text)
    }
    const raw = Math.min(1, this.text.length / Math.max(1, this.plan.expectedChars))
    // Never claim completion from length alone; the caller reports "Done".
    this.emit(this.floor + (0.95 - this.floor) * raw, this.message)
  }

  private emit(fraction: number, message: string): void {
    if (!this.onProgress) return
    const rounded = Math.round(fraction * 100) / 100
    if (message === this.lastMessage && rounded - this.lastFraction < MIN_STEP) return
    this.lastFraction = Math.max(this.lastFraction, rounded)
    this.lastMessage = message
    try {
      this.onProgress(this.task, this.lastFraction, message)
    } catch {
      // A broken listener must never fail the AI call.
    }
  }
}

/** Counts JSON keys in streamed output, ignoring escaped quotes inside string values. */
export function countKey(json: string, key: string): number {
  return json.match(new RegExp(`(?<!\\\\)"${key}"\\s*:`, 'g'))?.length ?? 0
}

// ---------------------------------------------------------------------------
// Running a structured call
// ---------------------------------------------------------------------------

export interface StructuredCall<T> extends Omit<StructuredRequest, 'maxTokens'> {
  progress: ProgressPlan
  /** Converts parsed JSON into the result; throws OutputError when it is unusable. */
  validate: (json: unknown) => T
}

/**
 * Streams one structured request and returns the validated result.
 * Refusal -> AI_REFUSED. max_tokens -> one retry with a larger limit.
 * Invalid output -> one retry with the reason appended. Then AI_BAD_OUTPUT.
 */
export async function runStructured<T>(client: AiClient, call: StructuredCall<T>, options: CallOptions = {}): Promise<T> {
  const [firstLimit, retryLimit] = TASK_MAX_TOKENS[call.task]
  const tracker = new ProgressTracker(call.task, call.progress, options.onProgress)
  let maxTokens = firstLimit
  let instruction = call.instruction
  let grewLimit = false
  let retriedOutput = false

  tracker.start()
  for (;;) {
    const params = buildMessageParams({ ...call, instruction, maxTokens })
    const message = await streamMessage(client, params, tracker, options.signal)

    if (message.stop_reason === 'refusal') {
      throw new AppError('AI_REFUSED', 'The AI declined to write this. Try different files or rephrase the topic.')
    }
    if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
      if (grewLimit) throw new AppError('AI_BAD_OUTPUT', 'The answer was too long to finish. Try fewer files or a narrower topic.')
      grewLimit = true
      maxTokens = retryLimit
      tracker.restart('Needs more room: writing it again')
      continue
    }

    try {
      return call.validate(parseJson(message))
    } catch (err) {
      if (!(err instanceof OutputError)) throw err
      if (retriedOutput) throw new AppError('AI_BAD_OUTPUT', `The AI's answer was not usable: ${err.message}`)
      retriedOutput = true
      instruction = call.instruction + retryNote(err.message)
      tracker.restart('Tidying up the answer: trying once more')
    }
  }
}

async function streamMessage(
  client: AiClient,
  params: BetaMessageStreamParams,
  tracker: ProgressTracker,
  signal: AbortSignal | undefined
): Promise<BetaMessage> {
  try {
    const stream = client.beta.messages.stream(params, signal ? { signal } : undefined)
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_start') return
      if (event.content_block.type === 'thinking' || event.content_block.type === 'redacted_thinking') tracker.thinking()
      if (event.content_block.type === 'fallback') tracker.status('Switching to a backup model')
    })
    stream.on('text', (delta) => tracker.addText(delta))
    return await stream.finalMessage()
  } catch (err) {
    throw mapAiError(err)
  }
}

/**
 * All text blocks joined in order. After a mid-stream server-side fallback the
 * fallback model continues the declined partial text, so the pieces form one
 * JSON document.
 */
export function messageText(message: BetaMessage): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function parseJson(message: BetaMessage): unknown {
  const text = messageText(message).trim()
  if (!text) throw new OutputError('The answer was empty.')
  try {
    return JSON.parse(text)
  } catch {
    throw new OutputError('The answer was not valid JSON.')
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Maps anything thrown by the SDK (most specific class first) to an AppError. Never inspects message text. */
export function mapAiError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new AppError('UNKNOWN', 'The AI request was cancelled.')
  if (err instanceof Anthropic.AuthenticationError) return new AppError('INVALID_API_KEY', ERROR_MESSAGES.INVALID_API_KEY)
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AppError('INVALID_API_KEY', 'This API key is not allowed to use the selected model.')
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AppError('AI_UNAVAILABLE', 'The selected model is not available for this API key. Pick another model in Settings.')
  }
  if (err instanceof Anthropic.RateLimitError) return new AppError('RATE_LIMITED', ERROR_MESSAGES.RATE_LIMITED)
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError('NETWORK', 'The AI took too long to respond. Check your connection and try again.')
  }
  if (err instanceof Anthropic.APIConnectionError) return new AppError('NETWORK', ERROR_MESSAGES.NETWORK)
  if (err instanceof Anthropic.InternalServerError) return new AppError('AI_UNAVAILABLE', ERROR_MESSAGES.AI_UNAVAILABLE)
  if (err instanceof Anthropic.BadRequestError) return new AppError('AI_BAD_OUTPUT', `The AI service rejected the request: ${apiMessage(err)}`)
  if (err instanceof Anthropic.APIError) {
    if (err.status === 413) return new AppError('SOURCE_TOO_LARGE', ERROR_MESSAGES.SOURCE_TOO_LARGE)
    // Errors sent inside an open stream have no HTTP status; the typed error.type says what happened.
    switch (err.type) {
      case 'rate_limit_error':
        return new AppError('RATE_LIMITED', ERROR_MESSAGES.RATE_LIMITED)
      case 'authentication_error':
      case 'permission_error':
        return new AppError('INVALID_API_KEY', ERROR_MESSAGES.INVALID_API_KEY)
      case 'billing_error':
        return new AppError('AI_UNAVAILABLE', 'Your Anthropic account has a billing problem. Check it at console.anthropic.com.')
      case 'invalid_request_error':
        return new AppError('AI_BAD_OUTPUT', `The AI service rejected the request: ${apiMessage(err)}`)
      default:
        if (err.status === undefined || err.status >= 500) return new AppError('AI_UNAVAILABLE', ERROR_MESSAGES.AI_UNAVAILABLE)
        return new AppError('UNKNOWN', `The AI service returned an error (${err.status}).`)
    }
  }
  return new AppError('UNKNOWN', err instanceof Error ? err.message : 'Something went wrong talking to the AI.')
}

/** The human-readable message from the API's error body; the SDK's own message is the raw JSON. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body: unknown = err.error
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const inner: unknown = body.error
    if (typeof inner === 'object' && inner !== null && 'message' in inner && typeof inner.message === 'string') return inner.message
  }
  return err.message
}
