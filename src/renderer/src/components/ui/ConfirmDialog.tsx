import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

export interface ConfirmOptions {
  title: string
  /** Body text (what will happen, what is lost). */
  message?: ReactNode
  /** Default "Confirm" ("Delete" reads better for destructive actions). */
  confirmLabel?: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** danger: red confirm button. Default "default". */
  tone?: 'default' | 'danger'
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Shows a spinner on the confirm button and blocks closing. */
  busy?: boolean
}

/** Controlled yes/no dialog. Most screens should use the promise-based useConfirm() instead. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  busy = false
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="subtle" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message !== undefined && <div className="text-2">{message}</div>}
    </Modal>
  )
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    // A second confirm while one is open cancels the first.
    pendingRef.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok)
    pendingRef.current = null
    setPending(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog open {...pending.options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
      )}
    </ConfirmContext.Provider>
  )
}

/**
 * Promise-based confirmation:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'Delete this notebook?', message: 'Its files, topics and cards are removed.', confirmLabel: 'Delete', tone: 'danger' })) remove.mutate([id])
 */
export function useConfirm(): ConfirmFn {
  const value = useContext(ConfirmContext)
  if (!value) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return value
}
