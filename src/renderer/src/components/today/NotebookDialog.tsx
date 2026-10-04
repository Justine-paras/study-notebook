import { useState } from 'react'
import type { Notebook, NotebookColor } from '@shared/types'
import { NotebookCover } from '../NotebookCover'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Modal, TextField, useToast } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { ColorPicker } from './ColorPicker'
import {
  cleanNotebookDraft,
  hasErrors,
  tidyText,
  validateNotebookDraft,
  type NotebookDraft
} from './notebookForm'
import './NotebookDialog.css'

export interface NotebookDialogProps {
  open: boolean
  onClose: () => void
  /** Edit this notebook; omit to create a new one. */
  notebook?: Pick<Notebook, 'id' | 'name' | 'code' | 'color'>
  /** Color preselected for a new notebook. */
  defaultColor?: NotebookColor
  /** Called after a new notebook is created (e.g. to open it). */
  onCreated?: (notebook: Notebook) => void
}

/** "New notebook" / "Edit notebook" dialog: name, course code and cover color, with a live cover preview. */
export function NotebookDialog(props: NotebookDialogProps) {
  // Mount the form only while open, so every opening starts from fresh values.
  if (!props.open) return null
  return <NotebookDialogForm {...props} />
}

function NotebookDialogForm({ onClose, notebook, defaultColor = 'blue', onCreated }: NotebookDialogProps) {
  const toast = useToast()
  const editing = notebook !== undefined
  const [draft, setDraft] = useState<NotebookDraft>(() => ({
    name: notebook?.name ?? '',
    code: notebook?.code ?? '',
    color: notebook?.color ?? defaultColor
  }))
  const [showErrors, setShowErrors] = useState(false)

  const create = useApiMutation('createNotebook', {
    onSuccess: (created) => {
      toast.success(`${created.name} is on your shelf. Add your course files next.`, 'Notebook created')
      onClose()
      onCreated?.(created)
    }
  })
  const update = useApiMutation('updateNotebook', {
    onSuccess: (saved) => {
      toast.success(`${saved.name} is updated.`, 'Saved')
      onClose()
    }
  })
  const saving = create.isPending || update.isPending
  const errors = validateNotebookDraft(draft)
  const visibleErrors = showErrors ? errors : {}

  function submit() {
    setShowErrors(true)
    if (hasErrors(errors) || saving) return
    const clean = cleanNotebookDraft(draft)
    if (notebook) update.mutate([notebook.id, clean])
    else create.mutate([clean])
  }

  const set = <K extends keyof NotebookDraft>(key: K, value: NotebookDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit notebook' : 'New notebook'}
      description={
        editing ? undefined : 'One notebook per subject. Next you will add its syllabus and lecture files.'
      }
      dismissible={!saving}
      onSubmit={submit}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Create notebook'}
          </Button>
        </>
      }
    >
      <div className="notebook-dialog">
        <div className="notebook-dialog__fields">
          <TextField
            label="Name"
            placeholder="Operating Systems"
            value={draft.name}
            onChange={(event) => set('name', event.target.value)}
            error={visibleErrors.name}
            autoComplete="off"
            data-autofocus
          />
          <TextField
            label="Course code"
            hint="Optional, for example CS 310"
            placeholder="CS 310"
            value={draft.code}
            onChange={(event) => set('code', event.target.value)}
            error={visibleErrors.code}
            autoComplete="off"
          />
          <ColorPicker value={draft.color} onChange={(color) => set('color', color)} />
        </div>
        <div className="notebook-dialog__preview" aria-hidden="true">
          <NotebookCover
            size="sm"
            notebook={{ name: tidyText(draft.name) || 'Your subject', code: tidyText(draft.code), color: draft.color }}
          />
        </div>
      </div>
      <ErrorNotice error={create.error ?? update.error} compact title="Couldn't save the notebook" />
    </Modal>
  )
}
