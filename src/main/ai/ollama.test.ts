// The Ollama transport over a real local socket (FakeOllama on 127.0.0.1):
// model listing, the /api/chat request body, NDJSON streaming in awkward
// chunks, thinking, retries, cut-off answers, Ollama's errors, cancellation
// and the connection test. No network beyond 127.0.0.1 is used.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OLLAMA_CONTEXT_SIZES } from '@shared/types'
import type { AiSourceDoc, CallOptions } from './index'
import {
  chooseThink,
  estimateTokens,
  fetchOllamaModels,
  forgetOllamaModelFacts,
  NdjsonLines,
  normalizeOllamaUrl,
  OLLAMA_NO_MODELS_MESSAGE,
  OLLAMA_TEMPERATURE,
  ollamaAnswerTokens,
  ollamaFailure,
  ollamaFirstTokenTimeoutMs,
  ollamaOutputTokens,
  ollamaQuestionsPerCall,
  ollamaSourceCharBudget,
  ollamaSourceChars,
  ollamaUnreachableMessage,
  runOllamaStructured,
  sameOllamaModel,
  testOllamaConnection,
  type OllamaCall,
  type OllamaTarget
} from './ollama'
import { answer, chatLines, closedPortUrl, DEFAULT_SHOW, FakeOllama, rechunk } from './ollamaTestkit'
import { jsonOutline, SYSTEM_PROMPT } from './prompts'
import { parseSummaryOutput, SUMMARY_JSON_SCHEMA } from './schemas'

let fake: FakeOllama

beforeEach(async () => {
  fake = await FakeOllama.start()
})
afterEach(async () => {
  await fake.close()
  forgetOllamaModelFacts()
})

const sources: AiSourceDoc[] = [
  { name: 'Week 5 - Trees.pdf', kind: 'lecture', text: '[Page 1]\nA binary search tree keeps smaller keys on the left.' },
  { name: 'Exam 2025.pdf', kind: 'exam', text: 'Q1. Delete 5 from the tree.' },
  { name: 'Blank.txt', kind: 'notes', text: '   ' }
]

const summary = { title: 'Summary: Trees', summary: '## Key ideas\n- Smaller keys go left.' }
const summaryJson = JSON.stringify(summary)

function target(overrides: Partial<OllamaTarget> = {}): OllamaTarget {
  return { baseUrl: fake.url, model: 'qwen3:8b', contextTokens: 16_384, ...overrides }
}

function summaryCall(overrides: Partial<OllamaCall<{ title: string; summary: string }>> = {}): OllamaCall<{ title: string; summary: string }> {
  return {
    task: 'summary',
    instruction: 'Task: write a study summary of the attached file.',
    sources,
    schema: SUMMARY_JSON_SCHEMA,
    validate: parseSummaryOutput,
    progress: { expectedChars: 500, startMessage: 'Reading Trees.pdf', thinkingMessage: 'Picking out the key ideas', describe: () => 'Writing the key ideas' },
    ...overrides
  }
}

function recordProgress(): { messages: string[]; fractions: number[]; options: CallOptions } {
  const messages: string[] = []
  const fractions: number[] = []
  return {
    messages,
    fractions,
    options: {
      onProgress: (_task, p, message) => {
        messages.push(message)
        if (p !== null) fractions.push(p)
      }
    }
  }
}

describe('normalizeOllamaUrl and model names', () => {
  it('tidies addresses and rejects anything that is not a plain http(s) address', () => {
    expect(normalizeOllamaUrl(' localhost:11434/ ')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('https://ollama.example.com/base//')).toBe('https://ollama.example.com/base')
    // The OpenAI-style address other tools give, or the API path, still means the server itself.
    expect(normalizeOllamaUrl('http://localhost:11434/v1')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('http://127.0.0.1:11434/api/')).toBe('http://127.0.0.1:11434')
    expect(normalizeOllamaUrl('https://proxy.example.com/ollama/V1/')).toBe('https://proxy.example.com/ollama')
    for (const bad of [42, null, '', ' ', 'ftp://host', 'http://user:pw@host', 'http://host/?q=1', 'http://host/#x', 'x'.repeat(201), 'http://']) {
      expect(() => normalizeOllamaUrl(bad)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
    }
  })

  it('matches names the way Ollama resolves them', () => {
    expect(sameOllamaModel('llama3.2', 'llama3.2:latest')).toBe(true)
    expect(sameOllamaModel('Llama3.2:Latest', 'registry.ollama.ai/library/llama3.2')).toBe(true)
    expect(sameOllamaModel('qwen3:8b', 'qwen3:4b')).toBe(false)
    expect(sameOllamaModel('qwen3', 'qwen3:8b')).toBe(false)
    expect(sameOllamaModel('localhost:5000/team/model', 'localhost:5000/team/model:latest')).toBe(true)
    expect(sameOllamaModel('hf.co/user/repo:Q4_K_M', 'hf.co/user/repo:q4_k_m')).toBe(true)
  })
})

describe('NdjsonLines', () => {
  it('handles lines split across chunks, several lines per chunk, blank lines, CRLF and a final line without a newline', () => {
    const lines = new NdjsonLines()
    expect(lines.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }])
    expect(lines.push(':2}\r\n\n{"c":3}\n{"d":4}\n{"e"')).toEqual([{ b: 2 }, { c: 3 }, { d: 4 }])
    expect(lines.push(':5}')).toEqual([])
    expect(lines.end()).toEqual([{ e: 5 }])
    expect(lines.end()).toEqual([])
  })

  it('throws on a line that is not JSON', () => {
    expect(() => new NdjsonLines().push('<html>\n')).toThrow(SyntaxError)
  })
})

