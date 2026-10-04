import './Spinner.css'

export interface SpinnerProps {
  /** Pixel size. Default 18. */
  size?: number
  /** Screen-reader text. Pass null when the surrounding text already says it is loading. */
  label?: string | null
  className?: string
}

/** A small turning ring. `<Spinner label="Loading topics" />` */
export function Spinner({ size = 18, label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      className={['spinner', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
    >
      <span className="spinner__ring" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

/** Centered spinner with text for loading a whole panel or page. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <Spinner size={22} label={null} />
      <span>{label}</span>
    </div>
  )
}
