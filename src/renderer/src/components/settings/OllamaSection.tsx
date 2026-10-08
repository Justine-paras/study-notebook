import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleDashed, ExternalLink, Info, PlugZap, RefreshCw, TriangleAlert } from 'lucide-react'
import { DEFAULT_OLLAMA_URL, type OllamaContextSize, type Settings } from '@shared/types'
import { ErrorNotice } from '../ErrorNotice'
import { Button, Callout, Select, TextField, useToast } from '../ui'
import { toApiError } from '../../lib/api'
import { queryKeys, useApiMutation, useOllamaModels } from '../../lib/queries'
import {
  OLLAMA_CONTEXT_OPTIONS,
  OLLAMA_PULL_COMMAND,
  OLLAMA_PULL_COMMAND_SMALL,
  OLLAMA_STATUS_TEXT,
  ollamaModelOptions,
  ollamaStatus,
  parseContextSize,
  type OllamaStatus
} from './settingsModel'
import { useSaveSetting } from './useSaveSetting'
import './OllamaSection.css'

const DOWNLOAD_URL = 'https://ollama.com/download'

/**
 * Settings for Ollama, a model server on the learner's own computer: where
 * it listens, which installed model writes, how much of the files it reads
 * at once, a connection test, and step-by-step help while Ollama isn't
 * running or has no models. In demo mode Ollama isn't used, so it isn't
 * looked for.
 */
export function OllamaSection({ settings }: { settings: Settings }) {
  const save = useSaveSetting()
  const demo = settings.demoAi
  const models = useOllamaModels(demo ? undefined : settings.ollamaUrl)
  const [model, setModel] = useState(settings.ollamaModel)
  const [contextTokens, setContextTokens] = useState<OllamaContextSize>(settings.ollamaContextTokens)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => setModel(settings.ollamaModel), [settings.ollamaModel])
  useEffect(() => setContextTokens(settings.ollamaContextTokens), [settings.ollamaContextTokens])

  // testApiKey checks whichever provider is chosen. It changes nothing, but
  // it may find Ollama running now, so the model list is asked again too.
  const test = useApiMutation('testApiKey', {
    invalidate: [queryKeys.ollamaModels(settings.ollamaUrl)],
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result)
  })

  const list = models.data
  // A failed call (not just a closed Ollama, which is ok: false) still means no models can be listed.
  const status: OllamaStatus = models.error && !list ? 'unreachable' : ollamaStatus(list, model, demo)
  const options = ollamaModelOptions(list?.models ?? [], model, list?.ok ?? false)

  async function changeModel(next: string) {
    if (!next || next === model) return
    const previous = model
    setModel(next)
    setTestResult(null)
    if (!(await save({ ollamaModel: next }, 'Ollama model'))) setModel(previous)
  }

  async function changeContext(raw: string) {
    const next = parseContextSize(raw)
    if (next === null || next === contextTokens) return
    const previous = contextTokens
    setContextTokens(next)
    if (!(await save({ ollamaContextTokens: next }, 'Context size'))) setContextTokens(previous)
  }

  return (
    <div className="ollama">
      <div className={`ollama__status ollama__status--${statusTone(status)}`} role="status">
        {statusIcon(status)}
        <span>{OLLAMA_STATUS_TEXT[status]}</span>
      </div>

      <p className="ollama__about">
        Ollama runs an AI model on this computer instead of Claude. It is free and private: your files never leave this
        computer. Local models are slower than Claude, and their lessons and questions are less accurate, so check anything
        that looks wrong against your files. A computer with 16 GB of memory is recommended.{' '}
        <ExternalAnchor href={DOWNLOAD_URL} className="ollama__link">
          Get Ollama at ollama.com
        </ExternalAnchor>
      </p>

      <AddressField saved={settings.ollamaUrl} onSaved={() => setTestResult(null)} />

      <div className="ollama__row">
        <Select
          className="ollama__grow"
          label="Model"
          hint="Bigger models write better lessons but are slower. Models you download with Ollama appear here."
          value={model ?? ''}
          options={options}
          placeholder={
            model !== null
              ? undefined
              : demo
                ? 'Not needed in demo mode'
                : models.isPending
                  ? 'Looking for models…'
                  : options.length
                    ? 'Choose a model'
                    : 'No models found'
          }
          disabled={demo || models.isPending || options.length === 0}
          error={
            status === 'missing' && model ? (
              <>
                {model} isn't installed in Ollama any more. Choose another model, or download it again with{' '}
                <code>ollama pull {model}</code>.
              </>
            ) : undefined
          }
          onChange={(event) => void changeModel(event.target.value)}
        />
        {!demo && (
          <Button
            variant="subtle"
            className="ollama__beside-field"
            icon={<RefreshCw size={16} aria-hidden="true" />}
            loading={models.isFetching}
            onClick={() => void models.refetch()}
          >
            Refresh
          </Button>
        )}
      </div>

      <ErrorNotice error={models.error} compact title="Couldn't list your Ollama models" onRetry={() => void models.refetch()} />
      {list && !list.ok && (
        <Callout tone="warn" title="How to get Ollama running">
          <p>{list.message}</p>
          <SetupSteps install />
        </Callout>
      )}
      {list?.ok && list.models.length === 0 && (
        <Callout tone="warn" title="Download a model">
          <SetupSteps install={false} />
        </Callout>
      )}

      <Select
        label="Context size"
        hint="How much of your files the model reads at once. Bigger reads more of your files but needs more memory and is slower."
        value={String(contextTokens)}
        options={OLLAMA_CONTEXT_OPTIONS}
        onChange={(event) => void changeContext(event.target.value)}
      />

      <div className="ollama__actions">
        <Button
          variant="secondary"
          size="sm"
          icon={<PlugZap size={16} aria-hidden="true" />}
          loading={test.isPending}
          onClick={() => test.mutate([])}
        >
          Test connection
        </Button>
      </div>
      <div aria-live="polite">
        {testResult && (
          <Callout tone={testResult.ok ? 'good' : 'bad'} title={testResult.ok ? 'Connected' : "Couldn't connect"}>
            {testResult.message}
          </Callout>
        )}
      </div>
      <ErrorNotice error={test.error} compact title="Couldn't test the connection" onRetry={() => test.mutate([])} />
    </div>
  )
}

