// Test doubles for the Claude transport (used by the *.test.ts files only):
// a fake client that replays scripted responses through the same stream
// interface the SDK exposes, and records every request it receives.

import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
  BetaStopReason
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { AiModelId } from '@shared/types'
import type { AiClient, MessageStreamLike } from './client'
import { StudyAi } from './index'

export interface ScriptedResponse {
  /** Text blocks of the final message; each block is also streamed as one text delta. */
  text?: string | string[]
  stopReason?: BetaStopReason
  /** `stop_details` of a refusal. */
  stopDetails?: BetaRefusalStopDetails
  /** Thrown from finalMessage(), like an SDK error. */
  error?: unknown
  /** Emit a thinking block start before the text. */
  thinking?: boolean
}

type TextListener = (delta: string, snapshot: string) => void
type EventListener = (event: BetaRawMessageStreamEvent, snapshot: BetaMessage) => void

export function fakeMessage(blocks: string[], stopReason: BetaStopReason = 'end_turn', stopDetails: BetaRefusalStopDetails | null = null): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: blocks.map((text) => ({ type: 'text', text, citations: null })),
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopDetails,
    usage: { input_tokens: 10, output_tokens: 10 }
  } as unknown as BetaMessage
}

class FakeStream implements MessageStreamLike {
  private readonly textListeners: TextListener[] = []
  private readonly eventListeners: EventListener[] = []

  constructor(private readonly response: ScriptedResponse) {}

  on(event: 'text' | 'streamEvent', listener: TextListener | EventListener): this {
    if (event === 'text') this.textListeners.push(listener as TextListener)
    else this.eventListeners.push(listener as EventListener)
    return this
  }

  async finalMessage(): Promise<BetaMessage> {
    if (this.response.error) throw this.response.error
    const blocks = this.response.text === undefined ? [] : Array.isArray(this.response.text) ? this.response.text : [this.response.text]
    const message = fakeMessage(blocks, this.response.stopReason, this.response.stopDetails ?? null)
    if (this.response.thinking) {
      const event = { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }
      for (const listener of this.eventListeners) listener(event as unknown as BetaRawMessageStreamEvent, message)
    }
    let snapshot = ''
    for (const block of blocks) {
      for (let i = 0; i < block.length; i += 50) {
        const delta = block.slice(i, i + 50)
        snapshot += delta
        for (const listener of this.textListeners) listener(delta, snapshot)
      }
    }
    return message
  }
}

export interface RecordedRequest {
  params: BetaMessageStreamParams
  signal: AbortSignal | null | undefined
}

export class FakeClient implements AiClient {
  readonly requests: RecordedRequest[] = []
  readonly retrieved: string[] = []

  constructor(
    private readonly responses: ScriptedResponse[] = [],
    private readonly retrieveError?: unknown
  ) {}

  readonly beta = {
    messages: {
      stream: (params: BetaMessageStreamParams, options?: { signal?: AbortSignal | null }): MessageStreamLike => {
        this.requests.push({ params, signal: options?.signal })
        const response = this.responses.shift()
        if (!response) throw new Error('FakeClient: no scripted response left')
        return new FakeStream(response)
      }
    }
  }

  readonly models = {
    retrieve: async (modelId: string): Promise<{ id: string; display_name: string }> => {
      this.retrieved.push(modelId)
      if (this.retrieveError) throw this.retrieveError
      return { id: modelId, display_name: 'Claude Opus 5.5' }
    }
  }

  /** The final text block of a recorded request: the task instruction. */
  instruction(index: number): string {
    const message = this.requests[index].params.messages[0]
    const content = message.content
    if (typeof content === 'string') return content
    const last = content[content.length - 1]
    return last.type === 'text' ? last.text : ''
  }
}

/** StudyAi wired to a FakeClient instead of the real SDK. */
export class TestStudyAi extends StudyAi {
  readonly client: FakeClient

  constructor(responses: ScriptedResponse[], model: AiModelId = 'claude-opus-5-5', retrieveError?: unknown) {
    super(() => ({ provider: 'claude', apiKey: 'sk-ant-test', model, demo: false }))
    this.client = new FakeClient(responses, retrieveError)
  }

  protected override clientFor(): AiClient {
    return this.client
  }
}
