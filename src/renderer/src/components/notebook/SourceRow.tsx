import { useEffect, useRef, useState } from 'react'
import { BookOpenText, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import type { Source, SourceKind } from '@shared/types'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { Markdown } from '../Markdown'
import { Button, IconButton, Menu, Modal, Spinner, useConfirm, useToast, type MenuEntry } from '../ui'
import { useAiAction } from '../../lib/aiJobs'
import { useApiMutation } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { SOURCE_KIND_OPTIONS, sourceMetaLine } from './model'
import './SourceRow.css'

export interface SourceRowProps {
  source: Source
}

/**
 * One file as a compact row: type badge and name (the full name on hover),
 * then the kind picker and size with summarize (or read the summary) and a
 * menu with open / delete.
 */
export function SourceRow({ source }: SourceRowProps) {
  const [reading, setReading] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  // A job: a summary takes a minute and must survive leaving the notebook.
  const summarize = useAiAction('summarizeSource', `summary:${source.id}`, {
    task: 'summary',
    label: source.fileName,
    href: ROUTES.notebook(source.notebookId)
  })
  const setKind = useApiMutation('updateSource', { onError: (err) => toast.error(err, "Couldn't change the file type") })
  const open = useApiMutation('openSource', { invalidate: 'none', onError: (err) => toast.error(err, "Couldn't open the file") })
  const remove = useApiMutation('deleteSource', {
    onSuccess: () => toast.success(`${source.fileName} was removed`),
    onError: (err) => toast.error(err, "Couldn't delete the file")
  })

  // A summary that arrives while this row is on screen gets a toast that opens it here.
  const job = summarize.job
  const seenRef = useRef(job)
  useEffect(() => {
    if (!job || job === seenRef.current || job.status !== 'success') return
    seenRef.current = job
    toast.show({
      tone: 'good',
      title: 'Summary ready',
      message: `Saved with your notes for ${source.fileName}.`,
      action: { label: 'Read it', onClick: () => setReading(true) }
    })
  }, [job, source.fileName, toast])

  const ready = source.status === 'ready'
  const startSummary = () => summarize.run(source.id)
  const askDelete = async () => {
    const ok = await confirm({
      title: `Delete ${source.fileName}?`,
      message: 'The copy kept by the app is removed, and new lessons and quizzes won’t use it. The original file on your computer is not touched.',
      confirmLabel: 'Delete file',
      tone: 'danger'
    })
    if (ok) remove.mutate([source.id])
  }

  const items: MenuEntry[] = [
    {
      label: source.summary ? 'Summarize again' : 'Summarize',
      icon: <Sparkles size={16} aria-hidden="true" />,
      onSelect: startSummary,
      disabled: !ready || summarize.isPending
    },
    ...(source.summary
      ? [{ label: 'Read summary', icon: <BookOpenText size={16} aria-hidden="true" />, onSelect: () => setReading(true) }]
      : []),
    { label: 'Open file', icon: <ExternalLink size={16} aria-hidden="true" />, onSelect: () => open.mutate([source.id]) },
    'separator',
    { label: 'Delete file', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger', onSelect: () => void askDelete() }
  ]

  return (
    <li className={['source-row', remove.isPending && 'source-row--removing'].filter(Boolean).join(' ')}>
      <div className="source-row__main">
        <span className={`source-row__ext source-row__ext--${source.ext}`} aria-hidden="true">
          {source.ext.toUpperCase()}
        </span>
        <div className="source-row__name" title={source.fileName}>
          <span className="sr-only">{source.ext.toUpperCase()} file: </span>
          {source.fileName}
        </div>
        <div className="source-row__meta">
          <span className="source-row__kind-wrap">
            <select
              className="source-row__kind"
              aria-label={`Type of file for ${source.fileName}`}
              value={source.kind}
              disabled={setKind.isPending}
              onChange={(event) => setKind.mutate([source.id, { kind: event.target.value as SourceKind }])}
            >
              {SOURCE_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <svg className="source-row__kind-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <SourceStatus source={source} />
        </div>
        <div className="source-row__actions">
          {source.summary ? (
            <IconButton label={`Read the summary of ${source.fileName}`} size="sm" onClick={() => setReading(true)}>
              <BookOpenText size={16} aria-hidden="true" />
            </IconButton>
          ) : (
            ready && (
              <IconButton label={`Summarize ${source.fileName}`} size="sm" onClick={startSummary} loading={summarize.isPending}>
                <Sparkles size={16} aria-hidden="true" />
              </IconButton>
            )
          )}
          <Menu label={`Actions for ${source.fileName}`} items={items} />
        </div>
      </div>
      {summarize.isPending && (
        <AiWorking task="summary" compact title={`Summarizing ${source.fileName}`} startedAt={summarize.job?.startedAt} subjectId={source.id} />
      )}
      <ErrorNotice
        error={summarize.error}
        title="Couldn't summarize this file"
        compact
        onRetry={startSummary}
        onDismiss={summarize.dismiss}
      />
      <Modal
        open={reading}
        onClose={() => setReading(false)}
        size="lg"
        title="Summary"
        description={source.fileName}
        footer={
          <>
            <Button variant="subtle" icon={<ExternalLink size={16} aria-hidden="true" />} onClick={() => open.mutate([source.id])}>
              Open file
            </Button>
            <Button onClick={() => setReading(false)}>Close</Button>
          </>
        }
      >
        {source.summary ? <Markdown>{source.summary}</Markdown> : <p className="muted">This file has no summary yet.</p>}
      </Modal>
    </li>
  )
}

function SourceStatus({ source }: { source: Source }) {
  if (source.status === 'processing') {
    return (
      <span className="source-row__status">
        <Spinner size={12} label={null} /> Reading the file…
      </span>
    )
  }
  if (source.status === 'error') {
    const reason = `No text could be read${source.error ? `: ${source.error}` : ''}`
    return (
      <span className="source-row__status source-row__status--error" title={reason}>
        {reason}
      </span>
    )
  }
  return <span className="source-row__status">{sourceMetaLine(source)}</span>
}