describe('context budget', () => {
  it('leaves room for the prompt and the largest answer at every context size', () => {
    // README.md ("Context size" pages table) and docs/ARCHITECTURE.md quote these numbers: update them together.
    const expected: Record<number, number> = { 8192: 4_608, 16384: 19_968, 32768: 62_976, 65536: 161_280, 131072: 357_888 }
    let previous = 0
    for (const size of OLLAMA_CONTEXT_SIZES) {
      const budget = ollamaSourceCharBudget(size)
      expect(budget).toBe(expected[size])
      expect(budget).toBeGreaterThan(previous)
      previous = budget
      // Files at 3 chars per token + the largest answer + a 3,584-token prompt reserve fit exactly.
      expect(budget / 3 + ollamaAnswerTokens(size) + 3_584).toBe(size)
      expect(ollamaAnswerTokens(size)).toBeGreaterThanOrEqual(ollamaOutputTokens('lesson')[1])
    }
    expect(ollamaSourceCharBudget(2_048)).toBe(0)
  })

  it('counts text in other scripts at more tokens per character than English', () => {
    expect(estimateTokens('abc'.repeat(100))).toBe(100)
    expect(estimateTokens('abc'.repeat(100), 3.5)).toBeCloseTo(300 / 3.5)
    expect(estimateTokens('数据结构'.repeat(25))).toBe(100)
    expect(estimateTokens('Привет'.repeat(10))).toBe(30)
    // English and code are measured as before; other scripts in characters of English.
    expect(ollamaSourceChars('def push(x): stack.append(x)')).toBe(28)
    expect(ollamaSourceChars('数据结构')).toBe(12)
    expect(ollamaSourceChars('Привет')).toBe(9)
  })

  it('waits longer for the first token when the prompt is longer', () => {
    expect(ollamaFirstTokenTimeoutMs(0)).toBe(10 * 60 * 1000)
    // A full 16K prompt on a slow laptop: about half an hour.
    expect(ollamaFirstTokenTimeoutMs(12_000)).toBe(10 * 60 * 1000 + 1_200_000)
  })

  it('splits big quizzes into calls whose answers fit, and sizes answers by item count', () => {
    expect(ollamaQuestionsPerCall(8_192)).toBe(7)
    for (const size of OLLAMA_CONTEXT_SIZES.slice(1)) expect(ollamaQuestionsPerCall(size)).toBe(10)
    for (const size of OLLAMA_CONTEXT_SIZES) {
      expect(ollamaOutputTokens('quiz', ollamaQuestionsPerCall(size))[0]).toBeLessThanOrEqual(ollamaAnswerTokens(size))
    }
    expect(ollamaOutputTokens('flashcards', 8)).toEqual([8 * 160 + 256, 8 * 60 + 128])
    expect(ollamaOutputTokens('explanation')[0]).toBeLessThan(ollamaOutputTokens('lesson')[0])
  })
})

describe('chooseThink', () => {
  it('turns thinking off where allowed, else picks the lowest level, else leaves the default', () => {
    expect(chooseThink(null)).toBe(false)
    expect(chooseThink({ contextLength: null, thinkValues: null, capabilities: null })).toBe(false)
    expect(chooseThink({ contextLength: null, thinkValues: [true, false], capabilities: null })).toBe(false)
    expect(chooseThink({ contextLength: null, thinkValues: [false], capabilities: null })).toBe(false)
    expect(chooseThink({ contextLength: null, thinkValues: ['low', 'medium', 'high'], capabilities: null })).toBe('low')
    expect(chooseThink({ contextLength: null, thinkValues: [true], capabilities: null })).toBeUndefined()
  })
})

