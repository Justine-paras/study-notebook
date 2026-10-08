// Ollama: a local model server the learner can use instead of Claude.
// Talks to Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md)
// with node:http rather than fetch: undici's default 300 s headers and body
// timeouts would kill a healthy run on a CPU-only laptop, where loading the
// model and reading a long prompt can take many minutes before the first
// token. Pure pieces (budget arithmetic, NDJSON parsing, model names) are
// exported for unit tests.

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { AppError, ERROR_MESSAGES } from '@shared/errors'
import { OLLAMA_CONTEXT_SIZES, type AiTask, type OllamaModelInfo } from '@shared/types'
import { ProgressTracker, type StructuredCall } from './client'
import type { CallOptions } from './index'
import { jsonOutline, retryNote, SYSTEM_PROMPT } from './prompts'
import { OutputError, type JsonSchema } from './schemas'
import { documentsText } from './sources'

export interface OllamaModelsResult {
  ok: boolean
  /** What to tell the learner: how many models were found, or what to do when none could be listed. */
  message: string
  models: OllamaModelInfo[]
}

/** Where and what to run. `model` is the name the learner chose, e.g. "qwen3:8b". */
export interface OllamaTarget {
  baseUrl: string
  model: string
  contextTokens: number
  /** Longest silence allowed once the answer has started streaming. Tests shorten it. */
  idleTimeoutMs?: number
  /** Longest wait for the first token, instead of the one sized by the prompt. Tests shorten it. */
  firstTokenTimeoutMs?: number
}

/** The same call shape as the Claude transport, minus the Claude model choice. */
export interface OllamaCall<T> extends Omit<StructuredCall<T>, 'model' | 'fallbacks'> {
  /** Questions or cards asked for, to size the answer (quizzes and flashcards). */
  itemCount?: number
}

const MAX_URL_LENGTH = 200

/** Listing models is quick even while Ollama is busy, so a server that takes longer is treated as unreachable. */
const LIST_TIMEOUT_MS = 5_000
/** /api/show reads the model file's header; slow disks get a little longer. */
const SHOW_TIMEOUT_MS = 10_000
/**
 * Once tokens are streaming, a gap this long means Ollama hung. The wait for
 * the first token is longer and grows with the prompt (see
 * ollamaFirstTokenTimeoutMs): a CPU-only laptop can spend many minutes
 * loading the model and reading the prompt. A server that quits closes the
 * connection, and TCP keep-alive notices a remote server that vanished.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const KEEPALIVE_MS = 30_000
/** After this long without a token, the progress message says a local model can be slow to start. */
const SLOW_START_MS = 20_000
const MAX_JSON_CHARS = 4_000_000
const MAX_ERROR_CHARS = 64_000

// ---------------------------------------------------------------------------
// Addresses and model names
// ---------------------------------------------------------------------------

/**
 * Checks and tidies an Ollama server address typed by the learner: http or
 * https only, no user name or password, no query or fragment, no trailing
 * slash. "localhost:11434" gets "http://" added, and a final "/v1" (the
 * address other tools give for Ollama's OpenAI-style API) or "/api" is
 * dropped, since the app adds "/api/..." itself. Throws
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
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(v1|api)$/i, '')
  return `${url.protocol}//${url.host}${path}`
}

/**
 * The name the way Ollama resolves it: no tag means ":latest", and the
 * default registry and "library/" namespace are implied, so "llama3.2",
 * "llama3.2:latest" and "registry.ollama.ai/library/llama3.2" are one model.
 */
