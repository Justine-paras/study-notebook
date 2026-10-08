import type { TodayOverview } from '@shared/types'
import { Panel, Stat } from '../ui'
import { formatMinutes, formatPercent } from '../../lib/format'
import './MemoryCheck.css'

type MemoryCheckProps = Pick<TodayOverview, 'recallRate7d' | 'longTermCards' | 'studyMinutesToday'>

/** "Memory check": recall rate this week, cards in long-term memory, minutes studied today. */
export function MemoryCheck({ recallRate7d, longTermCards, studyMinutesToday }: MemoryCheckProps) {
  return (
    <Panel title="Memory check" titleStyle="caps">
      <div className="memory-check">
        <Stat
          value={formatPercent(recallRate7d)}
          label={recallRate7d === null ? 'no reviews this week yet' : 'recalled in reviews this week'}
        />
        <Stat value={longTermCards.toLocaleString('en-US')} label="cards in long-term memory" />
        <Stat value={formatMinutes(studyMinutesToday)} label="studied today" />
      </div>
    </Panel>
  )
}