describe('fetchOllamaModels', () => {
  it('maps, de-duplicates and sorts the installed models', async () => {
    fake.tags = {
      status: 200,
      body: {
        models: [
          { name: 'qwen3:8b', model: 'qwen3:8b', size: 5_225_388_164, details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M' } },
          { model: 'Llama3.2:latest', size: 2_019_393_189, details: { parameter_size: '3.2B', quantization_level: 'Q4_K_M' } },
          { name: 'gemma3:4b', size: 'big', details: { parameter_size: '' } },
          { name: 'qwen3:8b', size: 1 },
          { name: '', model: '' },
          'junk'
        ]
      }
    }
    const result = await fetchOllamaModels(fake.url)
    expect(result).toEqual({
      ok: true,
      message: 'Found 3 models in Ollama.',
      models: [
        { name: 'gemma3:4b', sizeBytes: 0, parameterSize: null, quantization: null },
        { name: 'Llama3.2:latest', sizeBytes: 2_019_393_189, parameterSize: '3.2B', quantization: 'Q4_K_M' },
        { name: 'qwen3:8b', sizeBytes: 1, parameterSize: null, quantization: null }
      ]
    })
    expect(fake.requests).toEqual([{ method: 'GET', path: '/api/tags', body: null }])
  })

  it('leaves out cloud models, which run on ollama.com and not on this computer', async () => {
    fake.tags = {
      status: 200,
      body: {
        models: [
          { name: 'gpt-oss:120b-cloud', size: 384, remote_model: 'gpt-oss:120b', remote_host: 'https://ollama.com:443' },
          { name: 'glm-4.6:cloud', size: 300 },
          { name: 'mystery:latest', size: 300, remote_host: 'https://ollama.com:443' },
          { name: 'qwen3:8b', size: 5_225_388_164 },
          { name: 'cloudy:latest', size: 10 }
        ]
      }
    }
    expect((await fetchOllamaModels(fake.url)).models.map((m) => m.name)).toEqual(['cloudy:latest', 'qwen3:8b'])
  })

  it('says "1 model" and tells the learner how to pull one when there are none', async () => {
    fake.tags = { status: 200, body: { models: [{ name: 'qwen3:8b', size: 10 }] } }
    expect((await fetchOllamaModels(fake.url)).message).toBe('Found 1 model in Ollama.')
    fake.tags = { status: 200, body: { models: [] } }
    expect(await fetchOllamaModels(fake.url)).toEqual({ ok: true, message: OLLAMA_NO_MODELS_MESSAGE, models: [] })
    expect(OLLAMA_NO_MODELS_MESSAGE).toContain('ollama pull qwen3:8b')
  })

  it('names the address and says to start Ollama when nothing listens there', async () => {
    const url = await closedPortUrl()
    const result = await fetchOllamaModels(url)
    expect(result).toEqual({ ok: false, message: ollamaUnreachableMessage(url), models: [] })
    expect(result.message).toContain(url)
    expect(result.message).toMatch(/Start the Ollama app/)
  })

  it('says when the address answers but is not Ollama', async () => {
    fake.tags = { status: 200, body: '<html>Router login</html>' }
    expect(await fetchOllamaModels(fake.url)).toMatchObject({ ok: false, message: expect.stringContaining("doesn't look like Ollama") })
    fake.tags = { status: 404, body: { error: 'not found' } }
    expect(await fetchOllamaModels(fake.url)).toMatchObject({ ok: false, models: [] })
  })

  it('never throws, even when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchOllamaModels(fake.url, controller.signal)).resolves.toMatchObject({ ok: false })
  })
})

