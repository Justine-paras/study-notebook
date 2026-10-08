import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Notebook } from '@shared/types'
import { notebookStyle } from '../lib/format'
import { ProgressBar } from './ui/ProgressBar'
import './NotebookCover.css'

export interface NotebookCoverProps {
  notebook: Pick<Notebook, 'name' | 'code' | 'color'> & Partial<Pick<Notebook, 'archived'>>
  /** sm 150px tall, md 200px (default, shelf), lg 240px. */
  size?: 'sm' | 'md' | 'lg'
  /** 0-100: shows a "Mastery" bar at the bottom of the cover. */
  mastery?: number | null
  /** Small text at the bottom, e.g. "12 cards due · Midterm in 9 days". */
  footer?: ReactNode
  /** Makes the cover a router link. */
  to?: string
  /** Makes the cover a button (ignored when `to` is set). */
  onClick?: () => void
  /** Accessible name for the link/button. Default "Open <name>". */
  ariaLabel?: string
  /** Controls drawn on the cover's top-right corner, outside the link (e.g. a <Menu>). */
  actions?: ReactNode
  className?: string
}

/**
 * A notebook drawn as a cover: darker spine, elastic band, label sticker
 * with course code and name, optional mastery bar.
 *   <NotebookCover notebook={nb} mastery={nb.mastery} to={`/notebooks/${nb.id}`} />
 */
export function NotebookCover({
  notebook,
  size = 'md',
  mastery,
  footer,
  to,
  onClick,
  ariaLabel,
  actions,
  className
}: NotebookCoverProps) {
  const label = ariaLabel ?? `Open ${notebook.name}`
  const face = (
    <>
      <span className="cover__spine" aria-hidden="true" />
      <span className="cover__band" aria-hidden="true" />
      <span className="cover__label">
        {notebook.code && <span className="cover__code">{notebook.code}</span>}
        <span className="cover__name">{notebook.name}</span>
      </span>
      {(mastery !== undefined && mastery !== null) || footer !== undefined ? (
        <span className="cover__bottom">
          {mastery !== undefined && mastery !== null && (
            <>
              <span className="cover__mastery-row">
                <span>Mastery</span>
                <span className="tabular">{Math.round(mastery)}%</span>
              </span>
              <ProgressBar value={mastery} label={`Mastery of ${notebook.name}`} size="sm" onCover />
            </>
          )}
          {footer !== undefined && <span className="cover__footer">{footer}</span>}
        </span>
      ) : null}
    </>
  )

  const classes = [
    'cover',
    `cover--${size}`,
    notebook.archived && 'cover--archived',
    actions !== undefined && 'cover--with-actions',
    className
  ]
    .filter(Boolean)
    .join(' ')
  let surface: ReactNode
  if (to !== undefined) {
    surface = (
      <Link to={to} className="cover__face" aria-label={label}>
        {face}
      </Link>
    )
  } else if (onClick) {
    surface = (
      <button type="button" className="cover__face" aria-label={label} onClick={onClick}>
        {face}
      </button>
    )
  } else {
    surface = <div className="cover__face">{face}</div>
  }

  return (
    <div className={classes} style={notebookStyle(notebook.color)}>
      {surface}
      {actions !== undefined && <div className="cover__actions">{actions}</div>}
    </div>
  )
}
