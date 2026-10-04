import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Exam, ID, NotebookColor, TopicWithProgress } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { ErrorNotice } from '../ErrorNotice'
import { Button, LoadingBlock, Menu, Panel, ProgressBar, useConfirm, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { ExamDialog } from './ExamDialog'
import { examCoverageLine, examReadiness, examWhenLine, splitExams } from './model'
import './ExamsPanel.css'

export interface ExamsPanelProps {
  notebookId: ID
  color: NotebookColor
  exams: UseQueryResult<Exam[], ApiError>
  topics: readonly TopicWithProgress[]
  now?: Date
}

/** Upcoming exams with readiness, past exams tucked away, and the exam editor. */
export function ExamsPanel({ notebookId, color, exams, topics, now = new Date() }: ExamsPanelProps) {
  const [editing, setEditing] = useState<{ exam: Exam | null } | null>(null)
  const [showPast, setShowPast] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()
  const remove = useApiMutation('deleteExam', {
    onSuccess: () => toast.success('Exam deleted'),
    onError: (err) => toast.error(err, "Couldn't delete the exam")
  })
  const { upcoming, past } = splitExams(exams.data ?? [], now)

  const askDelete = async (exam: Exam) => {
    const ok = await confirm({
      title: `Delete ${exam.name}?`,
      message: 'Your topics and progress stay. The exam just stops shaping your daily plan.',
      confirmLabel: 'Delete exam',
      tone: 'danger'
    })
    if (ok) remove.mutate([exam.id])
  }

  const row = (exam: Exam, isPast: boolean) => {
    const readiness = isPast ? null : examReadiness(exam, topics)
    return (
      <li key={exam.id} className={['exam-row', isPast && 'exam-row--past'].filter(Boolean).join(' ')}>
        <div className="exam-row__top">
          <div className="exam-row__text">
            <div className="exam-row__name">{exam.name}</div>
            <div className="exam-row__when">{examWhenLine(exam.examDate, now)}</div>
          </div>
          <Menu
            label={`Actions for ${exam.name}`}
            items={[
              { label: 'Edit exam', icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => setEditing({ exam }) },
              'separator',
              { label: 'Delete exam', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', onSelect: () => void askDelete(exam) }
            ]}
          />
        </div>
        <div className="exam-row__coverage">{examCoverageLine(exam, topics)}</div>
        {readiness !== null && (
          <div className="exam-row__readiness">
            <span className="exam-row__readiness-label">Ready</span>
            <ProgressBar value={readiness} label={`Readiness for ${exam.name}`} notebookColor={color} size="sm" showValue className="exam-row__bar" />
          </div>
        )}
      </li>
    )
  }

  return (
    <Panel
      title="Exams"
      actions={
        <Button variant="subtle" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({ exam: null })}>
          Add exam
        </Button>
      }
    >
      {exams.isPending ? (
        <LoadingBlock label="Loading exams…" />
      ) : exams.error ? (
        <ErrorNotice error={exams.error} title="Couldn't load the exams" compact onRetry={() => void exams.refetch()} />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <ul className="exams-panel__list" aria-label="Upcoming exams">
              {upcoming.map((exam) => row(exam, false))}
            </ul>
          ) : (
            <p className="exams-panel__empty">
              No upcoming exams. Add your exam dates so your daily plan knows what to prepare first.
            </p>
          )}
          {past.length > 0 && (
            <>
              <button
                type="button"
                className="exams-panel__toggle"
                aria-expanded={showPast}
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                Past exams ({past.length})
              </button>
              {showPast && (
                <ul className="exams-panel__list" aria-label="Past exams">
                  {past.map((exam) => row(exam, true))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      <ExamDialog
        open={editing !== null}
        exam={editing?.exam ?? null}
        notebookId={notebookId}
        topics={topics}
        onClose={() => setEditing(null)}
      />
    </Panel>
  )
}
