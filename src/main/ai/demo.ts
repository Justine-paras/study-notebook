// Offline demo AI: deterministic, instant output built from the inputs
// (topic titles and sentences from the learner's own files). Every function
// returns the same raw shape the model would, so demo output goes through
// exactly the same validation and id assignment as real output.

import type { Difficulty, QuestionType } from '@shared/types'
import type { AiSourceDoc, GenerateQuestionsInput, TopicBrief } from './index'
import type {
  RawExplanation,
  RawFlashcards,
  RawLesson,
  RawLessonQuestion,
  RawQuizQuestion,
  RawSummary,
  RawSyllabus
} from './schemas'
import { BLANK, isValidLocalDate, promptKey, TF_OPTIONS } from './schemas'
import { keywords, relevantSentences, sentencesOf, splitPages, stableHash, type SourceSentence } from './sources'

// ---------------------------------------------------------------------------
// Facts: sentences about a topic, from the files or (without files) templates
// ---------------------------------------------------------------------------

interface Fact {
  text: string
  ref: string
}

function ensureSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return trimmed
  const capitalised = trimmed[0].toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

function templateFacts(topic: TopicBrief, notebookName: string): Fact[] {
  const t = topic.title
  const facts: string[] = []
  if (topic.description.trim()) facts.push(`${t} covers ${topic.description.trim().replace(/[.!?]+$/, '')}.`)
  facts.push(
    `Understanding ${t} means knowing what problem it solves, how it works step by step, and when it should not be used.`,
    `A common mistake with ${t} is memorising the definition without being able to apply it to a small example.`,
    `Tracing ${t} by hand on a small input is the quickest way to check that you really understand it.`,
    `Exam questions on ${t} usually ask you to apply the idea to a new situation rather than repeat its definition.`,
    `${t} is one of the core ideas of ${notebookName}, and later topics build on it.`,
    `Comparing ${t} with the alternatives shows which trade-offs it makes and why.`
  )
  return facts.map((text) => ({ text: ensureSentence(text), ref: '' }))
}

/** Up to `limit` facts about the topic: relevant sentences from the files first, then templates. */
function topicFacts(topic: TopicBrief, sources: AiSourceDoc[], notebookName: string, limit: number): Fact[] {
  const query = `${topic.title} ${topic.description}`
  // Teach from lectures and notes; the syllabus only names topics, so use it as a last resort.
  const teaching = sources.filter((s) => s.kind !== 'syllabus')
  const fromTeaching = relevantSentences(teaching, query, limit)
  const fromFiles = fromTeaching.length > 0 ? fromTeaching : relevantSentences(sources, query, limit)
  const facts: Fact[] = fromFiles.map((s: SourceSentence) => ({ text: s.text, ref: s.ref }))
  const seen = new Set(facts.map((f) => f.text.toLowerCase()))
  // A file that clearly covers this topic is about it throughout, so its other sentences are fair material too.
  const covering = teaching.filter((doc) => fromTeaching.some((f) => f.ref === doc.name || f.ref.startsWith(`${doc.name}, `)))
  for (const sentence of relevantSentences(covering, '', limit * 2)) {
    if (facts.length >= limit) break
    if (seen.has(sentence.text.toLowerCase())) continue
    seen.add(sentence.text.toLowerCase())
    facts.push({ text: sentence.text, ref: sentence.ref })
  }
  for (const fact of templateFacts(topic, notebookName)) {
    if (facts.length >= Math.max(limit, 3)) break
    if (fromFiles.length >= 3 && fact.ref === '') break
    if (seen.has(fact.text.toLowerCase())) continue
    seen.add(fact.text.toLowerCase())
    facts.push(fact)
  }
  return facts
}

