import { FileText } from 'lucide-react'
import { Panel } from '../ui'
import './SourcesRail.css'

export interface SourcesRailProps {
  /** The lesson's sourcesUsed (with page ranges when a file was cut), or null before there is a lesson. */
  sources: readonly string[] | null
}

/** "Built from": the files (and pages) the lesson was written from. */
export function SourcesRail({ sources }: SourcesRailProps) {
  return (
    <Panel title="Built from" as="section" className="sources-rail">
      {sources === null ? (
        <p className="sources-rail__empty">The files your lesson uses are listed here once it is written.</p>
      ) : sources.length === 0 ? (
        <p className="sources-rail__empty">No files: based on the topic description.</p>
      ) : (
        <ul className="sources-rail__list">
          {sources.map((source) => (
            <li key={source} className="sources-rail__item">
              <FileText size={14} aria-hidden="true" />
              <span>{source}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
