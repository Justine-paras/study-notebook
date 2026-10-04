import type { Insights } from '@shared/types'
import { EmptyState, Panel, ProgressBar, Stat } from '../ui'
import { formatDate, formatMinutes, notebookStyle, pluralize, toLocalDateKey } from '../../lib/format'
import { BarChart } from './BarChart'
import { studyTotals } from './insightsModel'
import './StudyTime.css'

type StudyTimeProps = Pick<Insights, 'studyMinutesByDay' | 'streakDays'>

/** Focus minutes for each of the last 14 days, with totals and the streak. */
export function StudyTime({ studyMinutesByDay, streakDays }: StudyTimeProps) {
  const totals = studyTotals(studyMinutesByDay)
  const todayKey = toLocalDateKey()
  return (
    <Panel title="Study time" meta="Last 14 days" className="study-time">
      <div className="study-time__stats">
        <Stat value={pluralize(streakDays, 'day')} label="study streak" />
        <Stat value={formatMinutes(totals.total)} label="focused in 14 days" />
        <Stat value={formatMinutes(totals.dailyAverage)} label="a day on average" />
      </div>
      <BarChart
        caption="Focus minutes on each of the last 14 days"
        labelHeader="Day"
        valueHeader="Minutes"
        height={120}
        hideZeroValues
        data={studyMinutesByDay.map((day) => {
          const isToday = day.date === todayKey
          return {
            key: day.date,
            label: formatDate(day.date, 'weekday'),
            fullLabel: `${isToday ? 'Today, ' : ''}${formatDate(day.date, 'weekday-short')}`,
            value: day.minutes,
            valueText: String(day.minutes),
            highlight: isToday
          }
        })}
      />
      {totals.total === 0 && (
        <p className="text-sm muted">
          Study time counts while the focus timer in the top bar runs. Start it whenever you sit down to study.
        </p>
      )}
    </Panel>
  )
}

/** Focus minutes per notebook over the last 30 days, longest first. */
export function SubjectTime({ subjects }: { subjects: Insights['studyMinutesBySubject'] }) {
  const max = Math.max(0, ...subjects.map((s) => s.minutes))
  return (
    <Panel title="By subject" meta="Last 30 days" className="subject-time">
      {subjects.length === 0 ? (
        <EmptyState compact titleLevel={3} title="No subject time yet">
          Open a notebook while the focus timer runs and its minutes are credited to that subject.
        </EmptyState>
      ) : (
        <ul className="subject-time__list">
          {subjects.map((subject) => (
            <li key={subject.notebookId} className="subject-time__row" style={notebookStyle(subject.color)}>
              <div className="subject-time__head">
                <span className="subject-time__name">
                  <span className="subject-time__dot" aria-hidden="true" />
                  {subject.name}
                </span>
                <span className="subject-time__minutes tabular">{formatMinutes(subject.minutes)}</span>
              </div>
              <ProgressBar
                value={subject.minutes}
                max={max || 1}
                label={`Study time for ${subject.name}`}
                valueText={formatMinutes(subject.minutes)}
                notebookColor={subject.color}
                size="sm"
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
