import { useState } from 'react'
import { BookOpenText, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import type { Source, SourceKind } from '@shared/types'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { Markdown } from '../Markdown'
import { Button, Menu, Modal, Select, Spinner, useConfirm, useToast, type MenuEntry } from '../ui'
import { useApiMutation } from '../../lib/queries'
import { SOURCE_KIND_OPTIONS, sourceMetaLine } from './model'
import './SourceRow.css'

export interface SourceRowProps {
  source: Source
}

/** One file: type badge, name, size, kind selector, and summarize / open / delete. */
export function SourceRow({ source }: SourceRowProps) {
  const [reading, setReading] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const summarize = useApiMutation('summarizeSource', {
    onSuccess: () =>
      toast.show({
        tone: 'good',
        title: 'Summary ready',
        message: `Saved with your notes for ${source.fileName}.`,
        action: { label: 'Read it', onClick: () => setReading(true) }
      })
  })
  const setKind = useApiMutation('updateSource', { onError: (err) => toast.error(err, "Couldn't change the file type") })
  const open = useApiMutation('openSource', { invalidate: 'none', onError: (err) => toast.error(err, "Couldn't open the file") })
  const remove = useApiMutation('deleteSource', {
    onSuccess: () => toast.success(`${source.fileName} was removed`),
    onError: (err) => toast.error(err, "Couldn't delete the file")
  })

  const ready = source.status === 'ready'
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
      onSelect: () => summarize.mutate([source.id]),
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
      <div className="source-row__top">
        <span className={`source-row__ext source-row__ext--${source.ext}`} aria-hidden="true">
          {source.ext.toUpperCase()}
        </span>
        <div className="source-row__text">
          <div className="source-row__name" title={source.fileName}>
            <span className="sr-only">{source.ext.toUpperCase()} file: </span>
            {source.fileName}
          </div>
          <SourceStatusLine source={source} />
        </div>
        <Menu label={`Actions for ${source.fileName}`} items={items} />
      </div>
      <div className="source-row__controls">
        <Select
          label={`Type of file for ${source.fileName}`}
          hideLabel
          className="source-row__kind"
          value={source.kind}
          options={SOURCE_KIND_OPTIONS}
          disabled={setKind.isPending}
          onChange={(event) => setKind.mutate([source.id, { kind: event.target.value as SourceKind }])}
        />
        {source.summary ? (
          <Button variant="ghost" size="sm" icon={<BookOpenText size={16} aria-hidden="true" />} onClick={() => setReading(true)}>
            Summary
          </Button>
        ) : (
          ready && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Sparkles size={16} aria-hidden="true" />}
              onClick={() => summarize.mutate([source.id])}
              loading={summarize.isPending}
              aria-label={`Summarize ${source.fileName}`}
            >
              Summarize
            </Button>
          )
        )}
      </div>
      {summarize.isPending && <AiWorking task="summary" compact title={`Summarizing ${source.fileName}`} />}
      <ErrorNotice error={summarize.error} title="Couldn't summarize this file" compact onRetry={() => summarize.mutate([source.id])} />
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

function SourceStatusLine({ source }: { source: Source }) {
  if (source.status === 'processing') {
    return (
      <div className="source-row__meta">
        <Spinner size={12} label={null} /> Reading the file…
      </div>
    )
  }
  if (source.status === 'error') {
    return (
      <div className="source-row__meta source-row__meta--error">
        No text could be read{source.error ? `: ${source.error}` : ''}
      </div>
    )
  }
  return <div className="source-row__meta">{sourceMetaLine(source)}</div>
}
