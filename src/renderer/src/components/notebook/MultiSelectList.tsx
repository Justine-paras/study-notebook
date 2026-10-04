import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import './MultiSelectList.css'

export interface MultiSelectOption {
  value: string
  label: string
  /** Second, smaller line (e.g. a file's kind). */
  hint?: string
}

export interface MultiSelectListProps {
  /** Visible legend, e.g. "Topics on this exam". */
  label: string
  /** Help under the legend, e.g. "Leave all unticked to cover every topic." */
  hint?: string
  options: readonly MultiSelectOption[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
  /** Text when there are no options at all. */
  emptyText: string
  /** Show a filter box from this many options. Default 8. */
  filterFrom?: number
}

/**
 * A checkbox list in a scrolling box, with "Select all" / "Clear" and a
 * filter for long lists. Selection order follows the options' order.
 */
export function MultiSelectList({
  label,
  hint,
  options,
  selected,
  onChange,
  emptyText,
  filterFrom = 8
}: MultiSelectListProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const chosen = useMemo(() => new Set(selected), [selected])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  const setChecked = (value: string, checked: boolean) => {
    const next = new Set(chosen)
    if (checked) next.add(value)
    else next.delete(value)
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value))
  }

  const hintId = hint ? `${id}-hint` : undefined
  return (
    <fieldset className="multi-select" aria-describedby={hintId}>
      <div className="multi-select__head">
        <legend className="multi-select__legend">{label}</legend>
        {options.length > 1 && (
          <div className="multi-select__bulk">
            <button
              type="button"
              className="multi-select__link"
              onClick={() => onChange(options.map((o) => o.value))}
              disabled={chosen.size === options.length}
            >
              Select all
            </button>
            <button type="button" className="multi-select__link" onClick={() => onChange([])} disabled={chosen.size === 0}>
              Clear
            </button>
          </div>
        )}
      </div>
      {hint && (
        <p id={hintId} className="multi-select__hint">
          {hint}
        </p>
      )}
      {options.length >= filterFrom && (
        <div className="multi-select__filter">
          <Search size={16} aria-hidden="true" className="multi-select__filter-icon" />
          <input
            type="search"
            className="multi-select__filter-input"
            placeholder="Filter"
            aria-label={`Filter ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {options.length === 0 ? (
        <p className="multi-select__empty">{emptyText}</p>
      ) : (
        <ul className="multi-select__list">
          {visible.map((option) => {
            const optionId = `${id}-${option.value}`
            return (
              <li key={option.value} className="multi-select__item">
                <input
                  id={optionId}
                  type="checkbox"
                  className="multi-select__check"
                  checked={chosen.has(option.value)}
                  onChange={(event) => setChecked(option.value, event.target.checked)}
                />
                <label htmlFor={optionId} className="multi-select__label">
                  <span>{option.label}</span>
                  {option.hint && <span className="multi-select__option-hint">{option.hint}</span>}
                </label>
              </li>
            )
          })}
          {visible.length === 0 && <li className="multi-select__empty">Nothing matches “{query.trim()}”.</li>}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {chosen.size} of {options.length} selected
      </p>
    </fieldset>
  )
}
