// Notebook page (/notebooks/:notebookId): the subject's cover, its topics in
// course order with mastery, and the materials behind them (files, exams,
// flashcards, notes, mock exams). See ARCHITECTURE.md "Screen specs".

import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Library } from 'lucide-react'
import type { NotebookSummary, TopicWithProgress } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { AddTopicDialog } from '../components/notebook/AddTopicDialog'
import { CardsPanel } from '../components/notebook/CardsPanel'
import { ExamsPanel } from '../components/notebook/ExamsPanel'
import { MockExamDialog } from '../components/notebook/MockExamDialog'
import { MockExamPanel } from '../components/notebook/MockExamPanel'
import { NotebookHeader } from '../components/notebook/NotebookHeader'
import { NotesPanel } from '../components/notebook/NotesPanel'
import { SourcesPanel } from '../components/notebook/SourcesPanel'
import { useSyllabusExtraction } from '../components/notebook/SyllabusButton'
import { TopicEditDialog } from '../components/notebook/TopicEditDialog'
import { TopicList } from '../components/notebook/TopicList'
import { splitExams } from '../components/notebook/model'
import { useNow } from '../components/notebook/useNow'
import { useSourceImport, useWindowFileDrop } from '../components/notebook/useSourceImport'
import { BackLink, Button, EmptyState, LoadingBlock, Page } from '../components/ui'
import { toApiError } from '../lib/api'
import { usePomodoroNotebook } from '../lib/pomodoro'
import { useCards, useExams, useNotebook, useNotes, useQuizzes, useSources, useTopics } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Notebook.css'

export default function NotebookScreen() {
  const { notebookId } = useParams()
  const notebook = useNotebook(notebookId)
  usePomodoroNotebook(notebookId)
  useDocumentTitle(notebook.data?.name)

  if (notebook.isPending) {
    return (
      <Page width="wide">
        <LoadingBlock label="Opening notebook…" />
      </Page>
    )
  }
  if (notebook.error) {
    const missing = toApiError(notebook.error).code === 'NOT_FOUND'
    return (
      <Page width="wide">
        {missing ? (
          <EmptyState
            kicker="this page is blank"
            title="This notebook isn't here anymore"
            action={
              <Button to={ROUTES.notebooks} icon={<Library size={16} aria-hidden="true" />}>
                See all notebooks
              </Button>
            }
          >
            It may have been deleted. Your other notebooks are on the shelf.
          </EmptyState>
        ) : (
          <>
            <BackLink to={ROUTES.notebooks}>All notebooks</BackLink>
            <ErrorNotice error={notebook.error} title="Couldn't open this notebook" onRetry={() => void notebook.refetch()} />
          </>
        )}
      </Page>
    )
  }
  // Keyed so dialogs and import progress never carry over from another notebook.
  return <NotebookView key={notebook.data.id} notebook={notebook.data} />
}

function NotebookView({ notebook }: { notebook: NotebookSummary }) {
  const now = useNow()
  const topics = useTopics(notebook.id)
  const sources = useSources(notebook.id)
  const exams = useExams(notebook.id)
  const notes = useNotes(notebook.id)
  const cards = useCards(notebook.id)
  const mockExams = useQuizzes(notebook.id, 'mock_exam')

  const importer = useSourceImport(notebook.id)
  const dragging = useWindowFileDrop(importer.addFiles)
  const syllabus = useSyllabusExtraction(notebook.id)

  const [addingTopic, setAddingTopic] = useState(false)
  const [editingTopic, setEditingTopic] = useState<TopicWithProgress | null>(null)
  const [mockOpen, setMockOpen] = useState(false)

  const topicList = useMemo(() => topics.data ?? [], [topics.data])
  const sourceList = useMemo(() => sources.data ?? [], [sources.data])
  const upcomingExams = useMemo(() => splitExams(exams.data ?? [], now).upcoming, [exams.data, now])
  // A mock exam needs something to be tested on.
  const startMock = topicList.length > 0 ? () => setMockOpen(true) : undefined

  return (
    <Page width="wide" className="notebook-screen">
      <BackLink to={ROUTES.notebooks} className="notebook-screen__back">
        All notebooks
      </BackLink>
      <NotebookHeader notebook={notebook} onStartMockExam={startMock} now={now} />

      <div className="split">
        <div className="split__main">
          <TopicList
            notebook={notebook}
            topics={topics}
            sources={sourceList}
            syllabus={syllabus}
            onAddTopic={() => setAddingTopic(true)}
            onEditTopic={setEditingTopic}
            onUpload={() => void importer.pick()}
            now={now}
          />
        </div>
        <aside className="split__side" aria-label="Files, exams, flashcards and notes">
          <SourcesPanel sources={sources} importer={importer} dragging={dragging} />
          <ExamsPanel notebookId={notebook.id} color={notebook.color} exams={exams} topics={topicList} now={now} />
          <CardsPanel notebookId={notebook.id} cards={cards} topics={topicList} now={now} />
          <NotesPanel notebookId={notebook.id} notes={notes} topics={topicList} now={now} />
          <MockExamPanel quizzes={mockExams} onStart={startMock} now={now} />
        </aside>
      </div>

      <AddTopicDialog open={addingTopic} onClose={() => setAddingTopic(false)} notebookId={notebook.id} />
      <TopicEditDialog topic={editingTopic} sources={sourceList} onClose={() => setEditingTopic(null)} />
      <MockExamDialog open={mockOpen} onClose={() => setMockOpen(false)} notebookId={notebook.id} exams={upcomingExams} />
    </Page>
  )
}
