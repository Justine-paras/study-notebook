// Toasts: short, non-blocking messages in the bottom-right corner.
//   const toast = useToast()
//   toast.success('Notebook created')
//   toast.error(err)  // ApiError or anything: shows the friendly text
//   toast.show({ title: 'Saved', message: '3 cards added', action: { label: 'Undo', onClick } })

import { createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { friendlyMessage } from '../../lib/api'
import './Toast.css'

export type ToastTone = 'info' | 'good' | 'warn' | 'bad'

export interface ToastInput {
  message: ReactNode
  title?: string
  tone?: ToastTone
  /** Milliseconds before it hides; 0 keeps it until dismissed. Default 5000 (8000 for errors). */
  duration?: number
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastInput {
  id: number
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (toast: ToastInput) => number
  success: (message: ReactNode, title?: string) => number
  info: (message: ReactNode, title?: string) => number
  /** Accepts an ApiError/Error (shows its friendly text) or a message. */
  error: (error: unknown, title?: string) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  good: CircleCheck,
  warn: TriangleAlert,
  bad: CircleAlert
}

const MAX_TOASTS = 4

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX_TOASTS))
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (message, title) => show({ message, title, tone: 'good' }),
      info: (message, title) => show({ message, title, tone: 'info' }),
      error: (error, title) => {
        const message = typeof error === 'string' || isValidElement(error) ? error : friendlyMessage(error)
        return show({ message, title, tone: 'bad' })
      }
    }),
    [show, dismiss]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="region" aria-label="Notifications">
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const tone = toast.tone ?? 'info'
  const Icon = ICONS[tone]
  const duration = toast.duration ?? (tone === 'bad' ? 8000 : 5000)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (duration <= 0 || paused) return
    const id = window.setTimeout(() => onDismiss(toast.id), duration)
    return () => window.clearTimeout(id)
  }, [duration, paused, toast.id, onDismiss])

  return (
    <div
      className={`toast toast--${tone}`}
      role={tone === 'bad' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="toast__icon" size={18} aria-hidden="true" />
      <div className="toast__body">
        {toast.title && <div className="toast__title">{toast.title}</div>}
        <div className="toast__message">{toast.message}</div>
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside <ToastProvider>')
  return value
}
