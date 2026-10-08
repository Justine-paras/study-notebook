import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { LinkProps } from 'react-router'
import { Button } from './Button'
import './BackLink.css'

export type BackLinkProps =
  | { to: LinkProps['to']; onClick?: undefined; children: ReactNode; className?: string }
  | { to?: undefined; onClick: () => void; children: ReactNode; className?: string }

/**
 * Quiet "back" link with a chevron, used above page titles:
 *   <BackLink to={`/notebooks/${topic.notebookId}`}>{notebook.name}</BackLink>
 *   <BackLink onClick={endSession}>End session</BackLink>
 */
export function BackLink({ to, onClick, children, className }: BackLinkProps) {
  const icon = <ChevronLeft size={16} aria-hidden="true" />
  const classes = ['back-link', className].filter(Boolean).join(' ')
  if (to !== undefined) {
    return (
      <Button to={to} variant="ghost" size="sm" icon={icon} className={classes}>
        {children}
      </Button>
    )
  }
  return (
    <Button variant="ghost" size="sm" icon={icon} onClick={onClick} className={classes}>
      {children}
    </Button>
  )
}
