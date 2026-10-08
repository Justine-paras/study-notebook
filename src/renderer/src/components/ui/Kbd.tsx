import type { ReactNode } from 'react'
import './Kbd.css'

/** A keyboard key hint: `Press <Kbd>Space</Kbd> to reveal`. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={['kbd', className].filter(Boolean).join(' ')}>{children}</kbd>
}
