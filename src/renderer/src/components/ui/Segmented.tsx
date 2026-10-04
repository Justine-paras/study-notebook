import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import './Segmented.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Accessible name when the label is only an icon. */
  ariaLabel?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group, e.g. "Difficulty". */
  label: string
  size?: 'sm' | 'md'
  /** Stretch options to fill the width equally. */
  block?: boolean
  className?: string
}

/**
 * One-of-many choice shown as a segmented control (a radio group with arrow-key
 * navigation):
 *   <Segmented label="Count" value={count} onChange={setCount}
 *     options={[{ value: '5', label: '5' }, { value: '10', label: '10' }]} />
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block = false,
  className
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let target: number | undefined
    if (event.key in keys) {
      const pos = enabled.indexOf(index)
      target = enabled[(pos + keys[event.key]! + enabled.length) % enabled.length]
    } else if (event.key === 'Home') target = enabled[0]
    else if (event.key === 'End') target = enabled[enabled.length - 1]
    if (target === undefined) return
    event.preventDefault()
    refs.current[target]?.focus()
    onChange(options[target]!.value)
  }

  const hasSelection = options.some((o) => o.value === value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={['segmented', `segmented--${size}`, block && 'segmented--block', className].filter(Boolean).join(' ')}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        // Roving tabindex: only the checked option (or the first one) is in the tab order.
        const tabbable = checked || (!hasSelection && index === enabled[0])
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={tabbable ? 0 : -1}
            disabled={option.disabled}
            className="segmented__option"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