describe('runOllamaStructured: the request', () => {
  it('sends the system prompt, delimited course files, the instruction and the JSON outline, with format, num_ctx and num_predict', async () => {
    fake.chats.push(answer(summaryJson))
    await expect(runOllamaStructured(target(), summaryCall())).resolves.toEqual(summary)

    expect(fake.sent('/api/show').map((r) => r.body)).toEqual([{ model: 'qwen3:8b' }])
    const [body] = fake.chatBodies()
    expect(body.model).toBe('qwen3:8b')
    expect(body.stream).toBe(true)
    expect(body.format).toEqual(SUMMARY_JSON_SCHEMA)
    expect(body.think).toBe(false)
    expect(body.options.num_ctx).toBe(16_384)
    expect(body.options.temperature).toBe(OLLAMA_TEMPERATURE.summary)
    expect(body.options.num_predict).toBe(ollamaOutputTokens('summary')[0])
    expect(body.options.num_predict).toBeLessThan(16_384)
    expect(body).not.toHaveProperty('keep_alive')

    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT)
    const user = body.messages[1].content
    // Files first (stable order, empty ones dropped, kind context included), then the instruction, then the outline.
    expect(user.startsWith('Course files (2):\n<documents>\n<document index="1">\n<title>Exam 2025.pdf</title>')).toBe(true)
    expect(user).toContain('<context>A past exam from this course: use it for question style, format and difficulty.</context>')
    expect(user).toContain('<title>Week 5 - Trees.pdf</title>\n<context>Lecture notes from the course.</context>\n<document_content>\n[Page 1]\nA binary search tree')
    expect(user).not.toContain('Blank.txt')
    expect(user.indexOf('</documents>')).toBeLessThan(user.indexOf('Task: write a study summary'))
    expect(user.endsWith(jsonOutline(SUMMARY_JSON_SCHEMA))).toBe(true)
  })

  it('leaves the documents out when there are no files', async () => {
    fake.chats.push(answer(summaryJson))
    await runOllamaStructured(target(), summaryCall({ sources: [] }))
    expect(fake.chatBodies()[0].messages[1].content.startsWith('Task: write a study summary')).toBe(true)
  })

  it("caps num_ctx at the model's own limit", async () => {
    fake.show = () => ({ status: 200, body: { ...DEFAULT_SHOW, model_info: { 'general.architecture': 'llama', 'llama.context_length': 8_192 } } })
    fake.chats.push(answer(summaryJson))
    await runOllamaStructured(target({ contextTokens: 32_768 }), summaryCall())
    expect(fake.chatBodies()[0].options.num_ctx).toBe(8_192)
  })

  it("uses the model's thinking controls: the lowest level, or its default with room for the thinking", async () => {
    fake.show = () => ({ status: 200, body: { ...DEFAULT_SHOW, thinking: { values: ['low', 'medium', 'high'], default: 'medium' } } })
    fake.chats.push(answer(summaryJson))
    await runOllamaStructured(target({ model: 'gpt-oss:20b' }), summaryCall())
    expect(fake.chatBodies()[0].think).toBe('low')

    fake.show = () => ({ status: 200, body: { ...DEFAULT_SHOW, thinking: { values: [true], default: true } } })
    fake.chats.push(answer(summaryJson))
    await runOllamaStructured(target({ model: 'always-thinks:7b' }), summaryCall())
    const body = fake.chatBodies()[1]
    expect(body).not.toHaveProperty('think')
    expect(body.options.num_predict).toBe(ollamaOutputTokens('summary')[0] + 2_048)
  })

  it('carries on with safe defaults when /api/show is missing (an older Ollama)', async () => {
    fake.show = () => ({ status: 500, body: { error: 'unknown endpoint' } })
    fake.chats.push(answer(summaryJson))
    await expect(runOllamaStructured(target({ model: 'old:1b' }), summaryCall())).resolves.toEqual(summary)
    expect(fake.chatBodies()[0]).toMatchObject({ think: false, options: { num_ctx: 16_384 } })
  })

  it('resends without "think" when this Ollama rejects the value', async () => {
    fake.chats.push({ status: 400, chunks: [JSON.stringify({ error: 'think value "false" is not supported for this model' })] }, answer(summaryJson))
    await expect(runOllamaStructured(target({ model: 'picky:3b' }), summaryCall())).resolves.toEqual(summary)
    const [first, second] = fake.chatBodies()
    expect(first.think).toBe(false)
    expect(second).not.toHaveProperty('think')
  })

  it('refuses before sending when the files and instruction leave no room for the answer', async () => {
    const big: AiSourceDoc[] = [{ name: 'Huge.pdf', kind: 'lecture', text: 'word '.repeat(10_000) }]
    await expect(runOllamaStructured(target({ contextTokens: 8_192, model: 'small:1b' }), summaryCall({ sources: big }))).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: expect.stringContaining('Choose a larger context size in Settings')
    })
    expect(fake.sent('/api/chat')).toHaveLength(0)
  })

  it('counts files in other scripts by their real size and refuses them before sending when they would overflow', async () => {
    // 15,000 Chinese characters are about 15,000 tokens, not the 5,000 an English-rate count would give.
    const chinese: AiSourceDoc[] = [{ name: 'Lecture.pdf', kind: 'lecture', text: '二叉搜索树'.repeat(3_000) }]
    await expect(runOllamaStructured(target({ contextTokens: 16_384 }), summaryCall({ sources: chinese }))).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE'
    })
    expect(fake.sent('/api/chat')).toHaveLength(0)
  })

  it("explains a model whose own limit is below the chosen context size", async () => {
    fake.show = () => ({ status: 200, body: { ...DEFAULT_SHOW, model_info: { 'general.architecture': 'phi', 'phi.context_length': 4_096 } } })
    await expect(runOllamaStructured(target({ model: 'tiny:1b' }), summaryCall({ sources: [{ name: 'A.pdf', kind: 'lecture', text: 'x '.repeat(9_000) }] }))).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: expect.stringContaining('tiny:1b can read at most 4,096 tokens at once')
    })
  })
})

