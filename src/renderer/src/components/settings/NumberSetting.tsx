import { useEffect, useRef, useState } from 'react'
import { TextField } from '../ui'
import { useDebouncer } from './debounce'
import { parseWholeNumber, type NumberSettingSpec } from './settingsModel'

/** Typing pauses this long before a number is saved. */
const SAVE_DELAY_MS = 700

export interface NumberSettingProps {
  spec: NumberSettingSpec
  /** The saved value. */
  value: number
  onSave: (value: number) => Promise<boolean>
}

/** A whole-number setting saved shortly after typing stops (and right away on blur). */
export function NumberSetting({ spec, value, onSave }: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  const lastSaved = useRef(value)

  // Follow outside changes (another window, a refetch) unless the learner is typing here.
  useEffect(() => {
    lastSaved.current = value
    if (!focused.current) {
      setDraft(String(value))
      setError(null)
    }
  }, [value])

  const debouncer = useDebouncer((next: number) => {
    void onSave(next).then((ok) => {
      if (ok) lastSaved.current = next
      else if (!focused.current) setDraft(String(lastSaved.current))
    })
  }, SAVE_DELAY_MS)

  function change(raw: string) {
    setDraft(raw)
    const parsed = parseWholeNumber(raw, spec.min, spec.max)
    if (!parsed.ok) {
      setError(parsed.error)
      debouncer.cancel()
      return
    }
    setError(null)
    if (parsed.value === lastSaved.current) debouncer.cancel()
    else debouncer.schedule(parsed.value)
  }

  return (
    <TextField
      label={spec.label}
      hint={spec.hint}
      error={error ?? undefined}
      type="number"
      inputMode="numeric"
      min={spec.min}
      max={spec.max}
      step={1}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        debouncer.flush()
      }}
    />
  )
}
