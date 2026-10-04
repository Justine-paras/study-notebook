# Renderer foundation

Everything a screen needs: providers, routing, design tokens, data hooks and UI
primitives. Read this before building a screen. The visual reference is
`docs/design/prototype.dc.html`, and the rules are in `docs/ARCHITECTURE.md`.

```
src/renderer/
  index.html                 CSP (no remote scripts, styles, fonts or images)
  src/main.tsx               entry: global CSS, initial theme, <App/>
  src/App.tsx                providers, layout (TopBar + scrolling <main>), routes, 404, error boundary
  src/styles/
    tokens.css               every color/size/font token, light + dark
    base.css                 reset, element defaults, focus ring, scrollbars, reduced motion, .paper, .sr-only
    paper.css                .sheet, .lined, .hand, .mark, .display, .caps-label, layout helpers
    fonts.css                bundled @fontsource fonts + KaTeX CSS
  src/lib/
    api.ts                   typed StudyApi client, ApiError
    queries.ts               react-query keys, read hooks, useApiMutation, createQueryClient
    format.ts                dates, numbers, labels, color helpers (pure, unit-tested)
    theme.tsx                ThemeProvider, useTheme
    pomodoro.tsx             PomodoroProvider, usePomodoro, usePomodoroNotebook (logic in pomodoroCore.ts)
    aiProgress.ts            useAiProgress
    useHotkeys.ts            keyboard shortcuts
    useDocumentTitle.ts      window title per screen
    routes.ts                ROUTES path helpers
  src/components/
    ui/                      primitives (import from './components/ui')
    Markdown.tsx  NotebookCover.tsx  MasteryPill.tsx  AiWorking.tsx  ErrorNotice.tsx  TopBar.tsx
  src/screens/               one default-exported component per route
```

Imports: inside the renderer use relative paths or the `@renderer/*` alias
(`@renderer/components/ui`), and `@shared/*` for contract types.

## Adding a screen

