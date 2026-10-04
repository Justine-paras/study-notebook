import { useId } from 'react'
import { Check } from 'lucide-react'
import { NOTEBOOK_COLORS, type NotebookColor } from '@shared/types'
import { NOTEBOOK_COLOR_LABELS, notebookStyle } from '../../lib/format'
import './ColorPicker.css'

export interface ColorPickerProps {
  value: NotebookColor
  onChange: (color: NotebookColor) => void
  label?: string
}

/**
 * The 8 cover colors as a native radio group: arrow keys move between them and
 * screen readers announce each color by name.
 */
export function ColorPicker({ value, onChange, label = 'Cover color' }: ColorPickerProps) {
  const name = useId()
  return (
    <fieldset className="color-picker">
      <legend className="color-picker__legend">{label}</legend>
      <div className="color-picker__options">
        {NOTEBOOK_COLORS.map((color) => (
          <label key={color} className="color-picker__option" style={notebookStyle(color)}>
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              className="color-picker__input sr-only"
            />
            <span className="color-picker__swatch" aria-hidden="true">
              {value === color && <Check size={16} strokeWidth={2.6} />}
            </span>
            <span className="color-picker__name">{NOTEBOOK_COLOR_LABELS[color]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
