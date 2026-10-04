import { useId, useState } from 'react'
import type { AnswerRecord, ID } from '@shared/types'
import { Markdown } from '../Markdown'
import { Button, EmptyState, Panel } from '../ui'
import { formatDate } from '../../lib/format'
import { ANSWER_SOURCE_LABELS, shownAnswer } from './insightsModel'
import './MistakeLog.css'

const INITIAL_ROWS = 6

export interface MistakeLogProps {
  mistakes: AnswerRecord[]
  /** notebookId -> "CS 201" (or the notebook name). */
  subjectNames: ReadonlyMap<ID, string>
}

/** Recent wrong answers: question, what was answered, the right answer, where and when. */
export function MistakeLog({ mistakes, subjectNames }: MistakeLogProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const shown = expanded ? mistakes : mistakes.slice(0, INITIAL_ROWS)

  return (
    <Panel title="Mistake log" meta="Every wrong answer becomes a flashcard automatically." className="mistake-log">
      {mistakes.length === 0 ? (
        <EmptyState compact titleLevel={3} title="No mistakes logged">
          Wrong answers from quizzes, lesson checks and reviews are listed here, so you can see what keeps tripping
          you up.
        </EmptyState>
      ) : (
        <>
          <ol id={listId} className="mistake-log__list">
            {shown.map((mistake) => {
              const subject = subjectNames.get(mistake.notebookId)
              return (
                <li key={mistake.id} className="mistake-log__item">
                  <div className="mistake-log__prompt">
                    <Markdown variant="compact">{mistake.prompt}</Markdown>
                  </div>
                  <dl className="mistake-log__answers">
                    <div className="mistake-log__answer mistake-log__answer--yours">
                      <dt>Your answer</dt>
                      <dd>{shownAnswer(mistake.userAnswer)}</dd>
                    </div>
                    <div className="mistake-log__answer mistake-log__answer--right">
                      <dt>Correct answer</dt>
                      <dd>{mistake.correctAnswer}</dd>
                    </div>
                  </dl>
                  <div className="mistake-log__meta">
                    {[subject, ANSWER_SOURCE_LABELS[mistake.source], formatDate(mistake.answeredAt, 'medium')]
                      .filter(Boolean)
                      .join(' · ')}
                    {mistake.confidence === 'sure' && <span className="mistake-log__flag">you were sure</span>}
                  </div>
                </li>
              )
            })}
          </ol>
          {mistakes.length > INITIAL_ROWS && (
            <div className="mistake-log__more">
              <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show fewer' : `Show all ${mistakes.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
