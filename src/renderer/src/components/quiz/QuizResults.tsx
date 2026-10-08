import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { QuizKind, QuizResult } from '@shared/types'
import { CONFIDENCE_LABELS, pluralize } from '../../lib/format'
import { ROUTES } from '../../lib/routes'
import { MasteryPill } from '../MasteryPill'
import { Badge, Button, Callout, ProgressBar, Sheet, Stat, type ProgressTone } from '../ui'
import { AnswerFeedback } from './AnswerFeedback'
import { QuestionView } from './QuestionView'
import { answerFeedback, questionTopicLabel, scoreKicker, scorePercent } from './quizModel'
import { useTopicLookup } from './useTopicLabels'
import './QuizResults.css'

export interface QuizResultsProps {
  result: QuizResult
  /** Buttons at the end, e.g. "Continue to Remember" and "New questions". */
  actions?: ReactNode
  /** Heading; defaults by quiz kind. */
  title?: ReactNode
}

const TITLES: Record<QuizKind, string> = {
  practice: 'Practice results',
  weak_spots: 'Weak spots results',
  mock_exam: 'Mock exam results'
}

function accuracyTone(pct: number): ProgressTone {
  if (pct >= 80) return 'good'
  if (pct >= 60) return 'caution'
  return 'bad'
}

/**
 * Score, "sure but wrong" count, cards made from mistakes, a by-topic
 * breakdown, and each question with its feedback. Mock exams list only the
 * mistakes by default ("Review mistakes").
 */
export function QuizResults({ result, actions, title }: QuizResultsProps) {
  const { quiz, correct, total, byTopic, overconfident, cardsCreated } = result
  const { labels, topics } = useTopicLookup(quiz.notebookId)
  const isExam = quiz.kind === 'mock_exam'
  const topicsHeadingId = useId()
  const questionsHeadingId = useId()
  const [showAll, setShowAll] = useState(!isExam)
  const answers = new Map(quiz.answers.map((a) => [a.questionId, a]))
  const overconfidentIds = new Set(overconfident)
  const reviewed = quiz.questions
    .map((question, index) => ({ question, index, answer: answers.get(question.id) }))
    .filter(({ answer }) => showAll || !answer?.correct)
  const mistakes = total - correct
  const showByTopic = isExam || byTopic.length > 1

  return (
    <Sheet
      raised
      className="quiz-results"
      kicker={scoreKicker(correct, total)}
      title={title ?? TITLES[quiz.kind]}
      aside={
        <Badge tone="ink" size="md" className="quiz-results__score">
          Score {correct} / {total}
        </Badge>
      }
    >
      <div className="quiz-results__stats">
        <Stat boxed value={`${scorePercent(correct, total)}%`} label={`${correct} of ${pluralize(total, 'question')} right`} />
        <Stat boxed value={overconfident.length} label={'"sure" but wrong'} tone={overconfident.length > 0 ? 'bad' : 'default'} />
        <Stat boxed value={cardsCreated} label={cardsCreated === 1 ? 'flashcard from a mistake' : 'flashcards from mistakes'} />
      </div>
      {mistakes > 0 && (
        <p className="quiz-results__note">
          Every mistake became a flashcard, so it comes back in your reviews.
          {overconfident.length > 0 && ' The ones you were sure about come back first.'}
        </p>
      )}

      {showByTopic && byTopic.length > 0 && (
        <section className="quiz-results__section" aria-labelledby={topicsHeadingId}>
          <h3 id={topicsHeadingId} className="quiz-results__heading">
            By topic
          </h3>
          <ul className="quiz-results__topics">
            {byTopic.map((row) => {
              const pct = scorePercent(row.correct, row.total)
              const topic = row.topicId ? topics.get(row.topicId) : undefined
              return (
                <li key={row.topicId ?? 'other'} className="quiz-results__topic">
                  <div className="quiz-results__topic-name">
                    {row.topicId ? <Link to={ROUTES.topic(row.topicId)}>{row.topicTitle}</Link> : row.topicTitle}
                  </div>
                  <span className="quiz-results__topic-score tabular">
                    {row.correct} / {row.total}
                  </span>
                  <ProgressBar
                    className="quiz-results__topic-bar"
                    value={pct}
                    label={`${row.topicTitle}: ${row.correct} of ${row.total} right`}
                    tone={accuracyTone(pct)}
                    size="sm"
                  />
                  {topic && (
                    <span className="quiz-results__topic-mastery">
                      <span className="sr-only">Mastery now: </span>
                      <MasteryPill state={topic.progress.state} mastery={topic.progress.mastery} />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {isExam && <p className="quiz-results__hint text-sm muted">Mastery already includes this exam. Weak topics show up in Today's plan.</p>}
        </section>
      )}

      <section className="quiz-results__section" aria-labelledby={questionsHeadingId}>
        <div className="quiz-results__section-head">
          <h3 id={questionsHeadingId} className="quiz-results__heading">
            {isExam && !showAll ? 'Review mistakes' : 'Your answers'}
          </h3>
          {isExam && (
            <Button variant="ghost" size="sm" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show mistakes only' : `Show all ${total} questions`}
            </Button>
          )}
        </div>
        {reviewed.length === 0 ? (
          <Callout tone="good" title="No mistakes to review.">
            You got every question right. Nice work.
          </Callout>
        ) : (
          <ol className="quiz-results__questions">
            {reviewed.map(({ question, index, answer }) => {
              const feedback = answerFeedback(question, answer)
              return (
                <li key={question.id}>
                  <QuestionView
                    question={question}
                    number={index + 1}
                    meta={questionTopicLabel(question, quiz.kind === 'practice' ? quiz.topicId : null, labels) ?? undefined}
                    response={answer?.response ?? ''}
                    locked
                    reveal
                    correct={answer?.correct ?? false}
                  >
                    {answer?.confidence && (
                      <span className="quiz-results__confidence text-xs muted">You said: {CONFIDENCE_LABELS[answer.confidence]}</span>
                    )}
                    <AnswerFeedback
                      correct={feedback.kind === 'correct'}
                      overconfident={overconfidentIds.has(question.id)}
                      title={feedback.title}
                      explanation={question.explanation}
                      sourceRef={question.sourceRef}
                    />
                  </QuestionView>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {actions !== undefined && <div className="quiz-results__actions">{actions}</div>}
    </Sheet>
  )
}
