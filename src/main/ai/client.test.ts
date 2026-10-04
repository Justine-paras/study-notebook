import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AppError } from '@shared/errors'
import type { AiModelId, AiTask } from '@shared/types'
import {
  buildMessageParams,
  clientForKey,
  countKey,
  FALLBACK_BETA,
  mapAiError,
  MODEL_MAX_OUTPUT_TOKENS,
  messageText,
  runStructured,
  TASK_MAX_TOKENS,
  type StructuredCall
} from './client'
import type { AiSourceDoc } from './index'
import { SYSTEM_PROMPT } from './prompts'
import { OutputError, SUMMARY_JSON_SCHEMA } from './schemas'
import { fakeMessage, FakeClient } from './testkit'

const docs: AiSourceDoc[] = [
  { name: 'b-lecture.pdf', kind: 'lecture', text: '[Page 1]\nStacks are LIFO.' },
  { name: 'a-slides.pptx', kind: 'slides', text: '[Slide 1]\nQueues are FIFO.' },
  { name: 'empty.txt', kind: 'notes', text: '   ' },
  { name: 'old-exam.pdf', kind: 'exam', text: 'Q1. Trace push/pop.' }
]

function params(model: AiModelId, task: AiTask = 'lesson', sources = docs) {
  return buildMessageParams({ task, model, instruction: 'Do the task.', sources, schema: SUMMARY_JSON_SCHEMA, maxTokens: 1234 })
}

describe('buildMessageParams', () => {
  it('sets effort per task and opts into server-side fallbacks for Opus 5.5 and Sonnet 5.5', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5'] as const) {
      expect(params(model, 'lesson').output_config?.effort).toBe('high')
      expect(params(model, 'syllabus').output_config?.effort).toBe('high')
      for (const task of ['quiz', 'flashcards', 'summary', 'explanation'] as const) expect(params(model, task).output_config?.effort).toBe('medium')
      const p = params(model)
      expect(p.fallbacks).toBe('default')
      expect(p.betas).toEqual([FALLBACK_BETA])
      expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01')
    }
  })

  it('sends neither effort, thinking nor fallbacks to Haiku 4.5', () => {
    const p = params('claude-haiku-4-5')
    expect(p.output_config).toEqual({ format: { type: 'json_schema', schema: SUMMARY_JSON_SCHEMA } })
    expect(p).not.toHaveProperty('fallbacks')
    expect(p).not.toHaveProperty('betas')
    expect(p).not.toHaveProperty('thinking')
  })

  it('never sends a thinking config, sampling params or an assistant prefill', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5'] as const) {
      const p = params(model)
      expect(p).not.toHaveProperty('thinking')
      expect(p).not.toHaveProperty('temperature')
      expect(p.messages).toHaveLength(1)
      expect(p.messages[0].role).toBe('user')
    }
  })

  it('uses the JSON schema as the output format with the requested max_tokens', () => {
    const p = params('claude-opus-5-5')
    expect(p.output_config?.format).toEqual({ type: 'json_schema', schema: SUMMARY_JSON_SCHEMA })
    expect(p.max_tokens).toBe(1234)
    expect(p.model).toBe('claude-opus-5-5')
  })

  it('never asks for more output than the model allows', () => {
    const big = (model: AiModelId) =>
      buildMessageParams({ task: 'lesson', model, instruction: 'x', sources: docs, schema: SUMMARY_JSON_SCHEMA, maxTokens: 500_000 }).max_tokens
    expect(big('claude-opus-5-5')).toBe(MODEL_MAX_OUTPUT_TOKENS['claude-opus-5-5'])
    expect(big('claude-haiku-4-5')).toBe(64_000)
  })

  it('leaves out the fallback opt-in when asked to', () => {
    const p = buildMessageParams({ task: 'lesson', model: 'claude-opus-5-5', instruction: 'x', sources: docs, schema: SUMMARY_JSON_SCHEMA, maxTokens: 10, fallbacks: false })
    expect(p).not.toHaveProperty('fallbacks')
    expect(p).not.toHaveProperty('betas')
    expect(p.output_config?.effort).toBe('high')
  })

  it('caches the stable system prompt', () => {
    expect(params('claude-opus-5-5').system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }])
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('sends sources as sorted plain-text documents with the cache breakpoint on the last, then the instruction', () => {
    const content = params('claude-opus-5-5').messages[0].content
    if (typeof content === 'string') throw new Error('expected blocks')
    expect(content.map((b) => b.type)).toEqual(['document', 'document', 'document', 'text'])
    const [first, second, third, instruction] = content
    expect(first).toMatchObject({ type: 'document', title: 'a-slides.pptx', source: { type: 'text', media_type: 'text/plain', data: '[Slide 1]\nQueues are FIFO.' } })
    expect(second).toMatchObject({ title: 'b-lecture.pdf' })
    expect(third).toMatchObject({ title: 'old-exam.pdf', cache_control: { type: 'ephemeral' } })
    expect(third.type === 'document' && third.context).toMatch(/past exam/i)
    expect(first).not.toHaveProperty('cache_control')
    expect(second).not.toHaveProperty('cache_control')
    expect(instruction).toEqual({ type: 'text', text: 'Do the task.' })
  })

  it('renders the same files identically whatever order they arrive in', () => {
    expect(params('claude-opus-5-5', 'lesson', [...docs].reverse()).messages).toEqual(params('claude-opus-5-5', 'quiz', docs).messages)
  })

  it('sends only the instruction when there are no files', () => {
    expect(params('claude-opus-5-5', 'lesson', []).messages[0].content).toEqual([{ type: 'text', text: 'Do the task.' }])
  })
})

