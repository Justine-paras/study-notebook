import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, Lightbulb } from 'lucide-react'
import type { Lesson, Question, TopicWithProgress } from '@shared/types'
import { useTopics } from '../../lib/queries'
import { ROUTES } from '../../lib/routes'
import { Markdown } from '../Markdown'
import { Button, Callout, Sheet } from '../ui'
import { InstantQuestion } from './InstantQuestion'
import { linkConnections, passedChunks, questionKey, shortNote, termsInText, type InstantAnswer, type InstantAnswers } from './topicModel'
import './LearnStep.css'

export interface LearnStepProps {
  topic: TopicWithProgress
  lesson: Lesson
  chunkIndex: number
  onChunkChange: (index: number) => void
  answers: InstantAnswers
  onAnswer: (key: string, answer: InstantAnswer) => void
  /** Back from the first part (to the warm-up). */
  onBack: () => void
  /** Next from the last part (to Explain it). */
  onFinish: () => void
}

function checkFeedback(correct: boolean, question: Question): string {
  return correct ? 'Correct.' : `Not quite. The answer is ${question.answer}.`
}

const NOTE_TILTS = ['hand--tilt-left', 'hand--tilt-right', '']

/**
 * Step 2: the lesson in small parts on lined paper. Each part ends with a
 * quick check that must be answered (right or wrong) before "Next part".
 */
export function LearnStep({ topic, lesson, chunkIndex, onChunkChange, answers, onAnswer, onBack, onFinish }: LearnStepProps) {
  const { chunks, keyTerms, connections } = lesson.content
  const count = chunks.length
  const index = Math.min(Math.max(0, chunkIndex), Math.max(0, count - 1))
  const chunk = chunks[index]
  const rootRef = useRef<HTMLDivElement>(null)
  const hintId = useId()
  const notebookTopics = useTopics(topic.notebookId)

  // Each new part starts at its top, with focus on its heading for screen readers.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    rootRef.current?.scrollIntoView({ block: 'start' })
    rootRef.current?.querySelector<HTMLElement>('.learn__heading')?.focus({ preventScroll: true })
  }, [index])

  if (!chunk) {
    return (
      <Sheet raised kicker="nothing to read yet" title="This lesson has no parts">
        <p className="learn__text">Regenerate the lesson from the menu above, or go on to explain the topic in your own words.</p>
        <div>
          <Button iconEnd={<ArrowRight size={16} aria-hidden="true" />} onClick={onFinish}>
            Explain it
          </Button>
        </div>
      </Sheet>
    )
  }

  const checkKey = questionKey(chunk.check)
  const checkAnswer = answers[checkKey]
  const unlocked = checkAnswer !== undefined || index < passedChunks(topic.pathStep, topic.chunkIndex, count)
  const isLast = index === count - 1
  const notes = termsInText(keyTerms, `${chunk.heading}\n${chunk.body}\n${chunk.example}`)
  const linked = isLast ? linkConnections(connections, notebookTopics.data ?? [], topic.id) : []

  return (
    <div className="learn" ref={rootRef}>
      <ol className="learn__progress" aria-label={`Part ${index + 1} of ${count}`}>
        {chunks.map((c, i) => (
          <li
            key={i}
            className={['learn__segment', i < index && 'learn__segment--done', i === index && 'learn__segment--current']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="sr-only">
              Part {i + 1}: {c.heading}
              {i < index ? ' (read)' : i === index ? ' (reading now)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <Sheet raised density="roomy" as="article" className="learn__sheet" aria-labelledby={`learn-heading-${index}`}>
        <div className="learn__columns">
          <div className="learn__main">
            <span className="caps-label caps-label--xs">
              Part {index + 1} of {count}
            </span>
            <h2 id={`learn-heading-${index}`} className="learn__heading" tabIndex={-1}>
              {chunk.heading}
            </h2>
            <Markdown variant="lesson">{chunk.body}</Markdown>

            {chunk.example.trim() && (
              <Callout tone="highlight" label="Worked example" icon={<Lightbulb size={18} aria-hidden="true" />}>
                <Markdown variant="lesson" className="learn__example">
                  {chunk.example}
                </Markdown>
              </Callout>
            )}

            {linked.length > 0 && (
              <div className="learn__connections">
                <span className="learn__connections-label">Connects to</span>
                <ul>
                  {linked.map((connection) => (
                    <li key={connection.text}>
                      {connection.text}
                      {connection.topics.map((t) => (
                        <span key={t.id}>
                          {' '}
                          <Link to={ROUTES.topic(t.id)} className="learn__connection-link">
                            Open {t.title}
                          </Link>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Callout tone="outline" label="Quick check before moving on" className="learn__check">
              <InstantQuestion
                key={checkKey}
                question={chunk.check}
                topicId={topic.id}
                notebookId={topic.notebookId}
                source="check"
                answer={checkAnswer}
                onAnswered={(answer) => onAnswer(checkKey, answer)}
                feedbackTitle={checkFeedback}
              />
            </Callout>

            <div className="learn__nav">
              <Button
                variant="subtle"
                icon={<ArrowLeft size={16} aria-hidden="true" />}
                onClick={() => (index === 0 ? onBack() : onChunkChange(index - 1))}
              >
                {index === 0 ? 'Back to warm-up' : 'Back'}
              </Button>
              <Button
                iconEnd={<ArrowRight size={16} aria-hidden="true" />}
                disabled={!unlocked}
                aria-describedby={unlocked ? undefined : hintId}
                onClick={() => (isLast ? onFinish() : onChunkChange(index + 1))}
              >
                {isLast ? 'Finish: explain it' : 'Next part'}
              </Button>
              {!unlocked && (
                <span id={hintId} className="learn__hint">
                  Answer the quick check first. Any answer counts, right or wrong.
                </span>
              )}
            </div>
          </div>

          {notes.length > 0 && (
            <aside className="learn__margin" aria-label="Margin notes">
              {notes.map((note, i) => (
                <p key={note.term} className={['hand', 'hand--blue', 'learn__note', NOTE_TILTS[i % NOTE_TILTS.length]].filter(Boolean).join(' ')}>
                  <strong>{note.term}</strong>: {shortNote(note.definition)}
                </p>
              ))}
            </aside>
          )}
        </div>
      </Sheet>
    </div>
  )
}