function canonicalModelName(name: string): string {
  let result = name.trim().toLowerCase().replace(/^registry\.ollama\.ai\//, '').replace(/^library\//, '')
  // The tag is after the last ":" that follows the last "/" (a host may carry a port: "host:5000/model").
  if (result.lastIndexOf(':') <= result.lastIndexOf('/')) result += ':latest'
  return result
}

/** True when two model names refer to the same installed model. */
export function sameOllamaModel(a: string, b: string): boolean {
  return canonicalModelName(a) === canonicalModelName(b)
}

// ---------------------------------------------------------------------------
// Learner-facing messages
// ---------------------------------------------------------------------------

const CANCELLED = 'The AI request was cancelled.'

export function ollamaUnreachableMessage(baseUrl: string): string {
  return `Couldn't reach Ollama at ${baseUrl}. Start the Ollama app and check that the address is right, then try again.`
}

export const OLLAMA_NO_MODELS_MESSAGE =
  'Ollama is running but has no models yet. To get one, open a terminal and run "ollama pull qwen3:8b", then check again.'

function notOllamaMessage(baseUrl: string): string {
  return `${baseUrl} answered, but it doesn't look like Ollama. Check the address, then try again.`
}

function notInstalledMessage(model: string): string {
  return `${model} isn't installed in Ollama. Open a terminal and run "ollama pull ${model}", or choose another model in Settings.`
}

function notChatModelMessage(model: string): string {
  return `${model} can't write lessons or questions because it isn't a chat model. Choose another model in Settings.`
}

function memoryMessage(model: string): string {
  return `Your computer ran out of memory running ${model}. Choose a smaller model or a smaller context size in Settings, or close other apps, then try again.`
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US')
}

/** The largest context size the learner can pick that fits a model's own limit, or null when none does. */
function largestContextSizeWithin(limit: number): number | null {
  return [...OLLAMA_CONTEXT_SIZES].reverse().find((size) => size <= limit) ?? null
}

function modelLimitMessage(model: string, limit: number): string {
  const fit = largestContextSizeWithin(limit)
  if (fit === null) {
    return `${model} can read at most ${formatTokens(limit)} tokens at once, which is too little for Study Notebook. Choose a model in Settings that can read at least ${formatTokens(OLLAMA_CONTEXT_SIZES[0])} tokens.`
  }
  return `${model} can read at most ${formatTokens(limit)} tokens at once. Choose a context size of ${formatTokens(fit)} or less in Settings so your files fit.`
}

function firstTokenTimeoutMessage(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return `Ollama didn't start answering within ${minutes} minute${minutes === 1 ? '' : 's'}. Restart the Ollama app, then try again. If it keeps happening, choose a smaller model or a smaller context size in Settings.`
}

function cancelled(): AppError {
  return new AppError('UNKNOWN', CANCELLED)
}

function unreachable(baseUrl: string): AppError {
  return new AppError('OLLAMA_UNREACHABLE', ollamaUnreachableMessage(baseUrl))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * The connection closed after Ollama had the whole request and before the
 * answer was complete: Ollama restarted (an update), crashed, or something in
 * between (a firewall or antivirus) cut a long silent request. Not "can't
 * reach Ollama", which would send the learner to the wrong fix.
 */
class StreamDropped extends Error {}

/**
 * Sends one request and resolves with the response once its headers arrive.
 * A fresh connection per request (no agent), so no pooled-socket timeout
 * applies and aborting closes the connection. Rejects with the raw network
 * error (refused, unknown host), StreamDropped when the connection breaks
 * after the request was delivered, or the signal's reason when aborted.
 */
function send(url: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const { signal } = init
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const target = new URL(url)
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body)
    let req: ClientRequest
    try {
      req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
        method: init.method,
        agent: false,
        headers: payload === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }
      })
    } catch (err) {
      reject(err)
      return
    }
    const onAbort = (): void => {
      req.destroy()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('socket', (socket) => socket.setKeepAlive(true, KEEPALIVE_MS))
    // 'finish': the whole request has been handed to the connection, so the server was reached.
    let delivered = false
    req.on('finish', () => {
      delivered = true
    })
    req.on('response', (res) => {
      signal?.removeEventListener('abort', onAbort)
      resolve(res)
    })
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(delivered ? new StreamDropped(err.message) : err)
    })
    req.end(payload)
  })
}

