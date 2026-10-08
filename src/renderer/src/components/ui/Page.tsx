import type { HTMLAttributes, ReactNode } from 'react'
import './Page.css'

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** default 1240px (Today, Insights), wide 1280px (Notebook, Topic), narrow 820px (Session, Review, Quiz). */
  width?: 'default' | 'wide' | 'narrow'
}

/**
 * The centered content column of a screen. App.tsx already renders <main>, so
 * screens start with <Page>:
 *   <Page><PageHeader title="Insights" description="..." />...</Page>
 */
export function Page({ width = 'default', className, ...rest }: PageProps) {
  return <div {...rest} className={['page', width !== 'default' && `page--${width}`, className].filter(Boolean).join(' ')} />
}

export interface PageHeaderProps {
  /** Handwritten line above the title (Today's date). */
  kicker?: ReactNode
  /** The page's h1 (serif). */
  title: ReactNode
  description?: ReactNode
  /** Buttons on the right. */
  actions?: ReactNode
  /** Something above the kicker, e.g. a <BackLink>. */
  before?: ReactNode
  /** xl 50px (Today), lg 44px (default). */
  size?: 'lg' | 'xl'
}

/** `<PageHeader kicker={formatDate(now, 'full')} title={greeting(now)} description="Your plan is built from..." size="xl" />` */
export function PageHeader({ kicker, title, description, actions, before, size = 'lg' }: PageHeaderProps) {
  return (
    <header className="page-header">
      {before}
      <div className="page-header__row">
        <div className="page-header__text">
          {kicker !== undefined && <div className="hand hand--lg">{kicker}</div>}
          <h1 className={`page-header__title page-header__title--${size}`}>{title}</h1>
          {description !== undefined && <p className="page-header__description">{description}</p>}
        </div>
        {actions !== undefined && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  )
}