describe('mapAiError', () => {
  const headers = new Headers()
  const body = (type: string, message = 'x') => ({ type: 'error', error: { type, message } })

  const cases: [string, unknown, string][] = [
    ['authentication', new Anthropic.AuthenticationError(401, body('authentication_error'), 'invalid x-api-key', headers), 'INVALID_API_KEY'],
    ['permission', new Anthropic.PermissionDeniedError(403, body('permission_error'), 'nope', headers), 'INVALID_API_KEY'],
    ['not found', new Anthropic.NotFoundError(404, body('not_found_error'), 'model', headers), 'AI_UNAVAILABLE'],
    ['rate limit', new Anthropic.RateLimitError(429, body('rate_limit_error'), 'slow down', headers), 'RATE_LIMITED'],
    ['connection', new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'NETWORK'],
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 'NETWORK'],
    ['internal', new Anthropic.InternalServerError(500, body('api_error'), 'boom', headers), 'AI_UNAVAILABLE'],
    ['overloaded 529', new Anthropic.InternalServerError(529, body('overloaded_error'), 'overloaded', headers), 'AI_UNAVAILABLE'],
    ['bad request', new Anthropic.BadRequestError(400, body('invalid_request_error'), 'prompt is too long', headers), 'AI_BAD_OUTPUT'],
    ['request too large', new Anthropic.APIError(413, body('request_too_large'), 'too big', headers), 'SOURCE_TOO_LARGE'],
    ['mid-stream overloaded', new Anthropic.APIError(undefined, body('overloaded_error'), undefined, headers, 'overloaded_error'), 'AI_UNAVAILABLE'],
    ['mid-stream rate limit', new Anthropic.APIError(undefined, body('rate_limit_error'), undefined, headers, 'rate_limit_error'), 'RATE_LIMITED'],
    ['aborted', new Anthropic.APIUserAbortError(), 'UNKNOWN'],
    ['stream cut off mid-answer', new Anthropic.AnthropicError('terminated'), 'NETWORK'],
    ['stream closed early', new Anthropic.AnthropicError('request ended without sending any chunks'), 'NETWORK'],
    ['plain error', new Error('weird'), 'UNKNOWN']
  ]

  for (const [name, error, code] of cases) {
    it(`${name} -> ${code}`, () => {
      const mapped = mapAiError(error)
      expect(mapped).toBeInstanceOf(AppError)
      expect(mapped.code).toBe(code)
    })
  }

  it('keeps the API message for bad requests and passes AppErrors through', () => {
    const tooLong = new Anthropic.BadRequestError(400, body('invalid_request_error', 'prompt is too long: 250000 tokens'), undefined, headers)
    expect(mapAiError(tooLong).message).toBe('The AI service rejected the request: prompt is too long: 250000 tokens')
    const original = new AppError('NO_API_KEY', 'x')
    expect(mapAiError(original)).toBe(original)
  })
})

describe('clientForKey', () => {
  it('reuses the client for the same key and replaces it for a new key', () => {
    const a = clientForKey('sk-ant-test-1')
    expect(clientForKey('sk-ant-test-1')).toBe(a)
    const b = clientForKey('sk-ant-test-2')
    expect(b).not.toBe(a)
    expect(b).toBeInstanceOf(Anthropic)
    expect((b as Anthropic).maxRetries).toBe(2)
    expect((b as Anthropic).timeout).toBe(10 * 60 * 1000)
  })
})

