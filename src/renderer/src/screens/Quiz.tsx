import { useState } from 'react'
import { useParams } from 'react-router'
import { ArrowLeft, BookOpen, Layers, NotebookTabs } from 'lucide-react'
import type { QuizResult } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { QuizResults } from '../components/quiz/QuizResults'
import { QuizRunner } from '../components/quiz/QuizRunner'
import { BackLink, Button, EmptyState, LoadingBlock, Page, PageHeader } from '../components/ui'
import { isApiError } from '../lib/api'
import { formatDate, formatMinutes, pluralize } from '../lib/format'
import { usePomodoroNotebook } from '../lib/pomodoro'
import { useNotebook, useQuiz, useQuizResult } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/** A quiz or mock exam: the runner while it is open, the results once it is submitted. */
export default function QuizScreen() {
  const { quizId } = useParams()
  const quiz = useQuiz(quizId)
  const notebookId = quiz.data?.notebookId
  const notebook = useNotebook(notebookId)
  usePomodoroNotebook(notebookId)
  useDocumentTitle(quiz.data?.title ?? 'Quiz')

  // The result handed back by submit shows at once; a reload reads it with getQuizResult.
  const [result, setResult] = useState<QuizResult | null>(null)
  const localResult = result && result.quiz.id === quizId ? result : null
  const submitted = !!quiz.data?.submittedAt || localResult !== null
  const stored = useQuizResult(quizId, { enabled: !!quiz.data?.submittedAt && !localResult })
  const shownResult = localResult ?? stored.data ?? null

  if (quiz.isPending) {
    return (
      <Page width="narrow">
        <LoadingBlock label="Opening the quiz…" />
      </Page>
    )
  }

  if (quiz.error || !quiz.data) {
    const gone = isApiError(quiz.error) && quiz.error.code === 'NOT_FOUND'
    return (
      <Page width="narrow">
        <BackLink to={ROUTES.notebooks}>Notebooks</BackLink>
        {gone ? (
          <EmptyState
            kicker="this page was torn out"
            title="This quiz doesn't exist anymore"
            action={
              <Button to={ROUTES.notebooks} icon={<BookOpen size={16} aria-hidden="true" />}>
                Back to notebooks
              </Button>
            }
          >
            It may have been deleted, or its notebook was.
          </EmptyState>
        ) : (
          <ErrorNotice error={quiz.error} onRetry={() => void quiz.refetch()} title="This quiz couldn't be opened" />
        )}
      </Page>
    )
  }

  const data = quiz.data
  const isExam = data.kind === 'mock_exam'
  const notebookName = notebook.data?.name ?? 'Notebook'
  const description = [
    pluralize(data.questions.length, 'question'),
    isExam && data.settings.timeLimitMin !== null ? `${formatMinutes(data.settings.timeLimitMin)} on the clock` : null,
    data.submittedAt ? `submitted ${formatDate(data.submittedAt, 'datetime')}` : `made ${formatDate(data.createdAt, 'datetime')}`
  ]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <PageHeader before={<BackLink to={ROUTES.notebook(data.notebookId)}>{notebookName}</BackLink>} title={data.title} description={description} />
  )

  if (submitted) {
    return (
      <Page width="narrow">
        {header}
        {shownResult ? (
          <QuizResults
            result={shownResult}
            actions={
              <>
                {data.topicId && data.kind === 'practice' ? (
                  <Button to={ROUTES.topic(data.topicId, 'remember')} icon={<ArrowLeft size={16} aria-hidden="true" />}>
                    Back to the topic
                  </Button>
                ) : (
                  <Button to={ROUTES.notebook(data.notebookId)} icon={<NotebookTabs size={16} aria-hidden="true" />}>
                    Back to {notebookName}
                  </Button>
                )}
                {shownResult.cardsCreated > 0 && (
                  <Button to={ROUTES.review(data.notebookId)} variant="secondary" icon={<Layers size={16} aria-hidden="true" />}>
                    Review your mistakes now
                  </Button>
                )}
              </>
            }
          />
        ) : stored.error ? (
          <ErrorNotice error={stored.error} onRetry={() => void stored.refetch()} title="Your results couldn't be loaded" />
        ) : (
          <LoadingBlock label="Loading your results…" />
        )}
      </Page>
    )
  }

  return (
    <Page width={isExam ? 'default' : 'narrow'}>
      {header}
      <QuizRunner key={data.id} quiz={data} onSubmitted={setResult} />
    </Page>
  )
}
