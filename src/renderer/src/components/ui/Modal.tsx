import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import './Modal.css'

export interface ModalProps {
  open: boolean
  /** Called for Esc, the close button and backdrop clicks (unless dismissible is false). */
  onClose: () => void
  title: ReactNode
  /** One line under the title; also the dialog's accessible description. */
  description?: ReactNode
  children?: ReactNode
  /** Action buttons, right-aligned at the bottom. */
  footer?: ReactNode
  /** sm 420px, md 560px (default), lg 760px. */
  size?: 'sm' | 'md' | 'lg'
  /** Close on backdrop click. Default true. */
  closeOnBackdrop?: boolean
  /** False blocks Esc, backdrop and the close button (e.g. while saving). Default true. */
  dismissible?: boolean
  /** Element to focus on open. Default: [data-autofocus], else the first field or button in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Wraps body and footer in a <form>; Enter in a field submits. preventDefault is called for you. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

/**
 * Modal dialog built on the native <dialog> (top layer, inert background,
 * aria-modal) with a focus trap, Esc to close and focus restored on close.
 * Content is only mounted while open.
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="New notebook"
 *     onSubmit={create} footer={<><Button variant="subtle" onClick={close}>Cancel</Button><Button type="submit">Create</Button></>}>
 *     <TextField label="Name" data-autofocus ... />
 *   </Modal>
 */
export function Modal(props: ModalProps) {
  if (!props.open) return null
  return createPortal(<ModalDialog {...props} />, document.body)
}

function ModalDialog({
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  dismissible = true,
  initialFocusRef,
  onSubmit,
  className
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pressStartedOnBackdrop = useRef(false)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible
  // Set while this component closes the dialog itself (unmount), so the native "close" event is ignored.
  const closingRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    closingRef.current = false
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    const body = dialog.querySelector<HTMLElement>('.modal__body')
    const target =
      initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>('[data-autofocus]') ??
      (body ? focusables(body)[0] : undefined) ??
      dialog.querySelector<HTMLElement>('.modal__footer button:not([disabled])') ??
      dialog
    target.focus()
    return () => {
      closingRef.current = true
      if (dialog.open) dialog.close()
      // Return focus to whatever opened the dialog, if it is still on the page.
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
    // Mount-only on purpose: focus moves once, when the dialog opens.
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Esc fires "cancel"; the dialog stays open until the parent closes it (controlled).
    const onCancel = (event: Event) => {
      // Chromium won't let a page cancel a second Esc without a click or key press in
      // between: the dialog then closes by itself, and onNativeClose below takes over.
      if (!event.cancelable) return
      event.preventDefault()
      if (dismissibleRef.current) onCloseRef.current()
    }
    // A close this component didn't ask for (see above): show it again, and let the
    // parent decide (it unmounts it, keeps it, or asks first, e.g. "Discard changes?").
    const onNativeClose = () => {
      // "close" is async: by now the dialog may be open again (StrictMode remount), which makes it stale.
      if (closingRef.current || dialog.open) return
      dialog.showModal()
      if (dismissibleRef.current) onCloseRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('close', onNativeClose)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('close', onNativeClose)
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = focusables(dialogRef.current)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // A click on the ::backdrop targets the <dialog> itself. Both press and release
  // must happen there, so selecting text and releasing outside doesn't close it.
  function onMouseDown(event: MouseEvent<HTMLDialogElement>) {
    pressStartedOnBackdrop.current = event.target === event.currentTarget
  }

  function onClick(event: MouseEvent<HTMLDialogElement>) {
    if (closeOnBackdrop && dismissible && pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose()
    pressStartedOnBackdrop.current = false
  }

  const content = (
    <>
      <div className="modal__body">{children}</div>
      {footer !== undefined && <div className="modal__footer">{footer}</div>}
    </>
  )

  return (
    <dialog
      ref={dialogRef}
      className={['modal', `modal--${size}`, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <div className="modal__panel">
        <div className="modal__header">
          <div className="modal__heading">
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            {description && (
              <p id={descId} className="modal__description">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton label="Close" size="sm" onClick={onClose} className="modal__close">
              <X size={18} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {onSubmit ? (
          <form
            className="modal__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(event)
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </dialog>
  )
}
