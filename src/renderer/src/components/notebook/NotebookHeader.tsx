import { ClipboardCheck, Layers } from 'lucide-react'
import type { NotebookSummary } from '@shared/types'
import { Button } from '../ui'
import { formatDate, formatRelativeDays, notebookStyle, pluralize } from '../../lib/format'
import { ROUTES } from '../../lib/routes'
import './NotebookHeader.css'

export interface NotebookHeaderProps {
  notebook: NotebookSummary
  /** Opens the mock exam dialog; hidden when there is nothing to be tested on yet. */
  onStartMockExam?: () => void
  now?: Date
}

/**
 * The notebook's cover as a page header: code, name, the next exam with its
 * readiness, and the two things worth doing from here (review due cards,
 * sit a mock exam).
 */
export function NotebookHeader({ notebook, onStartMockExam, now = new Date() }: NotebookHeaderProps) {
  const exam = notebook.nextExam
  return (
    <header className="notebook-header" style={notebookStyle(notebook.color)}>
      <span className="notebook-header__spine" aria-hidden="true" />
      <div className="notebook-header__title">
        <div className="notebook-header__code">
          {notebook.code || 'Notebook'}
          {notebook.archived && <span className="notebook-header__archived">Archived</span>}
        </div>
        <h1 className="notebook-header__name">{notebook.name}</h1>
        <p className="notebook-header__meta">
          {pluralize(notebook.topicCount, 'topic')} · {pluralize(notebook.sourceCount, 'file')} · {Math.round(notebook.mastery)}% mastery
        </p>
      </div>
      <div className="notebook-header__aside">
        {exam ? (
          <div className="notebook-header__exam">
            <div className="notebook-header__exam-name">
              {exam.name} · {formatRelativeDays(exam.examDate, now)}
            </div>
            <div className="notebook-header__exam-when">
              {formatDate(exam.examDate, 'medium', now)}
              {notebook.nextExamReadiness !== null && ` · ${Math.round(notebook.nextExamReadiness)}% ready`}
            </div>
          </div>
        ) : (
          <div className="notebook-header__exam">
            <div className="notebook-header__exam-name">No exam dates yet</div>
            <div className="notebook-header__exam-when">Add one to see how ready you are</div>
          </div>
        )}
        {notebook.dueCards > 0 && (
          <Button
            to={ROUTES.review(notebook.id)}
            variant="secondary"
            className="notebook-header__button notebook-header__button--outline"
            icon={<Layers size={16} aria-hidden="true" />}
          >
            Review {pluralize(notebook.dueCards, 'due card')}
          </Button>
        )}
        {onStartMockExam && (
          <Button
            onClick={onStartMockExam}
            className="notebook-header__button notebook-header__button--paper"
            icon={<ClipboardCheck size={16} aria-hidden="true" />}
          >
            Start mock exam
          </Button>
        )}
      </div>
    </header>
  )
}
