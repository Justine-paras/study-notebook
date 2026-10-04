import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { Spinner } from './Spinner'
import './IconButton.css'

export type IconButtonVariant = 'ghost' | 'subtle' | 'primary'

interface CommonProps {
  /** Required accessible name (also shown as the native tooltip). */
  label: string
  /** The icon, e.g. <Settings size={18} />. */
  children: ReactNode
  /** ghost (default): no border. subtle: light border. primary: ink fill. */
  variant?: IconButtonVariant
  /** sm 40px, md 44px (default). */
  size?: 'sm' | 'md'
  loading?: boolean
  className?: string
}

export type IconButtonProps =
  | (CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps | 'aria-label'> & { to?: undefined })
  | (CommonProps & Omit<LinkProps, keyof CommonProps | 'aria-label'> & { to: LinkProps['to'] })

/**
 * A square button with only an icon. The label is required so screen readers
 * can name it: `<IconButton label="Reset timer" onClick={reset}><RotateCcw size={16} /></IconButton>`
 */
export function IconButton(props: IconButtonProps) {
  const { label, children, variant = 'ghost', size = 'md', loading = false, className, ...rest } = props
  const classes = ['icon-button', `icon-button--${variant}`, `icon-button--${size}`, className].filter(Boolean).join(' ')
  const content = loading ? <Spinner size={16} label={null} /> : children

  if (rest.to !== undefined) {
    return (
      <Link {...(rest as LinkProps)} className={classes} aria-label={label} title={label}>
        {content}
      </Link>
    )
  }
  const { type = 'button', onClick, ...buttonProps } = rest as ButtonHTMLAttributes<HTMLButtonElement>
  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
    >
      {content}
    </button>
  )
}
