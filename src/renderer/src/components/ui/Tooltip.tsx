import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import './Tooltip.css'

export interface TooltipProps {
  /** Tooltip text (keep it short; it is also the trigger's accessible description). */
  content: ReactNode
  /** One focusable element (button, link, or an element with tabIndex={0}). */
  children: ReactElement<{ 'aria-describedby'?: string }>
  placement?: 'top' | 'bottom'
  /** Wider tooltip for definitions (key terms). */
  wide?: boolean
}

const GAP = 6
const MARGIN = 8

/**
 * Shows on hover and keyboard focus, hides on Esc, blur or mouse leave.
 * The child gets aria-describedby pointing at the tooltip.
 *   <Tooltip content="Desktop notification when a phase ends"><button>...</button></Tooltip>
 */
export function Tooltip({ content, children, placement = 'top', wide = false }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => setOpen(true), [])
  const hide = useCallback(() => {
    setOpen(false)
    setStyle({ visibility: 'hidden' })
  }, [])

  // Fixed positioning so overflow:hidden containers never clip the tooltip.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return
    const target = (anchorRef.current.firstElementChild ?? anchorRef.current).getBoundingClientRect()
    const tip = tipRef.current.getBoundingClientRect()
    let top = placement === 'top' ? target.top - GAP - tip.height : target.bottom + GAP
    if (top < MARGIN) top = target.bottom + GAP
    if (top + tip.height > window.innerHeight - MARGIN) top = target.top - GAP - tip.height
    const centered = target.left + target.width / 2 - tip.width / 2
    const left = Math.min(Math.max(MARGIN, centered), window.innerWidth - tip.width - MARGIN)
    setStyle({ top, left })
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open, hide])

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' ')
      })
    : children

  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {trigger}
      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        className={['tooltip', wide && 'tooltip--wide', open && 'tooltip--open'].filter(Boolean).join(' ')}
        style={style}
      >
        {content}
      </span>
    </span>
  )
}
