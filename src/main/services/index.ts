// Service implementations: one function per StudyApi method, each taking the
// AppContext first. ipc.ts registers them as IPC handlers.
// OWNER: backend agent. Split the implementation across files in this folder
// (notebooks.ts, sources.ts, topics.ts, lessons.ts, quizzes.ts, cards.ts,
// notes.ts, exams.ts, today.ts, focus.ts, settings.ts, ...) and assemble the
// `services` object here.

import type { StudyApi } from '@shared/api'
import type { AppContext } from '../context'

export type ServiceImpl = {
  [K in keyof StudyApi]: (ctx: AppContext, ...args: Parameters<StudyApi[K]>) => ReturnType<StudyApi[K]>
}

const notImplemented = (name: string) => async (): Promise<never> => {
  throw new Error(`TODO: ${name}`)
}

export const services = new Proxy({} as ServiceImpl, {
  get: (_target, prop: string) => notImplemented(prop)
})
