import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowLeft, BookOpen, Layers } from 'lucide-react'
import type { ReviewCard } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { ReviewFlow } from '../components/review/ReviewFlow'
import { BackLink, Button, EmptyState, LoadingBlock, Page, PageHeader } from '../components/ui'
import { pluralize } from '../lib/format'
import { usePomodoroNotebook } from '../lib/pomodoro'
import { useNotebook, useReviewQueue } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'

interface Run {
  key: number
  cards: ReviewCard[]
}

/** Free review of due cards, across subjects or for one notebook (?notebook=<id>). */
export default function ReviewScreen() {
  const [params] = useSearchParams()
  const notebookId = params.get('notebook') ?? undefined
  const notebook = useNotebook(notebookId)
  usePomodoroNotebook(notebookId)
  useDocumentTitle(notebook.data ? `Review: ${notebook.data.name}` : 'Review')

  // The flow works on a snapshot: grading invalidates the live queue, which must not reshuffle the card on screen.
  const queue = useReviewQueue(notebookId ? { notebookId } : {}, { staleTime: Infinity, refetchOnWindowFocus: false })
  const [run, setRun] = useState<Run | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  useEffect(() => {
    if (!run && queue.data) setRun({ key: 0, cards: queue.data })
  }, [run, queue.data])

  // After a run the queue refetches; only data newer than the finish counts as "more".
  const moreDue = finishedAt !== null && queue.dataUpdatedAt > finishedAt ? (queue.data?.length ?? 0) : 0
  const nextCards = queue.data
  const backTo = notebookId ? ROUTES.notebook(notebookId) : ROUTES.today
  const backLabel = notebookId ? (notebook.data?.name ?? 'Notebook') : 'Today'

  const header = (
    <PageHeader
      before={<BackLink to={backTo}>{backLabel}</BackLink>}
      title={notebook.data ? `Review ${notebook.data.name}` : 'Review due cards'}
      description="Recall each answer before you look. Cards come back just before you'd forget them."
    />
  )

  if (queue.isPending || (notebookId && notebook.isPending)) {
    return (
      <Page width="narrow">
        {header}
        <LoadingBlock label="Finding the cards that are due…" />
      </Page>
    )
  }

  const loadError = queue.error ?? notebook.error
  if (loadError && !run) {
    return (
      <Page width="narrow">
        {header}
        <ErrorNotice error={loadError} title="Your cards couldn't be loaded" onRetry={() => void queue.refetch()} />
      </Page>
    )
  }

  if (!run || run.cards.length === 0) {
    return (
      <Page width="narrow">
        {header}
        <EmptyState
          kicker="nothing due!"
          title="All caught up"
          action={
            <>
              <Button to={backTo} icon={<ArrowLeft size={16} aria-hidden="true" />}>
                Back to {backLabel}
              </Button>
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
            {moreDue > 0 && nextCards && (
              <Button
                variant="secondary"
                icon={<Layers size={16} aria-hidden="true" />}
                onClick={() => {
                  setFinishedAt(null)
                  setRun({ key: run.key + 1, cards: nextCards })
                }}
              >
                Review {pluralize(moreDue, 'more card')}
              </Button>
            )}
          </>
        )}
      />
    </Page>
  )
}
