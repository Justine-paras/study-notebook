import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** Renders instead of the children after a render error. */
  fallback: (props: { error: unknown; reset: () => void }) => ReactNode
  /** When any of these change (e.g. the route), the boundary clears its error. */
  resetKeys?: readonly unknown[]
}

interface ErrorBoundaryState {
  error: unknown
  hasError: boolean
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
}

/** Catches render errors in a subtree so one broken screen doesn't blank the app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.hasError && keysChanged(prev.resetKeys, this.props.resetKeys)) this.reset()
  }

  reset = (): void => {
    this.setState({ error: null, hasError: false })
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback({ error: this.state.error, reset: this.reset })
    return this.props.children
  }
}
