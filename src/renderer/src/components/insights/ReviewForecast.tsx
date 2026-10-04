import type { ForecastDay } from '@shared/types'
import { Panel } from '../ui'
import { formatDate, pluralize } from '../../lib/format'
import { BarChart } from './BarChart'
import { forecastLabel } from './insightsModel'

/** "Reviews due, next 7 days" as a column chart (today in ink). */
export function ReviewForecast({ forecast }: { forecast: ForecastDay[] }) {
  const total = forecast.reduce((sum, day) => sum + day.due, 0)
  return (
    <Panel title="Reviews due, next 7 days" meta={pluralize(total, 'card')}>
      <BarChart
        caption="Flashcards due on each of the next 7 days"
        labelHeader="Day"
        valueHeader="Cards due"
        data={forecast.map((day, index) => ({
          key: day.date,
          label: forecastLabel(day.date, index),
          fullLabel: index === 0 ? `Today, ${formatDate(day.date, 'medium')}` : formatDate(day.date, 'full'),
          value: day.due,
          valueText: String(day.due),
          highlight: index === 0
        }))}
      />
      {total === 0 && (
        <p className="text-sm muted">
          Nothing is scheduled this week. Cards are made when you finish a topic and when you miss a question.
        </p>
      )}
    </Panel>
  )
}
