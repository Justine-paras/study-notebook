import { Link } from 'react-router'
import type { ID, Note } from '@shared/types'
import { useNotes } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { ErrorNotice } from '../ErrorNotice'
import { Panel, Spinner } from '../ui'
import './NotesRail.css'

export interface NotesRailProps {
  notebookId: ID
  topicId: ID
}

const MAX_NOTES = 3
const EXCERPT_LENGTH = 140

/** First lines of a note, without Markdown symbols, for the handwritten preview. */
function excerpt(note: Note): string {
  const text = note.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^([-*+>]|\d+\.)\s+/, ''))
    .join(' ')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text
}

/** The learner's notes for this topic (including saved explanations), newest first. */
export function NotesRail({ notebookId, topicId }: NotesRailProps) {
  const notes = useNotes(notebookId, topicId)
  const list = [...(notes.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <Panel
      title="My notes"
      as="section"
      className="notes-rail"
      actions={
        list.length > MAX_NOTES ? (
          <Link to={ROUTES.notebook(notebookId)} className="notes-rail__all">
            All {list.length}
          </Link>
        ) : undefined
      }
    >
      {notes.isPending ? (
        <Spinner label="Loading notes" />
      ) : notes.error ? (
        <ErrorNotice error={notes.error} onRetry={() => void notes.refetch()} compact />
      ) : list.length === 0 ? (
        <p className="notes-rail__empty">
          No notes on this topic yet. Your explanation from step 3 is saved here, and you can add notes from the notebook page.
        </p>
      ) : (
        <ul className="notes-rail__list">
          {list.slice(0, MAX_NOTES).map((note) => (
            <li key={note.id} className="notes-rail__note">
              <span className="notes-rail__title">{note.title || 'Untitled note'}</span>
              {excerpt(note) && <span className="hand hand--blue notes-rail__excerpt">{excerpt(note)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
