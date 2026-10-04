import { useId, useState } from 'react'
import { CircleAlert, RotateCcw, Settings } from 'lucide-react'
import { toApiError } from '../lib/api'
import { Button } from './ui/Button'
import './ErrorNotice.css'

export interface ErrorNoticeProps {
  /** Anything thrown; null/undefined renders nothing. */
  error: unknown
  /** Shows a "Try again" button. */
  onRetry?: () => void
  /** Bold first line. Default "That didn't work". */
  title?: string
  /** Smaller, for inline use. */
  compact?: boolean
  className?: string
}

/**
 * Friendly error with an optional retry and technical details on demand.
 * For a missing or rejected API key it links to Settings.
 *   <ErrorNotice error={generate.error} onRetry={() => generate.mutate([topicId])} />
 */
export function ErrorNotice({ error, onRetry, title = "That didn't work", compact = false, className }: ErrorNoticeProps) {
  const [showDetails, setShowDetails] = useState(false)
  const detailsId = useId()
  if (error === null || error === undefined) return null
  const apiError = toApiError(error)

  return (
    <div className={['error-notice', compact && 'error-notice--compact', className].filter(Boolean).join(' ')} role="alert">
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
          {onRetry && (
            <Button
              variant={apiError.needsSettings ? 'subtle' : 'secondary'}
              size="sm"
              icon={<RotateCcw size={16} aria-hidden="true" />}
              onClick={onRetry}
            >
              Try again
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
