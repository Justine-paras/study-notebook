import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Flag, Send, Timer } from 'lucide-react'
import type { ID, Quiz, QuizResult } from '@shared/types'
import { api, toApiError, type ApiError } from '../../lib/api'
import { formatClock, pluralize } from '../../lib/format'
import { queryKeys } from '../../lib/queries'
import { useHotkeys } from '../../lib/useHotkeys'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Kbd, Panel, ProgressBar, Sheet, useConfirm, useToast } from '../ui'
import { ConfidencePicker } from './ConfidencePicker'
import { QuestionView } from './QuestionView'
import {
  countAnswered,
  describeQuestionNumbers,
  EMPTY_DRAFT,
  examDeadline,
  isAnswered,
  isChoiceQuestion,
  navigatorItems,
  navigatorLabel,
  optionHotkeys,
  optionIndexForKey,
  questionTopicLabel,
  remainingMs,
  timerAnnouncement,
  timerTone,
  unansweredNumbers
} from './quizModel'
import { SaveStatusText } from './SaveStatusText'
import { useQuizAnswers } from './useQuizAnswers'
import { useQuizSubmit } from './useQuizSubmit'
import { readStored, writeStored } from './useStoredState'
import { useTicker } from './useTicker'
import { useTopicLookup } from './useTopicLabels'
import './ExamRunner.css'

export interface ExamRunnerProps {
  quiz: Quiz
  onSubmitted: (result: QuizResult) => void
}

function parseFlags(value: unknown): ID[] {
  return Array.isArray(value) ? value.filter((v): v is ID => typeof v === 'string') : []
}

/**
 * A mock exam: one question at a time, a countdown computed from when the
 * exam started (so it survives reloads and auto-submits at zero), a
 * navigator with answered/flagged marks, and every answer autosaved.
 */
