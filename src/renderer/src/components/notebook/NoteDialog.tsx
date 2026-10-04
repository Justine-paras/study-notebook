import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { ID, Note, TopicWithProgress } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Markdown } from '../Markdown'
import { Button, Kbd, Modal, Segmented, Select, TextArea, TextField, useConfirm, useToast } from '../ui'
import { formatDate } from '../../lib/format'
import { useApiMutation } from '../../lib/queries'
import { NOTE_KIND_LABELS, notePreview, topicOptions } from './model'
import './NoteDialog.css'

export interface NoteDialogProps {
  open: boolean
  /** The note to edit, or null for a new one. */
  note: Note | null
  notebookId: ID
  topics: readonly TopicWithProgress[]
  onClose: () => void
}

/** Writes or edits a Markdown note, with a preview and an optional topic. */
export function NoteDialog({ open, note, notebookId, topics, onClose }: NoteDialogProps) {
  if (!open) return null
  return <NoteEditor key={note?.id ?? 'new'} note={note} notebookId={notebookId} topics={topics} onClose={onClose} />
}

type Tab = 'write' | 'preview'

function NoteEditor({ note, notebookId, topics, onClose }: Omit<NoteDialogProps, 'open'>) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [topicId, setTopicId] = useState<string>(note?.topicId ?? '')
  // Existing notes open on the preview, as something to read; new ones open ready to type.
  const [tab, setTab] = useState<Tab>(note ? 'preview' : 'write')
  const [submitted, setSubmitted] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const create = useApiMutation('createNote')
  const update = useApiMutation('updateNote')
  const remove = useApiMutation('deleteNote')
  const saving = create.isPending || update.isPending || remove.isPending
  const options = useMemo(() => topicOptions(topics), [topics])

  const dirty = note
    ? title !== note.title || body !== note.body || topicId !== (note.topicId ?? '')
    : title.trim() !== '' || body.trim() !== ''
  const empty = !title.trim() && !body.trim()

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' }))) return
    onClose()
  }

  const save = () => {
    setSubmitted(true)
    if (empty || saving) return
    const values = {
      title: title.trim() || notePreview(body, 60) || 'Untitled note',
      body,
      topicId: topicId || null
    }
    const done = () => {
      onClose()
      toast.success('Note saved')
    }
    if (note) update.mutate([note.id, values], { onSuccess: done })
    else create.mutate([{ notebookId, ...values }], { onSuccess: done })
  }

  const askDelete = async () => {
    if (!note) return
    const ok = await confirm({ title: `Delete “${note.title}”?`, message: 'This can’t be undone.', confirmLabel: 'Delete note', tone: 'danger' })
    if (ok) remove.mutate([note.id], { onSuccess: () => { onClose(); toast.success('Note deleted') } })
  }

  // Ctrl+Enter saves from the text area, where Enter adds a line.
  const onBodyKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      formRef.current?.closest('form')?.requestSubmit()
    }
  }

  const kindLabel = note && note.kind !== 'note' ? `${NOTE_KIND_LABELS[note.kind]} · ` : ''
  return (
    <Modal
      open
      onClose={() => void close()}
      size="lg"
      title={note ? 'Edit note' : 'New note'}
      description={note ? `${kindLabel}Last edited ${formatDate(note.updatedAt, 'datetime')}` : 'Markdown works here: **bold**, lists, `code`, tables and $math$.'}
      dismissible={!saving}
      closeOnBackdrop={false}
      onSubmit={save}
      footer={
        <>
          {note && (
            <Button
              variant="ghost"
              icon={<Trash2 size={16} aria-hidden="true" />}
              onClick={() => void askDelete()}
              disabled={saving}
              className="note-dialog__delete"
            >
              Delete
            </Button>
          )}
          <span className="note-dialog__hint">
            <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to save
          </span>
          <Button variant="subtle" onClick={() => void close()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending || update.isPending}>
            Save note
          </Button>
        </>
      }
    >
      <div ref={formRef} className="note-dialog__fields">
        <TextField
          label="Title"
          placeholder="e.g. Deadlock conditions"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className="note-dialog__title"
          data-autofocus={note ? undefined : true}
        />
        <Select
          label="Topic"
          value={topicId}
          onChange={(event) => setTopicId(event.target.value)}
          options={options}
          placeholder="No topic"
          className="note-dialog__topic"
        />
      </div>
      <div className="note-dialog__tabs">
        <Segmented<Tab>
          label="Editor view"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' }
          ]}
        />
      </div>
      {tab === 'write' ? (
        <TextArea
          label="Note"
          hideLabel
          rows={14}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onBodyKeyDown}
          inputClassName="note-dialog__body"
          error={submitted && empty ? 'Write something first.' : undefined}
          data-autofocus={note ? true : undefined}
        />
      ) : (
        <div className="note-dialog__preview sheet sheet--compact" tabIndex={0} aria-label="Note preview">
          {body.trim() ? <Markdown>{body}</Markdown> : <p className="muted">Nothing written yet.</p>}
        </div>
      )}
      <ErrorNotice error={create.error ?? update.error ?? remove.error} compact />
    </Modal>
  )
}
