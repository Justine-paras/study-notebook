import { useMemo } from 'react'
import type { ID } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { LoadingBlock, Page, PageHeader } from '../components/ui'
import { Calibration } from '../components/insights/Calibration'
import { MistakeLog } from '../components/insights/MistakeLog'
import { ReviewForecast } from '../components/insights/ReviewForecast'
import { StudyTime, SubjectTime } from '../components/insights/StudyTime'
import { WeakTopics } from '../components/insights/WeakTopics'
import { useInsights, useNotebooks } from '../lib/queries'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Insights.css'

export default function InsightsScreen() {
  useDocumentTitle('Insights')
  const insights = useInsights()
  // Only used to name the subject of each mistake; the log still renders without it.
  const notebooks = useNotebooks()
  const subjectNames = useMemo(
    () => new Map<ID, string>((notebooks.data ?? []).map((n) => [n.id, n.code.trim() || n.name])),
    [notebooks.data]
  )

  const header = (
    <PageHeader title="Insights" description="Where your understanding is weak, and whether you know what you think you know." />
  )

  if (insights.isPending) {
    return (
      <Page>
        {header}
        <LoadingBlock label="Looking over your answers…" />
      </Page>
    )
  }

  if (insights.error) {
    return (
      <Page>
        {header}
        <ErrorNotice error={insights.error} title="Couldn't load your insights" onRetry={() => void insights.refetch()} />
      </Page>
    )
  }

  const data = insights.data
  return (
    <Page className="insights">
      {header}
      {/* Two independent columns, so a short weak-topic list never leaves a hole beside the side panels. */}
      <div className="split">
        <div className="split__main">
          <WeakTopics topics={data.weakTopics} />
          <StudyTime studyMinutesByDay={data.studyMinutesByDay} streakDays={data.streakDays} />
        </div>
        <div className="split__side">
          <Calibration
            calibration={data.calibration}
            overconfidentLast7Days={data.overconfidentLast7Days}
            weakTopics={data.weakTopics}
          />
          <ReviewForecast forecast={data.forecast} />
          <SubjectTime subjects={data.studyMinutesBySubject} />
        </div>
      </div>
      <MistakeLog mistakes={data.mistakes} subjectNames={subjectNames} />
    </Page>
  )
}
