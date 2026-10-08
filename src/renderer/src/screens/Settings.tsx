import { useEffect, useState, type ReactNode } from 'react'
import { Download, FolderOpen, Info } from 'lucide-react'
import { AI_MODELS, type AiModelId, type Settings, type ThemePref } from '@shared/types'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button, Callout, LoadingBlock, Page, PageHeader, Panel, Segmented, Select, useToast } from '../components/ui'
import { ApiKeySection } from '../components/settings/ApiKeySection'
import { NumberSetting } from '../components/settings/NumberSetting'
import { RetentionSetting } from '../components/settings/RetentionSetting'
import { NUMBER_SETTINGS } from '../components/settings/settingsModel'
import { useSaveSetting } from '../components/settings/useSaveSetting'
import { useApiMutation, useSettings } from '../lib/queries'
import { useTheme } from '../lib/theme'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Settings.css'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Match Windows' },
  { value: 'light', label: 'Light paper' },
  { value: 'dark', label: 'Dark paper' }
]

const MODEL_OPTIONS = AI_MODELS.map((m) => ({ value: m.id, label: m.label }))

export default function SettingsScreen() {
  useDocumentTitle('Settings')
  const settings = useSettings()
  const header = <PageHeader title="Settings" description="Changes save as you make them." />

  if (settings.isPending) {
    return (
      <Page width="narrow">
        {header}
        <LoadingBlock label="Loading settings…" />
      </Page>
    )
  }

  if (settings.error) {
    return (
      <Page width="narrow">
        {header}
        <ErrorNotice error={settings.error} title="Couldn't load your settings" onRetry={() => void settings.refetch()} />
      </Page>
    )
  }

  return (
    <Page width="narrow" className="settings">
      {header}
      <SettingsForm settings={settings.data} />
    </Page>
  )
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Panel title={title} titleStyle="serif" className="settings__section">
      {description !== undefined && <p className="settings__description">{description}</p>}
      {children}
    </Panel>
  )
}

function SettingsForm({ settings }: { settings: Settings }) {
  const toast = useToast()
  const save = useSaveSetting()
  const { preference, setPreference } = useTheme()
  const [model, setModel] = useState<AiModelId>(settings.model)

  useEffect(() => setModel(settings.model), [settings.model])

  const openFolder = useApiMutation('openDataFolder', {
    invalidate: 'none',
    onError: (err) => toast.error(err, "Couldn't open the data folder")
  })
  const backup = useApiMutation('exportBackup', {
    invalidate: 'none',
    onSuccess: (result) => {
      // null means the save dialog was cancelled: nothing to report.
      if (result) toast.success(`Saved to ${result.path}`, 'Backup saved')
    },
    onError: (err) => toast.error(err, "Couldn't save the backup")
  })

  async function changeModel(next: AiModelId) {
    const previous = model
    setModel(next)
    if (!(await save({ model: next }, 'AI model'))) setModel(previous)
  }

  async function changeTheme(next: ThemePref) {
    try {
      await setPreference(next)
      toast.success('Theme saved')
    } catch (err) {
      toast.error(err, "Couldn't save the theme")
    }
  }

  const saveNumber = (key: keyof typeof NUMBER_SETTINGS) => (value: number) =>
    save({ [key]: value }, NUMBER_SETTINGS[key].noun)

  return (
    <div className="settings__sections">
      <Section title="AI tutor">
        {settings.demoAi && (
          <Callout tone="info" icon={<Info size={18} aria-hidden="true" />} title="Demo mode is on">
            The app is running with offline demo content, so no key is needed and nothing is sent anywhere. Lessons and
            quizzes are simple stand-ins built from your files. Restart without demo mode to use Claude.
          </Callout>
        )}
        <ApiKeySection settings={settings} />
        <Select
          label="Model"
          hint="Opus writes the most thorough lessons. Sonnet and Haiku are quicker and cost less per use."
          value={model}
          options={MODEL_OPTIONS}
          onChange={(event) => void changeModel(event.target.value as AiModelId)}
        />
      </Section>

      <Section title="Appearance">
        <div className="settings__control">
          <span className="settings__label" aria-hidden="true">
            Theme
          </span>
          <Segmented label="Theme" value={preference} onChange={(next) => void changeTheme(next)} options={THEME_OPTIONS} />
          <span className="settings__hint">Dark paper is easier on the eyes for late-night study.</span>
        </div>
      </Section>

      <Section title="Focus timer" description="The Pomodoro timer in the top bar. Focus time is logged to the notebook you are working in.">
        <div className="settings__grid">
          <NumberSetting spec={NUMBER_SETTINGS.focusMinutes} value={settings.focusMinutes} onSave={saveNumber('focusMinutes')} />
          <NumberSetting spec={NUMBER_SETTINGS.breakMinutes} value={settings.breakMinutes} onSave={saveNumber('breakMinutes')} />
        </div>
      </Section>

      <Section title="Daily plan" description="How much Today asks of you. The plan is rebuilt each time you open it.">
        <div className="settings__grid">
          <NumberSetting
            spec={NUMBER_SETTINGS.newTopicsPerDay}
            value={settings.newTopicsPerDay}
            onSave={saveNumber('newTopicsPerDay')}
          />
          <NumberSetting
            spec={NUMBER_SETTINGS.maxReviewsPerDay}
            value={settings.maxReviewsPerDay}
            onSave={saveNumber('maxReviewsPerDay')}
          />
        </div>
        <RetentionSetting value={settings.desiredRetention} onSave={(value) => save({ desiredRetention: value }, 'Desired retention')} />
      </Section>

      <Section
        title="Your data"
        description="Everything stays on this computer: your files, notes, flashcards and progress. A backup is one file you can copy to a USB drive or a cloud folder."
      >
        <div className="settings__control">
          <span className="settings__label">Data folder</span>
          <code className="settings__path">{settings.dataDir}</code>
        </div>
        <div className="settings__actions">
          <Button
            variant="secondary"
            icon={<Download size={16} aria-hidden="true" />}
            loading={backup.isPending}
            onClick={() => backup.mutate([])}
          >
            Export a backup
          </Button>
          <Button
            variant="subtle"
            icon={<FolderOpen size={16} aria-hidden="true" />}
            loading={openFolder.isPending}
            onClick={() => openFolder.mutate([])}
          >
            Open data folder
          </Button>
        </div>
      </Section>
    </div>
  )
}
