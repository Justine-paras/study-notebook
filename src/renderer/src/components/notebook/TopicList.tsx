import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ArrowUpDown, Check, Plus, Upload } from 'lucide-react'
import type { ID, NotebookSummary, Source, TopicWithProgress } from '@shared/types'
import type { ApiError } from '../../lib/api'
import { AiWorking } from '../AiWorking'
import { ErrorNotice } from '../ErrorNotice'
import { MasteryLegend } from '../MasteryPill'
import { Button, EmptyState, LoadingBlock, useConfirm, useToast } from '../ui'
import { pluralize } from '../../lib/format'
import { queryKeys, useApiMutation } from '../../lib/queries'
import { applyOrder, examCoveredIds, moveId, syllabusCandidates, topicStatusLine } from './model'
import { SyllabusButton, useSyllabusExtraction } from './SyllabusButton'
import { TopicRow } from './TopicRow'
import './TopicList.css'

export interface TopicListProps {
  notebook: NotebookSummary
  topics: UseQueryResult<TopicWithProgress[], ApiError>
  /** Every source of the notebook (empty while loading). */
  sources: readonly Source[]
  syllabus: ReturnType<typeof useSyllabusExtraction>
  onAddTopic: () => void
  onEditTopic: (topic: TopicWithProgress) => void
  onUpload: () => void
  now?: Date
}

