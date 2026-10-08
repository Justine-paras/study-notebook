// Test double for Ollama (used by the *.test.ts files only): a real HTTP
// server on 127.0.0.1 (port 0) that answers /api/tags, /api/show and
// /api/chat from scripts and records every request, so the transport is
// tested over a real socket with real chunking. No network is used.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OllamaChatBody } from './ollama'

export interface ChatScript {
  /** HTTP status; anything but 200 sends `chunks` joined as the body. */
  status?: number
  /** Body pieces, written one at a time with a pause so they reach the client as separate chunks. */
  chunks?: (string | Buffer)[]
  /** Keep the connection open after the chunks (abort and stall tests). */
  hang?: boolean
  /** Destroy the connection after the chunks (Ollama quit mid-answer). */
  drop?: boolean
}

export interface RecordedOllamaRequest {
  method: string
  path: string
  body: unknown
}

export interface JsonScript {
  status: number
  body: unknown
}

/** A qwen3-like model: chats, can think, trained for 40,960 tokens. */
export const DEFAULT_SHOW = {
  details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M' },
  model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40_960 },
  capabilities: ['completion', 'thinking']
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class FakeOllama {
  readonly requests: RecordedOllamaRequest[] = []
  tags: JsonScript = { status: 200, body: { models: [] } }
  show: (model: string) => JsonScript = () => ({ status: 200, body: DEFAULT_SHOW })
  readonly chats: ChatScript[] = []
  /** Chat connections that have closed, finished or not. */
  closedChats = 0
  /** Resolves each time a chat connection closes. */
  private closeWaiters: (() => void)[] = []

  private constructor(
    private readonly server: Server,
    readonly url: string
  ) {}

  static async start(): Promise<FakeOllama> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const fake = new FakeOllama(server, `http://127.0.0.1:${port}`)
    server.on('request', (req, res) => void fake.handle(req, res))
    return fake
  }

  /** Requests to one path, in order. */
  sent(path: string): RecordedOllamaRequest[] {
    return this.requests.filter((r) => r.path === path)
  }

  /** The bodies of /api/chat requests. */
  chatBodies(): OllamaChatBody[] {
    return this.sent('/api/chat').map((r) => r.body as OllamaChatBody)
  }

  waitForClosedChat(): Promise<void> {
    return new Promise((resolve) => this.closeWaiters.push(resolve))
  }

  async close(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    const path = req.url ?? ''
    let body: unknown = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }
    this.requests.push({ method: req.method ?? '', path, body })

    if (path === '/api/tags') return this.json(res, this.tags)
    if (path === '/api/show') return this.json(res, this.show(String((body as { model?: unknown })?.model)))
    if (path !== '/api/chat') return this.json(res, { status: 404, body: '404 page not found' })

    res.on('close', () => {
      this.closedChats++
      for (const resolve of this.closeWaiters.splice(0)) resolve()
    })
    const script = this.chats.shift()
    if (!script) return this.json(res, { status: 500, body: { error: 'FakeOllama: no scripted chat left' } })
    const status = script.status ?? 200
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end((script.chunks ?? []).join(''))
      return
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    for (const chunk of script.chunks ?? []) {
      if (res.destroyed) return
      res.write(chunk)
      await pause(5)
    }
    if (script.drop) {
      res.socket?.destroy()
      return
    }
    if (!script.hang) res.end()
  }

  private json(res: ServerResponse, script: JsonScript): void {
    res.writeHead(script.status, { 'content-type': typeof script.body === 'string' ? 'text/plain' : 'application/json' })
    res.end(typeof script.body === 'string' ? script.body : JSON.stringify(script.body))
  }
}

/** A port nothing listens on (a server that was started and closed again). */
export async function closedPortUrl(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${port}`
}

export interface StreamOptions {
  /** Thinking text streamed before the answer. */
  thinking?: string
  /** How many pieces the answer is streamed in (one NDJSON line each). */
  pieces?: number
  doneReason?: string
  evalCount?: number
}

/** The NDJSON lines Ollama streams for an answer: content pieces, then the final "done" line. */
export function chatLines(content: string, options: StreamOptions = {}): string[] {
  const line = (value: Record<string, unknown>): string => `${JSON.stringify({ model: 'qwen3:8b', created_at: '2026-10-08T12:00:00Z', ...value })}\n`
  const lines: string[] = []
  if (options.thinking) {
    for (const piece of split(options.thinking, 3)) lines.push(line({ message: { role: 'assistant', content: '', thinking: piece }, done: false }))
  }
  for (const piece of split(content, options.pieces ?? 4)) lines.push(line({ message: { role: 'assistant', content: piece }, done: false }))
  lines.push(
    line({
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: options.doneReason ?? 'stop',
      total_duration: 1_000_000,
      prompt_eval_count: 1_000,
      eval_count: options.evalCount ?? 200
    })
  )
  return lines
}

/** A complete scripted chat answer. */
export function answer(content: string, options: StreamOptions = {}): ChatScript {
  return { chunks: chatLines(content, options) }
}

function split(text: string, pieces: number): string[] {
  if (!text) return []
  const size = Math.max(1, Math.ceil(text.length / Math.max(1, pieces)))
  const result: string[] = []
  for (let i = 0; i < text.length; i += size) result.push(text.slice(i, i + size))
  return result
}

/** Cuts a string into chunks of `size` characters, ignoring line boundaries. */
export function rechunk(text: string, size: number): string[] {
  const result: string[] = []
  for (let i = 0; i < text.length; i += size) result.push(text.slice(i, i + size))
  return result
}