1. Replace the placeholder in `src/screens/<Name>.tsx` (the route in
   `App.tsx` already points at it; don't edit `App.tsx`). Keep it a default
   export.
2. Put screen-specific styles in `src/screens/<Name>.css` and import it from
   the screen. Put sub-components in your `src/components/<area>/` folder.
3. Start with the page column and header:

   ```tsx
   import { useParams } from 'react-router'
   import { Page, PageHeader, LoadingBlock } from '../components/ui'
   import { ErrorNotice } from '../components/ErrorNotice'
   import { useNotebook } from '../lib/queries'
   import { usePomodoroNotebook } from '../lib/pomodoro'
   import { useDocumentTitle } from '../lib/useDocumentTitle'
   import './Notebook.css'

   export default function NotebookScreen() {
     const { notebookId } = useParams()
     const notebook = useNotebook(notebookId)
     usePomodoroNotebook(notebookId)
     useDocumentTitle(notebook.data?.name)
     if (notebook.isPending) return <LoadingBlock label="Opening notebook…" />
     if (notebook.error) return <Page><ErrorNotice error={notebook.error} onRetry={() => notebook.refetch()} /></Page>
     return <Page width="wide">...</Page>
   }
   ```

4. Every loading state shows `LoadingBlock`/`Spinner`, every error shows
   `ErrorNotice`, every AI call shows `AiWorking` while pending, every empty
   list shows `EmptyState`.
5. Route helpers: `ROUTES` in `lib/routes.ts` (`ROUTES.topic(id, 'learn')` ->
   `/topics/<id>?step=learn`, `ROUTES.review(notebookId)`, `ROUTES.session('weak')`).
   Read query strings with `useSearchParams` from `react-router`.

## CSS conventions

- **Tokens only.** No hex/rgb values outside `styles/tokens.css`. Use
  `var(--ink)`, `var(--surface)`, `var(--good-bg)`... Both themes then work for
  free. If a color is missing, ask the foundation owner to add a token.
- **One CSS file per component or screen**, imported by its `.tsx`.
- **BEM-ish class names prefixed by the component or screen**:
  `.today`, `.today__plan`, `.today__plan--empty`; `.topic-step`,
  `.topic-step__dot`. Never style another component's internal classes; pass
  `className` instead. Primitive blocks already taken: `button`, `icon-button`,
  `panel`, `card`, `sheet`, `badge`, `progress`, `segmented`, `chip`, `field`,
  `check`, `switch`, `modal`, `menu`, `empty-state`, `spinner`, `toast`,
  `tooltip`, `kbd`, `callout`, `page`, `page-header`, `stat`, `back-link`,
  `md`, `cover`, `topbar`, `pomodoro`, `mastery-pill`, `mastery-legend`,
  `ai-working`, `error-notice`, `app`.
- Notebook colors: set `style={notebookStyle(color)}` on a wrapper and use
  `var(--notebook)`, `var(--notebook-tint)`, `var(--notebook-ink)` inside.
- Mastery colors: `var(--mastery-<state>-bg|fg|ink)` with state in kebab-case
  (`not-started`), or `masteryColorVars(state)` from `lib/format`.
- Layout must work from 960px to 1920px wide. Use `.split` (main + side rail
  that wraps) and `flex-wrap`; avoid fixed widths.
- Touch targets at least 40px tall (all primitives already are). Real
  `<button>`/`<a>`; icon-only buttons through `IconButton` (label required).
- No gradients (except the paper patterns), no emoji, no left-border cards.
- Animations: short (`var(--dur)`), and anything that moves must be
  acceptable under `prefers-reduced-motion` (base.css shortens them globally).

### Tokens (styles/tokens.css)

| Group | Tokens |
|---|---|
| Surfaces | `--paper` (page), `--paper-dot`, `--surface` (cards), `--surface-2` (segmented, table heads), `--surface-sunken`, `--topbar-bg` |
| Text | `--ink`, `--ink-2`, `--muted`, `--on-ink` (text on ink fills), `--on-status` (text on solid status fills) |
| Lines | `--line`, `--line-2` (inner dividers, empty bar tracks), `--line-strong` (input borders), `--ruled`, `--margin-line` |
| Accents | `--accent-hand` (Caveat notes), `--accent-hand-2` (blue notes), `--highlight` + `--highlight-ink`, `--link`, `--link-hover`, `--focus` |
| Status | `--good`, `--bad`, `--warn`, `--info`, `--neutral` (fills/icons/bars), each with `-bg` (tint) and `-ink` (text on tint); `--caution` |
| Mastery | `--mastery-{not-started,learning,weak,reviewing,mastered}-{bg,fg,ink}` |
| Notebooks | `--nb-<color>` (cover, same in both themes), `--nb-<color>-tint`, `--nb-<color>-ink` for blue, orange, teal, purple, green, pink, slate, gold |
| Covers | `--cover-spine`, `--cover-band`, `--cover-label-bg/-ink/-muted`, `--on-cover`, `--on-cover-track`, `--on-cover-soft` |
| Other color | `--pomo-focus`, `--pomo-break`, `--code-bg/-fg/-header-bg/-muted`, `--inline-code-bg`, `--backdrop`, `--scrollbar-thumb` |
| Shadows | `--shadow-sm`, `--shadow-md` (covers), `--shadow-sheet`, `--shadow-pop` (menus, dialogs, toasts) |
| Type | `--font-body` (DM Sans), `--font-display` (Instrument Serif), `--font-hand` (Caveat), `--font-mono` (JetBrains Mono); `--text-xs..2xl` (12-24px), `--display-sm..xl` (28-50px), `--hand-sm..lg` |
| Space | `--space-1..16` (4px grid: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64) |
| Radii | `--radius-xs..xl` (6, 8, 10, 12, 16), `--radius-pill`, `--radius-sheet` (6/18 bound edge), `--radius-cover` |
| Sizes | `--control-sm/md/lg` (40/44/50px), `--page-max` (1240), `--page-max-wide` (1280), `--page-max-narrow` (820), `--page-gutter` |
| Motion, layers | `--ease`, `--dur-fast`, `--dur`, `--dur-slow`; `--z-topbar`, `--z-menu`, `--z-toast`, `--z-tooltip` |

### Utility classes (styles/paper.css, base.css)

| Class | What |
|---|---|
| `.sheet` (+ `--raised`, `--roomy`, `--compact`) | lined paper with the red margin line; prefer `<Sheet>` |
| `.lined` | ruled background only |
| `.hand` (+ `--sm`, `--lg`, `--blue`, `--tilt-left`, `--tilt-right`) | Caveat accent in `--accent-hand` |
| `.mark` / `<mark>` | highlighter for key terms |
| `.display` (+ `--sm/md/lg/xl`) | Instrument Serif heading |
| `.caps-label` (+ `--xs`) | small uppercase label ("Coming up") |
| `.muted`, `.text-2`, `.text-sm`, `.text-xs`, `.tabular`, `.truncate` | text helpers |
| `.stack`, `.row` (+ `--between`, `--baseline`, `--nowrap`), `.spacer` | flex helpers; set `--gap` to change spacing |
| `.split` > `.split__main` + `.split__side` | main column with a side rail that wraps under it |
| `.paper` | dot-grid page background (on the app shell already) |
| `.sr-only` | visually hidden, read by screen readers |

## Data

### `api` (lib/api.ts)

```ts
import { api, ApiError, isApiError, toApiError, friendlyMessage } from '../lib/api'
const notebooks = await api.listNotebooks()
```

- `api` is a `StudyApi`: every method of `src/shared/api.ts`, same arguments.
- Failures throw `ApiError` with `code` (an `AppErrorCode` or other string),
  `message` (technical), `friendly` (learner text from `ERROR_MESSAGES`),
  `method`, and getters `retryable` and `needsSettings` (missing/invalid key).
- Outside Electron (no `window.studyBridge`) calls throw code `NO_BRIDGE`
  with a clear message. `hasBridge()` tells you up front.
- `toApiError(anything)` and `friendlyMessage(anything)` normalize errors.

Prefer the hooks below over calling `api` directly in components.

### Read hooks (lib/queries.ts)

All return react-query `UseQueryResult<T, ApiError>` and accept an optional
last argument of react-query options (`enabled`, `staleTime`,
`refetchInterval`...). Hooks that take an id are disabled while it is
`undefined`, so you can pass route params straight in.

| Hook | Data |
|---|---|
| `useNotebooks()` | `NotebookSummary[]` |
| `useNotebook(id)` | `NotebookSummary` |
| `useSources(notebookId)` | `Source[]` |
| `useSourceText(sourceId)` | `SourceText` |
| `useTopics(notebookId)` | `TopicWithProgress[]` |
| `useTopic(id)` | `TopicWithProgress` |
| `useLesson(topicId)` | `Lesson \| null` (null = not generated yet) |
| `useQuizzes(notebookId, kind?)` | `Quiz[]` |
| `useQuiz(id)` | `Quiz` |
| `useQuizResult(id, { enabled: !!quiz?.submittedAt })` | `QuizResult` (submitted quizzes only) |
| `useReviewQueue({ limit?, notebookId?, cardIds? })` | `ReviewCard[]` |
| `useCards(notebookId, topicId?)` | `Card[]` |
| `useNotes(notebookId, topicId?)` | `Note[]` |
| `useExams(notebookId?)` | `Exam[]` (all notebooks when omitted) |
| `useToday()` | `TodayOverview` |
| `useInsights()` | `Insights` |
| `useSettings()` | `Settings` |

`queryKeys.<name>(...)` gives the keys (each starts with the method name, e.g.
`['listTopics', notebookId]`) for `setQueryData` or targeted invalidation.

Defaults (`createQueryClient`): `staleTime` 10s, refetch on window focus,
reads retried once unless the error can't fix itself (`NOT_FOUND`,
`NO_API_KEY`, ...), mutations never retried.

