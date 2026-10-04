// Theme: the Settings preference (system | light | dark) resolved against the
// OS color scheme and applied as data-theme on <html>. The last preference is
// cached in localStorage so the first paint after a restart is already right.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Settings, ThemePref } from '@shared/types'
import { api } from './api'
import { queryKeys, useSettings } from './queries'

export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'study-notebook:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveTheme(preference: ThemePref, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches === true
}

export function readCachedThemePreference(): ThemePref {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isThemePref(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function cacheThemePreference(preference: ThemePref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable; the theme still applies for this session.
  }
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/** Called by main.tsx before the first render to avoid a light flash in dark mode. */
export function applyInitialTheme(): void {
  applyTheme(resolveTheme(readCachedThemePreference(), systemPrefersDark()))
}

interface ThemeContextValue {
  /** The learner's setting. */
  preference: ThemePref
  /** What is on screen now. */
  resolved: ResolvedTheme
  /** Applies immediately and saves to Settings. Rejects with ApiError when saving fails. */
  setPreference: (preference: ThemePref) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const [cached, setCached] = useState<ThemePref>(readCachedThemePreference)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Settings win once loaded; until then (or if the backend fails) use the cache.
  const preference = settings.data?.theme ?? cached
  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY)
    if (!media) return
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  useEffect(() => {
    cacheThemePreference(preference)
  }, [preference])

  const setPreference = useCallback(
    async (next: ThemePref) => {
      setCached(next)
      const key = queryKeys.settings()
      const previous = queryClient.getQueryData<Settings>(key)
      if (previous) queryClient.setQueryData<Settings>(key, { ...previous, theme: next })
      try {
        const saved = await api.updateSettings({ theme: next })
        queryClient.setQueryData<Settings>(key, saved)
      } catch (err) {
        if (previous) queryClient.setQueryData<Settings>(key, previous)
        setCached(previous?.theme ?? 'system')
        throw err
      }
    },
    [queryClient]
  )

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>')
  return value
}