export function ExamRunner({ quiz, onSubmitted }: ExamRunnerProps) {
  const answers = useQuizAnswers(quiz)
  const { labels } = useTopicLookup(quiz.notebookId)
  const { submit, pending, error } = useQuizSubmit(quiz, answers, onSubmitted)
  const confirm = useConfirm()
  const toast = useToast()
  const { drafts } = answers
  const questions = quiz.questions
  const total = questions.length

  // The clock starts the first time the exam is opened.
  const [startedAt, setStartedAt] = useState(quiz.startedAt)
  const [startError, setStartError] = useState<ApiError | null>(null)
  const queryClient = useQueryClient()
  useEffect(() => {
    if (startedAt) return
    let cancelled = false
    api.startQuiz(quiz.id).then(
      (started) => {
        // The exam lists show "in progress" from now on.
        void queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(started.notebookId) })
        if (cancelled) return
        queryClient.setQueryData(queryKeys.quiz(started.id), started)
        setStartedAt(started.startedAt)
      },
      (err: unknown) => !cancelled && setStartError(toApiError(err))
    )
    return () => {
      cancelled = true
    }
  }, [quiz.id, startedAt, queryClient])

  const timeLimit = quiz.settings.timeLimitMin
  const timed = timeLimit !== null
  const deadline = examDeadline(startedAt, timeLimit)
  const now = useTicker(1000, !pending)
  const remaining = remainingMs(deadline, now)
  const timeUp = remaining === 0
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0

  const [index, setIndex] = useState(() => {
    const firstOpen = questions.findIndex((q) => !isAnswered(drafts[q.id]))
    return firstOpen === -1 ? 0 : firstOpen
  })
  const flagsKey = `study:quiz-flags:${quiz.id}`
  const [flags, setFlags] = useState<ReadonlySet<ID>>(() => new Set(readStored(flagsKey, parseFlags, [])))
  const question = questions[index]!
  const draft = drafts[question.id] ?? EMPTY_DRAFT
  const flagged = flags.has(question.id)
  const locked = pending || timeUp
  const answered = countAnswered(questions, drafts)

  const toggleFlag = useCallback(() => {
    setFlags((current) => {
      const next = new Set(current)
      if (next.has(question.id)) next.delete(question.id)
      else next.add(question.id)
      writeStored(flagsKey, [...next])
      return next
    })
  }, [flagsKey, question.id])

  const go = useCallback((target: number) => setIndex(Math.min(Math.max(0, target), total - 1)), [total])

  // At zero the exam hands itself in, once.
  const autoSubmittedRef = useRef(false)
  useEffect(() => {
    if (!timeUp || autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    void submit().then((ok) => {
      if (ok) toast.info('Your answers were submitted when the time ran out.', "Time's up")
    })
  }, [timeUp, submit, toast])

  const requestSubmit = async () => {
    if (pending) return
    // After the time is up there is nothing left to confirm (this is a retry of the auto-submit).
    if (timeUp) {
      await submit()
      return
    }
    const missing = unansweredNumbers(questions, drafts)
    const flaggedCount = questions.filter((q) => flags.has(q.id)).length
    const lines = [
      missing.length > 0
        ? `${describeQuestionNumbers(missing).replace(/^q/, 'Q')} ${missing.length === 1 ? 'has' : 'have'} no answer yet and will count as wrong.`
        : 'You answered every question.',
      flaggedCount > 0 ? `${pluralize(flaggedCount, 'question')} ${flaggedCount === 1 ? 'is' : 'are'} still flagged for review.` : null,
      "You can't change answers after submitting."
    ].filter(Boolean)
    const ok = await confirm({
      title: 'Submit your exam?',
      message: lines.join(' '),
      confirmLabel: 'Submit exam',
      cancelLabel: 'Keep working'
    })
    if (ok) await submit()
  }

  useHotkeys(
    {
      ...Object.fromEntries(
        optionHotkeys(5).map((combo) => [
          combo,
          (event: KeyboardEvent) => {
            if (!isChoiceQuestion(question)) return
            const option = optionIndexForKey(event.key, question.options.length)
            if (option !== null) answers.setResponse(question.id, question.options[option]!)
          }
        ])
      ),
      arrowright: () => go(index + 1),
      arrowleft: () => go(index - 1),
      f: toggleFlag,
      'mod+enter': () => void requestSubmit()
    },
    { enabled: !locked }
  )

  const tone = timerTone(remaining)
  const items = navigatorItems(questions, drafts, flags, index)

  return (
    <div className="exam split">
      <section className="split__main exam__main" aria-label={`Question ${index + 1} of ${total}`}>
        <div className="exam__bar">
          <span className="caps-label">
            Question {index + 1} of {total}
          </span>
          <Button
            variant={flagged ? 'secondary' : 'subtle'}
            size="sm"
            icon={<Flag size={16} aria-hidden="true" />}
            aria-pressed={flagged}
            onClick={toggleFlag}
            disabled={locked}
          >
            {flagged ? 'Flagged for review' : 'Flag for review'}
          </Button>
        </div>

        <Sheet raised density="roomy" as="div" className="exam__sheet">
          <QuestionView
            key={question.id}
            question={question}
            size="lg"
            meta={questionTopicLabel(question, null, labels) ?? undefined}
            response={draft.response}
            onResponse={(value) => answers.setResponse(question.id, value, { typed: !isChoiceQuestion(question) })}
            onSubmitText={() => go(index + 1)}
            locked={locked}
            autoFocusInput
          >
            <ConfidencePicker
              value={draft.confidence}
              onChange={(confidence) => answers.setConfidence(question.id, confidence)}
              disabled={locked}
            />
          </QuestionView>
        </Sheet>

        <div className="exam__pager">
          <Button variant="subtle" icon={<ArrowLeft size={16} aria-hidden="true" />} disabled={index === 0} onClick={() => go(index - 1)}>
            Previous
          </Button>
          {index < total - 1 ? (
            <Button iconEnd={<ArrowRight size={16} aria-hidden="true" />} onClick={() => go(index + 1)}>
              Next question
            </Button>
          ) : (
            <Button icon={<Send size={16} aria-hidden="true" />} onClick={() => void requestSubmit()} loading={pending} disabled={timeUp && !error}>
              Review and submit
            </Button>
          )}
        </div>
        <p className="exam__keys text-xs muted">
          <Kbd>1</Kbd>-<Kbd>4</Kbd> or <Kbd>A</Kbd>-<Kbd>D</Kbd> pick an option · <Kbd>←</Kbd> <Kbd>→</Kbd> move between questions ·{' '}
          <Kbd>F</Kbd> flags it
        </p>
        <ErrorNotice error={startError} title="The timer couldn't start" compact />
        <ErrorNotice error={error ?? answers.saveError} onRetry={() => void submit()} title="Your exam couldn't be submitted" compact />
      </section>

      <aside className="split__side exam__side">
        <Panel className={`exam-timer exam-timer--${tone}`} aria-label="Time">
          <div className="exam-timer__head">
            <Timer size={18} aria-hidden="true" />
            <span className="caps-label caps-label--xs">{timed ? 'Time left' : 'Time so far'}</span>
          </div>
          <div className="exam-timer__clock tabular" role="timer" aria-label={timed ? 'Time left' : 'Time so far'}>
            {timed ? formatClock(remaining === null ? timeLimit * 60 : Math.ceil(remaining / 1000)) : formatClock(elapsedSeconds)}
          </div>
          {timed && (
            <ProgressBar
              value={remaining ?? timeLimit * 60_000}
              max={timeLimit * 60_000}
              label="Time left"
              valueText={`${Math.ceil((remaining ?? timeLimit * 60_000) / 60_000)} minutes left`}
              tone={tone === 'critical' ? 'bad' : tone === 'low' ? 'warn' : 'ink'}
              size="sm"
            />
          )}
          <span className="exam-timer__note">
            {!timed ? 'No time limit on this exam.' : timeUp ? 'Time is up.' : 'The exam is handed in automatically at 0:00.'}
          </span>
          <span className="sr-only" aria-live="polite">
            {timerAnnouncement(remaining)}
          </span>
        </Panel>

        <Panel title="Questions" titleStyle="caps" meta={`${answered} of ${total} answered`}>
          <ol className="exam-nav" aria-label="Question navigator">
            {items.map((item) => (
              <li key={item.questionId}>
                <button
                  type="button"
                  className={[
                    'exam-nav__item',
                    item.answered && 'exam-nav__item--answered',
                    item.flagged && 'exam-nav__item--flagged',
                    item.current && 'exam-nav__item--current'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={navigatorLabel(item)}
                  aria-current={item.current ? 'step' : undefined}
                  onClick={() => go(item.number - 1)}
                >
                  {item.number}
                  {item.flagged && <Flag className="exam-nav__flag" size={11} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ol>
          <ul className="exam-nav__legend" aria-hidden="true">
            <li>
              <span className="exam-nav__swatch exam-nav__swatch--answered" />
              Answered
            </li>
            <li>
              <span className="exam-nav__swatch" />
              Not answered
            </li>
            <li>
              <Flag size={12} />
              Flagged
            </li>
          </ul>
          <SaveStatusText status={answers.status} />
        </Panel>

        <Button block size="lg" icon={<Send size={18} aria-hidden="true" />} loading={pending} disabled={timeUp && !error} onClick={() => void requestSubmit()}>
          Submit exam
        </Button>
      </aside>
    </div>
  )
}