**Review queues:** every mutation invalidates the queue, so copy
`useReviewQueue(...).data` into local state when a session starts (or pass
`{ staleTime: Infinity, refetchOnWindowFocus: false }`) instead of rendering
the live query; otherwise the card under the learner's eyes can change after
each grade.

### Writes: `useApiMutation(method, options?)`

Variables are **the method's arguments as a tuple**, exactly as you would pass
them to `api[method]`:

```tsx
const rename = useApiMutation('updateNotebook', { onSuccess: () => toast.success('Renamed') })
rename.mutate([notebook.id, { name }])

const generate = useApiMutation('generateLesson')
const lesson = await generate.mutateAsync([topicId, { regenerate: true }])

const pick = useApiMutation('pickFiles')
pick.mutate([])   // no-argument methods take an empty tuple
```

- Returns `UseMutationResult<Result, ApiError, Args>`: use `isPending`,
  `error`, `data`, `reset()`.
- On success it invalidates **all** queries (fire-and-forget, so `onSuccess`
  and `mutateAsync` resolve right away, e.g. to navigate after a delete).
- `invalidate: 'none'` for high-frequency writes (quiz autosave
  `saveQuizAnswer`), or a list of key prefixes:
  `invalidate: [queryKeys.notes(notebookId)]`.
