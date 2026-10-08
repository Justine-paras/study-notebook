// Form fields with a visible label, an optional hint and an error message,
// all wired with ids and aria-describedby. Every field forwards the native
// props (value, onChange, disabled, ref...) to its control.

import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import './Field.css'

interface FieldChromeProps {
  label: ReactNode
  /** Help text under the control. */
  hint?: ReactNode
  /** Error text; also sets aria-invalid. */
  error?: ReactNode
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean
  /** Class on the wrapper. */
  className?: string
}

export interface FieldProps extends FieldChromeProps {
  /** Renders the control with the ids it must use. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  /** Something on the right of the label row, e.g. the slider's current value. */
  labelAside?: ReactNode
  /** Optional id for the control (one is generated otherwise). */
  id?: string
}

/** Low-level wrapper for custom controls: `<Field label="Color">{({ id }) => <Picker id={id} />}</Field>`. */
export function Field({ label, hint, error, hideLabel, className, children, labelAside, id }: FieldProps) {
  const generated = useId()
  const controlId = id ?? generated
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <div className={hideLabel ? 'sr-only' : 'field__label-row'}>
        <label htmlFor={controlId} className="field__label">
          {label}
        </label>
        {labelAside !== undefined && !hideLabel && <span className="field__label-aside">{labelAside}</span>}
      </div>
      {children({ id: controlId, describedBy, invalid: !!error })}
      {hint && (
        <div id={hintId} className="field__hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export type TextFieldProps = FieldChromeProps & Omit<ComponentProps<'input'>, 'className'> & { inputClassName?: string }

/** `<TextField label="Course code" hint="Optional, e.g. CS 201" value={code} onChange={(e) => setCode(e.target.value)} />` */
export function TextField({ label, hint, error, hideLabel, className, inputClassName, id, ...input }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} id={id}>
      {(ids) => (
        <input
          type="text"
          {...input}
          id={ids.id}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          className={['field__control', inputClassName].filter(Boolean).join(' ')}
        />
      )}
    </Field>
  )
}

export type TextAreaProps = FieldChromeProps & Omit<ComponentProps<'textarea'>, 'className'> & { inputClassName?: string }

/** `<TextArea label="Your explanation" rows={6} value={text} onChange={(e) => setText(e.target.value)} />` */
export function TextArea({ label, hint, error, hideLabel, className, inputClassName, id, rows = 4, ...input }: TextAreaProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} id={id}>
      {(ids) => (
        <textarea
          rows={rows}
          {...input}
          id={ids.id}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          className={['field__control', 'field__control--textarea', inputClassName].filter(Boolean).join(' ')}
        />
      )}
    </Field>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export type SelectProps = FieldChromeProps &
  Omit<ComponentProps<'select'>, 'className' | 'children'> & {
    options: readonly SelectOption[]
    /** Adds a first, empty option (e.g. "Choose a file"). */
    placeholder?: string
  }

/** `<Select label="Model" value={model} onChange={(e) => setModel(e.target.value)} options={AI_MODELS.map(...)} />` */
export function Select({ label, hint, error, hideLabel, className, id, options, placeholder, ...select }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} id={id}>
      {(ids) => (
        <div className="field__select">
          <select
            {...select}
            id={ids.id}
            aria-describedby={ids.describedBy}
            aria-invalid={ids.invalid || undefined}
            className="field__control field__control--select"
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <svg className="field__select-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </Field>
  )
}

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'className'> & {
  label: ReactNode
  /** Second line under the label. */
  description?: ReactNode
  className?: string
}

/** `<Checkbox label="Mix in earlier topics" checked={mix} onChange={(e) => setMix(e.target.checked)} />` */
export function Checkbox({ label, description, className, id, ...input }: CheckboxProps) {
  const generated = useId()
  const controlId = id ?? generated
  const descId = description ? `${controlId}-desc` : undefined
  return (
    <div className={['check', className].filter(Boolean).join(' ')}>
      <input {...input} id={controlId} type="checkbox" className="check__input" aria-describedby={descId} />
      <label htmlFor={controlId} className="check__label">
        <span className="check__text">{label}</span>
        {description && (
          <span id={descId} className="check__description">
            {description}
          </span>
        )}
      </label>
    </div>
  )
}

export type SwitchProps = Omit<ComponentProps<'button'>, 'onChange' | 'className' | 'role'> & {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

/** On/off setting: `<Switch label="Focus on my weak spots" checked={weak} onChange={setWeak} />` */
export function Switch({ label, description, checked, onChange, className, id, disabled, ...rest }: SwitchProps) {
  const generated = useId()
  const controlId = id ?? generated
  const labelId = `${controlId}-label`
  const descId = description ? `${controlId}-desc` : undefined
  return (
    <div className={['switch', className].filter(Boolean).join(' ')}>
      <div className="switch__text">
        <span id={labelId} className="switch__label" onClick={() => !disabled && onChange(!checked)}>
          {label}
        </span>
        {description && (
          <span id={descId} className="switch__description">
            {description}
          </span>
        )}
      </div>
      <button
        {...rest}
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        className="switch__control"
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" aria-hidden="true" />
      </button>
    </div>
  )
}

export type SliderProps = FieldChromeProps &
  Omit<ComponentProps<'input'>, 'type' | 'className' | 'value' | 'onChange'> & {
    value: number
    onChange: (value: number) => void
    min: number
    max: number
    step?: number
    /** Formats the value shown next to the label and read by screen readers. */
    format?: (value: number) => string
  }

/**
 * `<Slider label="Desired retention" min={0.8} max={0.97} step={0.01} value={r}
 *    onChange={setR} format={(v) => `${Math.round(v * 100)}%`} hint="..." />`
 */
export function Slider({ label, hint, error, hideLabel, className, id, value, onChange, min, max, step = 1, format, ...input }: SliderProps) {
  const shown = format ? format(value) : String(value)
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={className}
      id={id}
      labelAside={<output className="field__value tabular">{shown}</output>}
    >
      {(ids) => (
        <input
          {...input}
          id={ids.id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={shown}
          aria-describedby={ids.describedBy}
          className="field__range"
          style={{ '--range-pct': `${((value - min) / (max - min || 1)) * 100}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      )}
    </Field>
  )
}
