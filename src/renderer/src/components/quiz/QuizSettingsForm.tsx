import { useState, type FormEvent, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type Difficulty, type QuestionType, type QuizSettings } from '@shared/types'
import { Button, ChipGroup, ChipToggle, Segmented, Switch } from '../ui'
import { DEFAULT_PRACTICE_SETTINGS, PRACTICE_COUNTS } from './quizModel'
import './QuizSettingsForm.css'

export interface QuizSettingsFormProps {
  initial?: QuizSettings
  onSubmit: (settings: QuizSettings) => void
  /** Disables the form while the quiz is being written. */
  pending?: boolean
  submitLabel?: string
  /** Show the "Mix in earlier topics" switch (practice on a topic). Default true. */
  showInterleave?: boolean
  /** A line under the form, e.g. what the questions are drawn from. */
  note?: ReactNode
  className?: string
}

const DIFFICULTY_OPTIONS: { value: Difficulty | 'mixed'; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'mixed', label: 'Mixed' }
]

const COUNT_OPTIONS = PRACTICE_COUNTS.map((count) => ({ value: String(count), label: String(count) }))

/** Question types, count, difficulty and the interleaving/weak-spot switches for a practice quiz. */
export function QuizSettingsForm({
  initial = DEFAULT_PRACTICE_SETTINGS,
  onSubmit,
  pending = false,
  submitLabel = 'Write my questions',
  showInterleave = true,
  note,
  className
}: QuizSettingsFormProps) {
  const [types, setTypes] = useState<QuestionType[]>(initial.types)
  const [count, setCount] = useState(initial.count)
  const [difficulty, setDifficulty] = useState<Difficulty | 'mixed'>(initial.difficulty)
  const [interleave, setInterleave] = useState(initial.interleave)
  const [focusWeak, setFocusWeak] = useState(initial.focusWeak)
  const noTypes = types.length === 0

  const toggleType = (type: QuestionType, on: boolean) =>
    // Keep the canonical order so the request (and the AI's prompt cache) stays stable.
    setTypes((current) => QUESTION_TYPES.filter((t) => (t === type ? on : current.includes(t))))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (noTypes || pending) return
    onSubmit({ types, count, difficulty, interleave: showInterleave && interleave, focusWeak, timeLimitMin: null })
  }

  return (
    <form className={['quiz-settings', className].filter(Boolean).join(' ')} onSubmit={submit} aria-label="Practice settings">
      <div className="quiz-settings__row">
        <span className="quiz-settings__label" aria-hidden="true">
          Question types
        </span>
        <ChipGroup label="Question types">
          {QUESTION_TYPES.map((type) => (
            <ChipToggle key={type} pressed={types.includes(type)} onChange={(on) => toggleType(type, on)} disabled={pending}>
              {QUESTION_TYPE_LABELS[type]}
            </ChipToggle>
          ))}
        </ChipGroup>
      </div>
      {noTypes && (
        <p className="quiz-settings__error" role="alert">
          Turn on at least one question type.
        </p>
      )}

      <div className="quiz-settings__grid">
        <div className="quiz-settings__row">
          <span className="quiz-settings__label" aria-hidden="true">
            Questions
          </span>
          <Segmented label="Number of questions" value={String(count)} onChange={(v) => setCount(Number(v))} options={COUNT_OPTIONS} />
        </div>
        <div className="quiz-settings__row">
          <span className="quiz-settings__label" aria-hidden="true">
            Difficulty
          </span>
          <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={DIFFICULTY_OPTIONS} />
        </div>
      </div>

      <div className="quiz-settings__switches">
        {showInterleave && (
          <Switch
            label="Mix in earlier topics"
            description="Practising older topics alongside this one teaches you to pick the right idea, not just repeat the last one."
            checked={interleave}
            onChange={setInterleave}
            disabled={pending}
          />
        )}
        <Switch
          label="Focus on my weak spots"
          description="More questions on what you have missed before."
          checked={focusWeak}
          onChange={setFocusWeak}
          disabled={pending}
        />
      </div>

      <div className="quiz-settings__actions">
        <Button type="submit" icon={<Sparkles size={16} aria-hidden="true" />} loading={pending} disabled={noTypes}>
          {submitLabel}
        </Button>
        {note !== undefined && <span className="quiz-settings__note">{note}</span>}
      </div>
    </form>
  )
}
