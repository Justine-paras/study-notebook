import { ArrowRight } from 'lucide-react'
import type { Lesson, Question, TopicWithProgress } from '@shared/types'
import { Button, Sheet } from '../ui'
import { InstantQuestion } from './InstantQuestion'
import { questionKey, type InstantAnswer, type InstantAnswers } from './topicModel'
import './WarmupStep.css'

export interface WarmupStepProps {
  topic: TopicWithProgress
  lesson: Lesson
  answers: InstantAnswers
  onAnswer: (key: string, answer: InstantAnswer) => void
  onNext: () => void
}

function warmupFeedback(correct: boolean, question: Question): string {
  return correct ? 'Good guess.' : `Not yet: it's "${question.answer}".`
}

/** Step 1: two guesses before the lesson. Pre-testing primes memory, so wrong answers are fine. */
export function WarmupStep({ topic, lesson, answers, onAnswer, onNext }: WarmupStepProps) {
  const questions = lesson.content.warmup
  const answered = questions.filter((q) => answers[questionKey(q)] !== undefined).length

  return (
    <Sheet raised kicker="guess before you learn" className="warmup">
      {questions.length === 0 ? (
        <p className="warmup__intro">This lesson has no warm-up questions. Go straight to the first part.</p>
      ) : (
        <>
          <p className="warmup__intro">
            {questions.length === 1 ? 'One quick question' : `${questions.length === 2 ? 'Two' : questions.length} quick questions`}{' '}
            before the lesson. Getting them wrong is fine: guessing first makes the real answer easier to remember.
          </p>
        <ol className="warmup__list">
          {questions.map((question, index) => {
            const key = questionKey(question)
            return (
              <li key={key}>
                <InstantQuestion
                  question={question}
                  topicId={topic.id}
                  notebookId={topic.notebookId}
                  source="warmup"
                  number={questions.length > 1 ? index + 1 : undefined}
                  answer={answers[key]}
                  onAnswered={(answer) => onAnswer(key, answer)}
                  feedbackTitle={warmupFeedback}
                  hotkeyScope="focus"
                />
              </li>
            )
          })}
          </ol>
        </>
      )}

      <div className="warmup__actions">
        <Button size="lg" iconEnd={<ArrowRight size={18} aria-hidden="true" />} onClick={onNext}>
          Start learning
        </Button>
        {answered < questions.length && <span className="hand hand--sm">a guess is better than a blank</span>}
      </div>
    </Sheet>
  )
}
