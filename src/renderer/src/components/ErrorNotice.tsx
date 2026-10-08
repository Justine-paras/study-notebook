import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, FolderPlus, RotateCcw, Settings } from 'lucide-react'
import { toApiError } from '../lib/api'
import { Button } from './ui/Button'
import './ErrorNotice.css'

export interface ErrorNoticeProps {
  /** Anything thrown; null/undefined renders nothing. */
  error: unknown
  /** Shows a "Try again" button. */
  onRetry?: () => void
  /** Shows a "Dismiss" button (for errors that stay until cleared, e.g. a failed AI job). */
  onDismiss?: () => void
  /** Where files are added (a notebook page): shown as "Add files" when the error is NO_SOURCES. */
  addFilesTo?: string
  /** Bold first line. Default "That didn't work". */
  title?: string
  /** Smaller, for inline use. */
  compact?: boolean
  className?: string
}

/**
 * Friendly error with an optional retry and technical details on demand.
 * For a missing or rejected API key, an Ollama that can't be reached or no
 * Ollama model it links to Settings; for missing files
 * (NO_SOURCES) to the notebook when `addFilesTo` is given.
 *   <ErrorNotice error={lesson.error} onRetry={() => lesson.run(topicId)} addFilesTo={ROUTES.notebook(id)} />
 */
export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  addFilesTo,
  title = "That didn't work",
  compact = false,
  className
}: ErrorNoticeProps) {
  const [showDetails, setShowDetails] = useState(false)
  const detailsId = useId()
  const noticeRef = useRef<HTMLDivElement>(null)
  // A failed AI job puts its form back with the error underneath, which on a
  // laptop screen is often below the fold: bring a new error into view (no
  // jump when it is already visible).
  useEffect(() => {
    if (error !== null && error !== undefined) noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])
  if (error === null || error === undefined) return null
  const apiError = toApiError(error)
  const needsFiles = apiError.code === 'NO_SOURCES' && addFilesTo !== undefined
  // The fix comes first: a retry only helps once the key, Ollama or the files are there.
  const fixFirst = apiError.needsSettings || needsFiles

  return (
    <div ref={noticeRef} className={['error-notice', compact && 'error-notice--compact', className].filter(Boolean).join(' ')} role="alert">
      <CircleAlert className="error-notice__icon" size={compact ? 18 : 20} aria-hidden="true" />
      <div className="error-notice__body">
        <div className="error-notice__title">{title}</div>
        <p className="error-notice__text">{apiError.friendly}</p>
        <div className="error-notice__actions">
          {apiError.needsSettings && (
            <Button to="/settings" size="sm" icon={<Settings size={16} aria-hidden="true" />}>
              Open Settings
            </Button>
          )}
          {needsFiles && (
            <Button to={addFilesTo} size="sm" icon={<FolderPlus size={16} aria-hidden="true" />}>
              Add files
            </Button>
          )}
          {onRetry && (
            <Button
              variant={fixFirst ? 'subtle' : 'secondary'}
              size="sm"
              icon={<RotateCcw size={16} aria-hidden="true" />}
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
          <button
            type="button"
            className="error-notice__toggle"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        </div>
        {showDetails && (
          <pre id={detailsId} className="error-notice__details">
            {[apiError.code, apiError.method && `in ${apiError.method}`].filter(Boolean).join(' ')}
            {'\n'}
            {apiError.message}
          </pre>
        )}
      </div>
    </div>
  )
}
