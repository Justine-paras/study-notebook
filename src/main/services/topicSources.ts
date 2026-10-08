// Chooses which of a notebook's sources feed an AI call about some topics,
// then applies the character budget (see sourceBudget.ts).

import type { AiModelId, ID, SourceKind, Topic } from '@shared/types'
import { ollamaSourceCharBudget, ollamaSourceChars } from '../ai/ollama'
import type { AppContext } from '../context'
import { listReadySourceTexts, type SourceWithText } from '../db/repositories/sources'
import { readStoredSettings } from './settings'
import { SOURCE_CHAR_BUDGET, selectSources, type CandidateSource, type RelevanceQuery, type SourceSelection } from './sourceBudget'

/** Past exams and quizzes teach question style, not content. */
const STYLE_KINDS: readonly SourceKind[] = ['exam', 'quiz']
/**
 * Share of the budget style examples may use in quizzes, so they never crowd
 * out the content: 90,000 characters; for a local model, a quarter of its
 * much smaller budget.
 */
const STYLE_BUDGET = 90_000

/**
 * Haiku 4.5 has a 200K-token context window, and up to 64k of it can go to the
 * answer, so the full ~150k-token budget would overflow it. ~360k characters
 * (~90k tokens) leaves room for the prompt and the longest retry.
 */
const HAIKU_CHAR_BUDGET = 360_000

/** Characters of source text one AI call may carry with the chosen model. */
export function sourceCharBudget(model: AiModelId): number {
  return model === 'claude-haiku-4-5' ? HAIKU_CHAR_BUDGET : SOURCE_CHAR_BUDGET
}

/** Characters of source text one AI call may carry with the chosen provider and model. */
export function budgetFor(ctx: AppContext): number {
  const settings = readStoredSettings(ctx)
  return settings.aiProvider === 'ollama' ? ollamaSourceCharBudget(settings.ollamaContextTokens) : sourceCharBudget(settings.model)
}

/**
 * Budget for a call about one whole file (reading a syllabus, summarizing a
 * file). Claude reads up to SOURCE_CHAR_BUDGET whatever the model, as it
 * always has; a local model gets what fits its context window.
 */
export function singleSourceBudget(ctx: AppContext): number {
  const settings = readStoredSettings(ctx)
  return settings.aiProvider === 'ollama' ? ollamaSourceCharBudget(settings.ollamaContextTokens) : SOURCE_CHAR_BUDGET
}

/**
 * Runs `select` with `budget` and, for a local model, makes sure the result
 * fits its context window. The budget counts characters at the rate of
 * English text; files in another script (Chinese is about one token per
 * character, three times English) take more tokens per character, so the
 * selection is made again with a proportionally smaller budget. Claude's
 * selection is used as it is.
 */
function selectWithinBudget(ctx: AppContext, budget: number, select: (budget: number) => SourceSelection): SourceSelection {
  let selection = select(budget)
  if (readStoredSettings(ctx).aiProvider !== 'ollama') return selection
  // Each pass picks different text, so its density can differ a little: a few passes settle it.
  for (let pass = 0; pass < 3; pass++) {
    const chars = selection.docs.reduce((sum, doc) => sum + doc.text.length, 0)
    const size = selection.docs.reduce((sum, doc) => sum + ollamaSourceChars(doc.text), 0)
    if (size <= budget || chars === 0) break
    const smaller = select(Math.floor((budget * chars) / size))
    // Nothing fits at all: keep the oversized one, which the call refuses with advice, rather than silently send no files.
    if (smaller.docs.length === 0) break
    selection = smaller
  }
  return selection
}

/** The selection for a call about one whole file (reading a syllabus, summarizing a file); with no topic, the cut keeps the opening pages. */
export function selectWholeFile(ctx: AppContext, candidate: CandidateSource): SourceSelection {
  const query: RelevanceQuery = { titles: [], descriptions: [] }
  return selectWithinBudget(ctx, singleSourceBudget(ctx), (budget) => selectSources([candidate], query, { budget }))
}