/** Reads a whole (small) response body as text, up to `limit` characters. */
async function readText(res: IncomingMessage, limit: number, signal?: AbortSignal): Promise<string> {
  res.setEncoding('utf8')
  const onAbort = (): void => {
    res.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  let text = ''
  try {
    if (signal?.aborted) throw signal.reason
    for await (const chunk of res) {
      text += chunk as string
      if (text.length > limit) break
    }
  } catch (err) {
    // Report why the read stopped (cancelled, timed out) rather than the stream's "premature close".
    throw signal?.aborted ? signal.reason : err
  } finally {
    signal?.removeEventListener('abort', onAbort)
    res.destroy()
  }
  if (signal?.aborted) throw signal.reason
  return text
}

interface JsonReply {
  status: number
  json: unknown
  text: string
}

/** One short JSON request with an overall timeout (on top of the caller's signal). Throws raw network errors. */
async function requestJson(
  baseUrl: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal; timeoutMs: number }
): Promise<JsonReply> {
  const timeout = AbortSignal.timeout(init.timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const res = await send(`${baseUrl}${path}`, { method: init.method, body: init.body, signal })
  const text = await readText(res, MAX_JSON_CHARS, signal)
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // Not JSON: the address points at something other than Ollama.
  }
  return { status: res.statusCode ?? 0, json, text }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ollama's error text from a body like {"error": "..."}, or the raw body. */
function errorText(body: string): string {
  try {
    const json: unknown = JSON.parse(body)
    if (isObject(json) && typeof json.error === 'string') return json.error
  } catch {
    // Fall through to the raw text.
  }
  return body
}

// ---------------------------------------------------------------------------
// Installed models
// ---------------------------------------------------------------------------

/**
 * Ollama Cloud models ("gpt-oss:120b-cloud") are listed next to local ones
 * but run on ollama.com: the files would leave the computer, and Ollama's
 * Cloud doesn't support structured outputs. They carry a remote host, or a
 * tag ending in "cloud".
 */
function isCloudModel(entry: Record<string, unknown>, name: string): boolean {
  if (typeof entry.remote_host === 'string' || typeof entry.remote_model === 'string') return true
  const tag = name.lastIndexOf(':') > name.lastIndexOf('/') ? name.slice(name.lastIndexOf(':') + 1) : ''
  return /(^|-)cloud$/i.test(tag)
}

function parseTags(json: unknown): OllamaModelInfo[] | null {
  if (!isObject(json) || !Array.isArray(json.models)) return null
  const byName = new Map<string, OllamaModelInfo>()
  for (const entry of json.models) {
    if (!isObject(entry)) continue
    const rawName = typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.model
    if (typeof rawName !== 'string' || !rawName.trim()) continue
    const name = rawName.trim()
    if (isCloudModel(entry, name)) continue
    const details = isObject(entry.details) ? entry.details : {}
    const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
    byName.set(name, {
      name,
      sizeBytes: typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size > 0 ? entry.size : 0,
      parameterSize: text(details.parameter_size),
      quantization: text(details.quantization_level)
    })
  }
  return [...byName.values()].sort((a, b) => {
    const x = a.name.toLowerCase()
    const y = b.name.toLowerCase()
    return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : 1
  })
}

/**
 * Lists the models installed in the Ollama server at `baseUrl` (already
 * normalized), leaving out cloud models. Never throws: an unreachable server
 * or a bad answer gives ok false and a message saying what to do.
 */
export async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<OllamaModelsResult> {
  let reply: JsonReply
  try {
    reply = await requestJson(baseUrl, '/api/tags', { method: 'GET', signal, timeoutMs: LIST_TIMEOUT_MS })
  } catch {
    if (signal?.aborted) return { ok: false, message: CANCELLED, models: [] }
    return { ok: false, message: ollamaUnreachableMessage(baseUrl), models: [] }
  }
  const models = reply.status === 200 ? parseTags(reply.json) : null
  if (!models) return { ok: false, message: notOllamaMessage(baseUrl), models: [] }
  if (models.length === 0) return { ok: true, message: OLLAMA_NO_MODELS_MESSAGE, models: [] }
  return { ok: true, message: `Found ${models.length} model${models.length === 1 ? '' : 's'} in Ollama.`, models }
}

/** What /api/show tells us about a model; each part is null when this Ollama version doesn't say. */
export interface OllamaModelFacts {
  /** Longest context the model was trained for; Ollama caps num_ctx to it. */
  contextLength: number | null
  /** The model's thinking controls (`thinking.values`): booleans and/or level names. */
  thinkValues: (boolean | string)[] | null
  /** e.g. ["completion", "thinking"]; an embedding-only model lacks "completion". */
  capabilities: string[] | null
}

function parseShow(json: Record<string, unknown>): OllamaModelFacts {
  let contextLength: number | null = null
  const info = json.model_info
  if (isObject(info)) {
    const arch = info['general.architecture']
    const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)
    contextLength = typeof arch === 'string' ? positive(info[`${arch}.context_length`]) : null
    if (contextLength === null) {
      const key = Object.keys(info).find((k) => k.endsWith('.context_length') && positive(info[k]) !== null)
      contextLength = key ? positive(info[key]) : null
    }
  }
  const thinking = json.thinking
  const values = isObject(thinking) && Array.isArray(thinking.values) ? thinking.values : null
  const capabilities = Array.isArray(json.capabilities) ? json.capabilities.filter((c): c is string => typeof c === 'string') : null
  return {
    contextLength,
    thinkValues: values ? values.filter((v): v is boolean | string => typeof v === 'boolean' || typeof v === 'string') : null,
    capabilities
  }
}

/** Facts per server and model for this session: they only change when a model is pulled again. */
const modelFacts = new Map<string, OllamaModelFacts>()

/** Forgets what /api/show said (tests; a fresh connection test refreshes one model). */
export function forgetOllamaModelFacts(): void {
  modelFacts.clear()
}

/**
 * Asks /api/show about a model. A missing model -> NO_AI_MODEL, a server
 * that can't be reached -> OLLAMA_UNREACHABLE. Anything else (an old Ollama,
 * a slow disk) gives null and the caller carries on with safe defaults.
 */
export async function inspectOllamaModel(
  target: { baseUrl: string; model: string },
  signal?: AbortSignal,
  refresh = false
): Promise<OllamaModelFacts | null> {
  const key = `${target.baseUrl}\n${canonicalModelName(target.model)}`
  const cached = modelFacts.get(key)
  if (cached && !refresh) return cached
  let reply: JsonReply
  try {
    reply = await requestJson(target.baseUrl, '/api/show', { method: 'POST', body: { model: target.model }, signal, timeoutMs: SHOW_TIMEOUT_MS })
  } catch (err) {
    if (signal?.aborted) throw cancelled()
    if (err instanceof DOMException && err.name === 'TimeoutError') return null
    throw unreachable(target.baseUrl)
  }
  if (reply.status === 404 && isObject(reply.json) && typeof reply.json.error === 'string') {
    throw new AppError('NO_AI_MODEL', notInstalledMessage(target.model))
  }
  if (reply.status !== 200 || !isObject(reply.json)) return null
  const facts = parseShow(reply.json)
  modelFacts.set(key, facts)
  return facts
}

