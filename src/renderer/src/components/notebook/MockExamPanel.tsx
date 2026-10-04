import type { UseQueryResult } from '@tanstack/react-query'
import { ClipboardCheck, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import type { Quiz } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { ErrorNotice } from '../ErrorNotice'
import { Badge, Button, LoadingBlock, Menu, Panel, useConfirm, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { mockAttemptSummary, sortAttempts } from './model'
import './MockExamPanel.css'

export interface MockExamPanelProps {
  quizzes: UseQueryResult<Quiz[], ApiError>
  /** Opens the mock exam dialog; omitted when the notebook has no topics yet. */
  onStart?: () => void
  now?: Date
}

/** Past mock exam attempts with their scores, newest first. */
export function MockExamPanel({ quizzes, onStart, now = new Date() }: MockExamPanelProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const remove = useApiMutation('deleteQuiz', {
    onSuccess: () => toast.success('Attempt deleted'),
    onError: (err) => toast.error(err, "Couldn't delete the attempt")
  })
  const attempts = sortAttempts(quizzes.data ?? [])

  const askDelete = async (quiz: Quiz) => {
    const ok = await confirm({
      title: `Delete ${quiz.title}?`,
      message: 'The attempt and its score are removed. This can’t be undone.',
      confirmLabel: 'Delete attempt',
      tone: 'danger'
    })
    if (ok) remove.mutate([quiz.id])
  }

  return (
    <Panel
      title="Mock exams"
      actions={
        onStart && attempts.length > 0 ? (
          <Button variant="subtle" size="sm" icon={<ClipboardCheck size={16} aria-hidden="true" />} onClick={onStart}>
            New
          </Button>
        ) : undefined
      }
    >
      {quizzes.isPending ? (
        <LoadingBlock label="Loading attempts…" />
      ) : quizzes.error ? (
        <ErrorNotice error={quizzes.error} title="Couldn't load your mock exams" compact onRetry={() => void quizzes.refetch()} />
      ) : attempts.length === 0 ? (
        <div className="mock-panel__empty">
          <p>No attempts yet. A timed mock exam a few days before the real one shows what still needs work.</p>
          {onStart && (
            <Button variant="secondary" size="sm" icon={<ClipboardCheck size={16} aria-hidden="true" />} onClick={onStart}>
              Start mock exam
            </Button>
          )}
        </div>
      ) : (
        <ul className="mock-panel__list" aria-label="Mock exam attempts">
          {attempts.map((quiz) => {
            const summary = mockAttemptSummary(quiz, now)
            return (
              <li key={quiz.id} className="mock-panel__item">
                <Link to={ROUTES.quiz(quiz.id)} className="mock-panel__link">
                  <span className="mock-panel__title">{quiz.title}</span>
                  <span className="mock-panel__meta">
                    {summary.score !== null ? (
                      <>
                        <strong className="tabular">{summary.score}</strong> · {summary.percent}% · {summary.when}
                      </>
                    ) : (
                      <>
                        <Badge tone={summary.status === 'in_progress' ? 'warn' : 'neutral'}>
                          {summary.status === 'in_progress' ? 'In progress' : 'Not started'}
                        </Badge>{' '}
                        {summary.when}
                      </>
                    )}
                  </span>
                </Link>
                <Menu
                  label={`Actions for ${quiz.title}`}
                  items={[{ label: 'Delete attempt', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', onSelect: () => void askDelete(quiz) }]}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
