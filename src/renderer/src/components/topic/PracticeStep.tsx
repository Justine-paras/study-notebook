import { useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import type { ID, QuizResult, TopicWithProgress } from '@shared/types'
import { useAiAction } from '../../lib/aiJobs'
import { useQuiz, useQuizResult, useQuizzes } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { QuizResults } from '../quiz/QuizResults'
import { QuizRunner } from '../quiz/QuizRunner'
import { QuizSettingsForm } from '../quiz/QuizSettingsForm'
import { DEFAULT_PRACTICE_SETTINGS, latestTopicQuiz } from '../quiz/quizModel'
import { Button, LoadingBlock, Sheet } from '../ui'
import './PracticeStep.css'

export interface PracticeStepProps {
  topic: TopicWithProgress
  onContinue: () => void
}

/**
 * Step 4: an AI quiz on this topic (mixed with earlier ones when chosen),
 * answered inline with a confidence per question, then the results. The
 * newest practice quiz of the topic is resumed, so leaving mid-quiz loses
 * nothing.
 */
export function PracticeStep({ topic, onContinue }: PracticeStepProps) {
  const quizzes = useQuizzes(topic.notebookId, 'practice')
  const [chosenQuizId, setChosenQuizId] = useState<ID | null>(null)
  const [wantsNew, setWantsNew] = useState(false)
  const [result, setResult] = useState<QuizResult | null>(null)
  // A job: writing questions takes a minute or two and must survive leaving the page.
  // When it finishes elsewhere, the topic's newest practice quiz is the new one.
  const create = useAiAction('createQuiz', `practice:${topic.id}`, {
    task: 'quiz',
    label: `Practice questions on ${topic.title}`,
    href: ROUTES.topic(topic.id, 'practice'),
    onSuccess: (quiz) => {
      setChosenQuizId(quiz.id)
      setWantsNew(false)
      setResult(null)
    }
  })

  const latest = quizzes.data ? latestTopicQuiz(quizzes.data, topic.id) : null
  const quizId = wantsNew ? null : (chosenQuizId ?? latest?.id ?? null)
  const quiz = useQuiz(quizId ?? undefined)
  // The local result counts at once; the refetched quiz catches up a moment later.
  const submitted = !!quiz.data?.submittedAt || (result !== null && result.quiz.id === quizId)
  const storedResult = useQuizResult(quizId ?? undefined, { enabled: submitted && result?.quiz.id !== quizId })
  const shownResult = result?.quiz.id === quizId ? result : (storedResult.data ?? null)

  const generate = (settings = latest?.settings ?? DEFAULT_PRACTICE_SETTINGS) =>
    create.run({ notebookId: topic.notebookId, topicId: topic.id, kind: 'practice', settings: { ...settings, timeLimitMin: null }, topicIds: [] })

  if (create.isPending) {
    return <AiWorking task="quiz" title={`Writing practice questions on ${topic.title}`} startedAt={create.job?.startedAt} subjectId={topic.id} />
  }

  if (quizzes.isPending || (quizId && quiz.isPending)) return <LoadingBlock label="Opening your practice…" />

  const loadError = quizzes.error ?? (quizId ? quiz.error : null)
  if (loadError) {
    return <ErrorNotice error={loadError} onRetry={() => void (quizzes.error ? quizzes.refetch() : quiz.refetch())} title="Your practice couldn't be loaded" />
  }

  if (!quizId || !quiz.data) {
    return (
      <div className="practice">
        <Sheet raised kicker="mixed practice" title="Practice" as="section">
          <p className="practice__intro">
            Questions on {topic.title}, from your files. Rate how sure you are on each answer: answers you were sure about but got
            wrong are the ones worth fixing first.
          </p>
          <QuizSettingsForm
            key={latest?.id ?? 'new'}
            initial={latest?.settings ?? DEFAULT_PRACTICE_SETTINGS}
            onSubmit={generate}
            pending={create.isPending}
            note="Takes a minute or two to write."
          />
          <ErrorNotice
            error={create.error}
            onRetry={() => generate()}
            onDismiss={create.dismiss}
            addFilesTo={ROUTES.notebook(topic.notebookId)}
            title="Your questions couldn't be written"
          />
          {latest && wantsNew && (
            <div>
              <Button variant="ghost" onClick={() => setWantsNew(false)}>
                Back to my last practice
              </Button>
            </div>
          )}
        </Sheet>
      </div>
    )
  }

  if (submitted) {
    if (!shownResult) {
      return storedResult.error ? (
        <ErrorNotice error={storedResult.error} onRetry={() => void storedResult.refetch()} title="Your results couldn't be loaded" />
      ) : (
        <LoadingBlock label="Loading your results…" />
      )
    }
    return (
      <QuizResults
        result={shownResult}
        actions={
          <>
            <Button size="lg" iconEnd={<ArrowRight size={18} aria-hidden="true" />} onClick={onContinue}>
              Continue to Remember
            </Button>
            <Button size="lg" variant="secondary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => setWantsNew(true)}>
              New questions
            </Button>
          </>
        }
      />
    )
  }

  return (
    <QuizRunner
      key={quiz.data.id}
      quiz={quiz.data}
      title="Practice"
      intro={
        quiz.data.settings.interleave
          ? 'Mixed with older topics so you practice choosing the right idea, not just repeating the last one.'
          : undefined
      }
      onSubmitted={(graded) => {
        setChosenQuizId(graded.quiz.id)
        setResult(graded)
      }}
    />
  )
}
