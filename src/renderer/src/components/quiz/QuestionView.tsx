import { useId, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { QUESTION_TYPE_LABELS, type Question } from '@shared/types'
import { Markdown } from '../Markdown'
import { TextField } from '../ui'
import { isChoiceQuestion, optionLetter } from './quizModel'
import './QuestionView.css'

export interface QuestionViewProps {
  question: Question
  /** "Q3" label; omit for a single question (warm-up, check). */
  number?: number
  /** Shown after the type label, e.g. the topic ("Heaps, from week 5"). */
  meta?: ReactNode
  /** Show the "Multiple choice" label. Default true. */
  showType?: boolean
  /** The current answer: the chosen option, or the typed text. */
  response: string
  /** Called with a picked option or typed text. */
  onResponse?: (value: string) => void
  /** Enter in the text field (e.g. to check a single question). */
  onSubmitText?: () => void
  /** No more changes (answered or submitted). */
  locked?: boolean
  /** Color the correct option green and a wrong pick red. */
  reveal?: boolean
  /** Whether the response was right, for the text field's border after grading. */
  correct?: boolean | null
  /** lg: one question per screen (mock exam, review); md: lists and lessons. */
  size?: 'md' | 'lg'
  /** grid: two columns of options when they are short; list: one column. */
  layout?: 'grid' | 'list'
  /** Focus the text field when it appears. */
  autoFocusInput?: boolean
  /** Confidence picker, feedback... rendered under the answer area. */
  children?: ReactNode
  className?: string
}

// Long options read better one per line; short ones fit two per row as in the prototype.
const GRID_MAX_OPTION_LENGTH = 48

/** Fill-in prompts mark the blank with "____"; escape it so Markdown never reads it as emphasis or a rule. */
function promptMarkdown(question: Question): string {
  if (question.type !== 'fill') return question.prompt
  return question.prompt.replace(/_{3,}/g, (run) => '\\_'.repeat(Math.max(run.length, 6)))
}

/**
 * One question of any type: options A-D as buttons for multiple choice and
 * true/false, a text field for fill-in-the-blank and identification. The
 * parent owns the answer and decides when to lock and reveal it.
 */
export function QuestionView({
  question,
  number,
  meta,
  showType = true,
  response,
  onResponse,
  onSubmitText,
  locked = false,
  reveal = false,
  correct = null,
  size = 'md',
  layout,
  autoFocusInput = false,
  children,
  className
}: QuestionViewProps) {
  const promptId = useId()
  const choice = isChoiceQuestion(question)
  const effectiveLayout =
    layout ?? (question.options.every((o) => o.length <= GRID_MAX_OPTION_LENGTH) && question.options.length !== 3 ? 'grid' : 'list')

  return (
    <div
      className={['quiz-q', `quiz-q--${size}`, className].filter(Boolean).join(' ')}
      data-question-id={question.id}
      role="group"
      aria-labelledby={promptId}
    >
      {(number !== undefined || showType || meta !== undefined) && (
        <div className="quiz-q__meta">
          {number !== undefined && <span className="quiz-q__number">Q{number}</span>}
          {showType && <span className="quiz-q__type">{QUESTION_TYPE_LABELS[question.type]}</span>}
          {meta !== undefined && <span className="quiz-q__topic">{meta}</span>}
        </div>
      )}

      <div id={promptId} className="quiz-q__prompt">
        {number !== undefined && <span className="sr-only">Question {number}: </span>}
        <Markdown className="quiz-q__prompt-md">{promptMarkdown(question)}</Markdown>
      </div>

      {choice ? (
        <div className={`quiz-q__options quiz-q__options--${effectiveLayout}`}>
          {question.options.map((option, index) => {
            const selected = response === option
            const isAnswer = reveal && option === question.answer
            const isWrongPick = reveal && selected && !isAnswer
            const state = isAnswer ? 'correct' : isWrongPick ? 'wrong' : selected ? 'selected' : 'idle'
            return (
              <button
                key={`${index}-${option}`}
                type="button"
                className={`quiz-option quiz-option--${state}`}
                aria-pressed={selected}
                // Locked options stay readable and focusable; aria-disabled keeps them in the tab order.
                aria-disabled={locked || undefined}
                onClick={() => {
                  if (!locked) onResponse?.(option)
                }}
              >
                <span className="quiz-option__letter" aria-hidden="true">
                  {isAnswer ? <Check size={14} strokeWidth={3} /> : isWrongPick ? <X size={14} strokeWidth={3} /> : optionLetter(index)}
                </span>
                <span className="quiz-option__label">
                  <span className="sr-only">{optionLetter(index)}. </span>
                  <Markdown inline>{option}</Markdown>
                  {isAnswer && <span className="sr-only"> (correct answer)</span>}
                  {isWrongPick && <span className="sr-only"> (your answer, not correct)</span>}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <TextField
          label={number !== undefined ? `Your answer for question ${number}` : 'Your answer'}
          hideLabel
          className="quiz-q__field"
          inputClassName={[
            'quiz-q__input',
            reveal && correct === true && 'quiz-q__input--correct',
            reveal && correct === false && 'quiz-q__input--wrong'
          ]
            .filter(Boolean)
            .join(' ')}
          placeholder="Type your answer"
          autoComplete="off"
          spellCheck={false}
          value={response}
          readOnly={locked}
          autoFocus={autoFocusInput}
          onChange={(event) => onResponse?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && onSubmitText) {
              event.preventDefault()
              onSubmitText()
            }
          }}
        />
      )}

      {children}
    </div>
  )
}