- All other `useMutation` options (`onSuccess`, `onError`, `onSettled`,
  `onMutate`) work as usual. Errors are not toasted automatically: show
  `<ErrorNotice error={m.error} />` inline or call `toast.error(err)`.

### Theme (lib/theme.tsx)

`useTheme()` -> `{ preference: 'system'|'light'|'dark', resolved: 'light'|'dark', setPreference(pref): Promise<void> }`.
`setPreference` applies instantly and saves via `api.updateSettings`; it
rejects with `ApiError` if saving fails. Changing the theme through
`useApiMutation('updateSettings')` also works (the provider follows Settings).

```tsx
const { preference, setPreference } = useTheme()
<Segmented label="Theme" value={preference} onChange={(t) => void setPreference(t)} options={...} />
```

### Pomodoro (lib/pomodoro.tsx)

`usePomodoro()` returns `{ phase: 'focus'|'break', status: 'idle'|'running'|'paused', isRunning, label, remainingMs, remainingSeconds, totalMs, progress (0-1), focusMinutes, breakMinutes, notebookId, currentNotebookId, start, pause, toggle, reset, skip }`.

- Lengths come from Settings (`focusMinutes`, `breakMinutes`).
- A finished focus phase is logged with `api.logFocusSession` and the break
  starts by itself; when the break ends, the next focus waits for a click.
  Every phase end shows a desktop notification (`api.notify`) and a toast.
- `reset()` during focus logs the time so far when it is at least 1 minute.
  `skip()` ends the phase now (also logging partial focus).
- The running state is kept in localStorage, so it survives reloads and
  restarts (phases that ended while closed are logged, not notified).
- Credit time to a notebook: call `usePomodoroNotebook(notebookId)` in any
  page that belongs to one notebook (Notebook, Topic, quiz...). The first
  notebook opened during a focus phase gets the time.
- "Start today's session": `pomodoro.start(); navigate(ROUTES.session())`.
- Plan text: `pluralize(pomodoroCount(plan.totalMinutes, pomo.focusMinutes), 'Pomodoro')`.

### AI progress (lib/aiProgress.ts)

`useAiProgress(task?)` -> latest `AiProgressEvent` (`{ jobId, task, progress: 0-1 | null, message }`) since the component mounted, or `null`. `<AiWorking>` already uses it; you rarely need it directly.

### Keyboard (lib/useHotkeys.ts)

```tsx
useHotkeys(
  { 'space, enter': reveal, '1': () => grade(1), '2': () => grade(2), 'mod+enter': submit },
  { enabled: !revealed }
)
```

