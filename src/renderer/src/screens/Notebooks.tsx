import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react'
import { NOTEBOOK_COLORS, type NotebookSummary } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button, EmptyState, LoadingBlock, Menu, Page, PageHeader, Sheet, useConfirm, useToast } from '../components/ui'
import { NotebookDialog } from '../components/today/NotebookDialog'
import { NotebookShelf } from '../components/today/NotebookShelf'
import { suggestNotebookColor } from '../components/today/notebookForm'
import { useNow } from '../components/today/useNow'
import { useApiMutation, useNotebooks } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Notebooks.css'

type DialogState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; notebook: NotebookSummary }

export default function NotebooksScreen() {
  useDocumentTitle('Notebooks')
  const now = useNow()
  const notebooks = useNotebooks()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })

  const archive = useApiMutation('updateNotebook')
  const remove = useApiMutation('deleteNotebook')

  const openCreate = () => setDialog({ mode: 'create' })
  const header = (
    <PageHeader
      title="Notebooks"
      description="One notebook per subject. Each holds its files, topics, flashcards, notes and exams."
      actions={
        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={openCreate}>
          New notebook
        </Button>
      }
    />
  )

  if (notebooks.isPending) {
    return (
      <Page>
        {header}
        <LoadingBlock label="Opening your shelf…" />
      </Page>
    )
  }

  if (notebooks.error) {
    return (
      <Page>
        {header}
        <ErrorNotice error={notebooks.error} title="Couldn't load your notebooks" onRetry={() => void notebooks.refetch()} />
      </Page>
    )
  }

  const all = notebooks.data
  const active = all.filter((n) => !n.archived)
  const archived = all.filter((n) => n.archived)

  function setArchived(notebook: NotebookSummary, value: boolean) {
    archive.mutate([notebook.id, { archived: value }], {
      onSuccess: () => {
        if (value) {
          toast.show({
            tone: 'info',
            title: 'Archived',
            message: `${notebook.name} is off Today's plan. Its notes and cards are kept.`,
            action: { label: 'Undo', onClick: () => archive.mutate([notebook.id, { archived: false }]) }
          })
        } else {
          toast.success(`${notebook.name} is back on your shelf.`, 'Restored')
        }
      },
      onError: (err) => toast.error(err, `Couldn't ${value ? 'archive' : 'restore'} ${notebook.name}`)
    })
  }

  async function confirmDelete(notebook: NotebookSummary) {
    const ok = await confirm({
      title: `Delete ${notebook.name}?`,
      message:
        'This removes its files, topics, lessons, flashcards, notes and exam history from this computer. It cannot be undone. Archive it instead if you might need it again.',
      confirmLabel: 'Delete notebook',
      tone: 'danger'
    })
    if (!ok) return
    remove.mutate([notebook.id], {
      onSuccess: () => toast.success(`${notebook.name} was deleted.`, 'Deleted'),
      onError: (err) => toast.error(err, `Couldn't delete ${notebook.name}`)
    })
  }

  const renderActions = (notebook: NotebookSummary) => (
    <Menu
      label={`Actions for ${notebook.name}`}
      items={[
        {
          label: 'Edit name and color',
          icon: <Pencil size={16} aria-hidden="true" />,
          onSelect: () => setDialog({ mode: 'edit', notebook })
        },
        notebook.archived
          ? {
              label: 'Restore to shelf',
              icon: <ArchiveRestore size={16} aria-hidden="true" />,
              onSelect: () => setArchived(notebook, false)
            }
          : {
              label: 'Archive',
              icon: <Archive size={16} aria-hidden="true" />,
              onSelect: () => setArchived(notebook, true)
            },
        'separator',
        {
          label: 'Delete',
          icon: <Trash2 size={16} aria-hidden="true" />,
          tone: 'danger',
          onSelect: () => void confirmDelete(notebook)
        }
      ]}
    />
  )

  return (
    <Page>
      {header}

      {all.length === 0 ? (
        <Sheet as="section" raised aria-label="Get started" className="notebooks__empty">
          <EmptyState
            kicker="a fresh start"
            title="No notebooks yet"
            action={
              <Button size="lg" icon={<Plus size={18} aria-hidden="true" />} onClick={openCreate}>
                Create your first notebook
              </Button>
            }
          >
            Make one for each subject you are taking, then add the syllabus and lecture files. Topics, lessons and
            quizzes come from those files.
          </EmptyState>
        </Sheet>
      ) : (
        <section className="notebooks__section" aria-labelledby="notebooks-active-title">
          <h2 id="notebooks-active-title" className="sr-only">
            On your shelf
          </h2>
          {active.length === 0 && (
            <p className="notebooks__note">
              Every notebook is archived. Restore one below, or start a new subject.
            </p>
          )}
          <NotebookShelf
            notebooks={active}
            label="Notebooks on your shelf"
            size="lg"
            showFooter
            onCreate={openCreate}
            renderActions={renderActions}
            now={now}
          />
        </section>
      )}

      {archived.length > 0 && (
        <section className="notebooks__section" aria-labelledby="notebooks-archived-title">
          <div className="notebooks__section-head">
            <h2 id="notebooks-archived-title" className="caps-label">
              Archived
            </h2>
            <p className="notebooks__note">
              Archived notebooks stay out of Today's plan and reviews. Restore one to study it again.
            </p>
          </div>
          <NotebookShelf
            notebooks={archived}
            label="Archived notebooks"
            size="lg"
            showFooter
            renderActions={renderActions}
            now={now}
          />
        </section>
      )}

      <NotebookDialog
        open={dialog.mode === 'create'}
        onClose={() => setDialog({ mode: 'closed' })}
        defaultColor={suggestNotebookColor(
          active.map((n) => n.color),
          NOTEBOOK_COLORS
        )}
        onCreated={(notebook) => navigate(ROUTES.notebook(notebook.id))}
      />
      <NotebookDialog
        open={dialog.mode === 'edit'}
        onClose={() => setDialog({ mode: 'closed' })}
        notebook={dialog.mode === 'edit' ? dialog.notebook : undefined}
      />
    </Page>
  )
}
