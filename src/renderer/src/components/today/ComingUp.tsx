import { Link } from 'react-router'
import type { UpcomingExam } from '@shared/types'
import { EmptyState, Panel, ProgressBar } from '../ui'
import { formatDate, formatDayCount, notebookStyle, pluralize } from '../../lib/format'
import { ROUTES } from '../../lib/routes'
import { examNote, examUrgency } from './todayModel'
import './ComingUp.css'

/** How many exams fit the side rail before it turns into a list nobody reads. */
const MAX_EXAMS = 4

/** "Coming up": upcoming exams with days left, readiness and weakest topics. */
export function ComingUp({ exams }: { exams: UpcomingExam[] }) {
  const shown = exams.slice(0, MAX_EXAMS)
  const hidden = exams.length - shown.length
  return (
    <Panel title="Coming up" titleStyle="caps" className="coming-up">
      {shown.length === 0 ? (
        <EmptyState compact titleLevel={3} title="No exams scheduled">
          Add exam dates inside a notebook and you will see how ready you are here.
        </EmptyState>
      ) : (
        <ul className="coming-up__list">
          {shown.map((exam) => (
            <li key={exam.id} className="coming-up__exam" style={notebookStyle(exam.notebookColor)}>
              <div className="coming-up__head">
                <Link to={ROUTES.notebook(exam.notebookId)} className="coming-up__name">
                  {exam.name}
                </Link>
                <span className={`coming-up__days coming-up__days--${examUrgency(exam.daysLeft)}`}>
                  {formatDayCount(exam.daysLeft)}
                </span>
              </div>
              <span className="coming-up__meta">
                {exam.notebookName} · {formatDate(exam.examDate, 'weekday-short')}
              </span>
              <div className="coming-up__readiness">
                <ProgressBar
                  value={exam.readiness}
                  label={`Readiness for ${exam.name}`}
                  notebookColor={exam.notebookColor}
                />
                <span className="coming-up__ready tabular">{Math.round(exam.readiness)}% ready</span>
              </div>
              <span className="coming-up__note">{examNote(exam)}</span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="coming-up__more">and {pluralize(hidden, 'more exam')} later on</p>}
    </Panel>
  )
}