Combos: key names (`space`, `enter`, `escape`, `arrowleft`, `a`, `1`, `?`)
with `ctrl+`, `alt+`, `shift+`, `meta+`, `mod+` (Ctrl on Windows). Separate
alternatives with commas. Options: `enabled` (default true), `allowInInputs`
(default false; combos with ctrl/alt/meta/mod always fire, so `mod+enter`
works in a textarea), `allowInModal` (default false: page shortcuts pause
while a dialog is open), `preventDefault` (default true). Handlers can change
every render; the latest is used.

### Window title

`useDocumentTitle('Insights')` -> "Insights · Study Notebook".

### Formatting (lib/format.ts)

| Export | Example |
|---|---|
| `LEARNER_NAME` | `'Justine'` |
| `greeting(date?)` | `'Good afternoon, Justine'` (`timeOfDay(date)` -> `'afternoon'`) |
| `formatDate(d, style?, now?)` | `'full'` Saturday, October 3 · `'medium'` Oct 3 · `'weekday'` Sat · `'weekday-short'` Sat, Oct 3 · `'time'` 3:45 PM · `'datetime'` Oct 3, 3:45 PM (year added when not this year) |
| `formatRelativeDays(d, now?)` | today, tomorrow, yesterday, in 4 days, 5 days ago, in 3 weeks |
| `formatDayCount(n)` | same wording from a number (`UpcomingExam.daysLeft`) |
| `parseDate(d)` | reads `'YYYY-MM-DD'` as **local** midnight (never `new Date('2026-10-12')`) |
| `toLocalDateKey(d?)`, `daysBetween(a, b)`, `addDays(d, n)` | local calendar math |
| `formatMinutes(80)` | `'1 h 20 min'` |
| `formatClock(seconds)` | `'25:00'`, `'1:02:03'` |
| `formatPercent(v, fallback?)` | `'68%'`, `'–'` for null |
| `pluralize(n, 'card', plural?)` | `'1 card'`, `'3 cards'`, `pluralize(2, 'quiz', 'quizzes')` |
| `formatFileSize(bytes)`, `formatList(items)`, `clamp(v, min, max)`, `pomodoroCount(total, focus)` | `'3.4 MB'`, `'A, B and C'` |
| `notebookStyle(color)`, `notebookColorVars(color)`, `NOTEBOOK_COLOR_LABELS`, `isNotebookColor` | notebook color tokens |
| `MASTERY_LABELS`, `MASTERY_LEGEND_ORDER`, `masteryColorVars(state)` | mastery display |
| `CONFIDENCE_LABELS` (Sure/Unsure/Guessing), `CONFIDENCE_ORDER`, `RATING_LABELS` (Again/Hard/Good/Easy), `SOURCE_KIND_LABELS`, `PATH_STEP_LABELS` | shared copy |

## UI primitives (components/ui)

`import { Button, Panel, ... } from '../components/ui'`. Every component
accepts `className`; most pass other native props through.