// ---------------------------------------------------------------------------
// Context budget
// ---------------------------------------------------------------------------
//
// One call must fit inside num_ctx: system prompt + course files + the task
// instruction (+ the JSON outline and, on a retry, the retry note) + the
// answer. Ollama counts tokens with the model's own tokenizer, which the app
// can't run, so sizes are estimated from characters, conservatively:
// - course files at 3 characters per token (English prose is about 4 with
//   current tokenizers; code, maths, slide fragments and PDF extraction noise
//   come out denser),
// - the app's own English instructions at 3.5 characters per token.
//
// Budget for files = (num_ctx - largest answer - prompt reserve) * 3 chars:
// - largest answer = the lesson's num_predict cap: 3/8 of num_ctx, at most
//   8,192 tokens (a compact lesson is about 3,000 tokens of JSON),
// - prompt reserve = 3,584 tokens: the system prompt (~4,100 chars, ~1,200
//   tokens), the longest usual instruction with its JSON outline (~6,700
//   chars with a long topic list, ~1,900 tokens), the retry note (~120) and
//   ~350 for the chat template and the per-file wrappers.
//
//   num_ctx   answer   files (tokens)   files (chars)
//     8,192    3,072            1,536           4,608
//    16,384    6,144            6,656          19,968
//    32,768    8,192           20,992          62,976
//    65,536    8,192           53,760         161,280
//   131,072    8,192          119,296         357,888
//
// Every call also checks its real prompt before sending (an unusually long
// instruction, such as a long explanation to grade, can still overflow) and
// shrinks num_predict to the room that is left.
//
// The characters-per-token rates are for ASCII text (English, code). Text in
// other scripts takes more tokens per character, so `estimateTokens` counts
// accented Latin, Greek, Cyrillic, Hebrew and Arabic letters at 2 per token
// and everything else (Chinese, Japanese, Korean, other scripts, symbols,
// emoji) at about one token each. The file budget is in characters of ASCII;
// `ollamaSourceChars` converts other text into the same unit, so the source
// selection can pick less of it (services/topicSources.ts).

const FILE_CHARS_PER_TOKEN = 3
const PROMPT_CHARS_PER_TOKEN = 3.5
const MAX_ANSWER_TOKENS = 8_192
const PROMPT_RESERVE_TOKENS = 3_584
/** Chat template tokens around the two messages. */
const TEMPLATE_TOKENS = 64
/** A model that can't turn thinking off spends tokens on it before the answer; they count toward num_predict. */
const THINKING_ALLOWANCE_TOKENS = 2_048

/** The largest answer (num_predict) planned for at a context size: the lesson's. */
export function ollamaAnswerTokens(contextTokens: number): number {
  return Math.min(MAX_ANSWER_TOKENS, Math.floor((contextTokens * 3) / 8))
}

/** Characters of course files one call may carry so the prompt and the largest answer fit inside num_ctx. */
export function ollamaSourceCharBudget(contextTokens: number): number {
  const fileTokens = contextTokens - ollamaAnswerTokens(contextTokens) - PROMPT_RESERVE_TOKENS
  return Math.max(0, fileTokens) * FILE_CHARS_PER_TOKEN
}

/** A quiz question is about 250-350 tokens of JSON (more with code); the array and keys add a little. */
const QUESTION_TOKENS = 360
const CARD_TOKENS = 160
const LIST_OVERHEAD_TOKENS = 256
/** Small models get sloppier the longer the JSON array, so even a big context writes at most this many per call. */
const MAX_QUESTIONS_PER_CALL = 10

/** How many quiz questions one call asks a local model for; a bigger quiz is written in several calls. */
export function ollamaQuestionsPerCall(contextTokens: number): number {
  const fit = Math.floor((ollamaAnswerTokens(contextTokens) - LIST_OVERHEAD_TOKENS) / QUESTION_TOKENS)
  return Math.max(3, Math.min(MAX_QUESTIONS_PER_CALL, fit))
}

/** [num_predict wanted, the least worth sending] for a task's answer. */
export function ollamaOutputTokens(task: AiTask, itemCount = 1): readonly [number, number] {
  const items = Math.max(1, itemCount)
  switch (task) {
    case 'lesson':
      return [MAX_ANSWER_TOKENS, 2_048]
    case 'quiz':
      return [items * QUESTION_TOKENS + LIST_OVERHEAD_TOKENS, items * 200 + 128]
    case 'flashcards':
      return [items * CARD_TOKENS + LIST_OVERHEAD_TOKENS, items * 60 + 128]
    case 'syllabus':
      return [4_096, 1_024]
    case 'summary':
      return [3_072, 768]
    case 'explanation':
      return [1_536, 512]
  }
}

