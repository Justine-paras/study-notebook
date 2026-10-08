import { useEffect, useRef, useState } from 'react'
import { Slider } from '../ui'
import { useDebouncer } from './debounce'
import { RETENTION_MAX, RETENTION_MIN, RETENTION_STEP, formatRetention, retentionHint } from './settingsModel'

const SAVE_DELAY_MS = 500

export interface RetentionSettingProps {
  value: number
  onSave: (value: number) => Promise<boolean>
}

/** Desired retention slider (0.80-0.97) with a live explanation; saved when the slider rests. */
export function RetentionSetting({ value, onSave }: RetentionSettingProps) {
  const [draft, setDraft] = useState(value)
  const lastSaved = useRef(value)

  const debouncer = useDebouncer((next: number) => {
    void onSave(next).then((ok) => {
      if (ok) lastSaved.current = next
      else if (!debouncer.isPending()) setDraft(lastSaved.current)
    })
  }, SAVE_DELAY_MS)

  // Follow outside changes, but never yank the thumb while a newer value waits to be saved.
  useEffect(() => {
    lastSaved.current = value
    if (!debouncer.isPending()) setDraft(value)
  }, [value, debouncer])

  return (
    <Slider
      label="Desired retention"
      min={RETENTION_MIN}
      max={RETENTION_MAX}
      step={RETENTION_STEP}
      value={draft}
      format={formatRetention}
      hint={retentionHint(draft)}
      onChange={(next) => {
        // Range inputs can report 0.9000000000000001; the backend keeps two decimals too.
        const rounded = Math.round(next * 100) / 100
        setDraft(rounded)
        if (rounded === lastSaved.current) debouncer.cancel()
        else debouncer.schedule(rounded)
      }}
      onBlur={() => debouncer.flush()}
    />
  )
}
