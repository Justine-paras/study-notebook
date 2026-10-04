import { useRef, useState } from 'react'
import { ListTree } from 'lucide-react'
import type { ID, Source } from '@shared/types'
import { Button, Modal, Select, useToast, type ButtonVariant } from '../ui'
import { aiJobs, useAiAction } from '../../lib/aiJobs'
import { ROUTES } from '../../lib/routes'
import { syllabusCandidates, syllabusSummary } from './model'

/**
 * Runs the AI syllabus reader for a notebook and toasts what it added. The
 * screen owns it (not the button) so the progress panel can sit above the
 * topic list while the button stays in the toolbar. It is an app-wide job:
 * leaving the notebook keeps it running, and coming back shows its progress.
 */
export function useSyllabusExtraction(notebookId: ID) {
  const toast = useToast()
  const fileName = useRef('')
  const key = `syllabus:${notebookId}`
  const job = useAiAction('extractTopicsFromSyllabus', key, {
    task: 'syllabus',
    // A retry after leaving and coming back keeps the file name of the first try.
    label: () => fileName.current || aiJobs.get(key)?.label || 'your syllabus',
    href: ROUTES.notebook(notebookId),
    // The summary toast below always shows (it says what was added), so no second "ready" toast.
    announceSuccess: false,
    onSuccess: (result) => {
      const summary = syllabusSummary(result, fileName.current || (aiJobs.get(key)?.label ?? ''))
      toast.show({ tone: summary.tone, title: summary.title, message: summary.message })
    }
  })
  const run = (source: Source) => {
    if (job.isPending) return
    fileName.current = source.fileName
    job.run(notebookId, source.id)
  }
  return {
    run,
    job,
    /** The file being read (or that failed), for the progress and error panels. */
    fileName: job.isPending || job.error ? (job.job?.label ?? '') : ''
  }
}

export interface SyllabusButtonProps {
  sources: readonly Source[]
  onRun: (source: Source) => void
  running: boolean
  /** When no file is marked as a syllabus, let the learner pick any ready file. */
  fallbackToAll?: boolean
  variant?: ButtonVariant
}

/**
 * "Find topics in syllabus". Hidden when there is no file to read; asks
 * which file when there is more than one candidate.
 */
export function SyllabusButton({ sources, onRun, running, fallbackToAll = false, variant = 'secondary' }: SyllabusButtonProps) {
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState('')
  const candidates = syllabusCandidates(sources, fallbackToAll)
  if (candidates.length === 0) return null

  const markedSyllabus = candidates.some((s) => s.kind === 'syllabus')
  const label = markedSyllabus ? 'Find topics in syllabus' : 'Find topics in a file'

  const open = () => {
    if (candidates.length === 1) {
      onRun(candidates[0]!)
      return
    }
    setChoice(candidates[0]!.id)
    setPicking(true)
  }

  const confirm = () => {
    const source = candidates.find((s) => s.id === choice)
    if (!source) return
    setPicking(false)
    onRun(source)
  }

  return (
    <>
      <Button variant={variant} size="sm" icon={<ListTree size={16} aria-hidden="true" />} onClick={open} loading={running}>
        {label}
      </Button>
      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        size="sm"
        title={markedSyllabus ? 'Which syllabus?' : 'Which file lists your topics?'}
        description="The topics are added in course order, along with any exam dates it mentions. Topics you already have are kept."
        onSubmit={confirm}
        footer={
          <>
            <Button variant="subtle" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button type="submit">Find topics</Button>
          </>
        }
      >
        <Select
          label="File"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          options={candidates.map((s) => ({ value: s.id, label: s.fileName }))}
          data-autofocus
        />
      </Modal>
    </>
  )
}
