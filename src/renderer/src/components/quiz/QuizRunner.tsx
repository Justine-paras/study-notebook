import type { ReactNode } from 'react'
import type { Quiz, QuizResult } from '@shared/types'
import { EmptyState } from '../ui'
import { ExamRunner } from './ExamRunner'
import { SheetRunner } from './SheetRunner'

export interface QuizRunnerProps {
  /** Key the runner by quiz id: answers are read from the quiz once, when it mounts. */
  quiz: Quiz
  /** Called once the quiz is graded. The parent then shows <QuizResults>. */
  onSubmitted: (result: QuizResult) => void
  /** Heading of the practice sheet (default: the quiz title). */
  title?: ReactNode
  /** One line under the heading, e.g. why the questions are mixed. */
  intro?: ReactNode
}

/**
 * Runs a quiz: practice and weak-spot quizzes as one lined sheet with every
 * question; mock exams one question at a time with a timer, a navigator,
 * flags and autosave.
 */
export function QuizRunner({ quiz, onSubmitted, title, intro }: QuizRunnerProps) {
  if (quiz.questions.length === 0) {
    return (
      <EmptyState kicker="a blank page" title="This quiz has no questions">
        The AI didn't return any questions for it. Make a new quiz and try again.
      </EmptyState>
    )
  }
  if (quiz.kind === 'mock_exam') return <ExamRunner quiz={quiz} onSubmitted={onSubmitted} />
  return <SheetRunner quiz={quiz} onSubmitted={onSubmitted} title={title} intro={intro} />
}