/** Estimated tokens in `text`, with ASCII at `asciiCharsPerToken` (see the notes above). */
export function estimateTokens(text: string, asciiCharsPerToken = FILE_CHARS_PER_TOKEN): number {
  let ascii = 0
  let alphabetic = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) ascii++
    else if (code < 0x700) alphabetic++
    // Each half of a surrogate pair counts: an emoji or a rare Chinese character is often two tokens.
    else other++
  }
  return ascii / asciiCharsPerToken + alphabetic / 2 + other
}

/** The size of course file text in the unit the file budget is counted in: characters of ASCII text. */
export function ollamaSourceChars(text: string): number {
  return Math.ceil(estimateTokens(text) * FILE_CHARS_PER_TOKEN)
}

function promptTokens(ownText: string, documents: string): number {
  return Math.ceil(estimateTokens(ownText, PROMPT_CHARS_PER_TOKEN)) + Math.ceil(estimateTokens(documents)) + TEMPLATE_TOKENS
}

/**
 * The longest wait for the first token: loading the model (Ollama itself
 * gives up on a load that stalls for 5 minutes) plus reading the prompt at a
 * slow CPU-only laptop's pace, about 10 tokens a second. Without a limit, a
 * server that takes the request and never answers would hold the job until
 * the app restarts, since the same job can't be started twice.
 */
const FIRST_TOKEN_BASE_MS = 10 * 60 * 1000
const FIRST_TOKEN_MS_PER_PROMPT_TOKEN = 100

