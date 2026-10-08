// The real SDK client over a fake `fetch`: checks what actually goes over the
// wire (URL, headers, JSON body) and that real SSE streams, mid-stream errors
// and HTTP errors come back as the app expects. No network is used.

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { AiModelId } from '@shared/types'
import type { AiClient } from './client'
import { StudyAi, type AiSourceDoc } from './index'
import { SUMMARY_JSON_SCHEMA } from './schemas'

interface Captured {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

type Reply = () => Response

function sse(events: Record<string, unknown>[], options: { failAfter?: number } = {}): Response {
  const encoder = new TextEncoder()
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfter !== undefined && sent === options.failAfter) {
        controller.error(new TypeError('terminated'))
        return
      }
      const event = events[sent++]
      if (!event) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`))
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } })
}

function jsonError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' }
  })
}

/** A complete streamed answer: a thinking block (empty text, as Opus 5.5 sends by default), then the JSON text. */
function answer(json: string, model: AiModelId = 'claude-opus-5-5', stopReason = 'end_turn'): Record<string, unknown>[] {
  const half = Math.floor(json.length / 2)
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: json.slice(0, half) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: json.slice(half) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, stop_details: null }, usage: { output_tokens: 300 } },
    { type: 'message_stop' }
  ]
}

function sdkWith(replies: Reply[]): { client: Anthropic; captured: Captured[] } {
  const captured: Captured[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>
    })
    const reply = replies.shift()
    if (!reply) throw new Error('no scripted reply left')
    return reply()
  }
  return { client: new Anthropic({ apiKey: 'sk-ant-test-key', fetch, maxRetries: 0 }), captured }
}

class WireStudyAi extends StudyAi {
  constructor(
    private readonly sdk: Anthropic,
    model: AiModelId
  ) {
    super(() => ({ apiKey: 'sk-ant-test-key', model, demo: false }))
  }

  protected override clientFor(): AiClient {
    return this.sdk
  }
}

const source: AiSourceDoc = { name: 'Lecture 3.pdf', kind: 'lecture', text: '[Page 1]\nA queue is first-in, first-out.' }
const summaryJson = JSON.stringify({ title: 'Summary: Queues', summary: '## Key ideas\n- FIFO' })

describe('on the wire', () => {
  it('sends the beta as a header (not in the body), streams, and parses the streamed JSON', async () => {
    const { client, captured } = sdkWith([() => sse(answer(summaryJson))])
    const ai = new WireStudyAi(client, 'claude-opus-5-5')
    const progress: string[] = []
    const result = await ai.summarizeSource({ notebookName: 'Data Structures', source }, { onProgress: (_t, _p, message) => progress.push(message) })
    expect(result).toEqual({ title: 'Summary: Queues', summary: '## Key ideas\n- FIFO' })
    expect(progress).toContain('Picking out the key ideas')

    expect(captured).toHaveLength(1)
    const [{ url, headers, body }] = captured
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
    expect(headers.get('x-api-key')).toBe('sk-ant-test-key')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(Object.keys(body).sort()).toEqual(['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'stream', 'system'])
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SUMMARY_JSON_SCHEMA } }
    })
  })

  it('sends Haiku requests without a beta header, effort or fallbacks', async () => {
    const { client, captured } = sdkWith([() => sse(answer(summaryJson, 'claude-haiku-4-5'))])
    await new WireStudyAi(client, 'claude-haiku-4-5').summarizeSource({ notebookName: 'DS', source })
    const [{ headers, body }] = captured
    expect(headers.get('anthropic-beta')).toBeNull()
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'stream', 'system'])
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: SUMMARY_JSON_SCHEMA } })
  })

  it('joins text across a mid-stream fallback switch point', async () => {
    const events = answer(summaryJson)
    const split = events.findIndex((e) => e.type === 'content_block_stop' && e.index === 1)
    // The first model's text stops after the first half; the fallback model continues it in a new block.
    const [, , , , , firstHalf, secondHalf] = events
    const spliced = [
      ...events.slice(0, 6),
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } } },
      { type: 'content_block_stop', index: 2 },
      { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
      { ...secondHalf, index: 3 },
      { type: 'content_block_stop', index: 3 },
      ...events.slice(split + 1)
    ]
    expect(firstHalf.type).toBe('content_block_delta')
    const { client } = sdkWith([() => sse(spliced)])
    const progress: string[] = []
    const result = await new WireStudyAi(client, 'claude-opus-5-5').summarizeSource({ notebookName: 'DS', source }, { onProgress: (_t, _p, m) => progress.push(m) })
    expect(result.title).toBe('Summary: Queues')
    expect(progress).toContain('Switching to a backup model')
  })

  it('maps a connection that drops mid-answer to NETWORK', async () => {
    const { client } = sdkWith([() => sse(answer(summaryJson), { failAfter: 6 })])
    await expect(new WireStudyAi(client, 'claude-opus-5-5').summarizeSource({ notebookName: 'DS', source })).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('maps an overloaded error sent inside the stream to AI_UNAVAILABLE', async () => {
    const events = [...answer(summaryJson).slice(0, 5), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]
    const { client } = sdkWith([() => sse(events)])
    await expect(new WireStudyAi(client, 'claude-opus-5-5').summarizeSource({ notebookName: 'DS', source })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
  })

  it('maps HTTP errors by status', async () => {
    const cases: [Response, string][] = [
      [jsonError(401, 'authentication_error', 'invalid x-api-key'), 'INVALID_API_KEY'],
      [jsonError(429, 'rate_limit_error', 'slow down'), 'RATE_LIMITED'],
      [jsonError(529, 'overloaded_error', 'Overloaded'), 'AI_UNAVAILABLE'],
      [jsonError(402, 'billing_error', 'credit balance too low'), 'AI_UNAVAILABLE'],
      [jsonError(413, 'request_too_large', 'too big'), 'SOURCE_TOO_LARGE']
    ]
    for (const [response, code] of cases) {
      const { client } = sdkWith([() => response])
      await expect(new WireStudyAi(client, 'claude-opus-5-5').summarizeSource({ notebookName: 'DS', source })).rejects.toMatchObject({ code })
    }
  })

  it('retries a 400 without the fallback opt-in and succeeds', async () => {
    const { client, captured } = sdkWith([
      () => jsonError(400, 'invalid_request_error', 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.'),
      () => sse(answer(summaryJson))
    ])
    await expect(new WireStudyAi(client, 'claude-sonnet-5-5').summarizeSource({ notebookName: 'DS', source })).resolves.toMatchObject({ title: 'Summary: Queues' })
    expect(captured).toHaveLength(2)
    expect(captured[1].headers.get('anthropic-beta')).toBeNull()
    expect(captured[1].body).not.toHaveProperty('fallbacks')
  })

  it('testConnection reads the selected model', async () => {
    const captured: string[] = []
    const fetch = async (url: string | URL | Request): Promise<Response> => {
      captured.push(String(url))
      return new Response(JSON.stringify({ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', type: 'model', created_at: '2026-09-01T00:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const ai = new WireStudyAi(new Anthropic({ apiKey: 'sk-ant-test-key', fetch, maxRetries: 0 }), 'claude-sonnet-5-5')
    await expect(ai.testConnection()).resolves.toEqual({ ok: true, message: 'Connected. Claude Sonnet 5.5 is ready to use.' })
    expect(captured).toEqual(['https://api.anthropic.com/v1/models/claude-sonnet-5-5'])
  })
})
