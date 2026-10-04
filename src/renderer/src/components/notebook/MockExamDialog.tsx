import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Exam, ID } from '@shared/types'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, Segmented, Select, useToast } from '../ui'
import { formatDate, formatMinutes } from '../../lib/format'
import { useApiMutation } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { MOCK_EXAM_COUNTS, MOCK_EXAM_DEFAULTS, MOCK_EXAM_MINUTES, mockExamInput } from './model'
import './MockExamDialog.css'

export interface MockExamDialogProps {
  open: boolean
  onClose: () => void
  notebookId: ID
  /** Upcoming exams, soonest first; the first is preselected. */
  exams: readonly Exam[]
}

const ALL_TOPICS = ''

/**
 * Lets the learner set the length and time of a mock exam, writes it with
 * the AI and opens it. The AI call outlives the dialog: closing it while the
 * exam is being written shows a toast with a link when it is ready.
 */
export function MockExamDialog({ open, onClose, notebookId, exams }: MockExamDialogProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const openRef = useRef(open)
  openRef.current = open
  // After the page is left, a finished exam is announced with a toast instead of navigating.
  useEffect(
    () => () => {
      openRef.current = false
    },
    []
  )
  const create = useApiMutation('createQuiz', {
    onSuccess: (quiz) => {
      if (openRef.current) {
        onClose()
        navigate(ROUTES.quiz(quiz.id))
        return
      }
      toast.show({
        tone: 'good',
        title: 'Mock exam ready',
        message: `${quiz.title}: ${quiz.questions.length} questions. The timer starts when you open it.`,
        duration: 0,
        action: { label: 'Open it', onClick: () => navigate(ROUTES.quiz(quiz.id)) }
      })
    }
  })

  const start = (examId: string, count: number, minutes: number) => {
    if (create.isPending) return
    const exam = exams.find((e) => e.id === examId) ?? null
    create.mutate([mockExamInput(notebookId, exam, count, minutes)])
  }

  if (!open) return null
  return (
    <MockExamForm
      exams={exams}
      pending={create.isPending}
      error={create.error}
      onStart={start}
      onClose={() => {
        if (!create.isPending) create.reset()
        onClose()
      }}
    />
  )
}

interface MockExamFormProps {
  exams: readonly Exam[]
  pending: boolean
  error: unknown
  onStart: (examId: string, count: number, minutes: number) => void
  onClose: () => void
}

function MockExamForm({ exams, pending, error, onStart, onClose }: MockExamFormProps) {
  const [examId, setExamId] = useState(exams[0]?.id ?? ALL_TOPICS)
  const [count, setCount] = useState<string>(String(MOCK_EXAM_DEFAULTS.count))
  const [minutes, setMinutes] = useState<string>(String(MOCK_EXAM_DEFAULTS.timeLimitMin))

  const examOptions = [
    ...exams.map((e) => ({ value: e.id, label: `${e.name} · ${formatDate(e.examDate, 'medium')}` })),
    { value: ALL_TOPICS, label: 'Every topic in this notebook' }
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Start a mock exam"
      description="A timed exam with every question type and mixed difficulty, leaning on the topics you miss most. Sitting it like the real thing is the best rehearsal."
      onSubmit={() => onStart(examId, Number(count), Number(minutes))}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {pending ? 'Keep working in the background' : 'Cancel'}
          </Button>
          <Button type="submit" loading={pending}>
            Write my mock exam
          </Button>
        </>
      }
    >
      <fieldset className="mock-exam-dialog__fields" disabled={pending}>
        <Select label="Practice for" value={examId} onChange={(event) => setExamId(event.target.value)} options={examOptions} />
        <div className="mock-exam-dialog__choice">
          <span className="mock-exam-dialog__label" aria-hidden="true">
            Questions
          </span>
          <Segmented
            label="Number of questions"
            value={count}
            onChange={setCount}
            options={MOCK_EXAM_COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            block
          />
        </div>
        <div className="mock-exam-dialog__choice">
          <span className="mock-exam-dialog__label" aria-hidden="true">
            Time limit
          </span>
          <Segmented
            label="Time limit"
            value={minutes}
            onChange={setMinutes}
            options={MOCK_EXAM_MINUTES.map((n) => ({ value: String(n), label: formatMinutes(n) }))}
            block
          />
        </div>
      </fieldset>
      {pending && <AiWorking task="quiz" title="Writing your mock exam" />}
      <ErrorNotice error={error} title="Couldn't write the mock exam" onRetry={() => onStart(examId, Number(count), Number(minutes))} />
    </Modal>
  )
}
