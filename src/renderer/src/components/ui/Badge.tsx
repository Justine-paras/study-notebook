import type { HTMLAttributes, ReactNode } from 'react'
import type { NotebookColor } from '@shared/types'
import { notebookStyle } from '../../lib/format'
import './Badge.css'

export type BadgeTone = 'neutral' | 'info' | 'good' | 'bad' | 'warn' | 'ink' | 'highlight'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color family. Ignored when `notebookColor` is set. Default neutral. */
  tone?: BadgeTone
  /** Use a notebook's tint and ink instead of a tone (subject chips). */
  notebookColor?: NotebookColor
  /** tag: 6px corners (default for Badge). pill: fully rounded (default for Pill). */
  shape?: 'tag' | 'pill'
  size?: 'sm' | 'md'
  icon?: ReactNode
  children: ReactNode
}

/**
 * Small status label. `<Badge tone="good">Got it</Badge>`,
 * `<Badge notebookColor="blue">CS 201</Badge>`.
 */
export function Badge({
  tone = 'neutral',
  notebookColor,
  shape = 'tag',
  size = 'sm',
  icon,
  className,
  style,
  children,
  ...rest
}: BadgeProps) {
  const toneClass = notebookColor ? 'badge--notebook' : `badge--${tone}`
  return (
    <span
      {...rest}
      className={['badge', toneClass, `badge--${shape}`, `badge--${size}`, className].filter(Boolean).join(' ')}
      style={notebookColor ? { ...notebookStyle(notebookColor), ...style } : style}
    >
      {icon}
      {children}
    </span>
  )
}

/** A Badge with fully rounded ends: `<Pill tone="info">CS 201 · Hashing</Pill>`. */
export function Pill(props: Omit<BadgeProps, 'shape'>) {
  return <Badge {...props} shape="pill" />
}
