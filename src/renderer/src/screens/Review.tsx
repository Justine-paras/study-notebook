import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowLeft, BookOpen, Layers } from 'lucide-react'
import type { ID, ReviewCard } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { ReviewFlow } from '../components/review/ReviewFlow'
import { BackLink, Button, EmptyState, LoadingBlock, Page, PageHeader } from '../components/ui'
import { isApiError } from '../lib/api'
import { pluralize } from '../lib/format'
import { usePomodoroNotebook } from '../lib/pomodoro'
import { useNotebook, useReviewQueue, useTopic } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'

interface Run {
  key: number
  cards: ReviewCard[]
  /** Every card shown in this visit, so a topic's next run only offers cards not seen yet. */
  shown: ReadonlySet<ID>
}

/**
 * Free review: due cards across subjects or for one notebook (?notebook=<id>),
 * or one topic's cards whether due or not (?topic=<id>, for a weak topic).
 */
export default function ReviewScreen() {
  const [params] = useSearchParams()
  const topicId = params.get('topic') ?? undefined
  // A topic belongs to one notebook, so a topic review ignores ?notebook.
  const notebookId = topicId ? undefined : (params.get('notebook') ?? undefined)
  // Keyed: nothing from one queue's run may carry over to another's.
  return <ReviewView key={`${topicId ?? ''}|${notebookId ?? ''}`} topicId={topicId} notebookId={notebookId} />
}

function ReviewView({ topicId, notebookId }: { topicId: ID | undefined; notebookId: ID | undefined }) {
  const notebook = useNotebook(notebookId)
  const topic = useTopic(topicId)
  usePomodoroNotebook(notebookId ?? topic.data?.notebookId)
  const scopeName = topicId ? topic.data?.title : notebook.data?.name
  useDocumentTitle(scopeName ? `Review: ${scopeName}` : 'Review')

  // The flow works on a snapshot: grading invalidates the live queue, which must not reshuffle the card on screen.
  const queue = useReviewQueue(topicId ? { topicIds: [topicId] } : notebookId ? { notebookId } : {}, {
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })
  const [run, setRun] = useState<Run | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  // Only fresh data: a queue cached from an earlier visit may still hold cards graded since.
  const settled = queue.isSuccess && !queue.isFetching
  useEffect(() => {
    if (!run && settled && queue.data) setRun({ key: 0, cards: queue.data, shown: new Set(queue.data.map((c) => c.id)) })
  }, [run, settled, queue.data])

  // After a run the queue refetches; only data newer than the finish counts as "more". A topic's
  // queue also holds the cards that aren't due, so there only cards this visit hasn't shown count.
  const refreshed = finishedAt !== null && queue.dataUpdatedAt > finishedAt ? (queue.data ?? []) : []
  const nextCards = topicId && run ? refreshed.filter((c) => !run.shown.has(c.id)) : refreshed
  const backTo = topicId ? ROUTES.topic(topicId) : notebookId ? ROUTES.notebook(notebookId) : ROUTES.today
  const backLabel = topicId ? (topic.data?.title ?? 'Topic') : notebookId ? (notebook.data?.name ?? 'Notebook') : 'Today'

  let title = 'Review due cards'
  if (topicId) title = topic.data ? `Review: ${topic.data.title}` : 'Review cards'
  else if (notebook.data) title = `Review ${notebook.data.name}`

  const header = (
    <PageHeader
      before={<BackLink to={backTo}>{backLabel}</BackLink>}
      title={title}
      description={
        topicId
          ? "Recall each answer before you look. Cards that are due come first, then the ones you're closest to forgetting."
          : "Recall each answer before you look. Cards come back just before you'd forget them."
      }
    />
  )

  if (queue.isPending || (!run && queue.isFetching) || (notebookId && notebook.isPending) || (topicId && topic.isPending)) {
    return (
      <Page width="narrow">
        {header}
        <LoadingBlock label={topicId ? 'Gathering the cards for this topic…' : 'Finding the cards that are due…'} />
      </Page>
    )
  }

  const loadError = queue.error ?? notebook.error ?? topic.error
  if (loadError && !run) {
    if (topicId && isApiError(loadError) && loadError.code === 'NOT_FOUND') {
      return (
        <Page width="narrow">
          <BackLink to={ROUTES.notebooks}>Notebooks</BackLink>
          <EmptyState
            kicker="this page was torn out"
            title="This topic doesn't exist anymore"
            action={
              <Button to={ROUTES.notebooks} icon={<BookOpen size={16} aria-hidden="true" />}>
                Back to notebooks
              </Button>
            }
          >
            It may have been deleted from its notebook, along with its flashcards.
          </EmptyState>
        </Page>
      )
    }
    return (
      <Page width="narrow">
        {header}
        <ErrorNotice error={loadError} title="Your cards couldn't be loaded" onRetry={() => void queue.refetch()} />
      </Page>
    )
  }

  if (!run || run.cards.length === 0) {
    const back = (
      <Button to={backTo} icon={<ArrowLeft size={16} aria-hidden="true" />}>
        Back to {backLabel}
      </Button>
    )
    if (topicId) {
      return (
        <Page width="narrow">
          {header}
          <EmptyState kicker="nothing to review yet" title="No flashcards for this topic yet" action={back}>
            A topic's cards are made when you finish its learning path (the Remember step) and from the quiz questions you miss.
            Once it has some, you can review them here any time, even before they're due.
          </EmptyState>
        </Page>
      )
    }
    return (
      <Page width="narrow">
        {header}
        <EmptyState
          kicker="nothing due!"
          title="All caught up"
          action={
            <>
              {back}
              {!notebookId && (
                <Button to={ROUTES.notebooks} variant="subtle" icon={<BookOpen size={16} aria-hidden="true" />}>
                  Learn a new topic
                </Button>
              )}
            </>
          }
        >
          No cards are due {notebookId ? 'in this notebook ' : ''}right now. Each card comes back just before you would start to forget
          it, so there's nothing to gain from reviewing early.
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page width="narrow">
      {header}
      <ReviewFlow
        key={run.key}
        cards={run.cards}
        onDone={() => setFinishedAt(Date.now())}
        renderSummaryActions={() => (
          <>
            <Button to={backTo} icon={<ArrowLeft size={16} aria-hidden="true" />}>
              Back to {backLabel}
            </Button>
            {nextCards.length > 0 && (
              <Button
                variant="secondary"
                icon={<Layers size={16} aria-hidden="true" />}
                onClick={() => {
                  setFinishedAt(null)
                  setRun({ key: run.key + 1, cards: nextCards, shown: new Set([...run.shown, ...nextCards.map((c) => c.id)]) })
                }}
              >
                Review {pluralize(nextCards.length, 'more card')}
              </Button>
            )}
          </>
        )}
      />
    </Page>
  )
}
