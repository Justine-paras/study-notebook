import { Link, useLocation } from 'react-router'
import { Flame, Pause, Play, RotateCcw, Settings, SkipForward } from 'lucide-react'
import { formatClock, formatMinutes } from '../lib/format'
import { usePomodoro } from '../lib/pomodoro'
import { useToday } from '../lib/queries'
import { IconButton } from './ui/IconButton'
import './TopBar.css'

type NavKey = 'today' | 'notebooks' | 'insights'

const NAV_ITEMS: { key: NavKey; to: string; label: string }[] = [
  { key: 'today', to: '/', label: 'Today' },
  { key: 'notebooks', to: '/notebooks', label: 'Notebooks' },
  { key: 'insights', to: '/insights', label: 'Insights' }
]

/** Which nav item a route belongs to: study flows started from Today stay under Today. */
export function navSection(pathname: string): NavKey | null {
  if (pathname === '/' || pathname.startsWith('/session') || pathname.startsWith('/review')) return 'today'
  if (pathname.startsWith('/notebooks') || pathname.startsWith('/topics') || pathname.startsWith('/quiz')) return 'notebooks'
  if (pathname.startsWith('/insights')) return 'insights'
  return null
}

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="3.5" width="17" height="21" rx="2.5" />
      <path d="M6 3.5v21" />
      <path d="M3.5 8h4M3.5 14h4M3.5 20h4" />
      <path d="M11 9h8M11 13h6" />
    </svg>
  )
}

function Streak() {
  const today = useToday()
  if (!today.data) return null
  const days = today.data.streakDays
  return (
    <div className="topbar__streak">
      <Flame size={18} className="topbar__streak-icon" aria-hidden="true" />
      {days > 0 ? (
        <span>
          <strong>{days}-day</strong> streak
        </span>
      ) : (
        <span>Start a streak today</span>
      )}
    </div>
  )
}

function PomodoroWidget() {
  const pomo = usePomodoro()
  const clock = formatClock(pomo.remainingSeconds)
  const minutesLeft = formatMinutes(Math.ceil(pomo.remainingSeconds / 60))
  const statusText = pomo.status === 'running' ? 'running' : pomo.status === 'paused' ? 'paused' : 'ready'
  return (
    <div className={`pomodoro pomodoro--${pomo.phase}`} role="group" aria-label="Pomodoro timer">
      <div className="pomodoro__readout" role="timer" aria-label={`${pomo.label} timer, ${minutesLeft} left, ${statusText}`}>
        <span className="pomodoro__label" aria-hidden="true">
          {pomo.label}
          {pomo.status === 'paused' && ' · paused'}
        </span>
        <span className="pomodoro__time tabular" aria-hidden="true">
          {clock}
        </span>
      </div>
      <div className="pomodoro__bar" aria-hidden="true">
        <div className="pomodoro__bar-fill" style={{ width: `${Math.round(pomo.progress * 100)}%` }} />
      </div>
      <IconButton
        label={pomo.isRunning ? `Pause ${pomo.label.toLowerCase()} timer` : `Start ${pomo.label.toLowerCase()} timer`}
        variant="primary"
        onClick={pomo.toggle}
      >
        {pomo.isRunning ? <Pause size={16} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
      </IconButton>
      {pomo.phase === 'break' ? (
        <IconButton label="Skip break" variant="subtle" onClick={pomo.skip}>
          <SkipForward size={16} aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton label="Reset timer" variant="subtle" onClick={pomo.reset} disabled={pomo.status === 'idle'}>
          <RotateCcw size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  )
}

/** The bar on every screen: brand, main nav, streak, Pomodoro and Settings. */
export function TopBar() {
  const { pathname } = useLocation()
  const section = navSection(pathname)
  return (
    <header className="topbar">
      <Link to="/" className="topbar__brand" aria-label="Study Notebook, go to Today">
        <BrandMark />
        <span className="topbar__brand-name">Study Notebook</span>
      </Link>
      <nav aria-label="Main" className="segmented topbar__nav">
        {NAV_ITEMS.map((item) => (
          // Plain links: NavLink's own matching would not mark /topics under Notebooks.
          <Link
            key={item.key}
            to={item.to}
            className="segmented__option"
            aria-current={section === item.key ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="topbar__spacer" />
      <Streak />
      <PomodoroWidget />
      <IconButton
        to="/settings"
        label="Settings"
        variant="subtle"
        aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
      >
        <Settings size={18} aria-hidden="true" />
      </IconButton>
    </header>
  )
}
