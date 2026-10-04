import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { ID } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { EMPTY_TOPIC_DRAFT, TopicFormFields, cleanTopicDraft, type TopicDraft } from './TopicForm'

export interface AddTopicDialogProps {
  open: boolean
  onClose: () => void
  notebookId: ID
}

/** Adds a topic by hand at the end of the course order. */
export function AddTopicDialog({ open, onClose, notebookId }: AddTopicDialogProps) {
  return open ? <AddTopicForm onClose={onClose} notebookId={notebookId} /> : null
}

// Mounted only while open, so every opening starts with an empty form.
function AddTopicForm({ onClose, notebookId }: Omit<AddTopicDialogProps, 'open'>) {
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_TOPIC_DRAFT)
  const [submitted, setSubmitted] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const create = useApiMutation('createTopic')
  const clean = cleanTopicDraft(draft)

  const submit = () => {
    setSubmitted(true)
    if (!clean || create.isPending) return
    create.mutate([notebookId, { title: clean.title, unitLabel: clean.unitLabel, description: clean.description }], {
      onSuccess: (topic) => {
        onClose()
        toast.show({
          tone: 'good',
          message: `“${topic.title}” is at the end of your topics.`,
          title: 'Topic added',
          action: { label: 'Start learning', onClick: () => navigate(ROUTES.topic(topic.id)) }
        })
      }
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a topic"
      description="Topics usually come from your syllabus, but you can add your own."
      dismissible={!create.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add topic
          </Button>
        </>
      }
    >
      <TopicFormFields draft={draft} onChange={setDraft} titleError={submitted && !clean ? 'Give the topic a name.' : undefined} />
      <ErrorNotice error={create.error} compact />
    </Modal>
  )
}
