import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { Spinner } from './Spinner'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface CommonProps {
  /** primary: ink fill. secondary: ink outline. subtle: paper with a light border. ghost: text only. danger: red fill. */
  variant?: ButtonVariant
  /** sm 40px, md 44px (default), lg 50px tall. */
  size?: ButtonSize
  /** Leading icon (e.g. <Play size={16} />). Replaced by a spinner while loading. */
  icon?: ReactNode
  /** Trailing icon. */
  iconEnd?: ReactNode
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean
  /** Stretch to the container width. */
  block?: boolean
  className?: string
  children?: ReactNode
}

export type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { to?: undefined }

export type ButtonAsLink = CommonProps & Omit<LinkProps, keyof CommonProps> & { to: LinkProps['to']; disabled?: never }

export type ButtonProps = ButtonAsButton | ButtonAsLink

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  className
}: Pick<CommonProps, 'variant' | 'size' | 'block' | 'loading' | 'className'>): string {
  return ['button', `button--${variant}`, `button--${size}`, block && 'button--block', loading && 'button--loading', className]
    .filter(Boolean)
    .join(' ')
}

/**
 * The app's button. Renders a router <Link> when `to` is given:
 *   <Button onClick={save}>Save</Button>
 *   <Button to="/session" icon={<Play size={16} />} size="lg">Start today's session</Button>
 */
export function Button(props: ButtonProps) {
  const { variant, size, icon, iconEnd, loading = false, block, className, children, ...rest } = props
  const classes = buttonClassName({ variant, size, block, loading, className })
  const content = (
    <>
      {loading ? <Spinner size={16} label={null} /> : icon}
      {children !== undefined && children !== null && <span className="button__label">{children}</span>}
      {iconEnd}
    </>
  )

  if (rest.to !== undefined) {
    const linkProps = rest as Omit<ButtonAsLink, keyof CommonProps>
    return (
      <Link {...linkProps} className={classes} aria-busy={loading || undefined}>
        {content}
      </Link>
    )
  }

  const { type = 'button', disabled, onClick, ...buttonProps } = rest as Omit<ButtonAsButton, keyof CommonProps>
  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      // aria-disabled instead of disabled while loading keeps focus on the button.
      aria-disabled={loading || undefined}
      onClick={loading ? undefined : onClick}
    >
      {content}
    </button>
  )
}
