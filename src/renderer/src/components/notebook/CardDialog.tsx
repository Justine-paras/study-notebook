import { useId, useMemo, useState } from 'react'
import type { Card, CardOrigin, ID, TopicWithProgress } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, Select, TextArea, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { topicOptions } from './model'

export interface CardDialogProps {
  open: boolean
  /** The card to edit, or null for a new one. */
  card: Card | null
  notebookId: ID
  topics: readonly TopicWithProgress[]
  /** Preselected topic for a new card (e.g. the browser's topic filter). */
  defaultTopicId?: ID | null
  onClose: () => void
}

export const CARD_ORIGIN_LABELS: Record<CardOrigin, string> = {
  lesson: 'From a lesson',
  mistake: 'From a mistake',
  manual: 'Written by you',
  explanation: 'From your explanation'
}

/** Writes or edits one flashcard: a question on the front, the answer on the back. */
export function CardDialog({ open, card, notebookId, topics, defaultTopicId = null, onClose }: CardDialogProps) {
  if (!open) return null
  return (
    <CardEditor key={card?.id ?? 'new'} card={card} notebookId={notebookId} topics={topics} defaultTopicId={defaultTopicId} onClose={onClose} />
  )
}

function CardEditor({ card, notebookId, topics, defaultTopicId, onClose }: Omit<CardDialogProps, 'open'>) {
  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [topicId, setTopicId] = useState<string>(card ? (card.topicId ?? '') : (defaultTopicId ?? ''))
  const [submitted, setSubmitted] = useState(false)
  const frontId = useId()
  const toast = useToast()
  const create = useApiMutation('createCard')
  const update = useApiMutation('updateCard')
  const saving = create.isPending || update.isPending
  const options = useMemo(() => topicOptions(topics), [topics])

  const frontError = submitted && !front.trim() ? 'Write the question.' : undefined
  const backError = submitted && !back.trim() ? 'Write the answer.' : undefined

  const save = (addAnother: boolean) => {
    setSubmitted(true)
    if (saving || !front.trim() || !back.trim()) return
    const values = { front: front.trim(), back: back.trim(), topicId: topicId || null }
    if (card) {
      update.mutate([card.id, values], {
        onSuccess: () => {
          onClose()
          toast.success('Card saved')
        }
      })
      return
    }
    create.mutate([{ notebookId, ...values }], {
      onSuccess: () => {
        toast.success('Card added. It joins your reviews today.')
        if (!addAnother) {
          onClose()
          return
        }
        // Keep the topic, clear the text, and go back to the question for the next card.
        setFront('')
        setBack('')
        setSubmitted(false)
        document.getElementById(frontId)?.focus()
      }
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={card ? 'Edit card' : 'New card'}
      description={
        card
          ? [CARD_ORIGIN_LABELS[card.origin], card.sourceRef].filter(Boolean).join(' · ')
          : 'One idea per card, phrased as a question you can answer from memory.'
      }
      dismissible={!saving}
      closeOnBackdrop={false}
      onSubmit={() => save(false)}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {!card && (
            <Button variant="secondary" onClick={() => save(true)} disabled={saving}>
              Save and add another
            </Button>
          )}
          <Button type="submit" loading={saving}>
            {card ? 'Save card' : 'Add card'}
          </Button>
        </>
      }
    >
      <TextArea
        id={frontId}
        label="Front (question)"
        rows={3}
        value={front}
        onChange={(event) => setFront(event.target.value)}
        error={frontError}
        maxLength={2000}
        data-autofocus
      />
      <TextArea
        label="Back (answer)"
        hint="Markdown works, including `code` and $math$."
        rows={4}
        value={back}
        onChange={(event) => setBack(event.target.value)}
        error={backError}
        maxLength={4000}
      />
      <Select label="Topic" value={topicId} onChange={(event) => setTopicId(event.target.value)} options={options} placeholder="No topic" />
      <ErrorNotice error={create.error ?? update.error} compact />
    </Modal>
  )
}