| Component | Key props | Example |
|---|---|---|
| `Button` | `variant` primary\|secondary\|ghost\|danger\|subtle, `size` sm(40)\|md(44)\|lg(50), `icon`, `iconEnd`, `loading`, `block`, `to` (renders a router Link), native button props | `<Button to="/session" size="lg" icon={<Play size={16} />}>Start today's session</Button>` |
| `IconButton` | **`label`** (required, aria-label + title), `variant` ghost\|subtle\|primary, `size`, `loading`, `to` | `<IconButton label="Reset timer" variant="subtle" onClick={reset}><RotateCcw size={16} /></IconButton>` |
| `BackLink` | `to` or `onClick`, children | `<BackLink to={ROUTES.notebook(id)}>{name}</BackLink>` |
| `Page` | `width` default(1240)\|wide(1280)\|narrow(820) | `<Page width="narrow">...</Page>` |
| `PageHeader` | `title` (h1), `kicker` (Caveat), `description`, `actions`, `before`, `size` lg\|xl | `<PageHeader kicker={formatDate(now, 'full')} title={greeting(now)} size="xl" />` |
| `Panel` | `title`, `titleStyle` caps\|plain\|serif, `meta`, `actions`, `flush`, `as` | `<Panel title="Coming up" titleStyle="caps">...</Panel>` |
| `Card` | `interactive`, `compact` | `<Card compact>Tomorrow · Oct 4</Card>` |
| `Sheet` | `kicker`, `title`, `aside`, `density` default\|roomy\|compact, `raised`, `as` | `<Sheet kicker="teach it back" title={prompt} raised>...</Sheet>` |
| `Badge` / `Pill` | `tone` neutral\|info\|good\|bad\|warn\|ink\|highlight, `notebookColor`, `size`, `icon` | `<Pill notebookColor={c.notebookColor}>{code} · {topic}</Pill>` |
| `ProgressBar` | `value`, **`label`**, `max`, `tone`, `notebookColor`, `color`, `size` sm\|md\|lg, `onCover`, `showValue`, `minVisible`, `valueText` | `<ProgressBar value={ex.readiness} label="Readiness" notebookColor={ex.notebookColor} showValue />` |
| `Segmented` | `options`, `value`, `onChange`, **`label`**, `size`, `block` (radio group, arrow keys) | `<Segmented label="Count" value={c} onChange={setC} options={[{ value: '5', label: '5' }]} />` |
| `ChipToggle`, `ChipGroup` | `pressed`, `onChange`, `size` sm\|md, `icon` / `label` | `<ChipGroup label="Question types"><ChipToggle pressed={on} onChange={setOn}>Identification</ChipToggle></ChipGroup>` |
| `TextField`, `TextArea` | `label`, `hint`, `error`, `hideLabel`, native input props | `<TextField label="Name" value={v} onChange={(e) => setV(e.target.value)} data-autofocus />` |
| `Select` | `label`, `options: {value,label}[]`, `placeholder`, native select props | `<Select label="Kind" value={k} onChange={(e) => setK(e.target.value)} options={kinds} />` |
| `Checkbox` | `label`, `description`, native checkbox props | `<Checkbox label="Mix in earlier topics" checked={m} onChange={(e) => setM(e.target.checked)} />` |
| `Switch` | `label`, `description`, `checked`, `onChange(bool)` | `<Switch label="Focus on my weak spots" checked={w} onChange={setW} />` |
| `Slider` | `label`, `value`, `onChange(number)`, `min`, `max`, `step`, `format`, `hint` | `<Slider label="Desired retention" min={0.8} max={0.97} step={0.01} value={r} onChange={setR} format={(v) => `${Math.round(v * 100)}%`} />` |
| `Field` | render-prop wrapper for custom controls: `{({ id, describedBy, invalid }) => ...}` | `<Field label="Color">{({ id }) => <ColorPicker id={id} />}</Field>` |
| `Modal` | `open`, `onClose`, `title`, `description`, `footer`, `size` sm\|md\|lg, `onSubmit` (wraps in a form), `dismissible`, `closeOnBackdrop`, `initialFocusRef` | `<Modal open={o} onClose={close} title="New notebook" onSubmit={create} footer={<Button type="submit">Create</Button>}>...</Modal>` |
| `useConfirm()` / `ConfirmDialog` | `confirm({ title, message, confirmLabel, cancelLabel, tone: 'danger' })` -> `Promise<boolean>` | `if (await confirm({ title: 'Delete topic?', confirmLabel: 'Delete', tone: 'danger' })) del.mutate([id])` |
| `Menu` | **`label`**, `items: ({ label, onSelect, icon?, tone?: 'danger', disabled? } \| 'separator')[]`, `align`, `icon`, `size`, `variant` | `<Menu label={`Actions for ${t.title}`} items={[{ label: 'Edit', onSelect: edit }]} />` |
| `useToast()` | `success(msg, title?)`, `info(...)`, `error(errOrMsg, title?)`, `show({ message, title, tone, duration, action })`, `dismiss(id)` | `toast.error(err)` (shows the friendly text) |
| `Tooltip` | `content`, one focusable child, `placement` top\|bottom, `wide` | `<Tooltip content={term.definition} wide><button className="mark">{term.term}</button></Tooltip>` |
| `EmptyState` | `title`, `kicker`, children (text), `action`, `compact`, `titleLevel` | `<EmptyState kicker="nothing due!" title="All caught up" action={<Button>Learn a new topic</Button>} />` |
| `Callout` | `tone` neutral\|info\|good\|bad\|warn\|outline\|highlight, `title`, `label`, `icon` | `<Callout tone="bad" title={`Not quite. It's ${answer}.`}><Markdown variant="compact">{explanation}</Markdown></Callout>` |
| `Stat` | `value`, `label`, `boxed`, `tone` | `<Stat boxed value={`${recalled} / ${total}`} label="recalled" />` |
| `Spinner`, `LoadingBlock` | `size`, `label` (null when text says it) / `label` | `<LoadingBlock label="Loading topics…" />` |
| `Kbd` | children | `Press <Kbd>Space</Kbd> to reveal` |
| `ErrorBoundary` | `fallback({ error, reset })`, `resetKeys` | already wraps every route in `App.tsx` |