describe('runOllamaStructured: streaming', () => {
  it('parses NDJSON split mid-line into tiny chunks, with multibyte characters split across chunks', async () => {
    const content = JSON.stringify({ title: 'Summary: Bäume → trees', summary: 'Ünïcödé ✓ survives' })
    const raw = Buffer.from(chatLines(content, { pieces: 9 }).join(''), 'utf8')
    const chunks: Buffer[] = []
    for (let i = 0; i < raw.length; i += 7) chunks.push(raw.subarray(i, i + 7))
    fake.chats.push({ chunks })
    await expect(runOllamaStructured(target(), summaryCall())).resolves.toEqual(JSON.parse(content))
  })

  it('parses every line when one chunk carries the whole stream (no final newline)', async () => {
    fake.chats.push({ chunks: [chatLines(summaryJson, { pieces: 20 }).join('').trimEnd()] })
    await expect(runOllamaStructured(target(), summaryCall())).resolves.toEqual(summary)
  })

  it('reports thinking as thinking and the answer as writing progress', async () => {
    fake.chats.push({ chunks: rechunk(chatLines(summaryJson, { thinking: 'The file is about trees, so...' }).join(''), 50) })
    const progress = recordProgress()
    await runOllamaStructured(target(), summaryCall({ progress: { expectedChars: 20, startMessage: 'Reading Trees.pdf', thinkingMessage: 'Picking out the key ideas', describe: () => 'Writing the key ideas' } }), progress.options)
    expect(progress.messages[0]).toBe('Reading Trees.pdf')
    expect(progress.messages).toContain('Picking out the key ideas')
    expect(progress.messages.indexOf('Picking out the key ideas')).toBeLessThan(progress.messages.indexOf('Writing the key ideas'))
    // Progress only moves forward and never claims completion from length alone.
    expect(progress.fractions).toEqual([...progress.fractions].sort((a, b) => a - b))
    expect(Math.max(...progress.fractions)).toBeLessThanOrEqual(0.95)
  })

  it('retries once with the reason when the answer is not usable, then succeeds', async () => {
    fake.chats.push(answer('{"title": "Summary", "summary": '), answer(summaryJson))
    const progress = recordProgress()
    await expect(runOllamaStructured(target(), summaryCall(), progress.options)).resolves.toEqual(summary)
    const [first, second] = fake.chatBodies()
    expect(first.messages[1].content).not.toContain('could not be used')
    expect(second.messages[1].content).toContain('Your previous answer to this task could not be used: The answer was not valid JSON.')
    expect(second.messages[0]).toEqual(first.messages[0])
    expect(progress.messages).toContain('Tidying up the answer: trying once more')
  })

  it('gives up with AI_BAD_OUTPUT when the retry is not usable either', async () => {
    fake.chats.push(answer('{"title": ""}'), answer('not json'))
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT', message: expect.stringContaining('not valid JSON') })
    expect(fake.sent('/api/chat')).toHaveLength(2)
  })

  it('validation errors other than OutputError are not retried', async () => {
    fake.chats.push(answer(summaryJson))
    const validate = (): never => {
      throw new Error('bug')
    }
    await expect(runOllamaStructured(target(), summaryCall({ validate }))).rejects.toThrow('bug')
    expect(fake.sent('/api/chat')).toHaveLength(1)
  })

  it('does not retry an answer cut off by a full context window', async () => {
    // num_predict was shrunk to fit the context, and the answer still ran out of room.
    const long: AiSourceDoc[] = [{ name: 'Long.pdf', kind: 'lecture', text: 'x '.repeat(19_000) }]
    fake.chats.push(answer('{"title": "Summ', { doneReason: 'length', evalCount: 900 }))
    await expect(runOllamaStructured(target({ contextTokens: 16_384 }), summaryCall({ sources: long }))).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: expect.stringMatching(/larger context size in Settings, or pick fewer files/)
    })
    expect(fake.chatBodies()[0].options.num_predict).toBeLessThan(ollamaOutputTokens('summary')[0])
    expect(fake.sent('/api/chat')).toHaveLength(1)
  })

  it('retries once when the answer hit a cap that was shrunk to fit next to the files', async () => {
    // The files leave less room than a summary wants, so num_predict is the room; the answer used all of it.
    const long: AiSourceDoc[] = [{ name: 'Long.pdf', kind: 'lecture', text: 'x '.repeat(19_000) }]
    fake.chats.push(answer('{"title": "Summ', { doneReason: 'length', evalCount: 1_000_000 }), answer(summaryJson))
    await expect(runOllamaStructured(target(), summaryCall({ sources: long }))).resolves.toEqual(summary)
    const [first, second] = fake.chatBodies()
    expect(first.options.num_predict).toBeLessThan(ollamaOutputTokens('summary')[0])
    expect(second.messages[1].content).toContain('It was too long and got cut off')

    // Cut off again: the files are what leave too little room.
    fake.chats.push(answer('{"title": "Summ', { doneReason: 'length', evalCount: 1_000_000 }), answer('{"ti', { doneReason: 'length', evalCount: 1_000_000 }))
    await expect(runOllamaStructured(target(), summaryCall({ sources: long }))).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: expect.stringMatching(/next to your files.*larger context size in Settings, or pick fewer files/)
    })
  })

  it('retries once, asking for a shorter answer, when the answer hit its own length cap', async () => {
    const cap = ollamaOutputTokens('summary')[0]
    fake.chats.push(answer('{"title": "Summ', { doneReason: 'length', evalCount: cap }), answer(summaryJson))
    const progress = recordProgress()
    await expect(runOllamaStructured(target(), summaryCall(), progress.options)).resolves.toEqual(summary)
    expect(fake.chatBodies()[1].messages[1].content).toContain('It was too long and got cut off')
    expect(progress.messages).toContain('Too long: writing a shorter answer')

    fake.chats.push(answer('{"title": "Summ', { doneReason: 'length', evalCount: cap }), answer('{"ti', { doneReason: 'length', evalCount: cap }))
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT', message: expect.stringContaining('too long to finish') })
  })

  it('accepts a complete answer even when Ollama reports "length"', async () => {
    fake.chats.push(answer(summaryJson, { doneReason: 'length', evalCount: 100 }))
    await expect(runOllamaStructured(target(), summaryCall())).resolves.toEqual(summary)
  })

  it('treats an empty "load" answer as unusable output and an unload as an interruption', async () => {
    fake.chats.push(answer('', { doneReason: 'load' }), answer(summaryJson))
    await expect(runOllamaStructured(target(), summaryCall())).resolves.toEqual(summary)
    expect(fake.chatBodies()[1].messages[1].content).toContain('The answer was empty.')

    fake.chats.push(answer('{"ti', { doneReason: 'unload' }))
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: expect.stringContaining('unloaded the model') })
  })
})

