import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { NotebookSummary } from '@shared/types'
import { NotebookCover } from '../NotebookCover'
import { ROUTES } from '../../lib/routes'
import { shelfFooter } from './todayModel'
import './NotebookShelf.css'

export interface NotebookShelfProps {
  notebooks: NotebookSummary[]
  /** Accessible name of the list, e.g. "Your notebooks". */
  label: string
  /** md on Today (prototype), lg on the Notebooks screen (room for the footer line). */
  size?: 'md' | 'lg'
  /** Show due cards / next exam on each cover. */
  showFooter?: boolean
  /** Adds a "New notebook" tile at the end. */
  onCreate?: () => void
  /** Controls on each cover (e.g. a Menu). */
  renderActions?: (notebook: NotebookSummary) => ReactNode
  now?: Date
}

/** A grid of notebook covers that wraps from 960px to 1920px. */
export function NotebookShelf({ notebooks, label, size = 'md', showFooter = false, onCreate, renderActions, now }: NotebookShelfProps) {
  return (
    <ul className={`shelf shelf--${size}`} aria-label={label}>
      {notebooks.map((notebook) => {
        const footer = showFooter ? shelfFooter(notebook, now) : undefined
        return (
          <li key={notebook.id} className="shelf__item">
            <NotebookCover
              notebook={notebook}
              size={size}
              mastery={notebook.mastery}
              footer={footer}
              to={ROUTES.notebook(notebook.id)}
              ariaLabel={`Open ${notebook.name}${notebook.archived ? ' (archived)' : ''}`}
              actions={renderActions?.(notebook)}
            />
          </li>
        )
      })}
      {onCreate && (
        <li className="shelf__item">
          <button type="button" className="shelf__new" onClick={onCreate}>
            <Plus size={22} aria-hidden="true" />
            <span>New notebook</span>
          </button>
        </li>
      )}
    </ul>
  )
}
