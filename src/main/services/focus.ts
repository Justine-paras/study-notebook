// Pomodoro focus/break sessions and desktop notifications.

import type { FocusKind, FocusSession, ID } from '@shared/types'
import type { AppContext } from '../context'
import { insertFocusSession } from '../db/repositories/focusSessions'
import { invalid, newId, requireNotebook, requireText, requireTimestamp } from './common'

const MAX_SESSION_MINUTES = 24 * 60

export async function logFocusSession(
  ctx: AppContext,
  input: { notebookId: ID | null; kind: FocusKind; startedAt: string; endedAt: string; minutes: number }
): Promise<FocusSession> {
  if (typeof input !== 'object' || input === null) throw invalid('Session details are required.')
  if (input.kind !== 'focus' && input.kind !== 'break') throw invalid('Session kind must be focus or break.')
  const notebookId = input.notebookId ?? null
  if (notebookId !== null) requireNotebook(ctx, notebookId)
  const startedAt = requireTimestamp(input.startedAt, 'Start time')
  const endedAt = requireTimestamp(input.endedAt, 'End time')
  if (endedAt < startedAt) throw invalid('A session cannot end before it starts.')
  if (typeof input.minutes !== 'number' || !Number.isFinite(input.minutes) || input.minutes < 0 || input.minutes > MAX_SESSION_MINUTES) {
    throw invalid('Minutes must be between 0 and 1440.')
  }
  const session: FocusSession = {
    id: newId(),
    notebookId,
    kind: input.kind,
    startedAt,
    endedAt,
    minutes: Math.round(input.minutes * 100) / 100
  }
  insertFocusSession(ctx.db, session)
  return session
}

export async function notify(ctx: AppContext, title: string, body: string): Promise<void> {
  ctx.desktop.notify(requireText(title, 'Title', 200), typeof body === 'string' ? body.slice(0, 1_000) : '')
}