/** The most telling content word of a fact (prefers words from the topic, then the longest). */
function keyWord(fact: string, topic: TopicBrief): string {
  const words = keywords(fact).filter((w) => w.length >= 5)
  if (words.length === 0) return keywords(fact)[0] ?? topic.title.toLowerCase()
  const topicWords = new Set(keywords(`${topic.title} ${topic.description}`))
  const fromTopic = words.find((w) => topicWords.has(w))
  if (fromTopic) return fromTopic
  return [...words].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function maskWord(sentence: string, word: string, mask: string): string | null {
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i')
  return pattern.test(sentence) ? sentence.replace(pattern, mask) : null
}

/** The fact with its main verb negated, or null when there is no simple verb to negate. */
function negate(fact: string): string | null {
  const swaps: [RegExp, string][] = [
    [/\b(is)\b(?! not)/, 'is not'],
    [/\b(are)\b(?! not)/, 'are not'],
    [/\b(can)\b(?! not)/, 'cannot'],
    [/\b(must)\b(?! not)/, 'must not'],
    [/\b(does)\b(?! not)/, 'does not'],
    [/\b(has)\b/, 'never has']
  ]
  for (const [pattern, replacement] of swaps) {
    if (pattern.test(fact)) return fact.replace(pattern, replacement)
  }
  return null
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items
  const k = by % items.length
  return [...items.slice(k), ...items.slice(0, k)]
}

function distractors(fact: string, topic: TopicBrief, others: TopicBrief[]): string[] {
  const other = others.find((o) => o.id !== topic.id)?.title ?? 'an unrelated topic'
  const candidates = [
    negate(fact),
    `${topic.title} only matters for very small inputs, so it rarely comes up in practice.`,
    `${topic.title} is just another name for ${other}.`,
    `The order of the steps in ${topic.title} never affects the result.`,
    `${topic.title} works the same way in every situation, so there are no special cases to remember.`
  ].filter((c): c is string => c !== null && c !== fact)
  return candidates.slice(0, 3)
}

function citeExplanation(fact: Fact): string {
  return `Your notes say: "${fact.text}"${fact.ref ? ` (${fact.ref})` : ''}`
}

// ---------------------------------------------------------------------------
// Question templates
// ---------------------------------------------------------------------------

interface QuestionSeed {
  fact: Fact
  topic: TopicBrief
  allTopics: TopicBrief[]
  difficulty: Difficulty
  /** Varies phrasing and true/false polarity between questions from the same fact. */
  variant: number
}

type DraftQuestion = Omit<RawQuizQuestion, 'topicIndex'>

function mcQuestion(seed: QuestionSeed): DraftQuestion {
  const { fact, topic } = seed
  const word = keyWord(fact.text, topic)
  const prompts = [
    `Which statement about ${word} is correct?`,
    `According to your notes on ${topic.title}, which statement is true?`,
    `Which of these best describes ${word} in ${topic.title}?`
  ]
  const wrong = distractors(fact.text, topic, seed.allTopics)
  const options = rotate([fact.text, ...wrong], stableHash(fact.text) + seed.variant)
  return {
    type: 'mc',
    prompt: prompts[seed.variant % prompts.length],
    options,
    answer: fact.text,
    acceptable: [],
    explanation: `${citeExplanation(fact)}. The other options either reverse that statement or describe something ${topic.title} does not claim.`,
    difficulty: seed.difficulty,
    sourceRef: fact.ref
  }
}

function tfQuestion(seed: QuestionSeed): DraftQuestion {
  const { fact } = seed
  const negated = seed.variant % 2 === 1 ? negate(fact.text) : null
  const statement = negated ?? fact.text
  const prompts = ['True or false: ', 'Decide whether this is true: ', 'True or false? ']
  return {
    type: 'tf',
    prompt: `${prompts[Math.floor(seed.variant / 2) % prompts.length]}${statement}`,
    options: [...TF_OPTIONS],
    answer: negated ? 'False' : 'True',
    acceptable: [],
    explanation: negated
      ? `${citeExplanation(fact)}. The statement here reverses that, so it is false.`
      : `${citeExplanation(fact)}. The statement matches, so it is true.`,
    difficulty: seed.difficulty,
    sourceRef: fact.ref
  }
}

function fillQuestion(seed: QuestionSeed): DraftQuestion {
  const { fact, topic } = seed
  const word = keyWord(fact.text, topic)
  const masked = maskWord(fact.text, word, BLANK) ?? `${fact.text.replace(/[.!?]$/, '')}: the key term here is ${BLANK}.`
  const prompts = ['Fill in the blank: ', 'Complete the statement: ', 'Fill in the missing term: ']
  return {
    type: 'fill',
    prompt: `${prompts[seed.variant % prompts.length]}${masked}`,
    options: [],
    answer: word,
    acceptable: word.endsWith('s') ? [] : [`${word}s`],
    explanation: `${citeExplanation(fact)}. The missing term is **${word}**.`,
    difficulty: seed.difficulty,
    sourceRef: fact.ref
  }
}

function identificationQuestion(seed: QuestionSeed): DraftQuestion {
  const { fact, topic } = seed
  const word = keyWord(fact.text, topic)
  const described = maskWord(fact.text, word, '[?]') ?? fact.text
  const prompts = ['Name the term hidden as [?]: ', 'Identify the concept marked [?]: ', 'Which term does [?] stand for? ']
  return {
    type: 'identification',
    prompt: `${prompts[seed.variant % prompts.length]}"${described}"`,
    options: [],
    answer: word,
    acceptable: [],
    explanation: `${citeExplanation(fact)}. The term is **${word}**.`,
    difficulty: seed.difficulty,
    sourceRef: fact.ref
  }
}

const BUILDERS: Record<QuestionType, (seed: QuestionSeed) => DraftQuestion> = {
  mc: mcQuestion,
  tf: tfQuestion,
  fill: fillQuestion,
  identification: identificationQuestion
}

function asLessonQuestion(q: DraftQuestion): RawLessonQuestion {
  if (q.type !== 'mc' && q.type !== 'tf') throw new Error('Lesson questions are multiple choice or true/false.')
  return { type: q.type, prompt: q.prompt, options: q.options, answer: q.answer, explanation: q.explanation, difficulty: q.difficulty, sourceRef: q.sourceRef }
}

// ---------------------------------------------------------------------------
// Lesson
// ---------------------------------------------------------------------------

function firstCodeBlock(sources: AiSourceDoc[]): string | null {
  for (const source of sources) {
    const match = /```[a-z0-9+#-]*\n[\s\S]*?```/i.exec(source.text)
    if (match) return match[0]
  }
  return null
}

function keyTermsFor(topic: TopicBrief, facts: Fact[]): { term: string; definition: string }[] {
  const counts = new Map<string, number>()
  const titleWords = keywords(topic.title)
  const isTitleWord = (w: string): boolean => titleWords.some((t) => t.startsWith(w.slice(0, 5)) || w.startsWith(t.slice(0, 5)))
  for (const fact of facts) for (const w of new Set(keywords(fact.text))) if (w.length >= 5 && !isTitleWord(w)) counts.set(w, (counts.get(w) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w)
  const terms = [{ term: topic.title, definition: topic.description.trim() ? ensureSentence(topic.description) : facts[0].text }]
  const usedDefinitions = new Set(terms.map((t) => t.definition))
  for (const word of ranked) {
    if (terms.length >= 6) break
    const mentions = facts.filter((f) => new RegExp(`\\b${escapeRegExp(word)}`, 'i').test(f.text))
    // Prefer a sentence no other term uses, so definitions don't all repeat one line.
    const fact = mentions.find((f) => !usedDefinitions.has(f.text))
    if (!fact) continue
    usedDefinitions.add(fact.text)
    terms.push({ term: word, definition: fact.text })
  }
  const fillers = ['worked example', 'common mistake', 'trade-off', 'edge case', 'complexity']
  for (const filler of fillers) {
    if (terms.length >= 5) break
    terms.push({ term: filler, definition: `A ${filler} is worth noting for ${topic.title}: check your notes for one.` })
  }
  return terms
}

export function demoLesson(input: { notebookName: string; topic: TopicBrief; sources: AiSourceDoc[]; otherTopics: TopicBrief[] }): RawLesson {
  const { topic } = input
  const facts = topicFacts(topic, input.sources, input.notebookName, 12)
  const chunkCount = facts.length >= 9 ? 4 : 3
  const allTopics = [topic, ...input.otherTopics]
  const headings = ['the core idea', 'how it works', 'applying it', 'common pitfalls']
  const code = firstCodeBlock(input.sources)

  const chunks = Array.from({ length: chunkCount }, (_, i) => {
    const own = facts.filter((_, j) => j % chunkCount === i)
    const lead = own[0] ?? facts[i % facts.length]
    const terms = [...new Set(own.map((f) => keyWord(f.text, topic)))]
    const refs = [...new Set(own.map((f) => f.ref).filter(Boolean))]
    const body = [
      own.map((f) => f.text).join(' '),
      terms.length ? `Key terms in this part: ${terms.map((t) => `**${t}**`).join(', ')}.` : '',
      refs.length ? `_From ${refs.join('; ')}._` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    const example =
      i === 1 && code
        ? `Here is how the course writes it:\n\n${code}\n\nRead it line by line and say what each condition protects against.`
        : i < 2
          ? `**Worked example.** Take this statement${lead.ref ? ` from ${lead.ref}` : ''}:\n\n> ${lead.text}\n\n1. Underline the key terms: ${terms.join(', ') || topic.title}.\n2. Restate it in your own words with a small, concrete case.\n3. Check your restatement against the original before moving on.`
          : ''
    const seed: QuestionSeed = { fact: lead, topic, allTopics, difficulty: 'medium', variant: i }
    const check = asLessonQuestion(i % 2 === 0 ? tfQuestion({ ...seed, variant: 0 }) : mcQuestion({ ...seed, variant: i + 1 }))
    return { heading: `${topic.title}: ${headings[i]}`, body, example, check }
  })

  const warmFact = facts[facts.length > 1 ? 1 : 0]
  const warmup = [
    asLessonQuestion(tfQuestion({ fact: warmFact, topic, allTopics, difficulty: 'easy', variant: 1 })),
    asLessonQuestion(mcQuestion({ fact: facts[0], topic, allTopics, difficulty: 'easy', variant: 1 }))
  ]

  const keyTerms = keyTermsFor(topic, facts)
  const connections = input.otherTopics
    .slice(0, 2)
    .map((o, i) => (i === 0 ? `${topic.title} builds on ideas from ${o.title}.` : `You will use ${topic.title} again in ${o.title}.`))

  return {
    title: topic.title,
    overview: `${topic.title} is a core part of ${input.notebookName}. ${facts[0].text} This lesson walks through the idea in ${chunkCount} short parts, each with a quick check.`,
    estMinutes: 5 + chunkCount * 5,
    warmup,
    chunks,
    keyTerms,
    connections,
    explainPrompt: `Explain ${topic.title} to a first-year student, using your own example.`,
    explainRubric: [
      `States what ${topic.title} is in one or two sentences`,
      `Explains why it works or why it matters`,
      `Gives a concrete example`,
      `Names a common mistake or limitation`,
      ...keyTerms.slice(1, 3).map((k) => `Uses the term "${k.term}" correctly`)
    ]
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Which topic each question is about: two thirds on the primary topic, weak topics repeated. */
function topicPlan(input: GenerateQuestionsInput, count: number): TopicBrief[] {
  const { topics } = input
  if (topics.length === 0) return []
  const primary = topics.find((t) => t.id === input.primaryTopicId)
  const weak = input.weakFocus.map((w) => topics.find((t) => t.id === w.topicId)).filter((t): t is TopicBrief => Boolean(t))
  if (primary) {
    const others = topics.filter((t) => t.id !== primary.id)
    const othersRotation = [...weak.filter((t) => t.id !== primary.id), ...others]
    let k = 0
    return Array.from({ length: count }, (_, i) => (others.length && i % 3 === 2 ? othersRotation[k++ % othersRotation.length] : primary))
  }
  const rotation = [...weak, ...topics]
  return Array.from({ length: count }, (_, i) => rotation[i % rotation.length])
}

export function demoQuestions(input: GenerateQuestionsInput, count = input.count): { questions: RawQuizQuestion[] } {
  const plan = topicPlan(input, count)
  const factsByTopic = new Map<string, Fact[]>()
  const used = new Map<string, number>()
  const seen = new Set(input.avoidPrompts.map(promptKey))
  const difficulties: Difficulty[] = ['easy', 'medium', 'hard']

  const questions = plan.map((topic, i) => {
    let facts = factsByTopic.get(topic.id)
    if (!facts) {
      facts = topicFacts(topic, input.sources, input.notebookName, Math.max(6, count))
      factsByTopic.set(topic.id, facts)
    }
    const type = input.types[i % input.types.length]
    const difficulty = input.difficulty === 'mixed' ? difficulties[i % 3] : input.difficulty
    const n = used.get(topic.id) ?? 0
    used.set(topic.id, n + 1)

    let draft: DraftQuestion | null = null
    for (let attempt = 0; attempt < 6; attempt++) {
      const fact = facts[(n + attempt) % facts.length]
      const candidate = BUILDERS[type]({ fact, topic, allTopics: input.topics, difficulty, variant: Math.floor((n + attempt) / facts.length) + attempt })
      if (!seen.has(promptKey(candidate.prompt))) {
        draft = candidate
        break
      }
      draft ??= candidate
    }
    const question = draft as DraftQuestion
    if (seen.has(promptKey(question.prompt))) question.prompt = `${question.prompt} (question ${i + 1})`
    seen.add(promptKey(question.prompt))
    return { ...question, topicIndex: input.topics.indexOf(topic) + 1 }
  })
  return { questions }
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

function plainFirstSentence(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.split(/(?<=[.!?])\s+/)[0] ?? plain
}

export function demoFlashcards(input: {
  notebookName: string
  topic: TopicBrief
  lesson: { keyTerms: { term: string; definition: string }[]; chunks: { heading: string; body: string; check: { prompt: string; answer: string; explanation: string; sourceRef: string } }[] }
  sources: AiSourceDoc[]
  count: number
}): RawFlashcards {
  const cards: RawFlashcards['cards'] = []
  const seen = new Set<string>()
  const add = (front: string, back: string, sourceRef: string): void => {
    const key = promptKey(front)
    if (!front.trim() || !back.trim() || seen.has(key) || cards.length >= input.count) return
    seen.add(key)
    cards.push({ front, back, sourceRef })
  }
  for (const kt of input.lesson.keyTerms) add(`What is meant by "${kt.term}"?`, kt.definition, '')
  for (const chunk of input.lesson.chunks) add(`What is the key idea of "${chunk.heading}"?`, plainFirstSentence(chunk.body), chunk.check.sourceRef)
  for (const chunk of input.lesson.chunks) add(chunk.check.prompt, `${chunk.check.answer}. ${plainFirstSentence(chunk.check.explanation)}`, chunk.check.sourceRef)
  for (const fact of topicFacts(input.topic, input.sources, input.notebookName, input.count)) {
    const word = keyWord(fact.text, input.topic)
    const masked = maskWord(fact.text, word, BLANK)
    if (masked) add(`Fill in the blank: ${masked}`, word, fact.ref)
  }
  return { cards }
}

// ---------------------------------------------------------------------------
// Explanation grading
// ---------------------------------------------------------------------------

const GENERIC_RUBRIC_WORDS = new Set(['states', 'explains', 'gives', 'names', 'uses', 'term', 'correctly', 'concrete', 'sentences', 'matters', 'works', 'common'])

export function demoExplanation(input: { topic: TopicBrief; rubric: string[]; explanation: string }): RawExplanation {
  const written = new Set(keywords(input.explanation))
  const writtenList = [...written]
  const wordCount = input.explanation.trim().split(/\s+/).filter(Boolean).length
  const covers = (point: string): boolean => {
    const words = keywords(point).filter((w) => !GENERIC_RUBRIC_WORDS.has(w))
    if (/example/i.test(point) && /\b(for example|e\.g\.|for instance|suppose|imagine)\b/i.test(input.explanation)) return true
    if (/mistake|limitation|pitfall/i.test(point) && /\b(mistake|wrong|careful|pitfall|limitation|fails|but)\b/i.test(input.explanation)) return true
    return words.some((w) => written.has(w) || writtenList.some((x) => x.startsWith(w.slice(0, 5)) && w.length >= 5))
  }
  const rubric = input.rubric.length ? input.rubric : [`States what ${input.topic.title} is`, 'Gives a concrete example']
  const covered = rubric.filter(covers)
  const missing = rubric.filter((p) => !covers(p))
  let score = Math.round((100 * covered.length) / rubric.length)
  if (wordCount < 15) score = Math.min(score, 30)
  const misconceptions = /\b(always|never)\b/i.test(input.explanation)
    ? ['Uses "always" or "never": check whether your notes mention exceptions to this rule']
    : []
  if (misconceptions.length) score = Math.max(0, score - 10)
  const suggestion = missing.length
    ? `Add one or two sentences on this point: ${missing[0].replace(/[.]$/, '').toLowerCase()}.`
    : 'Good coverage. Make it stronger by walking through a small example step by step.'
  return { score, covered, missing, misconceptions, suggestion }
}

// ---------------------------------------------------------------------------
// Syllabus
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAME = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const UNIT_LINE = /^\s*(?:[-*•]\s*)?((?:week|wk|unit|module|lecture|chapter|part|session|topic)\s*\d+[a-z]?)\s*(?:[:\-–—.)]|\s)\s*(.+)$/i
const EXAM_WORD = /\b(mid-?term|final|exam|examination|test|quiz)\b/i
const ADMIN_WORDS = /\b(grading|grade[sd]?|office hours?|attendance|policy|policies|late|textbook|e-?mail|contact|prerequisites?|integrity|accommodations?|instructor|ta\b|room|credits?)\b|%/i

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${pad(month)}-${pad(day)}`
  return isValidLocalDate(value) ? value : null
}

/** Finds one date in a line: ISO, "October 12, 2026", "12 Oct 2026" or "10/12/2026" (US order). */
export function findDate(line: string, defaultYear: number): string | null {
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(line)
  if (iso) return localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const monthFirst = new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, 'i').exec(line)
  if (monthFirst) {
    const month = MONTHS.indexOf(monthFirst[1].slice(0, 3).toLowerCase()) + 1
    return localDate(monthFirst[3] ? Number(monthFirst[3]) : defaultYear, month, Number(monthFirst[2]))
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}(?:,?\\s*(\\d{4}))?`, 'i').exec(line)
  if (dayFirst) {
    const month = MONTHS.indexOf(dayFirst[2].slice(0, 3).toLowerCase()) + 1
    return localDate(dayFirst[3] ? Number(dayFirst[3]) : defaultYear, month, Number(dayFirst[1]))
  }
  const slashed = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(line)
  if (slashed) return localDate(slashed[3] ? Number(slashed[3]) : defaultYear, Number(slashed[1]), Number(slashed[2]))
  return null
}

function normaliseUnitLabel(label: string): string {
  const match = /^([a-z]+)\s*(\d+[a-z]?)$/i.exec(label.trim())
  if (!match) return label.trim()
  const word = match[1].toLowerCase() === 'wk' ? 'week' : match[1].toLowerCase()
  return `${word[0].toUpperCase()}${word.slice(1)} ${match[2]}`
}

function unitNumber(label: string): number | null {
  const match = /(\d+)/.exec(label)
  return match ? Number(match[1]) : null
}

/** "Processes and threads - process states, ..." -> title and description. */
function splitTitle(rest: string): { title: string; description: string } {
  const cleaned = rest
    .replace(/\s*\((?:[^)]*\d{1,2}[^)]*)\)\s*$/, '')
    .replace(/[.;]+$/, '')
    .trim()
  const parts = cleaned.split(/\s+[-–—:]\s+|:\s+/)
  const title = parts[0].trim().slice(0, 120)
  const description = parts.slice(1).join(' - ').trim()
  return { title, description: description ? ensureSentence(description) : '' }
}

export function demoSyllabus(input: { notebookName: string; syllabus: AiSourceDoc; existingTopicTitles: string[]; todayDate: string }): RawSyllabus {
  const defaultYear = Number(input.todayDate.slice(0, 4)) || new Date().getFullYear()
  const text = splitPages(input.syllabus.text)
    .map((p) => p.text)
    .join('\n')
  const lines = text.split(/\r?\n/)
  const code = /\b([A-Z]{2,4})\s?-?(\d{3,4}[A-Z]?)\b/.exec(text)
  const existing = new Set(input.existingTopicTitles.map((t) => t.trim().toLowerCase()))

  type Found = { title: string; description: string; unitLabel: string; line: number }
  const topics: Found[] = []
  const exams: { name: string; examDate: string | null; line: number; rangeFrom: number | null; rangeTo: number | null; all: boolean }[] = []
  let current: Found | null = null

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const unit = UNIT_LINE.exec(trimmed)
    const examLike = EXAM_WORD.test(trimmed) && !ADMIN_WORDS.test(trimmed)
    const date = findDate(trimmed, defaultYear)

    if (examLike && (date || /[:\-–—]/.test(trimmed) || unit)) {
      const nameSource = unit ? unit[2] : trimmed.replace(/^\s*[-*•]\s*/, '')
      const name = nameSource.split(/\s*[:–—]\s*|\s+-\s+|,\s*/)[0].replace(/\s*\(.*$/, '').trim()
      if (EXAM_WORD.test(name) && name.length <= 60) {
        const range = /\b(?:weeks?|units?|modules?|lectures?|chapters?)\s*(\d+)\s*(?:-|–|to|through)\s*(\d+)/i.exec(trimmed)
        exams.push({
          name: name[0].toUpperCase() + name.slice(1),
          examDate: date,
          line: index,
          rangeFrom: range ? Number(range[1]) : null,
          rangeTo: range ? Number(range[2]) : null,
          all: /\b(everything|all topics|cumulative|comprehensive)\b/i.test(trimmed) || /\bfinal\b/i.test(name)
        })
        current = null
        return
      }
    }

    if (unit && !ADMIN_WORDS.test(unit[2])) {
      const { title, description } = splitTitle(unit[2])
      if (title) {
        current = { title, description, unitLabel: normaliseUnitLabel(unit[1]), line: index }
        topics.push(current)
      }
      return
    }

    // Sub-bullets under a unit line are merged into that topic's description.
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line)
    if (bullet && current && /^\s+/.test(line)) {
      const item = bullet[1].trim().replace(/[.;]+$/, '')
      current.description = current.description ? `${current.description.replace(/[.]$/, '')}; ${item}.` : ensureSentence(item)
    }
  })

  // Without a schedule, fall back to top-level bullets that look like content.
  if (topics.length === 0) {
    lines.forEach((line, index) => {
      const bullet = /^\s*[-*•]\s+(.+)$/.exec(line)
      if (!bullet || ADMIN_WORDS.test(bullet[1]) || EXAM_WORD.test(bullet[1])) return
      const { title, description } = splitTitle(bullet[1])
      if (title.length >= 3) topics.push({ title, description, unitLabel: '', line: index })
    })
  }

  const kept = topics.filter((t) => !existing.has(t.title.toLowerCase()))
  return {
    courseCode: code ? `${code[1]} ${code[2]}` : '',
    topics: kept.map(({ title, description, unitLabel }) => ({ title, description, unitLabel })),
    exams: exams.map((exam) => {
      const covered = topics.filter((t) => {
        if (exam.rangeFrom !== null && exam.rangeTo !== null) {
          const n = unitNumber(t.unitLabel)
          return n !== null && n >= exam.rangeFrom && n <= exam.rangeTo
        }
        return exam.all || t.line < exam.line
      })
      return { name: exam.name, examDate: exam.examDate, coversTopicTitles: (covered.length ? covered : topics).map((t) => t.title) }
    })
  }
}

