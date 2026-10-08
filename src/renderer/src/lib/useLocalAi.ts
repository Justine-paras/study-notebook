import { useSettings } from './queries'

/**
 * True when lessons and questions are written by Ollama on this computer
 * (and not by the offline demo). Local models are several times slower than
 * Claude, so waiting times are described differently.
 */
export function useLocalAi(): boolean {
  const settings = useSettings().data
  return settings !== undefined && settings.aiProvider === 'ollama' && !settings.demoAi
}
