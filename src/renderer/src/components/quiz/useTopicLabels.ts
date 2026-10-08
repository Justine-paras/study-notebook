import { useMemo } from 'react'
import type { ID, TopicWithProgress } from '@shared/types'
import { useTopics } from '../../lib/queries'
import type { TopicLabelInfo } from './quizModel'

export interface TopicLookup {
  labels: ReadonlyMap<ID, TopicLabelInfo>
  topics: ReadonlyMap<ID, TopicWithProgress>
}

/** The notebook's topics by id, for question labels and per-topic results. Empty while loading. */
export function useTopicLookup(notebookId: ID | undefined): TopicLookup {
  const topics = useTopics(notebookId)
  return useMemo(() => {
    const list = topics.data ?? []
    return {
      labels: new Map(list.map((t) => [t.id, { title: t.title, unitLabel: t.unitLabel }])),
      topics: new Map(list.map((t) => [t.id, t]))
    }
  }, [topics.data])
}