// ---------------------------------------------------------------------------
// Source summary
// ---------------------------------------------------------------------------

function pageNote(ref: string, name: string): string {
  return ref.startsWith(`${name}, `) ? ` (${ref.slice(name.length + 2)})` : ''
}

export function demoSummary(input: { notebookName: string; source: AiSourceDoc }): RawSummary {
  const { source } = input
  const baseName = source.name.replace(/\.[a-z0-9]+$/i, '')
  const sentences = sentencesOf(source)
  const fallback = [{ text: `${baseName} is part of ${input.notebookName}.`, ref: source.name }]
  const all = sentences.length ? sentences : fallback

  const keyIdeas = all.slice(0, 6).map((s) => `- ${s.text}${pageNote(s.ref, source.name)}`)
  const definitions = all
    .filter((s) => /\b(is|are|means|refers to)\b/.test(s.text))
    .slice(0, 5)
    .map((s) => {
      const subject = /^(.{3,60}?)\s+(?:is|are|means|refers to)\b/.exec(s.text)?.[1]?.replace(/^(?:a|an|the)\s+/i, '')
      return subject && subject.split(' ').length <= 6 ? `- **${subject}**: ${s.text}` : `- ${s.text}`
    })
  const examPoints = (all.filter((s) => /\b(only if|must|always|never|condition|algorithm|complexity|O\(|\d)/i.test(s.text)).slice(0, 5).length
    ? all.filter((s) => /\b(only if|must|always|never|condition|algorithm|complexity|O\(|\d)/i.test(s.text)).slice(0, 5)
    : all.slice(0, 3)
  ).map((s) => `- ${s.text}${pageNote(s.ref, source.name)}`)

  const summary = [
    '## Key ideas',
    ...keyIdeas,
    '',
    '## Definitions',
    ...(definitions.length ? definitions : ['- No formal definitions in this file.']),
    '',
    '## Likely exam points',
    ...examPoints
  ].join('\n')
  return { title: `Summary: ${baseName}`, summary }
}
