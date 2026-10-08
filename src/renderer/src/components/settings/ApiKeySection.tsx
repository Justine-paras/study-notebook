import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, ExternalLink, KeyRound, PlugZap, Trash2 } from 'lucide-react'
import type { Settings } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Callout, TextField, useConfirm, useToast } from '../ui'
import { queryKeys, useApiMutation } from '../../lib/queries'
import { API_KEY_STATUS_TEXT, apiKeyInputError, apiKeyStatus } from './settingsModel'
import './ApiKeySection.css'

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys'

/**
 * Add, test, replace or remove the Anthropic API key. The stored key never
 * comes back to the renderer: the field only ever holds what is being typed.
 */
export function ApiKeySection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [key, setKey] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const storeSettings = (saved: Settings) => queryClient.setQueryData<Settings>(queryKeys.settings(), saved)

  const save = useApiMutation('setApiKey', {
    onSuccess: (saved) => {
      storeSettings(saved)
      setKey('')
      setTestResult(null)
      toast.success('Your key is stored encrypted on this computer.', 'API key saved')
    }
  })
  const clear = useApiMutation('clearApiKey', {
    onSuccess: (saved) => {
      storeSettings(saved)
      setTestResult(null)
      toast.success(
        saved.hasApiKey
          ? 'The saved key is gone. ANTHROPIC_API_KEY is still set on this computer, so AI features keep working.'
          : 'AI features will ask for a key again.',
        'API key removed'
      )
    }
  })
  // A test makes no change, so nothing needs refetching.
  const test = useApiMutation('testApiKey', {
    invalidate: 'none',
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result)
  })

  const status = apiKeyStatus(settings)
  const busy = save.isPending || clear.isPending

  function submit() {
    const error = apiKeyInputError(key)
    setInputError(error)
    if (error || busy) return
    save.mutate([key.trim()])
  }

  async function remove() {
    const ok = await confirm({
      title: 'Remove your API key?',
      message: 'Lessons, quizzes and feedback will stop working until you add a key again. Everything you made so far stays.',
      confirmLabel: 'Remove key',
      tone: 'danger'
    })
    if (ok) clear.mutate([])
  }

  return (
    <div className="api-key">
      <div className={`api-key__status api-key__status--${status}`}>
        {status === 'saved' ? (
          <CircleCheck size={18} aria-hidden="true" />
        ) : (
          <KeyRound size={18} aria-hidden="true" />
        )}
        <span>
          <span className="sr-only">API key: </span>
          {API_KEY_STATUS_TEXT[status]}
        </span>
      </div>

      <p className="api-key__about">
        Lessons, quizzes and feedback are written by Claude through your own Anthropic account. The key is stored
        encrypted on this computer and is only ever sent to Anthropic. Each AI action costs a little, usually a few
        cents, billed to that account.{' '}
        <a href={CONSOLE_URL} target="_blank" rel="noreferrer" className="api-key__link">
          Get a key at console.anthropic.com
          <ExternalLink size={14} aria-hidden="true" />
          <span className="sr-only"> (opens in your browser)</span>
        </a>
      </p>

      <form
        className="api-key__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField
          className="api-key__field"
          label={settings.hasApiKey ? 'Replace your key' : 'API key'}
          type="password"
          placeholder={settings.hasApiKey ? 'Paste a new key to replace the saved one' : 'sk-ant-…'}
          autoComplete="off"
          spellCheck={false}
          value={key}
          error={inputError ?? undefined}
          onChange={(event) => {
            setKey(event.target.value)
            if (inputError) setInputError(null)
          }}
        />
        <Button type="submit" loading={save.isPending} disabled={clear.isPending} className="api-key__save">
          Save key
        </Button>
      </form>

      <div className="api-key__actions">
        <Button
          variant="secondary"
          size="sm"
          icon={<PlugZap size={16} aria-hidden="true" />}
          loading={test.isPending}
          disabled={busy || status === 'missing'}
          onClick={() => test.mutate([])}
        >
          Test connection
        </Button>
        {settings.hasApiKey && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} aria-hidden="true" />}
            loading={clear.isPending}
            disabled={save.isPending}
            onClick={() => void remove()}
          >
            Remove key
          </Button>
        )}
      </div>

      <div aria-live="polite">
        {testResult && (
          <Callout tone={testResult.ok ? 'good' : 'bad'} title={testResult.ok ? 'Connected' : "Couldn't connect"}>
            {testResult.message}
          </Callout>
        )}
      </div>
      <ErrorNotice error={save.error} compact title="Couldn't save the key" />
      <ErrorNotice error={clear.error} compact title="Couldn't remove the key" />
      <ErrorNotice error={test.error} compact title="Couldn't test the connection" onRetry={() => test.mutate([])} />
    </div>
  )
}
