// Importing files into a notebook from the Upload button or by dropping them
// anywhere on the Notebook page. Files go through importSources one at a
// time so every file gets its own progress line and result.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ID } from '@shared/types'
import { api, friendlyMessage } from '../../lib/api'
import { queryKeys } from '../../lib/queries'
import { useToast } from '../ui'
import { createImportItems, importProgress, importReducer, type DroppedFile, type ImportItem, type ImportProgress } from './importQueue'

export interface SourceImport {
  items: ImportItem[]
  progress: ImportProgress
  /** Opens the system file picker and imports what the learner picks. */
  pick: () => Promise<void>
  /** Imports files dropped onto the page. */
  addFiles: (files: readonly File[]) => void
  dismiss: (key: string) => void
  clearFinished: () => void
  picking: boolean
}

function pathOf(file: File): string {
  try {
    return window.studyBridge.pathForFile(file)
  } catch {
    // Not a file on disk (or no bridge): reported as "couldn't find this file".
    return ''
  }
}

export function useSourceImport(notebookId: ID): SourceImport {
  const [items, dispatch] = useReducer(importReducer, [])
  const [picking, setPicking] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const queue = useRef<{ key: string; path: string; notebookId: ID }[]>([])
  const running = useRef(false)
  const keyCounter = useRef(0)

  const refresh = useCallback(
    (id: ID) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notebook(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notebooks() })
    },
    [queryClient]
  )

  const drain = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        dispatch({ type: 'start', key: job.key })
        try {
          const result = await api.importSources(job.notebookId, [{ path: job.path }])
          const source = result.sources[0]
          if (source) dispatch({ type: 'done', key: job.key, source })
          else dispatch({ type: 'failed', key: job.key, reason: result.failed[0]?.reason ?? "This file couldn't be added." })
        } catch (err) {
          dispatch({ type: 'failed', key: job.key, reason: friendlyMessage(err) })
        }
        // Refresh after each file so the Sources list fills in as files finish.
        refresh(job.notebookId)
      }
    } finally {
      running.current = false
      // New files can change Today's plan and the shelf too, so refresh everything once the batch is done.
      void queryClient.invalidateQueries()
    }
  }, [refresh, queryClient])

  const addDropped = useCallback(
    (files: readonly DroppedFile[]) => {
      const created = createImportItems(files, itemsRef.current, () => `import-${++keyCounter.current}`)
      if (created.length === 0) return
      dispatch({ type: 'add', items: created })
      // Keep the ref in step so a second drop before the next render still sees these as in flight.
      itemsRef.current = [...itemsRef.current, ...created]
      for (const item of created) {
        if (item.status === 'queued') queue.current.push({ key: item.key, path: item.path, notebookId })
      }
      void drain()
    },
    [drain, notebookId]
  )

  const addFiles = useCallback(
    (files: readonly File[]) => addDropped(files.map((file) => ({ path: pathOf(file), name: file.name }))),
    [addDropped]
  )

  const pick = useCallback(async () => {
    setPicking(true)
    try {
      const paths = await api.pickFiles()
      addDropped(paths.map((path) => ({ path, name: '' })))
    } catch (err) {
      toast.error(err, "Couldn't open the file picker")
    } finally {
      setPicking(false)
    }
  }, [addDropped, toast])

  return {
    items,
    progress: importProgress(items),
    pick,
    addFiles,
    dismiss: useCallback((key: string) => dispatch({ type: 'dismiss', key }), []),
    clearFinished: useCallback(() => dispatch({ type: 'clear-finished' }), []),
    picking
  }
}

function hasFiles(event: DragEvent): boolean {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')
}

/** A dialog is open: dropping should neither import nor reach the page behind it. */
function dialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null
}

/**
 * Accepts files dropped anywhere in the window while the page is mounted
 * (and stops Electron from navigating to a dropped file). Returns true while
 * files are being dragged over the window, to highlight the drop zone.
 */
export function useWindowFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false)
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles

  useEffect(() => {
    // dragenter/dragleave fire for every child element, so count them.
    let depth = 0
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth += 1
      if (!dialogOpen()) setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = dialogOpen() ? 'none' : 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (dialogOpen()) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) onFilesRef.current(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return dragging
}
