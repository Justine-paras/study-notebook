// Turning course files into request content, plus the small text analysis
// (pages, sentences, keywords) the demo engine uses to build realistic
// output from the learner's own files.

import type { BetaRequestDocumentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { SourceKind } from '@shared/types'
import type { AiSourceDoc } from './index'

const KIND_CONTEXT: Record<SourceKind, string> = {
  syllabus: 'Course syllabus: scope, schedule and exam dates.',
  lecture: 'Lecture notes from the course.',
  slides: 'Lecture slides from the course.',
  quiz: 'A past quiz from this course: use it for question style, format and difficulty.',
  exam: 'A past exam from this course: use it for question style, format and difficulty.',
  notes: "The student's own notes for this course.",
  other: 'Course material.'
}

/**
 * Sources in a byte-stable order with empty files dropped. The same set of
 * files must always render to the same prefix so a lesson, its quiz and its
 * flashcards made a few minutes apart reuse the prompt cache.
 */
export function orderSources(sources: AiSourceDoc[]): AiSourceDoc[] {
  return sources
    .filter((s) => s.text.trim().length > 0)
    .map((s, index) => ({ s, index }))
    .sort((a, b) => compare(a.s.name, b.s.name) || compare(a.s.kind, b.s.kind) || a.index - b.index)
    .map(({ s }) => s)
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** One plain-text document block per source; the cache breakpoint goes on the last one. */
export function documentBlocks(sources: AiSourceDoc[]): BetaRequestDocumentBlock[] {
  const ordered = orderSources(sources)
  return ordered.map((source, i) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: source.text },
    title: source.name,
    context: KIND_CONTEXT[source.kind],
    ...(i === ordered.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {})
  }))
}

/**
 * The same documents as plain text for a model without document blocks
 * (Ollama): each file in its own clearly delimited <document> with its name
 * and what kind of file it is, in the same stable order, so a local model
 * can reuse its cached prompt prefix across calls too. Empty when no file
 * has text.
 */
export function documentsText(sources: AiSourceDoc[]): string {
  const ordered = orderSources(sources)
  if (ordered.length === 0) return ''
  const documents = ordered.map(
    (source, i) =>
      `<document index="${i + 1}">\n<title>${source.name}</title>\n<context>${KIND_CONTEXT[source.kind]}</context>\n<document_content>\n${source.text.trim()}\n</document_content>\n</document>`
  )
  return `Course files (${ordered.length}):\n<documents>\n${documents.join('\n')}\n</documents>`
}

// ---------------------------------------------------------------------------
// Text analysis (used by demo mode)
// ---------------------------------------------------------------------------

export interface SourcePage {
  /** "page 3" / "slide 7", or null when the text has no markers. */
  label: string | null
  text: string
}

const MARKER = /^\[(Page|Slide)\s+(\d+)\]\s*$/i

/** Splits extracted text on the "[Page N]" / "[Slide N]" marker lines. */
export function splitPages(text: string): SourcePage[] {
  const pages: SourcePage[] = []
  let current: SourcePage = { label: null, text: '' }
  for (const line of text.split(/\r?\n/)) {
    const match = MARKER.exec(line.trim())
    if (match) {
      if (current.text.trim() || current.label) pages.push(current)
      current = { label: `${match[1].toLowerCase()} ${match[2]}`, text: '' }
    } else {
      current.text += `${line}\n`
    }
  }
  if (current.text.trim() || current.label) pages.push(current)
  return pages
}

export interface SourceSentence {
  text: string
  /** Citation such as "Lecture 5.pdf, page 3". */
  ref: string
}

/** Readable prose sentences (code blocks, headings and list markers removed) with their citations. */
export function sentencesOf(source: AiSourceDoc): SourceSentence[] {
  const result: SourceSentence[] = []
  for (const page of splitPages(source.text)) {
    const ref = page.label ? `${source.name}, ${page.label}` : source.name
    const prose = page.text
      .replace(/```[\s\S]*?```/g, '\n')
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*#{1,6}\s+/, '')
          .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
          .replace(/[*_`]/g, '')
          .trim()
      )
      // A line without end punctuation is a heading or a lead-in to a list; end it so it doesn't merge into the next line.
      .map((line) => (!line || /[.!?]$/.test(line) ? line : `${line.replace(/:$/, '')}.`))
      .join(' ')
    for (const raw of prose.split(/(?<=[.!?])\s+/)) {
      const sentence = raw.replace(/\s+/g, ' ').trim()
      if (isUsefulSentence(sentence)) result.push({ text: sentence, ref })
    }
  }
  return result
}

// Schedule lines ("Week 3: Deadlocks - ...") and dated admin lines are not facts to teach.
const SCHEDULE_LINE = /^(?:week|wk|unit|module|lecture|chapter|session)\s*\d+|\b\d{4}-\d{2}-\d{2}\b|\b(?:mid-?term|final)\s+exam\b/i

function isUsefulSentence(sentence: string): boolean {
  if (sentence.length < 30 || sentence.length > 320) return false
  if (SCHEDULE_LINE.test(sentence)) return false
  if (!/[.!?]$/.test(sentence)) return false
  const words = sentence.split(' ')
  return words.length >= 6 && /[a-z]/.test(sentence)
}

const STOPWORDS = new Set(
  (
    'about above after again against also among another because been before being below between both cannot could does doing down during each ' +
    'every from further have having here into itself just least more most must only other others over same should since some such than that their ' +
    'theirs them then there these they this those through under until upon very want were what when where which while with within without would ' +
    'your yours will shall the and for are but not you all any can had her him his how its may our out own she too use used using was who why ' +
    'week unit lecture chapter slide page part topic course example examples following called means first second third make makes made one two ' +
    // Common verbs and adverbs: never useful as key terms in demo lessons.
    'take takes taking took give gives given gave keep keeps kept hold holds held work works run runs ran need needs always never often ' +
    'usually still well like much many able across either neither instead whole'
  ).split(' ')
)

/** Lower-case content words (4+ letters, no stopwords) in order of appearance. */
export function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).map((w) => w.replace(/'s$/, '')).filter((w) => !STOPWORDS.has(w))
}

/**
 * Sentences from the sources most related to a query (topic title and
 * description), best first. Ties keep document order so output is stable.
 */
export function relevantSentences(sources: AiSourceDoc[], query: string, limit: number): SourceSentence[] {
  const queryWords = new Set(keywords(query))
  const scored = orderSources(sources)
    .flatMap((source) => sentencesOf(source))
    .map((sentence, index) => {
      const words = new Set(keywords(sentence.text))
      let score = 0
      for (const w of queryWords) if (words.has(w) || [...words].some((x) => x.startsWith(w) || w.startsWith(x))) score += 1
      return { sentence, index, score }
    })
  const seen = new Set<string>()
  return scored
    .filter((s) => queryWords.size === 0 || s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((s) => {
      const key = s.sentence.text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((s) => s.sentence)
}

/** Stable 32-bit FNV-1a hash, so demo output varies with input but never between runs. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