Providers (`AppProviders` in App.tsx, outermost first): `QueryClientProvider`,
`HashRouter`, `ThemeProvider`, `ToastProvider`, `ConfirmProvider`,
`PomodoroProvider`.

## App components (components/)

| Component | Key props | Example |
|---|---|---|
| `Markdown` | children (string), `variant` default\|lesson\|compact, `inline` | `<Markdown variant="lesson">{chunk.body}</Markdown>` |
| `CodeBlock` | `code`, `language` (used by Markdown; reuse for code outside Markdown) | `<CodeBlock code={src} language="python" />` |
| `NotebookCover` | `notebook` ({name, code, color, archived?}), `size` sm\|md\|lg, `mastery`, `footer`, `to` or `onClick`, `ariaLabel`, `actions` (e.g. a Menu, rendered outside the link) | `<NotebookCover notebook={nb} mastery={nb.mastery} to={ROUTES.notebook(nb.id)} />` |
| `MasteryPill` | `state`, `mastery?` (adds "· 40% mastery"), `size` | `<MasteryPill state={t.progress.state} />` |
| `MasteryBar` | `state`, `mastery`, **`label`**, `size`, `showValue` | `<MasteryBar state={p.state} mastery={p.mastery} label={`Mastery of ${t.title}`} />` |
| `MasteryLegend` | none | `<MasteryLegend />` |
| `AiWorking` | `task` (AiTask), `title?`, `explanation?`, `compact` | `{generate.isPending && <AiWorking task="lesson" />}` |
| `ErrorNotice` | `error` (renders nothing when null), `onRetry`, `title`, `compact` | `<ErrorNotice error={generate.error} onRetry={() => generate.mutate([topicId])} />` |
| `TopBar` | none (rendered by App) | brand, nav, streak, Pomodoro, Settings |

Markdown details: GFM (tables in a horizontal scroll box, task lists,
strikethrough, autolinks), `$inline$` and block math (`$$` on its own lines) via KaTeX, fenced
code with a language label and Copy button, external links open in the system
browser (`target=_blank`, handled by the main process), raw HTML is shown as
text and never rendered, images show their alt text.

## Tests

```
npx vitest run src/renderer          # pure helpers: format, pomodoroCore, api, hotkeys, queries, tokens
npx tsc --noEmit -p tsconfig.web.json
npx electron-vite build
```

Tests run in Node (no DOM): keep logic in pure modules (like
`pomodoroCore.ts`) and test those; components are checked by the type
checker, the build and the e2e suite.
