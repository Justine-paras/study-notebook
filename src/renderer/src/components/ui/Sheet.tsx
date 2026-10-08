import type { HTMLAttributes, ReactNode } from 'react'

export interface SheetProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Handwritten note above the title, e.g. "guess before you learn". */
  kicker?: ReactNode
  /** Serif heading. */
  title?: ReactNode
  titleLevel?: 1 | 2 | 3
  /** Right side of the title row (e.g. a score or "about 45 min"). */
  aside?: ReactNode
  /** default, roomy (lesson reading), compact (small notes). */
  density?: 'default' | 'roomy' | 'compact'
  /** Soft drop shadow, for the main sheet of a page. */
  raised?: boolean
  as?: 'article' | 'section' | 'div'
}

/**
 * Lined notebook paper with the red margin line. Used for lessons, quizzes,
 * the plan and notes. Children are laid out in a column with 16px gaps.
 *   <Sheet kicker="teach it back" title="Explain BST search">...</Sheet>
 */
export function Sheet({
  kicker,
  title,
  titleLevel = 2,
  aside,
  density = 'default',
  raised = false,
  as: Tag = 'article',
  className,
  children,
  ...rest
}: SheetProps) {
  const Heading = `h${titleLevel}` as 'h1' | 'h2' | 'h3'
  const classes = [
    'sheet',
    density !== 'default' && `sheet--${density}`,
    raised && 'sheet--raised',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Tag {...rest} className={classes}>
      {kicker !== undefined && <div className="hand">{kicker}</div>}
      {(title !== undefined || aside !== undefined) && (
        <div className="row row--between row--baseline">
          {title !== undefined && <Heading className="display display--md">{title}</Heading>}
          {aside !== undefined && <div className="text-sm muted">{aside}</div>}
        </div>
      )}
      {children}
    </Tag>
  )
}
