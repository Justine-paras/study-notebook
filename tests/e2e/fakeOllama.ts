// A stand-in for Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md)
// for end-to-end tests: two installed models, /api/show, and /api/chat
// answering any structured-output schema with valid JSON, streamed as NDJSON
// the way Ollama streams it. Every request is recorded so a test can check
// what the app sent.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  path: string
  /** The parsed JSON body, or null when there was none. */
  body: Record<string, unknown> | null
}

export interface FakeOllama {
  /** e.g. "http://127.0.0.1:53123" */
  url: string
  requests: RecordedRequest[]
  /** The recorded POST /api/chat bodies, oldest first. */
  chats(): Record<string, unknown>[]
  close(): Promise<void>
}

/** What `GET /api/tags` lists, with the field names Ollama uses. */
export const FAKE_MODELS = [
  {
    name: 'qwen3:8b',
    model: 'qwen3:8b',
    modified_at: '2026-09-01T10:00:00.000000000+02:00',
    size: 5_225_387_923,
    digest: '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41',
    details: { parent_model: '', format: 'gguf', family: 'qwen3', families: ['qwen3'], parameter_size: '8.2B', quantization_level: 'Q4_K_M' }
  },
  {
    name: 'llama3.2:3b',
    model: 'llama3.2:3b',
    modified_at: '2026-08-14T17:37:44.706015396-07:00',
    size: 2_019_393_189,
    digest: 'a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72',
    details: { parent_model: '', format: 'gguf', family: 'llama', families: ['llama'], parameter_size: '3.2B', quantization_level: 'Q4_K_M' }
  }
] as const

/** Part of every summary the fake writes, so a test can find it on screen. */
export const FAKE_SUMMARY_MARK = 'Written by the fake Ollama model.'

// Strings for properties a test may look for; everything else gets a generic sentence.
const TEXT: Record<string, string> = {
  title: 'Stacks and queues in brief',
  summary: `## Stacks and queues\n\n- A stack is last in, first out: push and pop work on the top.\n- A queue is first in, first out.\n\n${FAKE_SUMMARY_MARK}`
}

type Schema = { [key: string]: unknown }

/**
 * A value that matches `schema` (the JSON Schema subset the app sends as
 * `format`). Questions get distinct options with the answer copied from
 * them, so lesson and quiz schemas validate too.
 */
export function sampleFor(schema: Schema, key = ''): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (Array.isArray(schema.anyOf)) {
    const choices = schema.anyOf as Schema[]
    return sampleFor(choices.find((s) => s.type !== 'null') ?? choices[0]!, key)
  }
  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Schema>
      const value: Record<string, unknown> = {}
      for (const [name, child] of Object.entries(properties)) value[name] = sampleFor(child, name)
      if (Array.isArray(value.options) && 'answer' in value) {
        value.options = ['A stack', 'A queue', 'A heap']
        value.answer = 'A stack'
        if ('acceptable' in value) value.acceptable = []
      }
      return value
    }
    case 'array':
      return [1, 2, 3].map((n) => sampleFor((schema.items ?? {}) as Schema, `${key} ${n}`))
    case 'integer':
    case 'number':
      return key === 'score' ? 70 : key === 'estMinutes' ? 15 : 1
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return TEXT[key] ?? `A short note about ${key || 'this'} from the fake model.`
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { unparsed: text }
  }
}

function findModel(name: unknown) {
  return FAKE_MODELS.find((m) => m.name === name || (typeof name === 'string' && `${name}:latest` === m.name))
}

function chat(res: ServerResponse, body: Record<string, unknown>): void {
  const model = String(body.model ?? '')
  if (!findModel(model)) {
    send(res, 404, { error: `model '${model}' not found` })
    return
  }
  const format = body.format
  const answer =
    format && typeof format === 'object'
      ? JSON.stringify(sampleFor(format as Schema))
      : format === 'json'
        ? JSON.stringify({ answer: 'ok' })
        : 'Hello from the fake Ollama model.'
  const createdAt = new Date().toISOString()
  const final = {
    model,
    created_at: createdAt,
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    total_duration: 4_883_583_458,
    load_duration: 1_334_875,
    prompt_eval_count: 812,
    prompt_eval_duration: 342_546_000,
    eval_count: 282,
    eval_duration: 4_535_599_000
  }

  // Ollama streams unless stream is false.
  if (body.stream === false) {
    send(res, 200, { ...final, message: { role: 'assistant', content: answer } })
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`)
  // Thinking models (qwen3) think first unless asked not to: the thoughts come in message.thinking, never in content.
  if (body.think !== false) {
    line({ model, created_at: createdAt, message: { role: 'assistant', content: '', thinking: 'Reading the file first.' }, done: false })
  }
  const size = Math.max(1, Math.ceil(answer.length / 6))
  for (let i = 0; i < answer.length; i += size) {
    line({ model, created_at: createdAt, message: { role: 'assistant', content: answer.slice(i, i + size) }, done: false })
  }
  line(final)
  res.end()
}

async function handle(req: IncomingMessage, res: ServerResponse, requests: RecordedRequest[]): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]!
  const body = await readBody(req)
  requests.push({ method: req.method ?? 'GET', path, body })

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Ollama is running')
  } else if (req.method === 'GET' && path === '/api/version') {
    send(res, 200, { version: '0.12.3' })
  } else if (req.method === 'GET' && path === '/api/tags') {
    send(res, 200, { models: FAKE_MODELS })
  } else if (req.method === 'GET' && path === '/api/ps') {
    send(res, 200, { models: [] })
  } else if (req.method === 'POST' && path === '/api/show') {
    const model = findModel(body?.model ?? body?.name)
    if (!model) send(res, 404, { error: `model '${String(body?.model ?? '')}' not found` })
    else {
      send(res, 200, {
        modelfile: `FROM ${model.name}`,
        parameters: 'temperature 0.6',
        template: '{{ .Prompt }}',
        details: model.details,
        model_info: { 'general.architecture': model.details.family, [`${model.details.family}.context_length`]: 40_960 },
        capabilities: ['completion', 'tools', 'thinking'],
        modified_at: model.modified_at
      })
    }
  } else if (req.method === 'POST' && path === '/api/chat') {
    chat(res, body ?? {})
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 page not found')
  }
}

/** Starts the fake on 127.0.0.1 at a free port. */
export async function startFakeOllama(): Promise<FakeOllama> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    handle(req, res, requests).catch((err: unknown) => send(res, 500, { error: String(err) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    chats: () => requests.filter((r) => r.method === 'POST' && r.path === '/api/chat').map((r) => r.body ?? {}),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** A port on 127.0.0.1 that nothing listens on (taken, then released). */
export async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}
