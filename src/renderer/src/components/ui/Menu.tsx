import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Ellipsis } from 'lucide-react'
import { IconButton, type IconButtonVariant } from './IconButton'
import './Menu.css'

export interface MenuItem {
  label: string
  onSelect: () => void
  icon?: ReactNode
  /** danger: red text, for destructive actions (pair with useConfirm). */
  tone?: 'default' | 'danger'
  disabled?: boolean
}

export type MenuEntry = MenuItem | 'separator'

export interface MenuProps {
  /** Accessible name of the trigger, e.g. "Actions for Operating Systems". */
  label: string
  items: readonly MenuEntry[]
  /** Trigger icon. Default: three dots. */
  icon?: ReactNode
  /** Align the menu's start or end edge with the trigger. Default end. */
  align?: 'start' | 'end'
  size?: 'sm' | 'md'
  variant?: IconButtonVariant
  className?: string
}

const GAP = 4
const VIEWPORT_MARGIN = 8

/**
 * Dropdown of row actions behind an icon button (WAI-ARIA menu button):
 * arrow keys, Home/End, Esc and Tab, click outside to close.
 *   <Menu label={`Actions for ${nb.name}`} items={[
 *     { label: 'Rename', icon: <Pencil size={16} />, onSelect: rename },
 *     'separator',
 *     { label: 'Delete', tone: 'danger', onSelect: remove }
 *   ]} />
 */
export function Menu({ label, items, icon, align = 'end', size = 'sm', variant = 'ghost', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    setPosition({ visibility: 'hidden' })
    if (returnFocus) triggerRef.current?.querySelector('button')?.focus()
  }, [])

  const itemButtons = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])

  // Fixed positioning escapes overflow:hidden lists; flip above when there's no room below.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const menu = menuRef.current.getBoundingClientRect()
    const below = trigger.bottom + GAP
    const top = below + menu.height > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, trigger.top - GAP - menu.height) : below
    const rawLeft = align === 'end' ? trigger.right - menu.width : trigger.left
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rawLeft), window.innerWidth - menu.width - VIEWPORT_MARGIN)
    setPosition({ top, left })
    itemButtons()[0]?.focus()
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    // The menu is anchored with fixed coordinates, so any scroll or resize closes it.
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = itemButtons()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % buttons.length
        break
      case 'ArrowUp':
        next = (index - 1 + buttons.length) % buttons.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = buttons.length - 1
        break
      case 'Escape':
        event.preventDefault()
        // Keep Esc from also closing a surrounding dialog.
        event.stopPropagation()
        close(true)
        return
      case 'Tab':
        close(false)
        return
      default:
        return
    }
    event.preventDefault()
    buttons[next]?.focus()
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className={['menu', className].filter(Boolean).join(' ')}>
      <div ref={triggerRef} onKeyDown={onTriggerKeyDown}>
        <IconButton
          label={label}
          size={size}
          variant={variant}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          {icon ?? <Ellipsis size={18} aria-hidden="true" />}
        </IconButton>
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="menu__popup"
          style={position}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((entry, index) =>
            entry === 'separator' ? (
              <div key={`sep-${index}`} role="separator" className="menu__separator" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={entry.disabled}
                className={['menu__item', entry.tone === 'danger' && 'menu__item--danger'].filter(Boolean).join(' ')}
                onClick={() => {
                  close(true)
                  entry.onSelect()
                }}
              >
                {entry.icon && <span className="menu__icon">{entry.icon}</span>}
                {entry.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
