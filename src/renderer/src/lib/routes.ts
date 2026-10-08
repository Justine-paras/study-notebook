// Route paths (see ARCHITECTURE.md "Routes"). Use these instead of string literals.

import type { ID, PathStep } from '@shared/types'

export const ROUTES = {
  today: '/',
  notebooks: '/notebooks',
  insights: '/insights',
  settings: '/settings',
  notebook: (notebookId: ID) => `/notebooks/${notebookId}`,
  topic: (topicId: ID, step?: PathStep) => (step ? `/topics/${topicId}?step=${step}` : `/topics/${topicId}`),
  session: (part?: 'review' | 'weak' | 'learn') => (part ? `/session?part=${part}` : '/session'),
  review: (notebookId?: ID) => (notebookId ? `/review?notebook=${notebookId}` : '/review'),
  /** One topic's cards, due or not (reviewing a weak topic on demand). */
  reviewTopic: (topicId: ID) => `/review?topic=${topicId}`,
  quiz: (quizId: ID) => `/quiz/${quizId}`
} as const
