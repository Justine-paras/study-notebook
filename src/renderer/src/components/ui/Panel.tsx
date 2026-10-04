import type { HTMLAttributes, ReactNode } from 'react'
import './Panel.css'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Heading text. Rendered as an h2 by default. */
  title?: ReactNode
  /** caps: small uppercase ("Coming up"). plain: 16px bold ("Sources"). serif: display heading ("Weak topics"). */
  titleStyle?: 'caps' | 'plain' | 'serif'
  titleLevel?: 2 | 3
  /** Short text next to the title (right side), e.g. "All subjects, lowest first". */
  meta?: ReactNode
  /** Buttons on the right of the header. */
  actions?: ReactNode
  /** No inner padding (for lists whose rows have their own padding). */
  flush?: boolean
  as?: 'section' | 'div' | 'aside' | 'article'
}

/**
 * A paper card with an optional header: the standard container for side
 * panels and lists.
 *   <Panel title="Coming up" titleStyle="caps">...</Panel>
 */
export function Panel({
  title,
  titleStyle = 'plain',
  titleLevel = 2,
  meta,
  actions,
  flush = false,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: PanelProps) {
  const Heading = titleLevel === 2 ? 'h2' : 'h3'
  const hasHeader = title !== undefined || actions !== undefined || meta !== undefined
  return (
    <Tag {...rest} className={['panel', flush && 'panel--flush', className].filter(Boolean).join(' ')}>
      {hasHeader && (
        <div className="panel__header">
          {title !== undefined && <Heading className={`panel__title panel__title--${titleStyle}`}>{title}</Heading>}
          {meta !== undefined && <span className="panel__meta">{meta}</span>}
          {actions !== undefined && <div className="panel__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  )
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover feedback for cards that are fully clickable (wrap a link or button inside). */
  interactive?: boolean
  /** Smaller padding. */
  compact?: boolean
}

/** A smaller bordered box for items inside panels or sheets (plan blocks, stats, review plan days). */
export function Card({ interactive = false, compact = false, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={['card', interactive && 'card--interactive', compact && 'card--compact', className].filter(Boolean).join(' ')}
    />
  )
}
