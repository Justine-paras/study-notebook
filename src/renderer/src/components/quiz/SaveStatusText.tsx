import { Check, CloudOff } from 'lucide-react'
import { Spinner } from '../ui'
import type { SaveStatus } from './useQuizAnswers'
import './SaveStatusText.css'

/** "Saving…" / "Answers saved" / "Not saved", shown quietly while a quiz is taken. */
export function SaveStatusText({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  return (
    <span className={`save-status save-status--${status}`} aria-live="polite">
      {status === 'saving' && <Spinner size={12} label={null} />}
      {status === 'saved' && <Check size={14} aria-hidden="true" />}
      {status === 'error' && <CloudOff size={14} aria-hidden="true" />}
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Answers saved' : 'Not saved yet'}
    </span>
  )
}
