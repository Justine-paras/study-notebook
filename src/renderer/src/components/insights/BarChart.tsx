import type { CSSProperties } from 'react'
import { barFractions } from './insightsModel'
import './BarChart.css'

export interface BarDatum {
  key: string
  /** Short label under the bar ("Mon"). */
  label: string
  /** Full label for the data table and tooltip ("Monday, October 5"). */
  fullLabel: string
  value: number
  /** Formatted value ("12", "45 min"). */
  valueText: string
  /** Draws the bar in ink (today). */
  highlight?: boolean
}

export interface BarChartProps {
  data: readonly BarDatum[]
  /** Caption of the screen-reader table, e.g. "Reviews due on each of the next 7 days". */
  caption: string
  labelHeader: string
  valueHeader: string
  /** Plot height in px (bars and value labels). Default 110. */
  height?: number
  /** Hide the "0" above empty bars to reduce clutter on long ranges. */
  hideZeroValues?: boolean
  className?: string
}

/**
 * A small column chart drawn with divs. The visual is hidden from screen
 * readers, which get the same numbers as a table instead.
 */
export function BarChart({
  data,
  caption,
  labelHeader,
  valueHeader,
  height = 110,
  hideZeroValues = false,
  className
}: BarChartProps) {
  const fractions = barFractions(data.map((d) => d.value))
  return (
    <figure className={['bar-chart', className].filter(Boolean).join(' ')}>
      <div className="bar-chart__plot" aria-hidden="true" style={{ '--bar-chart-height': `${height}px` } as CSSProperties}>
        {data.map((datum, index) => (
          <div key={datum.key} className="bar-chart__column" title={`${datum.fullLabel}: ${datum.valueText}`}>
            <div className="bar-chart__track">
              <span className="bar-chart__value tabular">{hideZeroValues && datum.value === 0 ? '' : datum.valueText}</span>
              <span
                className={[
                  'bar-chart__bar',
                  datum.highlight && 'bar-chart__bar--highlight',
                  datum.value === 0 && 'bar-chart__bar--empty'
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ '--bar-fraction': fractions[index] } as CSSProperties}
              />
            </div>
            <span className={['bar-chart__label', datum.highlight && 'bar-chart__label--highlight'].filter(Boolean).join(' ')}>
              {datum.label}
            </span>
          </div>
        ))}
      </div>
      {/* The wrapper hides the table: a <table> ignores the 1px height of .sr-only,
          so on its own it would stay full size and stretch the page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeader}</th>
              <th scope="col">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((datum) => (
              <tr key={datum.key}>
                <th scope="row">{datum.fullLabel}</th>
                <td>{datum.valueText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
