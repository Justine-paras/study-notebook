import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Settings, SettingsUpdate } from '@shared/types'
import { useToast } from '../ui'
import { queryKeys, useApiMutation } from '../../lib/queries'

/**
 * Saves one settings field and confirms it with a toast ("Focus length saved").
 * Resolves true on success; on failure shows the friendly error and resolves
 * false so the caller can put the old value back.
 *
 * mutateAsync (not mutate with per-call callbacks) because react-query only
 * runs per-call callbacks for the latest call, and two fields can save at once.
 */
export function useSaveSetting(): (patch: SettingsUpdate, noun: string) => Promise<boolean> {
  const queryClient = useQueryClient()
  const toast = useToast()
  const mutation = useApiMutation('updateSettings')
  const { mutateAsync } = mutation

  return useCallback(
    async (patch: SettingsUpdate, noun: string) => {
      try {
        const saved = await mutateAsync([patch])
        queryClient.setQueryData<Settings>(queryKeys.settings(), saved)
        toast.success(`${noun} saved`)
        return true
      } catch (err) {
        toast.error(err, `Couldn't save ${noun.toLowerCase()}`)
        return false
      }
    },
    [mutateAsync, queryClient, toast]
  )
}