/** The main column: topics in course order with their mastery and next step. */
export function TopicList({ notebook, topics, sources, syllabus, onAddTopic, onEditTopic, onUpload, now = new Date() }: TopicListProps) {
  const [reordering, setReordering] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const pendingFocus = useRef<{ id: ID; direction: 'up' | 'down'; via: 'buttons' | 'menu' } | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const topicsKey = queryKeys.topics(notebook.id)

  const reorder = useApiMutation('reorderTopics', {
    // Today's "next topic to learn" follows the course order.
    invalidate: [topicsKey, queryKeys.today()],
    onError: (err) => {
      toast.error(err, "Couldn't save the new order")
      void queryClient.invalidateQueries({ queryKey: topicsKey })
    }
  })
  const remove = useApiMutation('deleteTopic', {
    onSuccess: () => toast.success('Topic deleted'),
    onError: (err) => toast.error(err, "Couldn't delete the topic")
  })

  const list = topics.data ?? []
  const nextExam = useMemo(
    () => (notebook.nextExam ? { exam: notebook.nextExam, topicIds: examCoveredIds(notebook.nextExam, list) } : null),
    [notebook.nextExam, list]
  )

  // Rows are re-inserted when the order changes, which drops focus: put it back on the control that moved.
  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (!target || !listRef.current) return
    pendingFocus.current = null
    const row = listRef.current.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(target.id)}"]`)
    if (!row) return
    if (target.via === 'menu') {
      row.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
      return
    }
    const same = row.querySelector<HTMLButtonElement>(`[data-reorder="${CSS.escape(`${target.id}:${target.direction}`)}"]`)
    const other = row.querySelector<HTMLButtonElement>(
      `[data-reorder="${CSS.escape(`${target.id}:${target.direction === 'up' ? 'down' : 'up'}`)}"]`
    )
    ;(same && !same.disabled ? same : other)?.focus()
  })

  const move = (topic: TopicWithProgress, direction: 'up' | 'down', via: 'buttons' | 'menu') => {
    const next = moveId(
      list.map((t) => t.id),
      topic.id,
      direction
    )
    if (!next) return
    // Show the new order at once; the server confirms it in the background.
    void queryClient.cancelQueries({ queryKey: topicsKey })
    queryClient.setQueryData<TopicWithProgress[]>(topicsKey, (old) =>
      old ? applyOrder(old, next).map((t, orderIndex) => ({ ...t, orderIndex })) : old
    )
    pendingFocus.current = { id: topic.id, direction, via }
    reorder.mutate([notebook.id, next])
  }

  const askDelete = async (topic: TopicWithProgress) => {
    const ok = await confirm({
      title: `Delete “${topic.title}”?`,
      message: 'Its lesson and learning progress are removed from this notebook. This can’t be undone.',
      confirmLabel: 'Delete topic',
      tone: 'danger'
    })
    if (ok) remove.mutate([topic.id])
  }

  const showUnits = list.some((t) => t.unitLabel !== '')
  const syllabusRunning = syllabus.job.isPending
  const hasCandidates = syllabusCandidates(sources).length > 0

  return (
    <section className="topic-list" aria-labelledby="topic-list-title">
      <div className="topic-list__head">
        <div className="topic-list__heading">
          <h2 id="topic-list-title" className="display display--sm">
            Topics
          </h2>
          {list.length > 0 && (
            <span className="topic-list__meta">
              {pluralize(list.length, 'topic')}, in course order
            </span>
          )}
        </div>
        <div className="topic-list__toolbar">
          {list.length > 0 && (
            <SyllabusButton sources={sources} onRun={syllabus.run} running={syllabusRunning} variant="subtle" />
          )}
          <Button variant="subtle" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={onAddTopic}>
            Add topic
          </Button>
          {list.length > 1 && (
            <Button
              variant={reordering ? 'primary' : 'ghost'}
              size="sm"
              icon={reordering ? <Check size={16} aria-hidden="true" /> : <ArrowUpDown size={16} aria-hidden="true" />}
              aria-pressed={reordering}
              onClick={() => setReordering((on) => !on)}
            >
              {reordering ? 'Done' : 'Reorder'}
            </Button>
          )}
        </div>
      </div>
      {list.length > 0 && <MasteryLegend />}

      {syllabusRunning && (
        <AiWorking
          task="syllabus"
          title={syllabus.fileName ? `Finding topics in ${syllabus.fileName}` : undefined}
          compact={list.length > 0}
          startedAt={syllabus.job.job?.startedAt}
          subjectId={notebook.id}
        />
      )}
      <ErrorNotice
        error={syllabus.job.error}
        title={syllabus.fileName ? `Couldn't read ${syllabus.fileName}` : "Couldn't read the syllabus"}
        onRetry={syllabus.job.retry}
        onDismiss={syllabus.job.dismiss}
      />

      {topics.isPending ? (
        <div className="topic-list__box">
          <LoadingBlock label="Loading topics…" />
        </div>
      ) : topics.error ? (
        <ErrorNotice error={topics.error} title="Couldn't load the topics" onRetry={() => void topics.refetch()} />
      ) : list.length === 0 ? (
        syllabusRunning ? null : (
          <div className="topic-list__box">
            <TopicsEmpty
              sources={sources}
              hasSyllabus={hasCandidates}
              onRunSyllabus={syllabus.run}
              onAddTopic={onAddTopic}
              onUpload={onUpload}
            />
          </div>
        )
      ) : (
        <ol ref={listRef} className="topic-list__box topic-list__rows" aria-label="Topics in course order">
          {list.map((topic, index) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              status={topicStatusLine(topic, { now, nextExam })}
              showUnit={showUnits}
              reordering={reordering}
              canMoveUp={index > 0}
              canMoveDown={index < list.length - 1}
              onMove={(direction) => move(topic, direction, reordering ? 'buttons' : 'menu')}
              onEdit={() => onEditTopic(topic)}
              onDelete={() => void askDelete(topic)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

interface TopicsEmptyProps {
  sources: readonly Source[]
  hasSyllabus: boolean
  onRunSyllabus: (source: Source) => void
  onAddTopic: () => void
  onUpload: () => void
}

function TopicsEmpty({ sources, hasSyllabus, onRunSyllabus, onAddTopic, onUpload }: TopicsEmptyProps) {
  const addByHand = (
    <Button variant="subtle" icon={<Plus size={16} aria-hidden="true" />} onClick={onAddTopic}>
      Add a topic by hand
    </Button>
  )
  if (sources.length === 0) {
    return (
      <EmptyState
        kicker="a blank notebook"
        title="No topics yet"
        action={
          <>
            <Button icon={<Upload size={16} aria-hidden="true" />} onClick={onUpload}>
              Add your syllabus
            </Button>
            {addByHand}
          </>
        }
      >
        Add your syllabus and lecture files, and the app will list the topics in course order. You can also add topics yourself.
      </EmptyState>
    )
  }
  return (
    <EmptyState
      kicker="almost there"
      title="No topics yet"
      action={
        <>
          <SyllabusButton sources={sources} onRun={onRunSyllabus} running={false} fallbackToAll variant="primary" />
          {addByHand}
        </>
      }
    >
      {hasSyllabus
        ? `Topics appear here once the syllabus is read. This notebook has ${pluralize(sources.length, 'file')} waiting.`
        : `This notebook has ${pluralize(sources.length, 'file')}. Mark your syllabus as “Syllabus” in Sources, or pick the file that lists your topics.`}
    </EmptyState>
  )
}
