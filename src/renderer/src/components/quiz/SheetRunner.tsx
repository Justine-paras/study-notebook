import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import type { Quiz, QuizResult } from '@shared/types'
import { pluralize } from '../../lib/format'
import { useHotkeys } from '../../lib/useHotkeys'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Kbd, Sheet, useConfirm } from '../ui'
import { ConfidencePicker } from './ConfidencePicker'
import { QuestionView } from './QuestionView'
import {
  countAnswered,
  describeQuestionNumbers,
  EMPTY_DRAFT,
  isChoiceQuestion,
  missingConfidenceCount,
  optionHotkeys,
  optionIndexForKey,
  questionTopicLabel,
  unansweredNumbers
} from './quizModel'
import { useQuizSubmit } from './useQuizSubmit'
import { SaveStatusText } from './SaveStatusText'
import { useQuizAnswers } from './useQuizAnswers'
import { useTopicLookup } from './useTopicLabels'
import './SheetRunner.css'

export interface SheetRunnerProps {
  quiz: Quiz
  onSubmitted: (result: QuizResult) => void
  title?: ReactNode
  intro?: ReactNode
}

const DEFAULT_INTROS: Partial<Record<Quiz['kind'], string>> = {
  weak_spots: 'Questions on the topics you keep missing. Rate how sure you are on each one.',
  practice: 'Answer from memory, then rate how sure you are. Your confidence shows what you only think you know.'
}

/** Practice and weak-spot quizzes: every question on one lined sheet, checked together. */
export function SheetRunner({ quiz, onSubmitted, title, intro }: SheetRunnerProps) {
  const answers = useQuizAnswers(quiz)
  const { labels } = useTopicLookup(quiz.notebookId)
  const { submit, pending, error } = useQuizSubmit(quiz, answers, onSubmitted)
  const confirm = useConfirm()
  const { drafts } = answers
  const total = quiz.questions.length
  const answered = countAnswered(quiz.questions, drafts)
  const unrated = missingConfidenceCount(quiz.questions, drafts)

  const check = async () => {
    if (pending) return
    const missing = unansweredNumbers(quiz.questions, drafts)
    if (missing.length > 0) {
      const ok = await confirm({
        title: 'Check your answers now?',
        message: `${describeQuestionNumbers(missing).replace(/^q/, 'Q')} ${missing.length === 1 ? 'has' : 'have'} no answer yet and will count as missed.`,
        confirmLabel: 'Check answers',
        cancelLabel: 'Keep answering'
      })
      if (!ok) return
    }
    await submit()
  }

  // Option keys act on the question that has focus (a sheet has many questions).
  const pickForFocused = (event: KeyboardEvent) => {
    const holder = document.activeElement?.closest<HTMLElement>('[data-question-id]')
    const question = holder ? quiz.questions.find((q) => q.id === holder.dataset.questionId) : undefined
    if (!question || !isChoiceQuestion(question)) return
    const index = optionIndexForKey(event.key, question.options.length)
    if (index !== null) answers.setResponse(question.id, question.options[index]!)
  }
  useHotkeys(
    {
      ...Object.fromEntries(optionHotkeys(5).map((combo) => [combo, pickForFocused])),
      'mod+enter': () => void check()
    },
    { enabled: !pending }
  )

  return (
    <Sheet
      raised
      className="quiz-sheet"
      title={title ?? quiz.title}
      aside={
        <span className="tabular">
          {answered} of {pluralize(total, 'question')} answered
        </span>
      }
    >
      <p className="quiz-sheet__intro">{intro ?? DEFAULT_INTROS[quiz.kind]}</p>

      <ol className="quiz-sheet__list">
        {quiz.questions.map((question, index) => {
          const draft = drafts[question.id] ?? EMPTY_DRAFT
          return (
            <li key={question.id} className="quiz-sheet__item">
              <QuestionView
                question={question}
                number={index + 1}
                meta={questionTopicLabel(question, quiz.topicId, labels) ?? undefined}
                response={draft.response}
                onResponse={(value) => answers.setResponse(question.id, value, { typed: !isChoiceQuestion(question) })}
                locked={pending}
              >
                <ConfidencePicker
                  value={draft.confidence}
                  onChange={(confidence) => answers.setConfidence(question.id, confidence)}
                  disabled={pending}
                />
              </QuestionView>
            </li>
          )
        })}
      </ol>

      <ErrorNotice error={error ?? answers.saveError} onRetry={() => void check()} title="Your answers couldn't be checked" compact />

      <div className="quiz-sheet__footer">
        <Button size="lg" icon={<CircleCheck size={18} aria-hidden="true" />} loading={pending} onClick={() => void check()}>
          Check answers
        </Button>
        <div className="quiz-sheet__status">
          {unrated > 0 ? (
            <span className="hand hand--sm">rate your confidence on {pluralize(unrated, 'answer')} too</span>
          ) : (
            <SaveStatusText status={answers.status} />
          )}
          <span className="quiz-sheet__keys text-xs muted">
            Pick options with <Kbd>1</Kbd>-<Kbd>4</Kbd> or <Kbd>A</Kbd>-<Kbd>D</Kbd> · check with <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
          </span>
        </div>
      </div>
    </Sheet>
  )
}