describe('runOllamaStructured: errors', () => {
  it('maps an error line in the middle of the stream, keeping Ollama’s words', async () => {
    const lines = chatLines(summaryJson, { pieces: 4 })
    fake.chats.push({ chunks: [lines[0], lines[1], '{"error":"an error was encountered while running the model"}\n'] })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'Ollama ran into a problem running qwen3:8b: an error was encountered while running the model. Try again, or choose a smaller model in Settings.'
    })
  })

  it('turns a model that is not installed (404) into NO_AI_MODEL with the pull command', async () => {
    fake.chats.push({ status: 404, chunks: [JSON.stringify({ error: 'model "qwen3:8b" not found, try pulling it first' })] })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({
      code: 'NO_AI_MODEL',
      message: 'qwen3:8b isn\'t installed in Ollama. Open a terminal and run "ollama pull qwen3:8b", or choose another model in Settings.'
    })
  })

  it('stops at /api/show when the model is missing, before sending the files', async () => {
    fake.show = (model) => ({ status: 404, body: { error: `model '${model}' not found` } })
    await expect(runOllamaStructured(target({ model: 'llama3.2' }), summaryCall())).rejects.toMatchObject({ code: 'NO_AI_MODEL', message: expect.stringContaining('ollama pull llama3.2') })
    expect(fake.sent('/api/chat')).toHaveLength(0)
  })

  it('turns out-of-memory errors into advice to pick a smaller model or context size, fixed in Settings', async () => {
    fake.chats.push({ status: 500, chunks: [JSON.stringify({ error: 'model requires more system memory (11.2 GiB) than is available (6.1 GiB)' })] })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({
      code: 'NO_AI_MODEL',
      message: expect.stringMatching(/ran out of memory running qwen3:8b\. Choose a smaller model or a smaller context size in Settings/)
    })
    fake.chats.push({ chunks: [chatLines('{"t', { pieces: 1 })[0], '{"error":"llama runner process has terminated: CUDA error: out of memory"}\n'] })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'NO_AI_MODEL', message: expect.stringContaining('ran out of memory') })
  })

  it('refuses a model that cannot chat (an embedding model)', async () => {
    fake.show = () => ({ status: 200, body: { capabilities: ['embedding'] } })
    await expect(runOllamaStructured(target({ model: 'nomic-embed-text' }), summaryCall())).rejects.toMatchObject({ code: 'NO_AI_MODEL' })
    expect(fake.sent('/api/chat')).toHaveLength(0)
  })

  it('names the address when Ollama is not running', async () => {
    const url = await closedPortUrl()
    await expect(runOllamaStructured(target({ baseUrl: url }), summaryCall())).rejects.toMatchObject({ code: 'OLLAMA_UNREACHABLE', message: ollamaUnreachableMessage(url) })
  })

  it('reports a connection dropped mid-answer', async () => {
    const lines = chatLines(summaryJson, { pieces: 4 })
    fake.chats.push({ chunks: lines.slice(0, 2), drop: true })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({
      code: 'OLLAMA_UNREACHABLE',
      message: expect.stringContaining('closed before the answer was finished')
    })
  })

  it('says the connection closed, not that Ollama is unreachable, when it breaks while the model is starting', async () => {
    fake.chats.push({ chunks: [], drop: true })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({
      code: 'OLLAMA_UNREACHABLE',
      message: expect.stringContaining('closed before the answer was finished')
    })
  })

  it('gives up, closing the connection, when Ollama takes the request but never starts answering', async () => {
    fake.chats.push({ chunks: [], hang: true })
    const closed = fake.waitForClosedChat()
    await expect(runOllamaStructured(target({ firstTokenTimeoutMs: 150 }), summaryCall())).rejects.toMatchObject({
      code: 'OLLAMA_UNREACHABLE',
      message: "Ollama didn't start answering within 1 minute. Restart the Ollama app, then try again. If it keeps happening, choose a smaller model or a smaller context size in Settings."
    })
    await closed
  })

  it('does not time out an answer that started before the first-token limit', async () => {
    fake.chats.push({ chunks: chatLines(summaryJson, { pieces: 30 }) })
    await expect(runOllamaStructured(target({ firstTokenTimeoutMs: 100 }), summaryCall())).resolves.toEqual(summary)
  })

  it('reports a stream that ends without its final line', async () => {
    fake.chats.push({ chunks: chatLines(summaryJson).slice(0, -1) })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'OLLAMA_UNREACHABLE' })
  })

  it('gives up on a stream that stalls after it started', async () => {
    fake.chats.push({ chunks: chatLines(summaryJson).slice(0, 1), hang: true })
    await expect(runOllamaStructured(target({ idleTimeoutMs: 100 }), summaryCall())).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: expect.stringContaining('stopped sending the answer')
    })
  })

  it('reports an answer that is not Ollama NDJSON', async () => {
    fake.chats.push({ chunks: ['<html>hello</html>\n'] })
    await expect(runOllamaStructured(target(), summaryCall())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: expect.stringContaining("couldn't read") })
  })

  it('maps other HTTP errors sensibly', () => {
    const where = { baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b' }
    expect(ollamaFailure(400, 'invalid format', where)).toMatchObject({ code: 'AI_BAD_OUTPUT', message: 'Ollama rejected the request: invalid format.' })
    expect(ollamaFailure(503, 'server busy, please try again.  maximum pending requests exceeded', where)).toMatchObject({ code: 'RATE_LIMITED' })
    expect(ollamaFailure(401, 'unauthorized', where)).toMatchObject({ code: 'AI_UNAVAILABLE', message: 'Ollama refused to run qwen3:8b: unauthorized.' })
    expect(ollamaFailure(400, '"nomic-embed-text" does not support chat', where)).toMatchObject({ code: 'NO_AI_MODEL' })
    expect(ollamaFailure(500, 'model runner has unexpectedly stopped, this may be due to resource limitations or an internal error', where).message).toContain('ran out of memory')
    expect(ollamaFailure(404, '<html>404</html>', where)).toMatchObject({ code: 'OLLAMA_UNREACHABLE' })
    expect(ollamaFailure(418, '', where)).toMatchObject({ code: 'UNKNOWN', message: 'Ollama returned an error (418).' })
    expect(ollamaFailure(502, 'x'.repeat(1_000), where).message.length).toBeLessThan(450)
  })
})

