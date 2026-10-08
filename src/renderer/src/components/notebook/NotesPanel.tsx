import { useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { ID, Note, TopicWithProgress } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { ErrorNotice } from '../ErrorNotice'
import { Badge, Button, LoadingBlock, Panel } from '../ui'
import { formatDate, pluralize } from '../../lib/format'
import { NOTE_KIND_LABELS, notePreview, sortNotes } from './model'
import { NoteDialog } from './NoteDialog'
import './NotesPanel.css'

export interface NotesPanelProps {
  notebookId: ID
  notes: UseQueryResult<Note[], ApiError>
  topics: readonly TopicWithProgress[]
  now?: Date
}

const COLLAPSED_COUNT = 5

/** The learner's notes, file summaries and saved explanations, newest first. */
export function NotesPanel({ notebookId, notes, topics, now = new Date() }: NotesPanelProps) {
  const [editing, setEditing] = useState<{ note: Note | null } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => sortNotes(notes.data ?? []), [notes.data])
  const topicTitles = useMemo(() => new Map(topics.map((t) => [t.id, t.title])), [topics])
  const visible = showAll ? sorted : sorted.slice(0, COLLAPSED_COUNT)

  return (
    <Panel
      title="Notes"
      meta={sorted.length > 0 ? pluralize(sorted.length, 'note') : undefined}
      actions={
        <Button variant="subtle" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({ note: null })}>
          New note
        </Button>
      }
    >
      {notes.isPending ? (
        <LoadingBlock label="Loading notes…" />
      ) : notes.error ? (
        <ErrorNotice error={notes.error} title="Couldn't load your notes" compact onRetry={() => void notes.refetch()} />
      ) : sorted.length === 0 ? (
        <p className="notes-panel__empty">
          No notes yet. Write your own, or summarize a file from Sources. Your “explain it” answers are saved here too.
        </p>
      ) : (
        <>
          <ul className="notes-panel__list">
            {visible.map((note) => {
              const topic = note.topicId ? topicTitles.get(note.topicId) : undefined
              const preview = notePreview(note.body)
              return (
                <li key={note.id}>
                  <button type="button" className="notes-panel__item" onClick={() => setEditing({ note })}>
                    <span className="notes-panel__title-row">
                      <span className="notes-panel__title">{note.title || 'Untitled note'}</span>
                      {note.kind !== 'note' && (
                        <Badge tone={note.kind === 'summary' ? 'info' : 'warn'}>{NOTE_KIND_LABELS[note.kind]}</Badge>
                      )}
                    </span>
                    {preview && <span className="notes-panel__preview">{preview}</span>}
                    <span className="notes-panel__meta">
                      {[topic, formatDate(note.updatedAt, 'medium', now)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {sorted.length > COLLAPSED_COUNT && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : `Show all ${sorted.length} notes`}
            </Button>
          )}
        </>
      )}
      <NoteDialog
        open={editing !== null}
        note={editing?.note ?? null}
        notebookId={notebookId}
        topics={topics}
        onClose={() => setEditing(null)}
      />
    </Panel>
  )
}
