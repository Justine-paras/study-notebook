import { useMemo, useState } from 'react'
import type { Exam, ID, TopicWithProgress } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, TextField, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { isValidDateKey, topicOptions } from './model'
import { MultiSelectList } from './MultiSelectList'
import './ExamDialog.css'

export interface ExamDialogProps {
  open: boolean
  /** The exam to edit, or null to add a new one. */
  exam: Exam | null
  notebookId: ID
  topics: readonly TopicWithProgress[]
  onClose: () => void
}

/** Adds or edits an exam: name, date and the topics it covers. */
export function ExamDialog({ open, exam, notebookId, topics, onClose }: ExamDialogProps) {
  if (!open) return null
  // Keyed so each opening starts from the chosen exam's values.
  return <ExamForm key={exam?.id ?? 'new'} exam={exam} notebookId={notebookId} topics={topics} onClose={onClose} />
}

function ExamForm({ exam, notebookId, topics, onClose }: Omit<ExamDialogProps, 'open'>) {
  const [name, setName] = useState(exam?.name ?? '')
  const [examDate, setExamDate] = useState(exam?.examDate ?? '')
  const [topicIds, setTopicIds] = useState<string[]>(() => {
    const known = new Set(topics.map((t) => t.id))
    return (exam?.topicIds ?? []).filter((id) => known.has(id))
  })
  const [submitted, setSubmitted] = useState(false)
  const toast = useToast()
  const create = useApiMutation('createExam')
  const update = useApiMutation('updateExam')
  const saving = create.isPending || update.isPending
  const options = useMemo(() => topicOptions(topics), [topics])

  const nameError = submitted && !name.trim() ? 'Give the exam a name, like “Midterm”.' : undefined
  const dateError = submitted && !isValidDateKey(examDate) ? 'Pick the date of the exam.' : undefined

  const submit = () => {
    setSubmitted(true)
    if (saving || !name.trim() || !isValidDateKey(examDate)) return
    const values = { name: name.trim(), examDate, topicIds }
    const done = () => {
      onClose()
      toast.success(exam ? 'Exam saved' : `${values.name} added`)
    }
    if (exam) update.mutate([exam.id, values], { onSuccess: done })
    else create.mutate([{ notebookId, ...values }], { onSuccess: done })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={exam ? 'Edit exam' : 'Add an exam'}
      description="Exams shape your daily plan: topics they cover come first, and a mock exam is suggested in the last few days."
      dismissible={!saving}
      onSubmit={submit}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {exam ? 'Save exam' : 'Add exam'}
          </Button>
        </>
      }
    >
      <div className="exam-dialog__row">
        <TextField
          label="Name"
          placeholder="e.g. Midterm"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={nameError}
          maxLength={120}
          className="exam-dialog__name"
          data-autofocus
          required
        />
        <TextField
          label="Date"
          type="date"
          value={examDate}
          onChange={(event) => setExamDate(event.target.value)}
          error={dateError}
          className="exam-dialog__date"
          required
        />
      </div>
      <MultiSelectList
        label="Topics on this exam"
        hint="Leave all unticked to cover every topic in this notebook."
        options={options}
        selected={topicIds}
        onChange={setTopicIds}
        emptyText="This notebook has no topics yet. The exam will cover every topic you add."
      />
      <ErrorNotice error={create.error ?? update.error} compact />
    </Modal>
  )
}