describe('runOllamaStructured: cancellation', () => {
  it('rejects at once when already cancelled, without contacting Ollama', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runOllamaStructured(target(), summaryCall(), { signal: controller.signal })).rejects.toMatchObject({ code: 'UNKNOWN', message: 'The AI request was cancelled.' })
    expect(fake.requests).toHaveLength(0)
  })

  it('closes the connection when cancelled mid-answer', async () => {
    fake.chats.push({ chunks: chatLines(summaryJson, { pieces: 10 }).slice(0, 3), hang: true })
    const controller = new AbortController()
    const closed = fake.waitForClosedChat()
    const run = runOllamaStructured(target(), summaryCall(), {
      signal: controller.signal,
      onProgress: (_task, _p, message) => {
        if (message === 'Writing the key ideas') controller.abort()
      }
    })
    await expect(run).rejects.toMatchObject({ code: 'UNKNOWN', message: 'The AI request was cancelled.' })
    await closed
    expect(fake.closedChats).toBe(1)
  })

  it('closes the connection when cancelled while the model is still loading', async () => {
    fake.chats.push({ chunks: [], hang: true })
    const controller = new AbortController()
    const closed = fake.waitForClosedChat()
    const run = runOllamaStructured(target(), summaryCall(), { signal: controller.signal })
    // Wait until the request reached the server, then cancel before any token.
    while (fake.sent('/api/chat').length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    await expect(run).rejects.toMatchObject({ code: 'UNKNOWN', message: 'The AI request was cancelled.' })
    await closed
  })
})

