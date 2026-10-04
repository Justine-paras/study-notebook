import type { StudyBridge } from '../shared/api'

declare global {
  interface Window {
    studyBridge: StudyBridge
  }
}

export {}
