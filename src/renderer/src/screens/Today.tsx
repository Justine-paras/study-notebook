import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Plus } from 'lucide-react'
import { NOTEBOOK_COLORS } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button, EmptyState, LoadingBlock, Page, PageHeader, Sheet } from '../components/ui'
import { ComingUp } from '../components/today/ComingUp'
import { MemoryCheck } from '../components/today/MemoryCheck'
import { NotebookDialog } from '../components/today/NotebookDialog'
import { NotebookShelf } from '../components/today/NotebookShelf'
import { PlanSheet } from '../components/today/PlanSheet'
import { suggestNotebookColor } from '../components/today/notebookForm'
import { nothingDueTarget, sessionTimerAction, todayState } from '../components/today/todayModel'
import { useNow } from '../components/today/useNow'
import { formatDate, greeting } from '../lib/format'
import { usePomodoro } from '../lib/pomodoro'
import { useToday } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Today.css'

export default function TodayScreen() {
  useDocumentTitle('Today')
  const now = useNow()
  const today = useToday()
  const pomodoro = usePomodoro()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const header = (
    <PageHeader
      kicker={formatDate(now, 'full', now)}
      title={greeting(now)}
      description="Your plan is built from what you're about to forget, what you keep missing, and what's next on the syllabus."
      size="xl"
    />
  )

  if (today.isPending) {
    return (
      <Page>
        {header}
        <LoadingBlock label="Building today's plan…" />
      </Page>
    )
  }

  if (today.error) {
    return (
      <Page>
        {header}
        <ErrorNotice error={today.error} title="Couldn't build today's plan" onRetry={() => void today.refetch()} />
      </Page>
    )
  }

  const overview = today.data
  const state = todayState(overview)
  const newColor = suggestNotebookColor(
    overview.notebooks.map((n) => n.color),
    NOTEBOOK_COLORS
  )
  const dialog = (
    <NotebookDialog
      open={creating}
      onClose={() => setCreating(false)}
      defaultColor={newColor}
      onCreated={(notebook) => navigate(ROUTES.notebook(notebook.id))}
    />
  )

  if (state === 'no_notebooks') {
    return (
      <Page>
        {header}
        <Sheet as="section" raised className="today__welcome" aria-label="Get started">
          <EmptyState
            kicker="a fresh start"
            title="Create your first notebook"
            action={
              <Button size="lg" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setCreating(true)}>
                Create your first notebook
              </Button>
            }
          >
            One notebook per subject. Add your syllabus and lecture files to it, and each day's plan will build itself
            from what you study.
          </EmptyState>
        </Sheet>
        {dialog}
      </Page>
    )
  }

  function startSession() {
    const action = sessionTimerAction(pomodoro.phase, pomodoro.status)
    if (action === 'skip_break_and_start') pomodoro.skip()
    if (action !== 'none') pomodoro.start()
    navigate(ROUTES.session())
  }

  return (
    <Page>
      {header}
      <div className="split">
        <div className="split__main">
          <PlanSheet
            plan={overview.plan}
            focusMinutes={pomodoro.focusMinutes}
            onStart={startSession}
            focusRunning={pomodoro.isRunning && pomodoro.phase === 'focus'}
            nothingDueTo={nothingDueTarget(overview.notebooks)}
          />
        </div>
        <aside className="split__side" aria-label="Exams and memory">
          <ComingUp exams={overview.exams} />
          <MemoryCheck
            recallRate7d={overview.recallRate7d}
            longTermCards={overview.longTermCards}
            studyMinutesToday={overview.studyMinutesToday}
          />
        </aside>
      </div>

      <section className="today__shelf" aria-labelledby="today-shelf-title">
        <div className="today__shelf-head">
          <h2 id="today-shelf-title" className="caps-label">
            Notebooks
          </h2>
          <Button to={ROUTES.notebooks} variant="ghost" size="sm" iconEnd={<ArrowRight size={16} aria-hidden="true" />}>
            All notebooks
          </Button>
        </div>
        <NotebookShelf notebooks={overview.notebooks} label="Your notebooks" onCreate={() => setCreating(true)} now={now} />
      </section>
      {dialog}
    </Page>
  )
}