function toCandidate(source: SourceWithText): CandidateSource {
  return { id: source.id, fileName: source.fileName, kind: source.kind, text: source.text }
}

/**
 * Content sources for `topics`: each topic's linked sources when it has
 * ready ones, otherwise every ready non-exam/quiz source of the notebook.
 */
export function contentCandidates(ready: SourceWithText[], topics: Topic[]): CandidateSource[] {
  const readyIds = new Set(ready.map((s) => s.id))
  const chosen = new Set<ID>()
  let needsNotebookWide = topics.length === 0
  for (const topic of topics) {
    const linked = topic.sourceIds.filter((id) => readyIds.has(id))
    if (linked.length > 0) linked.forEach((id) => chosen.add(id))
    else needsNotebookWide = true
  }
  if (needsNotebookWide) {
    for (const source of ready) if (!STYLE_KINDS.includes(source.kind)) chosen.add(source.id)
  }
  return ready.filter((s) => chosen.has(s.id)).map(toCandidate)
}

function queryFor(topics: Topic[]): { titles: string[]; descriptions: string[] } {
  return { titles: topics.map((t) => t.title), descriptions: topics.map((t) => t.description).filter(Boolean) }
}

/** Sources for a lesson, its flashcards, or grading an explanation. */
export function selectTopicSources(ctx: AppContext, topic: Topic): SourceSelection {
  const ready = listReadySourceTexts(ctx.db, topic.notebookId)
  const candidates = contentCandidates(ready, [topic])
  const query = queryFor([topic])
  return selectWithinBudget(ctx, budgetFor(ctx), (budget) =>
    selectSources(candidates, query, { budget, allowDescriptionOnly: topic.description.trim().length > 0 })
  )
}

/**
 * Sources for a quiz over `topics`. With `includeStyle` (mock exams, weak
 * spots) past exams and quizzes are added, within a small share of the
 * budget, so questions match how the course actually asks them.
 */
export function selectQuizSources(ctx: AppContext, notebookId: ID, topics: Topic[], includeStyle: boolean): SourceSelection {
  const ready = listReadySourceTexts(ctx.db, notebookId)
  const query = queryFor(topics)
  const allowDescriptionOnly = topics.some((t) => t.description.trim().length > 0)
  const local = readStoredSettings(ctx).aiProvider === 'ollama'
  const styleCandidates = includeStyle ? ready.filter((s) => STYLE_KINDS.includes(s.kind)).map(toCandidate) : []
  const content = contentCandidates(ready, topics).filter((c) => !styleCandidates.some((s) => s.id === c.id))
  return selectWithinBudget(ctx, budgetFor(ctx), (budget) =>
    selectQuizSourcesWithin(budget, local ? Math.min(STYLE_BUDGET, Math.floor(budget / 4)) : STYLE_BUDGET, content, styleCandidates, query, allowDescriptionOnly)
  )
}

/** selectQuizSources at one budget: past exams and quizzes within their share, then the content in the rest. */
function selectQuizSourcesWithin(
  budget: number,
  styleBudget: number,
  content: CandidateSource[],
  styleCandidates: CandidateSource[],
  query: RelevanceQuery,
  allowDescriptionOnly: boolean
): SourceSelection {
  const style =
    styleCandidates.length > 0 ? selectSources(styleCandidates, query, { budget: styleBudget, allowDescriptionOnly: true }) : null
  const styleChars = style?.usedChars ?? 0
  const hasStyleDocs = (style?.docs.length ?? 0) > 0

  let main: SourceSelection
  if (content.length === 0 && hasStyleDocs) {
    main = { docs: [], labels: [], usedChars: 0 }
  } else {
    main = selectSources(content, query, { budget: budget - styleChars, allowDescriptionOnly: allowDescriptionOnly || hasStyleDocs })
    if (main.docs.length === 0 && hasStyleDocs) main = { docs: [], labels: [], usedChars: 0 }
  }
  if (!style || !hasStyleDocs) return main
  return {
    docs: [...main.docs, ...style.docs],
    labels: [...main.labels, ...style.labels],
    usedChars: main.usedChars + styleChars
  }
}
