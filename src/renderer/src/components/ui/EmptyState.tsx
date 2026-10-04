import type { ReactNode } from 'react'
import './EmptyState.css'

export interface EmptyStateProps {
  /** Handwritten line above the title, e.g. "nothing due today!". */
  kicker?: ReactNode
  title: ReactNode
  /** One or two sentences on why it's empty and what to do. */
  children?: ReactNode
  /** Usually one primary Button. */
  action?: ReactNode
  /** Less padding, smaller title (inside panels). */
  compact?: boolean
  /** Heading level for the title. Default 2. */
  titleLevel?: 2 | 3
  className?: string
}

/**
 * What a list or screen shows when there is nothing yet. No illustrations:
 * a Caveat kicker, a serif title, a sentence and an action.
 *   <EmptyState kicker="a fresh start" title="No notebooks yet" action={<Button onClick={create}>Create your first notebook</Button>}>
 *     One notebook per subject. Add your syllabus and lecture files to it.
 *   </EmptyState>
 */
export function EmptyState({ kicker, title, children, action, compact = false, titleLevel = 2, className }: EmptyStateProps) {
  const Heading = titleLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={['empty-state', compact && 'empty-state--compact', className].filter(Boolean).join(' ')}>
      {kicker !== undefined && <div className="hand empty-state__kicker">{kicker}</div>}
      <Heading className="empty-state__title">{title}</Heading>
      {children !== undefined && <div className="empty-state__text">{children}</div>}
      {action !== undefined && <div className="empty-state__action">{action}</div>}
    </div>
  )
}
