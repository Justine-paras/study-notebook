import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Home, RotateCcw } from 'lucide-react'
import { TopBar } from './components/TopBar'
import { ErrorNotice } from './components/ErrorNotice'
import { Button, ConfirmProvider, EmptyState, ErrorBoundary, Page, ToastProvider } from './components/ui'
import { createQueryClient } from './lib/queries'
import { PomodoroProvider } from './lib/pomodoro'
import { ThemeProvider } from './lib/theme'
import TodayScreen from './screens/Today'
import NotebooksScreen from './screens/Notebooks'
import InsightsScreen from './screens/Insights'
import SettingsScreen from './screens/Settings'
import NotebookScreen from './screens/Notebook'
import TopicScreen from './screens/Topic'
import SessionScreen from './screens/Session'
import ReviewScreen from './screens/Review'
import QuizScreen from './screens/Quiz'
import './App.css'

function NotFound() {
  return (
    <Page>
      <EmptyState
        kicker="this page is blank"
        title="Nothing here"
        action={
          <Button to="/" icon={<Home size={16} aria-hidden="true" />}>
            Back to Today
          </Button>
        }
      >
        The page you were looking for doesn't exist. It may have been deleted.
      </EmptyState>
    </Page>
  )
}

function ScreenCrashed({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <Page width="narrow">
      <EmptyState
        kicker="oops, a smudge"
        title="This page ran into a problem"
        action={
          <>
            <Button icon={<RotateCcw size={16} aria-hidden="true" />} onClick={reset}>
              Try again
            </Button>
            <Button to="/" variant="subtle" icon={<Home size={16} aria-hidden="true" />} onClick={reset}>
              Back to Today
            </Button>
          </>
        }
      >
        Your notes and progress are safe. Try again, or go back to Today.
      </EmptyState>
      <ErrorNotice error={error} title="What went wrong" compact />
    </Page>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TodayScreen />} />
      <Route path="/notebooks" element={<NotebooksScreen />} />
      <Route path="/notebooks/:notebookId" element={<NotebookScreen />} />
      <Route path="/insights" element={<InsightsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/topics/:topicId" element={<TopicScreen />} />
      <Route path="/session" element={<SessionScreen />} />
      <Route path="/review" element={<ReviewScreen />} />
      <Route path="/quiz/:quizId" element={<QuizScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function Layout() {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  // Each screen starts at the top (only the main area scrolls, so the browser won't do it).
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="app paper">
      <a className="skip-link" href="#main" onClick={(event) => {
        // HashRouter owns the URL hash, so move focus instead of following the link.
        event.preventDefault()
        mainRef.current?.focus()
      }}>
        Skip to content
      </a>
      <TopBar />
      <main id="main" ref={mainRef} className="app__main" tabIndex={-1}>
        <ErrorBoundary resetKeys={[location.pathname]} fallback={(props) => <ScreenCrashed {...props} />}>
          <AppRoutes />
        </ErrorBoundary>
      </main>
    </div>
  )
}

/** Providers that every screen relies on, outermost first. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <PomodoroProvider>{children}</PomodoroProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}

export default function App() {
  return (
    <AppProviders>
      <Layout />
    </AppProviders>
  )
}
