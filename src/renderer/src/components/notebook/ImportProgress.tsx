import { CircleAlert, CircleCheck, Clock, TriangleAlert, X } from 'lucide-react'
import { IconButton, Spinner } from '../ui'
import { pluralize } from '../../lib/format'
import type { ImportItem, ImportProgress as Progress } from './importQueue'
import './ImportProgress.css'

export interface ImportProgressProps {
  items: readonly ImportItem[]
  progress: Progress
  onDismiss: (key: string) => void
  onClearFinished: () => void
}

const STATUS_TEXT: Record<ImportItem['status'], string> = {
  queued: 'Waiting…',
  importing: 'Copying and reading the text…',
  done: '',
  warning: '',
  failed: ''
}

/** One line per file being added, with its result; failures stay until dismissed. */
export function ImportProgress({ items, progress, onDismiss, onClearFinished }: ImportProgressProps) {
  if (items.length === 0) return null
  const summary = progress.active
    ? `Adding ${progress.finished + 1} of ${pluralize(progress.total, 'file')}…`
    : [progress.added > 0 && `${pluralize(progress.added, 'file')} added`, progress.failed > 0 && `${progress.failed} couldn't be added`]
        .filter(Boolean)
        .join(', ')

  return (
    <div className="import-progress">
      <div className="import-progress__head">
        <span className="import-progress__summary" role="status">
          {summary}
        </span>
        {!progress.active && (
          <button type="button" className="import-progress__clear" onClick={onClearFinished}>
            Clear
          </button>
        )}
      </div>
      <ul className="import-progress__list">
        {items.map((item) => (
          <li key={item.key} className={`import-progress__item import-progress__item--${item.status}`}>
            <span className="import-progress__icon">
              <StatusIcon status={item.status} />
            </span>
            <div className="import-progress__text">
              <div className="import-progress__name" title={item.path || item.name}>
                {item.name}
              </div>
              <div className="import-progress__message">{item.message ?? STATUS_TEXT[item.status]}</div>
            </div>
            {(item.status === 'failed' || item.status === 'warning') && (
              <IconButton label={`Dismiss ${item.name}`} size="sm" onClick={() => onDismiss(item.key)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusIcon({ status }: { status: ImportItem['status'] }) {
  switch (status) {
    case 'queued':
      return <Clock size={16} aria-label="Waiting" />
    case 'importing':
      return <Spinner size={16} label="Adding" />
    case 'done':
      return <CircleCheck size={16} aria-label="Added" />
    case 'warning':
      return <TriangleAlert size={16} aria-label="Added with a problem" />
    case 'failed':
      return <CircleAlert size={16} aria-label="Not added" />
  }
}
