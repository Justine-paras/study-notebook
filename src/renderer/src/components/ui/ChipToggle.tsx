import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ChipToggle.css'

export interface ChipToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  pressed: boolean
  onChange: (pressed: boolean) => void
  children: ReactNode
  /** sm 32px (confidence chips inside dense lists), md 40px (default). */
  size?: 'sm' | 'md'
  icon?: ReactNode
}

/**
 * An on/off chip (aria-pressed), e.g. question-type filters:
 *   <ChipToggle pressed={types.mc} onChange={(on) => setType('mc', on)}>Multiple choice</ChipToggle>
 * For one-of-many chips, render several and pass pressed={value === x}.
 */
export function ChipToggle({ pressed, onChange, children, size = 'md', icon, className, type, ...rest }: ChipToggleProps) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      aria-pressed={pressed}
      className={['chip', `chip--${size}`, className].filter(Boolean).join(' ')}
      onClick={() => onChange(!pressed)}
    >
      {icon}
      {children}
    </button>
  )
}

/** Wraps chips in a labelled, wrapping row: `<ChipGroup label="Question types">...</ChipGroup>`. */
export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={['chip-group', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
