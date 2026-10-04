import { FileText, FolderOpen, Sparkles } from 'lucide-react'
import type { TopicWithProgress } from '@shared/types'
import { SOURCE_KIND_LABELS } from '../../lib/format'
import { useSources } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { Badge, Button, Callout, LoadingBlock, Sheet } from '../ui'
import { lessonSourcesPreview } from './topicModel'
import './LessonStart.css'

export interface LessonStartProps {
  topic: TopicWithProgress
  onGenerate: () => void
  pending: boolean
  error: unknown
}

/** First visit to a topic: what the lesson will be built from, and "Create my lesson". */
export function LessonStart({ topic, onGenerate, pending, error }: LessonStartProps) {
  const sources = useSources(topic.notebookId)

  if (pending) {
    return <AiWorking task="lesson" title={`Writing your lesson on ${topic.title}`} />
  }

  const files = sources.data ? lessonSourcesPreview(topic, sources.data) : []
  const hasDescription = topic.description.trim() !== ''
  const canGenerate = files.length > 0 || hasDescription

  return (
    <Sheet raised density="roomy" kicker="a fresh page" title="Create my lesson" className="lesson-start">
      <p className="lesson-start__text">
        Your lesson is written from your own files, in small parts. Each part ends with a quick check, and the topic starts with
        two warm-up guesses. Writing it takes about a minute.
      </p>

      {sources.isPending ? (
        <LoadingBlock label="Looking at your files…" />
      ) : sources.error ? (
        <ErrorNotice error={sources.error} onRetry={() => void sources.refetch()} title="Your files couldn't be listed" compact />
      ) : files.length > 0 ? (
        <div className="lesson-start__files">
          <span className="caps-label caps-label--xs">It will use</span>
          <ul className="lesson-start__list">
            {files.map((file) => (
              <li key={file.id} className="lesson-start__file">
                <FileText size={16} aria-hidden="true" />
                <span className="lesson-start__name">{file.fileName}</span>
                <Badge>{SOURCE_KIND_LABELS[file.kind]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : hasDescription ? (
        <Callout tone="info" title="No files for this topic yet.">
          The lesson will be based on the topic's description alone. Add lecture notes or slides to the notebook for a lesson
          grounded in your course.
        </Callout>
      ) : (
        <Callout tone="warn" title="There's nothing to learn from yet.">
          Add lecture notes, slides or a textbook chapter to this notebook (or link files to this topic), then come back.
        </Callout>
      )}

      <ErrorNotice error={error} onRetry={onGenerate} title="Your lesson couldn't be written" />

      <div className="lesson-start__actions">
        <Button size="lg" icon={<Sparkles size={18} aria-hidden="true" />} onClick={onGenerate} disabled={!canGenerate && !sources.isPending}>
          Create my lesson
        </Button>
        {!canGenerate && !sources.isPending && (
          <Button to={ROUTES.notebook(topic.notebookId)} variant="subtle" size="lg" icon={<FolderOpen size={18} aria-hidden="true" />}>
            Add files
          </Button>
        )}
      </div>
    </Sheet>
  )
}