export function ollamaFirstTokenTimeoutMs(promptTokenCount: number): number {
  return FIRST_TOKEN_BASE_MS + promptTokenCount * FIRST_TOKEN_MS_PER_PROMPT_TOKEN
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/**
 * Temperature per task. Ollama's structured outputs guide recommends a low
 * temperature (e.g. 0) for reliable JSON. Reading a syllabus and grading an
 * explanation have one right answer, so they use 0. Tasks that write long
 * teaching text use a little more: pure greedy decoding makes small models
 * repeat themselves in long answers, and a retry or a second quiz on the
 * same files shouldn't come out word for word the same.
 */
export const OLLAMA_TEMPERATURE: Record<AiTask, number> = {
  syllabus: 0,
  explanation: 0,
  summary: 0.2,
  lesson: 0.3,
  quiz: 0.3,
  flashcards: 0.3
}

/**
 * The `think` value to send. Thinking tokens share num_predict and num_ctx
 * with the answer and are slow on a laptop, and the JSON schema already
 * shapes the answer, so thinking is turned off where the model allows it.
 * Per Ollama's thinking guide, `false` asks for no thinking "if the model
 * permits it" and is safe for models that can't think at all (only `true`
 * is an error there). When /api/show lists the model's controls and `false`
 * isn't one of them (gpt-oss only has levels), the lowest level is used, or
 * the field is left out so the model uses its default.
 */
export function chooseThink(facts: OllamaModelFacts | null): boolean | 'low' | undefined {
  const values = facts?.thinkValues
  if (!values || values.length === 0 || values.includes(false)) return false
  if (values.includes('low')) return 'low'
  return undefined
}

export interface OllamaChatBody {
  model: string
  messages: { role: 'system' | 'user'; content: string }[]
  stream: true
  format: JsonSchema
  think?: boolean | string
  options: { num_ctx: number; num_predict: number; temperature: number }
}

/**
 * The user message: course files first, then the task instruction, then the
 * JSON outline (the structured outputs guide recommends also giving the
 * schema in the prompt), then any retry note. The system prompt and the
 * files form a stable prefix, so Ollama can reuse its cached prompt for a
 * retry or the next call on the same files.
 */
export function ollamaUserContent(documents: string, instruction: string, schema: JsonSchema, note = ''): string {
  const outline = `Answer with one JSON object in exactly this shape (every key is required):\n${jsonOutline(schema)}`
  return [documents, instruction, outline].filter(Boolean).join('\n\n') + note
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Splits a newline-delimited JSON stream into parsed objects. Network chunks
 * can end mid-line or carry several lines; `end()` parses a final line that
 * has no newline. Throws SyntaxError for a line that isn't JSON.
 */
export class NdjsonLines {
  private buffer = ''

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    return lines.flatMap(parseLine)
  }

  end(): unknown[] {
    const rest = this.buffer
    this.buffer = ''
    return parseLine(rest)
  }
}

function parseLine(line: string): unknown[] {
  const trimmed = line.trim()
  return trimmed ? [JSON.parse(trimmed)] : []
}

/** A non-200 reply or an {"error": ...} line in the stream, before it is mapped to an AppError. */
class OllamaReplyError extends Error {
  constructor(
    readonly status: number | null,
    readonly text: string
  ) {
    super(text)
    this.name = 'OllamaReplyError'
  }
}

interface ChatOutcome {
  text: string
  doneReason: string | null
  /** Tokens generated, thinking included. */
  evalCount: number | null
}

class StreamStalled extends Error {}
class StreamUnreadable extends Error {}

class FirstTokenTimeout extends Error {
  constructor(readonly ms: number) {
    super(`No answer within ${ms} ms`)
  }
}

/** Streams one /api/chat request, feeding answer text and thinking into the tracker. */
async function streamChat(
  target: OllamaTarget,
  body: OllamaChatBody,
  tracker: ProgressTracker,
  slowStartMessage: string,
  firstTokenMs: number,
  signal: AbortSignal | undefined
): Promise<ChatOutcome> {
  let started = false
  const slowStart = setTimeout(() => {
    if (!started) tracker.status(slowStartMessage)
  }, SLOW_START_MS)
  let res: IncomingMessage | null = null
  let idle: NodeJS.Timeout | undefined
  let stalled = false
  // Until the first chunk arrives, the deadline closes the connection like a cancel would.
  let timedOut = false
  const deadline = new AbortController()
  const firstToken = setTimeout(() => {
    timedOut = true
    deadline.abort()
    res?.destroy()
  }, firstTokenMs)
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const onAbort = (): void => {
    res?.destroy()
  }
  try {
    try {
      res = await send(`${target.baseUrl}/api/chat`, { method: 'POST', body, signal: requestSignal })
      if (res.statusCode !== 200) throw new OllamaReplyError(res.statusCode ?? 0, errorText(await readText(res, MAX_ERROR_CHARS, requestSignal)))
    } catch (err) {
      if (timedOut && !signal?.aborted) throw new FirstTokenTimeout(firstTokenMs)
      throw err
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // Cancelled between the headers and here: the listener above won't fire for it.
    if (signal?.aborted) throw signal.reason
    res.setEncoding('utf8')

    const lines = new NdjsonLines()
    let text = ''
    let done: Record<string, unknown> | null = null
    const handle = (line: unknown): void => {
      if (!isObject(line)) throw new StreamUnreadable()
      if (typeof line.error === 'string') throw new OllamaReplyError(null, line.error)
      const message = isObject(line.message) ? line.message : {}
      if (typeof message.thinking === 'string' && message.thinking) tracker.thinking()
      if (typeof message.content === 'string' && message.content) {
        text += message.content
        tracker.addText(message.content)
      }
      if (line.done === true) done = line
    }
    const idleMs = target.idleTimeoutMs ?? IDLE_TIMEOUT_MS
    const response = res
    try {
      for await (const chunk of response) {
        if (!started) {
          started = true
          clearTimeout(firstToken)
        }
        clearTimeout(idle)
        idle = setTimeout(() => {
          stalled = true
          response.destroy()
        }, idleMs)
        for (const line of lines.push(chunk as string)) handle(line)
      }
      for (const line of lines.end()) handle(line)
    } catch (err) {
      if (err instanceof OllamaReplyError || err instanceof StreamUnreadable) throw err
      if (err instanceof SyntaxError) throw new StreamUnreadable()
      if (signal?.aborted) throw signal.reason
      if (timedOut) throw new FirstTokenTimeout(firstTokenMs)
      throw stalled ? new StreamStalled() : new StreamDropped()
    }
    if (signal?.aborted) throw signal.reason
    const final = done as Record<string, unknown> | null
    if (!final) throw stalled ? new StreamStalled() : new StreamDropped()
    return {
      text,
      doneReason: typeof final.done_reason === 'string' ? final.done_reason : null,
      evalCount: typeof final.eval_count === 'number' ? final.eval_count : null
    }
  } finally {
    clearTimeout(slowStart)
    clearTimeout(firstToken)
    clearTimeout(idle)
    signal?.removeEventListener('abort', onAbort)
    res?.destroy()
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const MEMORY_ERROR =
  /out of memory|insufficient memory|not enough memory|more system memory|requires more .*memory|unable to allocate|failed to allocate|cudamalloc|memory allocation|resource limitations/i
const NOT_CHAT_ERROR = /does not support (chat|generate|completion)/i
const NOT_FOUND_ERROR = /model ['"]?[^'"]*['"]? not found|try pulling it first/i

/** Ollama's own words, tidied for a sentence: ": <text>." or "." when there are none. */
function detail(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!clean) return '.'
  return `: ${clean}${/[.!?]$/.test(clean) ? '' : '.'}`
}

/** Maps an Ollama error (HTTP status, or null for an error line inside the stream) to an AppError. */
export function ollamaFailure(status: number | null, text: string, target: { baseUrl: string; model: string }): AppError {
  if (status === 404 || (status === null && NOT_FOUND_ERROR.test(text))) {
    // Ollama's 404 is JSON naming the model; an HTML 404 page means the address isn't Ollama.
    if (text.trim().startsWith('<')) return new AppError('OLLAMA_UNREACHABLE', notOllamaMessage(target.baseUrl))
    return new AppError('NO_AI_MODEL', notInstalledMessage(target.model))
  }
  // Fixed in Settings (a smaller model or context size), like a missing model: the learner sees this advice and a Settings button.
  if (MEMORY_ERROR.test(text)) return new AppError('NO_AI_MODEL', memoryMessage(target.model))
  if (NOT_CHAT_ERROR.test(text)) return new AppError('NO_AI_MODEL', notChatModelMessage(target.model))
  if (status === 429 || status === 503) return new AppError('RATE_LIMITED', 'Ollama is busy with other requests right now. Try again in a minute.')
  if (status === 401 || status === 403) return new AppError('AI_UNAVAILABLE', `Ollama refused to run ${target.model}${detail(text)}`)
  if (status === 400) return new AppError('AI_BAD_OUTPUT', `Ollama rejected the request${detail(text)}`)
  if (status !== null && status < 500) return new AppError('UNKNOWN', `Ollama returned an error (${status})${detail(text)}`)
  return new AppError('AI_UNAVAILABLE', `Ollama ran into a problem running ${target.model}${detail(text)} Try again, or choose a smaller model in Settings.`)
}

/** Anything thrown while talking to Ollama -> AppError. */
function mapOllamaError(err: unknown, target: OllamaTarget, signal: AbortSignal | undefined): AppError {
  if (err instanceof AppError) return err
  if (signal?.aborted) return cancelled()
  if (err instanceof OllamaReplyError) return ollamaFailure(err.status, err.text, target)
  if (err instanceof StreamDropped) {
    return new AppError(
      'OLLAMA_UNREACHABLE',
      'The connection to Ollama closed before the answer was finished. Make sure the Ollama app is still running, then try again.'
    )
  }
  if (err instanceof FirstTokenTimeout) return new AppError('OLLAMA_UNREACHABLE', firstTokenTimeoutMessage(err.ms))
  if (err instanceof StreamStalled) return new AppError('AI_UNAVAILABLE', 'Ollama stopped sending the answer partway through. Try again, or restart the Ollama app.')
  if (err instanceof StreamUnreadable) {
    return new AppError('AI_UNAVAILABLE', "Ollama sent an answer Study Notebook couldn't read. Make sure the address in Settings points to Ollama, then try again.")
  }
  // The request never reached Ollama: refused, unknown host, unreachable network.
  return unreachable(target.baseUrl)
}

// ---------------------------------------------------------------------------
// Running a structured call
// ---------------------------------------------------------------------------

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new OutputError('The answer was empty.')
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new OutputError('The answer was not valid JSON.')
  }
}

/**
 * Streams one structured request to Ollama and returns the validated result,
 * with the same contract as the Claude transport's runStructured: progress
 * through a ProgressTracker, invalid output -> one retry with the reason
 * appended, then AI_BAD_OUTPUT; options.signal cancels (and closes the
 * connection). An answer cut off by the context window is not retried (the
 * same prompt can't get more room); one cut off by its num_predict cap gets
 * the single retry, asking for a shorter answer.
 */
export async function runOllamaStructured<T>(target: OllamaTarget, call: OllamaCall<T>, options: CallOptions = {}): Promise<T> {
  const { signal } = options
  if (signal?.aborted) throw cancelled()
  const tracker = new ProgressTracker(call.task, call.progress, options.onProgress)
  tracker.start()

  const facts = await inspectOllamaModel(target, signal)
  if (facts?.capabilities && facts.capabilities.length > 0 && !facts.capabilities.includes('completion')) {
    throw new AppError('NO_AI_MODEL', notChatModelMessage(target.model))
  }
  // Ollama caps num_ctx at the model's own limit, so plan with what it will really use.
  const contextTokens = facts?.contextLength ? Math.min(target.contextTokens, facts.contextLength) : target.contextTokens
  const documents = documentsText(call.sources)
  const [wanted, least] = ollamaOutputTokens(call.task, call.itemCount)
  let think = chooseThink(facts)
  let note = ''
  let retried = false

  for (;;) {
    const content = ollamaUserContent(documents, call.instruction, call.schema, note)
    const prompt = promptTokens(SYSTEM_PROMPT + content.slice(documents.length), documents)
    const room = contextTokens - prompt
    const want = wanted + (think === false ? 0 : THINKING_ALLOWANCE_TOKENS)
    const numPredict = Math.min(want, room)
    if (numPredict < least) {
      const limit = facts?.contextLength
      throw new AppError(
        'SOURCE_TOO_LARGE',
        limit && limit < target.contextTokens
          ? modelLimitMessage(target.model, limit)
          : `Your files and this request leave the model no room to answer within a context size of ${formatTokens(contextTokens)} tokens. Choose a larger context size in Settings, or pick fewer files for this topic.`
      )
    }
    const body: OllamaChatBody = {
      model: target.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content }
      ],
      stream: true,
      format: call.schema,
      ...(think === undefined ? {} : { think }),
      options: { num_ctx: contextTokens, num_predict: numPredict, temperature: OLLAMA_TEMPERATURE[call.task] }
    }

    let outcome: ChatOutcome
    try {
      outcome = await streamChat(
        target,
        body,
        tracker,
        `${call.progress.startMessage}: a local model can take a few minutes to start`,
        target.firstTokenTimeoutMs ?? ollamaFirstTokenTimeoutMs(prompt),
        signal
      )
    } catch (err) {
      // An Ollama version that rejects this think value: the request without it is otherwise identical.
      if (err instanceof OllamaReplyError && err.status === 400 && think !== undefined && /think/i.test(err.text)) {
        think = undefined
        continue
      }
      throw mapOllamaError(err, target, signal)
    }

    if (outcome.doneReason === 'unload') {
      throw new AppError('AI_UNAVAILABLE', 'Ollama unloaded the model before the answer was finished. Try again.')
    }
    if (outcome.doneReason === 'length') {
      try {
        // Cut off exactly at the end of a complete answer: nothing is missing.
        return call.validate(JSON.parse(outcome.text))
      } catch {
        // Incomplete, as expected.
      }
      // num_predict never exceeds the room the prompt leaves, so an answer that reached it was stopped by
      // that cap (whether it was the task's own or shrunk to the room), and one that stopped short of it
      // ran into the end of the context window.
      const hitCap = outcome.evalCount === null || outcome.evalCount >= numPredict
      if (!hitCap) {
        throw new AppError(
          'SOURCE_TOO_LARGE',
          "The answer didn't fit in the model's context window. Choose a larger context size in Settings, or pick fewer files for this topic."
        )
      }
      if (retried) {
        // Even the shorter answer didn't fit. With less room than the task asks for, the files crowd it out.
        if (numPredict < want) {
          throw new AppError(
            'SOURCE_TOO_LARGE',
            "The answer didn't fit next to your files in the model's context window. Choose a larger context size in Settings, or pick fewer files for this topic."
          )
        }
        throw new AppError('AI_BAD_OUTPUT', 'The answer was too long to finish, even when asked to keep it shorter. Try again, or choose another model in Settings.')
      }
      retried = true
      note = retryNote('It was too long and got cut off before the JSON was complete. Keep every field shorter so the whole answer fits.')
      tracker.restart('Too long: writing a shorter answer')
      continue
    }

    try {
      return call.validate(parseJson(outcome.text))
    } catch (err) {
      if (!(err instanceof OutputError)) throw err
      if (retried) throw new AppError('AI_BAD_OUTPUT', `The AI's answer was not usable: ${err.message}`)
      retried = true
      note = retryNote(err.message)
      tracker.restart('Tidying up the answer: trying once more')
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

/**
 * Settings' "Test connection" for Ollama: the server answers, a model is
 * chosen, it is installed, it can chat, and (when /api/show says) the chosen
 * context size is within the model's own limit. Never throws.
 */
export async function testOllamaConnection(
  config: { baseUrl: string; model: string | null; contextTokens: number },
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string }> {
  try {
    const list = await fetchOllamaModels(config.baseUrl, signal)
    if (!list.ok || list.models.length === 0) return { ok: false, message: list.message }
    const model = config.model
    if (!model) return { ok: false, message: ERROR_MESSAGES.NO_AI_MODEL }
    if (!list.models.some((m) => sameOllamaModel(m.name, model))) return { ok: false, message: notInstalledMessage(model) }

    const facts = await inspectOllamaModel({ baseUrl: config.baseUrl, model }, signal, true)
    if (facts?.capabilities && facts.capabilities.length > 0 && !facts.capabilities.includes('completion')) {
      return { ok: false, message: notChatModelMessage(model) }
    }
    const limit = facts?.contextLength
    if (limit && limit < config.contextTokens) {
      const fit = largestContextSizeWithin(limit)
      if (fit === null) return { ok: false, message: modelLimitMessage(model, limit) }
      return {
        ok: true,
        message: `Connected. ${model} is ready to use, but it can read at most ${formatTokens(limit)} tokens at once. Choose a context size of ${formatTokens(fit)} or less in Settings so your files fit.`
      }
    }
    return { ok: true, message: `Connected. ${model} is ready to use.` }
  } catch (err) {
    return { ok: false, message: err instanceof AppError ? err.message : ERROR_MESSAGES.UNKNOWN }
  }
}
