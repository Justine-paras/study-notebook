import { useEffect } from 'react'

const APP_NAME = 'Study Notebook'

/** Sets the window title to "<title> · Study Notebook" while the screen is shown. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
    return () => {
      document.title = APP_NAME
    }
  }, [title])
}
