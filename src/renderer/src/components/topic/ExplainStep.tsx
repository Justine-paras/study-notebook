import { useEffect } from 'react'
import { ArrowRight, NotebookPen, Sparkles } from 'lucide-react'
import type { ExplanationFeedback, Lesson, TopicWithProgress } from '@shared/types'
import { useAiAction } from '../../lib/aiJobs'
import { queryKeys } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { useHotkeys } from '../../lib/useHotkeys'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { useStoredState } from '../quiz/useStoredState'
import { Badge, Button, Kbd, Sheet, TextArea, type BadgeTone } from '../ui'
import { explainDraftStorageKey } from './topicModel'
import './ExplainStep.css'

export interface ExplainStepProps {
  topic: TopicWithProgress
  lesson: Lesson
  onNext: () => void
}

interface ExplainDraft {
  text: string
  feedback: ExplanationFeedback | null
}

const EMPTY: ExplainDraft = { text: '', feedback: null }
const MIN_LENGTH = 40

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function parseDraft(value: unknown): ExplainDraft {
  if (typeof value !== 'object' || value === null) return EMPTY
  const { text, feedback } = value as Partial<ExplainDraft>
  const f = feedback as Partial<ExplanationFeedback> | null | undefined
  const validFeedback =
    f && typeof f.score === 'number' && isStringList(f.covered) && isStringList(f.missing) && isStringList(f.misconceptions) && typeof f.suggestion === 'string'
      ? (f as ExplanationFeedback)
      : null
  return { text: typeof text === 'string' ? text : '', feedback: validFeedback }
}

interface FeedbackRow {
  label: string
  tone: BadgeTone
  text: string
}

function feedbackRows(feedback: ExplanationFeedback): FeedbackRow[] {
  return [
    ...feedback.covered.map((text) => ({ label: 'Got it', tone: 'good' as const, text })),
    ...feedback.missing.map((text) => ({ label: 'Missing', tone: 'bad' as const, text })),
    ...feedback.misconceptions.map((text) => ({ label: 'Misconception', tone: 'warn' as const, text })),
    ...(feedback.suggestion.trim() ? [{ label: 'Try', tone: 'info' as const, text: feedback.suggestion }] : [])
  ]
}

/** Step 3: explain the topic in your own words (Feynman); the AI checks it against the rubric and your files. */
export function ExplainStep({ topic, lesson, onNext }: ExplainStepProps) {
  // The draft survives leaving the step (or the app) until it is checked.
  const [draft, setDraft] = useStoredState(explainDraftStorageKey(lesson.id), EMPTY, parseDraft)
  const grade = useAiAction('gradeExplanation', `explain:${lesson.id}`, {
    task: 'explanation',
    label: `Your explanation of ${topic.title}`,
    href: ROUTES.topic(topic.id, 'explain'),
    invalidate: [queryKeys.notes(topic.notebookId), queryKeys.notes(topic.notebookId, topic.id)],
    // Saved even if the learner has moved on, so the feedback is there when they come back.
    onSuccess: (feedback) => setDraft((current) => ({ ...current, feedback }))
  })
  // A check that finished while this step was not on screen (or before a remount) still shows.
  const finished = grade.data
  useEffect(() => {
    if (finished) setDraft((current) => (current.feedback === finished ? current : { ...current, feedback: finished }))
  }, [finished, setDraft])
  const tooShort = draft.text.trim().length < MIN_LENGTH

  const check = () => {
    if (tooShort || grade.isPending) return
    grade.run(topic.id, draft.text.trim())
  }
  useHotkeys({ 'mod+enter': check }, { allowInInputs: true })

  const feedback = draft.feedback

  return (
    <Sheet raised kicker="teach it back" title={lesson.content.explainPrompt || `Explain ${topic.title} in your own words`} className="explain">
      <p className="explain__intro">Use your own words, no notes. If you get stuck, that's the part you don't understand yet.</p>

      <TextArea
        label="Your explanation"
        hideLabel
        rows={7}
        value={draft.text}
        placeholder="Explain it as if to a classmate who missed the lecture…"
        readOnly={grade.isPending}
        onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
        hint={tooShort && draft.text.trim().length > 0 ? 'Keep going: a few sentences give the check something to work with.' : undefined}
      />

      <div className="explain__actions">
        <Button icon={<Sparkles size={16} aria-hidden="true" />} onClick={check} disabled={tooShort} loading={grade.isPending}>
          {feedback ? 'Check it again' : 'Check my explanation'}
        </Button>
        <span className="explain__keys text-xs muted">
          or <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
        </span>
        {!feedback && (
          <Button variant="ghost" iconEnd={<ArrowRight size={16} aria-hidden="true" />} onClick={onNext}>
            Skip to practice
          </Button>
        )}
      </div>

      {grade.isPending && <AiWorking task="explanation" compact startedAt={grade.job?.startedAt} subjectId={topic.id} />}
      <ErrorNotice error={grade.error} onRetry={check} onDismiss={grade.dismiss} title="Your explanation couldn't be checked" />

      {feedback && !grade.isPending && (
        <section className="explain__feedback" aria-label="Feedback on your explanation" role="status">
          <div className="explain__feedback-head">
            <span className="explain__feedback-title">Feedback, checked against your files</span>
            <Badge tone={feedback.score >= 80 ? 'good' : feedback.score >= 50 ? 'warn' : 'bad'} size="md">
              {Math.round(feedback.score)} / 100
            </Badge>
          </div>
          <ul className="explain__rows">
            {feedbackRows(feedback).map((row, i) => (
              <li key={`${row.label}-${i}`} className="explain__row">
                <Badge tone={row.tone} className="explain__badge">
                  {row.label}
                </Badge>
                <span>{row.text}</span>
              </li>
            ))}
          </ul>
          <p className="explain__saved">
            <NotebookPen size={14} aria-hidden="true" />
            Saved to this topic's notes, with this feedback.
          </p>
          <div>
            <Button variant="secondary" iconEnd={<ArrowRight size={16} aria-hidden="true" />} onClick={onNext}>
              Go to practice
            </Button>
          </div>
        </section>
      )}
    </Sheet>
  )
}
