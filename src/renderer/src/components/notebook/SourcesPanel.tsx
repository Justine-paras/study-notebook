import type { UseQueryResult } from '@tanstack/react-query'
import { FileUp, Upload } from 'lucide-react'
import type { Source } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { ErrorNotice } from '../ErrorNotice'
import { Button, LoadingBlock, Panel } from '../ui'
import { pluralize } from '../../lib/format'
import { ImportProgress } from './ImportProgress'
import { SourceRow } from './SourceRow'
import type { SourceImport } from './useSourceImport'
import './SourcesPanel.css'

export interface SourcesPanelProps {
  sources: UseQueryResult<Source[], ApiError>
  importer: SourceImport
  /** Files are being dragged over the window (the whole page accepts drops). */
  dragging: boolean
}

/**
 * The notebook's files. Drop files anywhere on the page or use Upload; each
 * file shows its own progress, then joins the list with its type, a kind
 * selector and summarize / open / delete.
 */
export function SourcesPanel({ sources, importer, dragging }: SourcesPanelProps) {
  const list = sources.data ?? []
  return (
    <Panel
      title="Sources"
      meta={list.length > 0 ? pluralize(list.length, 'file') : undefined}
      className="sources-panel"
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={16} aria-hidden="true" />}
          onClick={() => void importer.pick()}
          loading={importer.picking}
        >
          Upload
        </Button>
      }
    >
      <button
        type="button"
        className={['sources-panel__drop', dragging && 'sources-panel__drop--active'].filter(Boolean).join(' ')}
        onClick={() => void importer.pick()}
      >
        <FileUp size={20} aria-hidden="true" />
        <span className="sources-panel__drop-title">
          {dragging ? 'Drop to add them to this notebook' : 'Drop PDFs, slides, docs, quizzes or exams'}
        </span>
        <span className="sources-panel__drop-hint">or click to choose files · PDF, PPTX, DOCX, TXT, MD</span>
      </button>

      <ImportProgress
        items={importer.items}
        progress={importer.progress}
        onDismiss={importer.dismiss}
        onClearFinished={importer.clearFinished}
      />

      {sources.isPending ? (
        <LoadingBlock label="Loading files…" />
      ) : sources.error ? (
        <ErrorNotice error={sources.error} title="Couldn't load the files" compact onRetry={() => void sources.refetch()} />
      ) : list.length === 0 ? (
        <p className="sources-panel__empty">
          No files yet. Start with your syllabus: the app reads it to list your topics and exam dates.
        </p>
      ) : (
        <ul className="sources-panel__list" aria-label="Files in this notebook">
          {list.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
