import { useRef, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import type { ID, Question } from '@shared/types'
import { useApiMutation, queryKeys } from '../../lib/queries'
import { useHotkeys } from '../../lib/useHotkeys'
import { ErrorNotice } from '../ErrorNotice'
import { AnswerFeedback } from '../quiz/AnswerFeedback'
import { QuestionView } from '../quiz/QuestionView'
import { isChoiceQuestion, optionHotkeys, optionIndexForKey } from '../quiz/quizModel'
import { Button } from '../ui'
import type { InstantAnswer } from './topicModel'

export interface InstantQuestionProps {
  question: Question
  topicId: ID
  notebookId: ID
  source: 'warmup' | 'check'
  /** The stored answer, when this question was already answered. */
  answer: InstantAnswer | undefined
  onAnswered: (answer: InstantAnswer) => void
  /** Bold first line of the feedback. */
  feedbackTitle: (correct: boolean, question: Question) => string
  /**
   * global: option keys (1-4, A-D) always pick for this question (one question on screen).
   * focus: only while focus is inside it (several questions on screen).
   */
  hotkeyScope?: 'global' | 'focus'
  number?: number
  className?: string
}

/**
 * A warm-up or check question that is graded the moment it is answered
 * (recordAnswer) and shows its feedback right away. Picks submit at once;
 * typed answers submit with Enter or the Check button.
 */
export function InstantQuestion({
  question,
  topicId,
  notebookId,
  source,
  answer,
  onAnswered,
  feedbackTitle,
  hotkeyScope = 'global',
  number,
  className
}: InstantQuestionProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const record = useApiMutation('recordAnswer', {
    // Every answer moves mastery (topic header, notebook, shelf), weak topics
    // and calibration (Today, Insights). The lesson itself is left alone.
    invalidate: [
      queryKeys.topic(topicId),
      queryKeys.topics(notebookId),
      queryKeys.notebook(notebookId),
      queryKeys.notebooks(),
      queryKeys.today(),
      queryKeys.insights()
    ]
  })
  const choice = isChoiceQuestion(question)
  const answered = answer !== undefined
  const response = answer?.response ?? (record.isPending || record.isError ? (record.variables?.[0].response ?? draft) : draft)

  const submit = (value: string) => {
    if (answered || record.isPending || value.trim() === '') return
    record.mutate([{ topicId, source, question, response: value, confidence: null }], {
      onSuccess: ({ correct }) => onAnswered({ response: value, correct })
    })
  }

  useHotkeys(
    Object.fromEntries(
      optionHotkeys(question.options.length).map((combo) => [
        combo,
        (event: KeyboardEvent) => {
          if (hotkeyScope === 'focus' && !rootRef.current?.contains(document.activeElement)) return
          const index = optionIndexForKey(event.key, question.options.length)
          if (index === null) return
          event.preventDefault()
          submit(question.options[index]!)
        }
      ])
    ),
    // Several instant questions can share a screen, so each one decides itself whether to take the key.
    { enabled: choice && !answered && !record.isPending, preventDefault: false }
  )

  return (
    <div ref={rootRef} className={['instant-q', className].filter(Boolean).join(' ')}>
      <QuestionView
        question={question}
        number={number}
        showType={false}
        response={response}
        onResponse={(value) => (choice ? submit(value) : setDraft(value))}
        onSubmitText={() => submit(draft)}
        locked={answered || record.isPending}
        reveal={answered}
        correct={answer?.correct ?? null}
        layout={source === 'check' ? 'list' : undefined}
      >
        {!choice && !answered && (
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon={<CircleCheck size={16} aria-hidden="true" />}
              loading={record.isPending}
              disabled={draft.trim() === ''}
              onClick={() => submit(draft)}
            >
              Check
            </Button>
          </div>
        )}
        <ErrorNotice
          error={record.error}
          title="Your answer wasn't saved"
          onRetry={() => submit(record.variables?.[0].response ?? draft)}
          compact
        />
        {answer && (
          <AnswerFeedback
            live
            correct={answer.correct}
            title={feedbackTitle(answer.correct, question)}
            explanation={question.explanation}
            sourceRef={question.sourceRef}
          />
        )}
      </QuestionView>
    </div>
  )
}
