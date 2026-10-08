import { useMemo, useState } from 'react'
import type { Source, TopicWithProgress } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, useToast } from '../ui'
import { SOURCE_KIND_LABELS } from '../../lib/format'
import { useApiMutation } from '../../lib/queries'
import { MultiSelectList } from './MultiSelectList'
import { TopicFormFields, cleanTopicDraft, type TopicDraft } from './TopicForm'

export interface TopicEditDialogProps {
  /** The topic being edited; null keeps the dialog closed. */
  topic: TopicWithProgress | null
  sources: readonly Source[]
  onClose: () => void
}

/** Renames a topic, sets its unit and description, and picks the files its lessons use. */
export function TopicEditDialog({ topic, sources, onClose }: TopicEditDialogProps) {
  // Keyed by topic so switching topics starts from that topic's values.
  return topic ? <TopicEditForm key={topic.id} topic={topic} sources={sources} onClose={onClose} /> : null
}

function TopicEditForm({ topic, sources, onClose }: { topic: TopicWithProgress; sources: readonly Source[]; onClose: () => void }) {
  const [draft, setDraft] = useState<TopicDraft>({
    title: topic.title,
    unitLabel: topic.unitLabel,
    description: topic.description
  })
  const [sourceIds, setSourceIds] = useState<string[]>(() => topic.sourceIds.filter((id) => sources.some((s) => s.id === id)))
  const [submitted, setSubmitted] = useState(false)
  const toast = useToast()
  const update = useApiMutation('updateTopic')
  const clean = cleanTopicDraft(draft)

  const sourceOptions = useMemo(
    () => sources.map((s) => ({ value: s.id, label: s.fileName, hint: SOURCE_KIND_LABELS[s.kind] })),
    [sources]
  )

  const submit = () => {
    setSubmitted(true)
    if (!clean || update.isPending) return
    update.mutate([topic.id, { ...clean, sourceIds }], {
      onSuccess: () => {
        onClose()
        toast.success('Topic saved')
      }
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit topic"
      size="lg"
      dismissible={!update.isPending}
      onSubmit={submit}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending}>
            Save topic
          </Button>
        </>
      }
    >
      <TopicFormFields draft={draft} onChange={setDraft} titleError={submitted && !clean ? 'Give the topic a name.' : undefined} />
      <MultiSelectList
        label="Files this topic uses"
        hint="Leave all unticked to let the app pick the most relevant files in this notebook. Changes apply to the next lesson you create."
        options={sourceOptions}
        selected={sourceIds}
        onChange={setSourceIds}
        emptyText="This notebook has no files yet."
      />
      <ErrorNotice error={update.error} compact />
    </Modal>
  )
}
