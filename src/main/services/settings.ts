// Settings service helpers. OWNER: backend agent.

import type { AiConfig } from '../ai'
import type { AppContext } from '../context'

/** Current AI configuration: stored (decrypted) API key or ANTHROPIC_API_KEY, chosen model, demo flag. */
export function getAiConfig(ctx: AppContext): AiConfig {
  void ctx
  throw new Error('TODO')
}

/** Applies the stored theme preference to the native window chrome at startup. */
export function getThemePreference(ctx: AppContext): 'system' | 'light' | 'dark' {
  void ctx
  throw new Error('TODO')
}