function statusTone(status: OllamaStatus): 'ready' | 'checking' | 'problem' {
  if (status === 'ready') return 'ready'
  return status === 'checking' || status === 'demo' ? 'checking' : 'problem'
}

function statusIcon(status: OllamaStatus): ReactNode {
  if (status === 'ready') return <CircleCheck size={18} aria-hidden="true" />
  if (status === 'demo') return <Info size={18} aria-hidden="true" />
  if (status === 'checking') return <CircleDashed size={18} aria-hidden="true" />
  return <TriangleAlert size={18} aria-hidden="true" />
}

/** A web link; the main process opens it in the learner's browser. */
function ExternalAnchor({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  )
}

/** What to do when Ollama isn't running (install, open, download a model) or has no models yet. */
function SetupSteps({ install }: { install: boolean }) {
  return (
    <ol className="ollama__steps">
      {install && (
        <>
          <li>
            Install Ollama for Windows from{' '}
            <ExternalAnchor href={DOWNLOAD_URL} className="ollama__link">
              ollama.com
            </ExternalAnchor>
            .
          </li>
          <li>Open Ollama from the Start menu. It keeps running in the background, with its icon near the clock.</li>
        </>
      )}
      <li>
        Open PowerShell from the Start menu and run <code>{OLLAMA_PULL_COMMAND}</code> to download a model (about 5 GB). On a
        laptop with 8 GB of memory, run <code>{OLLAMA_PULL_COMMAND_SMALL}</code> instead (about 2.5 GB).
      </li>
      <li>When the download finishes, come back here and press Refresh.</li>
    </ol>
  )
}

/**
 * The Ollama address, saved when the learner leaves the field or presses
 * Enter. The main process checks and tidies it ("localhost:11434" becomes
 * "http://localhost:11434"); what it rejects is shown under the field.
 */
function AddressField({ saved, onSaved }: { saved: string; onSaved: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  // Only the newest save may report back: a blur save can still be running when "Use the default address" starts another.
  const latest = useRef(0)
  const { mutateAsync } = useApiMutation('updateSettings')

  // Follow outside changes (a refetch, the default button) unless the learner is typing here.
  useEffect(() => {
    if (!focused.current) {
      setDraft(saved)
      setError(null)
    }
  }, [saved])

  async function commit(value: string) {
    const next = value.trim()
    const id = ++latest.current
    if (next === saved) {
      setError(null)
      return
    }
    try {
      const result = await mutateAsync([{ ollamaUrl: next }])
      if (id !== latest.current) return
      queryClient.setQueryData<Settings>(queryKeys.settings(), result)
      setDraft(result.ollamaUrl)
      setError(null)
      toast.success('Ollama address saved')
      onSaved()
    } catch (err) {
      if (id === latest.current) setError(toApiError(err).friendly)
    }
  }

  function restoreDefault() {
    setDraft(DEFAULT_OLLAMA_URL)
    void commit(DEFAULT_OLLAMA_URL)
  }

  const showDefault = saved !== DEFAULT_OLLAMA_URL || draft.trim() !== DEFAULT_OLLAMA_URL

  return (
    <div className="ollama__row">
      <TextField
        className="ollama__grow"
        label="Ollama address"
        hint={`Where Ollama listens. The usual address is ${DEFAULT_OLLAMA_URL}. Saved when you press Enter or leave the field.`}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        error={error ?? undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError(null)
        }}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={(event) => {
          focused.current = false
          void commit(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          void commit(event.currentTarget.value)
        }}
      />
      {showDefault && (
        <Button variant="ghost" className="ollama__beside-field" onClick={restoreDefault}>
          Use the usual address
        </Button>
      )}
    </div>
  )
}
