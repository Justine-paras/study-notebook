import { TextArea, TextField } from '../ui'

export interface TopicDraft {
  title: string
  unitLabel: string
  description: string
}

export const EMPTY_TOPIC_DRAFT: TopicDraft = { title: '', unitLabel: '', description: '' }

export interface TopicFormFieldsProps {
  draft: TopicDraft
  onChange: (draft: TopicDraft) => void
  /** Shown under the title after a submit with an empty title. */
  titleError?: string
}

/** The fields shared by the Add topic and Edit topic dialogs. */
export function TopicFormFields({ draft, onChange, titleError }: TopicFormFieldsProps) {
  return (
    <>
      <TextField
        label="Topic"
        placeholder="e.g. Binary search trees"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        error={titleError}
        maxLength={200}
        required
        data-autofocus
      />
      <TextField
        label="Unit or week"
        hint="Optional. Shown next to the topic, like in your syllabus."
        placeholder="e.g. Week 4"
        value={draft.unitLabel}
        onChange={(event) => onChange({ ...draft, unitLabel: event.target.value })}
        maxLength={40}
      />
      <TextArea
        label="What it covers"
        hint="Optional. A sentence or two helps the lesson focus on the right things, and lets a lesson be written even without files."
        rows={3}
        value={draft.description}
        onChange={(event) => onChange({ ...draft, description: event.target.value })}
        maxLength={2000}
      />
    </>
  )
}

/** Trimmed values, or null when the title is empty. */
export function cleanTopicDraft(draft: TopicDraft): TopicDraft | null {
  const title = draft.title.trim()
  if (!title) return null
  return { title, unitLabel: draft.unitLabel.trim(), description: draft.description.trim() }
}
