// Service implementations: one function per StudyApi method, each taking the
// AppContext first. ipc.ts registers them as IPC handlers.
// OWNER: backend agent. Each area lives in its own file in this folder; the
// `services` object here assembles them, and its type makes the compiler
// check that every StudyApi method is implemented with the right signature.

import type { StudyApi } from '@shared/api'
import type { AppContext } from '../context'
import { createCard, deleteCard, getReviewQueue, listCards, reviewCard, updateCard } from './cards'
import { createExam, deleteExam, listExams, updateExam } from './exams'
import { logFocusSession, notify } from './focus'
import { getInsights } from './insights'
import { finishTopic, generateLesson, getLesson, gradeExplanation, recordAnswer } from './lessons'
import { createNote, deleteNote, listNotes, updateNote } from './notes'
import { createNotebook, deleteNotebook, getNotebook, listNotebooks, updateNotebook } from './notebooks'
import { createQuiz, deleteQuiz, getQuiz, getQuizResult, listQuizzes, saveQuizAnswer, startQuiz, submitQuiz } from './quizzes'
import {
  clearApiKey,
  exportBackup,
  getSettings,
  openDataFolder,
  setApiKey,
  testApiKey,
  updateSettings
} from './settings'
import { deleteSource, getSourceText, importSources, listSources, openSource, pickFiles, summarizeSource, updateSource } from './sources'
import { getToday } from './today'
import { createTopic, deleteTopic, extractTopicsFromSyllabus, getTopic, listTopics, reorderTopics, setTopicStep, updateTopic } from './topics'

export type ServiceImpl = {
  [K in keyof StudyApi]: (ctx: AppContext, ...args: Parameters<StudyApi[K]>) => ReturnType<StudyApi[K]>
}

export const services: ServiceImpl = {
  // Notebooks
  listNotebooks,
  getNotebook,
  createNotebook,
  updateNotebook,
  deleteNotebook,

  // Sources
  pickFiles,
  importSources,
  listSources,
  updateSource,
  deleteSource,
  getSourceText,
  summarizeSource,
  openSource,

  // Topics
  listTopics,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderTopics,
  extractTopicsFromSyllabus,
  setTopicStep,

  // Learning path
  getLesson,
  generateLesson,
  recordAnswer,
  gradeExplanation,
  finishTopic,

  // Quizzes and mock exams
  createQuiz,
  getQuiz,
  listQuizzes,
  startQuiz,
  saveQuizAnswer,
  submitQuiz,
  getQuizResult,
  deleteQuiz,

  // Flashcards and reviews
  getReviewQueue,
  reviewCard,
  listCards,
  createCard,
  updateCard,
  deleteCard,

  // Notes
  listNotes,
  createNote,
  updateNote,
  deleteNote,

  // Exams
  listExams,
  createExam,
  updateExam,
  deleteExam,

  // Today and insights
  getToday,
  getInsights,

  // Focus timer
  logFocusSession,
  notify,

  // Settings
  getSettings,
  updateSettings,
  setApiKey,
  clearApiKey,
  testApiKey,
  exportBackup,
  openDataFolder
}