describe('countKey and messageText', () => {
  it('counts keys but not escaped quotes inside strings', () => {
    expect(countKey('{"heading": "a", "body": "say \\"heading\\": no", "heading":"b"', 'heading')).toBe(2)
  })

  it('joins text blocks across a fallback switch point', () => {
    const message = fakeMessage(['{"title": "Sum', 'mary", "summary": "x"}'])
    expect(JSON.parse(messageText(message))).toEqual({ title: 'Summary', summary: 'x' })
  })
})

const summaryJson = JSON.stringify({ title: 'Summary: Stacks', summary: '## Key ideas\n- LIFO' })

function call(overrides: Partial<StructuredCall<{ title: string }>> = {}): StructuredCall<{ title: string }> {
  return {
    task: 'summary',
    model: 'claude-opus-5-5',
    instruction: 'Summarise.',
    sources: docs,
    schema: SUMMARY_JSON_SCHEMA,
    validate: (json) => {
      const value = json as { title?: unknown }
      if (typeof value.title !== 'string') throw new OutputError('title missing')
      return { title: value.title }
    },
    progress: { expectedChars: 100, startMessage: 'Reading', thinkingMessage: 'Thinking', describe: () => 'Writing' },
    ...overrides
  }
}

describe('runStructured', () => {
  it('streams, reports progress and returns the validated result', async () => {
    const client = new FakeClient([{ text: summaryJson, thinking: true }])
    const events: [AiTask, number | null, string][] = []
    const result = await runStructured(client, call(), { onProgress: (...args) => events.push(args) })
    expect(result).toEqual({ title: 'Summary: Stacks' })
    expect(client.requests).toHaveLength(1)
    expect(client.requests[0].params.max_tokens).toBe(TASK_MAX_TOKENS.summary[0])
    expect(events.map((e) => e[2])).toEqual(expect.arrayContaining(['Reading', 'Thinking', 'Writing']))
    const fractions = events.map((e) => e[1] ?? 0)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(Math.max(...fractions)).toBeLessThan(1)
    expect(events.every((e) => e[0] === 'summary')).toBe(true)
  })

  it('passes the abort signal to the SDK request', async () => {
    const client = new FakeClient([{ text: summaryJson }])
    const controller = new AbortController()
    await runStructured(client, call(), { signal: controller.signal })
    expect(client.requests[0].signal).toBe(controller.signal)
  })

  it('throws AI_REFUSED on a refusal without reading the content', async () => {
    const client = new FakeClient([{ text: '{"tit', stopReason: 'refusal' }])
    await expect(runStructured(client, call())).rejects.toMatchObject({ code: 'AI_REFUSED' })
  })

  it('retries once with a larger limit after max_tokens', async () => {
    const client = new FakeClient([{ text: '{"title": "Sum', stopReason: 'max_tokens' }, { text: summaryJson }])
    await expect(runStructured(client, call())).resolves.toEqual({ title: 'Summary: Stacks' })
    expect(client.requests.map((r) => r.params.max_tokens)).toEqual([...TASK_MAX_TOKENS.summary])
  })

  it('gives up with AI_BAD_OUTPUT after max_tokens twice', async () => {
    const client = new FakeClient([
      { text: '{', stopReason: 'max_tokens' },
      { text: '{', stopReason: 'max_tokens' }
    ])
    await expect(runStructured(client, call())).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('retries once with the reason when the output fails validation', async () => {
    const client = new FakeClient([{ text: '{"summary": "no title"}' }, { text: summaryJson }])
    await expect(runStructured(client, call())).resolves.toEqual({ title: 'Summary: Stacks' })
    expect(client.instruction(0)).toBe('Summarise.')
    expect(client.instruction(1)).toContain('title missing')
    // The retry only changes the final block, so the cached prefix is reused.
    expect(client.requests[1].params.system).toEqual(client.requests[0].params.system)
  })

  it('throws AI_BAD_OUTPUT after two unusable answers (including invalid JSON)', async () => {
    const client = new FakeClient([{ text: 'not json' }, { text: '{"summary": "still no title"}' }])
    await expect(runStructured(client, call())).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
    expect(client.requests).toHaveLength(2)
  })

  it('maps SDK errors thrown by the stream', async () => {
    const error = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 'x', new Headers())
    await expect(runStructured(new FakeClient([{ error }]), call())).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('lets non-output errors from validation propagate unchanged', async () => {
    const boom = new AppError('INVALID_INPUT', 'bad')
    const client = new FakeClient([{ text: summaryJson }])
    await expect(
      runStructured(
        client,
        call({
          validate: () => {
            throw boom
          }
        })
      )
    ).rejects.toBe(boom)
  })
})
