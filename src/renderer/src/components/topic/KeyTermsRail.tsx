import type { KeyTerm } from '@shared/types'
import { Panel, Tooltip } from '../ui'
import './KeyTermsRail.css'

export interface KeyTermsRailProps {
  terms: readonly KeyTerm[] | null
}

/** Highlighter chips for the lesson's key terms; the definition shows on hover or keyboard focus. */
export function KeyTermsRail({ terms }: KeyTermsRailProps) {
  return (
    <Panel title="Key terms" as="section" className="key-terms">
      {terms === null ? (
        <p className="key-terms__empty">Key terms appear here once your lesson is written.</p>
      ) : terms.length === 0 ? (
        <p className="key-terms__empty">This lesson has no key terms.</p>
      ) : (
        <ul className="key-terms__list">
          {terms.map((term) => (
            <li key={term.term}>
              <Tooltip content={term.definition} wide>
                <button type="button" className="key-terms__chip">
                  {term.term}
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