describe('testOllamaConnection', () => {
  const config = (overrides: Partial<{ baseUrl: string; model: string | null; contextTokens: number }> = {}) => ({
    baseUrl: fake.url,
    model: 'llama3.2' as string | null,
    contextTokens: 16_384,
    ...overrides
  })

  beforeEach(() => {
    fake.tags = { status: 200, body: { models: [{ name: 'llama3.2:latest', size: 2_019_393_189 }, { name: 'nomic-embed-text:latest', size: 1 }] } }
  })

  it('connects when the chosen model is installed, matching names the way Ollama does', async () => {
    await expect(testOllamaConnection(config())).resolves.toEqual({ ok: true, message: 'Connected. llama3.2 is ready to use.' })
    expect(fake.sent('/api/show').map((r) => r.body)).toEqual([{ model: 'llama3.2' }])
  })

  it('names the address when Ollama is not running', async () => {
    const url = await closedPortUrl()
    await expect(testOllamaConnection(config({ baseUrl: url }))).resolves.toEqual({ ok: false, message: ollamaUnreachableMessage(url) })
  })

  it('asks for a model to be pulled, chosen or installed', async () => {
    fake.tags = { status: 200, body: { models: [] } }
    await expect(testOllamaConnection(config())).resolves.toEqual({ ok: false, message: OLLAMA_NO_MODELS_MESSAGE })
    fake.tags = { status: 200, body: { models: [{ name: 'llama3.2:latest' }] } }
    await expect(testOllamaConnection(config({ model: null }))).resolves.toEqual({ ok: false, message: 'Choose an Ollama model in Settings.' })
    await expect(testOllamaConnection(config({ model: 'qwen3:8b' }))).resolves.toEqual({
      ok: false,
      message: 'qwen3:8b isn\'t installed in Ollama. Open a terminal and run "ollama pull qwen3:8b", or choose another model in Settings.'
    })
  })

  it('warns when the context size is larger than the model supports', async () => {
    fake.show = () => ({ status: 200, body: { ...DEFAULT_SHOW, model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40_960 } } })
    await expect(testOllamaConnection(config({ contextTokens: 65_536 }))).resolves.toEqual({
      ok: true,
      message: 'Connected. llama3.2 is ready to use, but it can read at most 40,960 tokens at once. Choose a context size of 32,768 or less in Settings so your files fit.'
    })
    fake.show = () => ({ status: 200, body: { model_info: { 'general.architecture': 'phi', 'phi.context_length': 2_048 } } })
    await expect(testOllamaConnection(config())).resolves.toMatchObject({ ok: false, message: expect.stringContaining('too little for Study Notebook') })
  })

  it('rejects a model that cannot chat', async () => {
    fake.show = () => ({ status: 200, body: { capabilities: ['embedding'] } })
    await expect(testOllamaConnection(config({ model: 'nomic-embed-text' }))).resolves.toMatchObject({ ok: false, message: expect.stringContaining("isn't a chat model") })
  })

  it('still connects when /api/show is unavailable', async () => {
    fake.show = () => ({ status: 500, body: { error: 'boom' } })
    await expect(testOllamaConnection(config())).resolves.toEqual({ ok: true, message: 'Connected. llama3.2 is ready to use.' })
  })
})
