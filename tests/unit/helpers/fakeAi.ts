// A scripted StudyAi for service tests: records every request and returns
// small, valid outputs built from the inputs. No network, no demo-mode logic.

import type { ExplanationFeedback, LessonContent, Question, QuestionType } from '@shared/types'
import {
  StudyAi,
  type AiSourceDoc,
  type CallOptions,
  type GenerateQuestionsInput,
  type GeneratedCard,
  type SyllabusExtraction,
  type TopicBrief
} from '../../../src/main/ai'

let counter = 0
const nextId = (): string => `fake-${++counter}`

export function fakeQuestion(type: QuestionType, topicId: string | null, prompt: string, answer: string): Question {
  const options = type === 'mc' ? [answer, 'Wrong A', 'Wrong B'] : type === 'tf' ? ['True', 'False'] : []
  return {
    id: nextId(),
    type,
    prompt,
    options,
    answer,
    acceptable: [],
    explanation: `Because ${answer}.`,
    topicId,
    difficulty: 'medium',
    sourceRef: 'Lecture.md'
  }
}

export class FakeAi extends StudyAi {
  syllabus: SyllabusExtraction = { courseCode: '', topics: [], exams: [] }
  flashcards: GeneratedCard[] = []
  calls: { method: string; sources: AiSourceDoc[]; input: unknown }[] = []

  constructor() {
    super(() => ({ provider: 'claude', apiKey: null, model: 'claude-opus-5-5', demo: true }))
  }

  private record(method: string, sources: AiSourceDoc[], input: unknown, options?: CallOptions): void {
    this.calls.push({ method, sources, input })
    options?.onProgress?.('lesson', 0.5, `${method} halfway`)
  }

  callsTo(method: string): { method: string; sources: AiSourceDoc[]; input: unknown }[] {
    return this.calls.filter((c) => c.method === method)
  }

  override async extractSyllabus(
    input: { notebookName: string; syllabus: AiSourceDoc; existingTopicTitles: string[]; todayDate: string },
    options?: CallOptions
  ): Promise<SyllabusExtraction> {
    this.record('extractSyllabus', [input.syllabus], input, options)
    return this.syllabus
  }

  override async generateLesson(
    input: { notebookName: string; topic: TopicBrief; sources: AiSourceDoc[]; otherTopics: TopicBrief[] },
    options?: CallOptions
  ): Promise<LessonContent> {
    this.record('generateLesson', input.sources, input, options)
    const t = input.topic
    return {
      title: t.title,
      overview: `Why ${t.title} matters.`,
      estMinutes: 15,
      warmup: [fakeQuestion('tf', t.id, `Warm-up about ${t.title}?`, 'True'), fakeQuestion('mc', t.id, `Which is ${t.title}?`, 'Right')],
      chunks: [1, 2, 3].map((n) => ({
        heading: `Part ${n}`,
        body: `Body ${n}`,
        example: '',
        check: fakeQuestion('mc', t.id, `Check ${n} on ${t.title}?`, `Answer ${n}`)
      })),
      keyTerms: [{ term: t.title, definition: 'A term.' }],
      connections: [],
      explainPrompt: `Explain ${t.title}.`,
      explainRubric: ['point one', 'point two'],
      sourcesUsed: ['whatever the model claims']
    }
  }

  override async generateQuestions(input: GenerateQuestionsInput, options?: CallOptions): Promise<Question[]> {
    this.record('generateQuestions', input.sources, input, options)
    return Array.from({ length: input.count }, (_, i) => {
      const topic = input.topics[i % input.topics.length]
      const type = input.types[i % input.types.length]
      return fakeQuestion(type, topic.id, `Q${i + 1} (${type}) about ${topic.title}`, type === 'tf' ? 'True' : `answer ${i + 1}`)
    })
  }

  override async generateFlashcards(
    input: { notebookName: string; topic: TopicBrief; lesson: LessonContent; sources: AiSourceDoc[]; count: number },
    options?: CallOptions
  ): Promise<GeneratedCard[]> {
    this.record('generateFlashcards', input.sources, input, options)
    return this.flashcards.length > 0
      ? this.flashcards
      : Array.from({ length: input.count }, (_, i) => ({ front: `What is fact ${i + 1} of ${input.topic.title}?`, back: `Fact ${i + 1}`, sourceRef: 'Lecture.md' }))
  }

  override async gradeExplanation(
    input: { topic: TopicBrief; prompt: string; rubric: string[]; explanation: string; sources: AiSourceDoc[] },
    options?: CallOptions
  ): Promise<ExplanationFeedback> {
    this.record('gradeExplanation', input.sources, input, options)
    return { score: 70, covered: ['point one'], missing: ['point two'], misconceptions: [], suggestion: 'Add an example.' }
  }

  override async summarizeSource(input: { notebookName: string; source: AiSourceDoc }, options?: CallOptions): Promise<{ title: string; summary: string }> {
    this.record('summarizeSource', [input.source], input, options)
    return { title: `Summary of ${input.source.name}`, summary: '- key point' }
  }

  override async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Connected (fake).' }
  }
}
