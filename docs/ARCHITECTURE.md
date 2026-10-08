# Study Notebook: architecture and build brief

Study Notebook is a Windows desktop app (Electron) for one computer science
student. It turns uploaded course files (syllabus, lecture PDFs, slides,
quizzes, past exams) into a study system built on learning science: active
recall, spaced repetition, interleaving, pre-testing, self-explanation,
confidence calibration and topic mastery.

Read this whole file before writing code. `docs/FEATURES.md` is the agreed
scope; `docs/design/prototype.dc.html` is the approved high-fidelity
prototype (an HTML-like file: read the markup and the `renderVals()` data at
the bottom to see the layout, copy and states).

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron 44 (Node 24.21 in main), electron-vite 5, Vite 7 |
| UI | React 19, TypeScript 5.9 (strict), react-router 7 (`HashRouter`), @tanstack/react-query 5 |
| Styling | Plain CSS with design tokens (CSS custom properties), one `.css` file per component/screen, no CSS framework |
| Icons | lucide-react |
| Markdown | react-markdown 10 + remark-gfm + remark-math + rehype-katex (+ katex CSS) |
| Fonts | Bundled via @fontsource: Instrument Serif (display), DM Sans (body), Caveat (handwritten accents), JetBrains Mono (code). The app must work offline, so no Google Fonts links. |
| Storage | SQLite through `node:sqlite` (`DatabaseSync`, built into Electron's Node, zero native deps) |
| Files | pdfjs-dist 6 (PDF), mammoth (DOCX), jszip (PPTX), fs (TXT/MD) |
| Spaced repetition | ts-fsrs 5 (FSRS) |
| AI | @anthropic-ai/sdk 0.131, default model `claude-opus-5-5` (Settings lets the learner pick Sonnet 5.5 or Haiku 4.5) |
| Validation | zod 4 |
| Tests | vitest 3 (unit/integration, Node), Playwright `_electron` (end-to-end, run under `xvfb-run`) |

Dependencies are already installed. Do not edit `package.json` or install
packages. If you truly need one, say so in your final report instead.

## Layout and ownership

```
src/shared/types.ts      domain types (CONTRACT, read-only)
src/shared/api.ts        StudyApi: renderer -> main methods (CONTRACT, read-only)
src/shared/errors.ts     AppError + friendly messages (CONTRACT, read-only)
src/shared/learning.ts   pure learning logic                       [learning agent]
src/main/index.ts        app lifecycle, window, wiring (lead, read-only)
src/main/ipc.ts          registers services as IPC handlers (lead, read-only)
src/main/context.ts      AppContext, DesktopAdapter (CONTRACT, read-only)
src/main/db/**           SQLite schema, migrations, repositories    [backend agent]
src/main/services/**     one service per StudyApi method            [backend agent]
src/main/files/**        file copy + text extraction                [files agent]
src/main/ai/**           Claude client, prompts, schemas, demo mode [ai agent]
src/preload/**           contextBridge (lead, read-only)
src/renderer/**          React app                                  [renderer agents, see below]
tests/e2e/**             Playwright end-to-end tests                [integration]
```

Rules for every agent:

- Only create or edit files you own. Contract files are read-only: if one
  needs to change, stop and describe the change in your final report.
- Code against the signatures in the stub files exactly (they are the
  contract other agents are coding against in parallel). You may add
  exports, never change or remove existing ones.
- Put unit tests next to the code as `*.test.ts` (vitest, Node
  environment). Tests must not use the network. Run `npx vitest run <your
  paths>` and `npx tsc --noEmit -p tsconfig.node.json` (main/shared) or
  `-p tsconfig.web.json` (renderer) before finishing; fix every error in
  your files. Errors in files you don't own can be ignored (other agents are
  mid-flight), but mention them.
- Do not commit; the lead commits.
- No secrets in code or logs. Never log the API key.
- Comments: explain why, not what. Match the existing style (2-space
  indent, single quotes, no semicolons).

## Process model

- **Main process** owns the database, files and AI. Every `StudyApi` method
  (src/shared/api.ts) is implemented by `services[method](ctx, ...args)` in
  src/main/services and registered by src/main/ipc.ts. Handlers return
  `ApiResult` envelopes; throw `AppError(code, message)` for expected
  failures.
- **Preload** exposes `window.studyBridge` (`invoke`, `onAiProgress`,
  `pathForFile`, `platform`). Nothing else from Node reaches the renderer.
- **Renderer** calls the typed `api` client (src/renderer/src/lib/api.ts),
  which unwraps envelopes and throws `ApiError` (with `.code`).
- **AI progress**: long AI calls report progress with
  `ctx.emitAiProgress({ jobId, task, subjectId, progress, message })`
  (through `runAiJob(ctx, { task, subjectId }, startMessage, call)`); the
  renderer listens with `studyBridge.onAiProgress`. `subjectId` is the topic
  (lessons, explanation feedback, flashcards, practice quizzes), the file
  (summaries) or the notebook (syllabus, weak-spot quizzes, mock exams), so
  two jobs of the same task each show their own progress.

Security rules (src/main/security.ts, src/main/files/access.ts):

- The window is sandboxed with context isolation. The preload may import
  only `electron` and modules bundled into it (electron.vite.config.ts
  bundles its dependencies); `src/preload/channels.ts` holds preload-only
  channel names and must stay import-free.
- IPC is answered only for the app's own top-level page; the preload only
  forwards names in `STUDY_API_METHODS`.
- Browser permissions are denied except `clipboard-sanitized-write` (the
  Copy button on code blocks). No webviews or new windows; web links open
  in the system browser; navigation away from the app is blocked.
- In the installed app (`app.isPackaged`), `importSources` only reads files
  returned by `pickFiles` or dropped on the window (`pathForFile` reports
  them to main). Development and e2e runs skip this check.
- `openPath`/`showItemInFolder` only accept paths inside the data folder.
- Other files in the data folder: `window-state.json` (window size and
  position). `npm run icon` regenerates `resources/icon.png`.

`AppContext` (src/main/context.ts) is passed to every service: `db`
(DatabaseSync), `ai` (StudyAi), `paths`, `desktop` (Electron-only actions),
`emitAiProgress`, `now()`, `demoAi`. Tests build their own context with
`openDatabase(':memory:')`, a temp library folder, a fake DesktopAdapter and
`new StudyAi(() => ({ apiKey: null, model: 'claude-opus-5-5', demo: true }))`.

Environment variables:

- `STUDY_DEMO_AI=1` or the `--demo` switch (`npm run dev:demo`,
  `npm run start:demo`, which work from PowerShell and cmd): AI returns
  offline, deterministic demo content built from the inputs (used by tests,
  e2e and for trying the app without a key). Without `STUDY_DATA_DIR`, demo
  mode keeps its data in `<userData>/demo`, apart from the real notebooks.
- `STUDY_DATA_DIR=<dir>`: overrides the data folder (e2e tests).
- `STUDY_ALLOW_MULTIPLE=1`: skips the single-instance lock (e2e tests).
- `ANTHROPIC_API_KEY`: used when no key is stored in Settings.

## The learning model (what the app is for)

The app is organised around memory, not file types:

1. **Notebooks** (one per subject) hold **sources** (uploaded files) and
   **topics**. Topics normally come from the syllabus (AI extraction, in
   course order) and can be added by hand.
2. Each topic has a 5-step **learning path**:
   1. *Warm-up*: 2 questions before the lesson (pre-testing primes memory;
      wrong guesses are expected and fine).
   2. *Learn*: an in-depth AI lesson from the topic's sources, split into
      3-6 small chunks. Each chunk ends with a quick check question that must
      be answered before moving on.
   3. *Explain it*: the learner explains the topic in their own words; the
      AI grades it against a rubric and the sources (covered, missing,
      misconceptions, one suggestion). Saved as a note.
   4. *Practice*: an AI quiz on this topic, interleaved with earlier topics,
      with the learner's chosen question types (multiple choice, true or
      false, fill in the blank, identification), count and difficulty.
      Every answer gets a confidence rating (sure, unsure, guessing).
   5. *Remember*: flashcards are created from the lesson (and from
      mistakes) and scheduled with FSRS; the screen shows the review plan.
3. **Every answer is logged** (`AnswerRecord`). Mastery, weak topics and
   calibration are computed from the log plus card memory (see
   `computeTopicProgress` in src/shared/learning.ts).
4. **Mistakes become flashcards** automatically (origin `mistake`).
   Answers marked "sure" that were wrong are *overconfident* errors: flagged,
   shown in Insights, and prioritised.
5. **Today** builds one daily plan: (1) due reviews interleaved across
   subjects, (2) up to 3 weak topics (exam-covered first), (3) the next topic
   to learn, (4) a mock exam when an exam is within 3 days. "Start today's
   session" runs it with the Pomodoro timer.
6. **Mock exams** are timed quizzes over an exam's topics, with a question
   navigator and a by-topic result breakdown.
7. **Insights**: weak topics across subjects, confidence vs accuracy,
   reviews due in the next 7 days, mistake log, study time.

Rules shared by every part of the app (src/shared/learning.ts):

- A review counts as recalled unless rated Again (`isRecalledRating`): Hard
  is a successful, effortful recall, in mastery, the answer log and the
  7-day recall rate alike.
- Overconfident errors keep a topic weak only until recent accuracy reaches
  the mastered bar (85%). Topics with only warm-up or learning-path answers
  are never weak (`isWeakTopic` needs scored data).
- A quiz mistake that matches an existing flashcard brings that card due
  now (a day ago when the learner was sure), keeping its FSRS history.
- Today's session asks `WEAK_SPOT_QUESTIONS` (8) weak-spot questions, one
  quiz per notebook of at least `WEAK_SPOT_MIN_PER_QUIZ` (4)
  (`weakSpotQuizSize`); a mock exam lasts `MOCK_EXAM_MINUTES` (60). The plan's
  estimates and the renderer's defaults both use these constants.

Mastery states and their colors (used everywhere a topic appears):

| State | Meaning | Light bg / fg |
|---|---|---|
| not_started | never studied | #EEE9DE / #6A655C |
| learning | path in progress | #F7EFD3 / #8A6A12 |
| weak | low accuracy or overconfident errors | #F8E6E1 / #9E3A24 |
| reviewing | learned, in spaced review | #E6EEF6 / #2F5D8A |
| mastered | high mastery, proven over spaced reviews | #E3F1E7 / #2E6B45 |

## Database (backend agent)

SQLite via `node:sqlite`. `PRAGMA journal_mode = WAL`, `foreign_keys = ON`.
Migrations keyed by `PRAGMA user_version`. Ids are `crypto.randomUUID()`.
Arrays/objects are stored as JSON text columns. Timestamps ISO strings.
Tables: `notebooks`, `sources` (with `text` column for extracted text),
`topics`, `lessons` (content JSON, one current lesson per topic), `quizzes`
(questions/settings/answers JSON), `answers` (AnswerRecord), `cards`,
`review_logs`, `notes`, `exams`, `focus_sessions`, `settings` (key TEXT
PRIMARY KEY, value TEXT JSON). Deleting a notebook cascades to everything in
it and removes its library folder. Index the columns you filter on
(notebook_id, topic_id, due, answered_at); migration 2 also indexes every
foreign-key child column, so deletes never scan a child table.
Opening the database marks sources left `processing` by an interrupted
import as `error` (the learner deletes and re-adds them). Backups are
written with `VACUUM INTO` to a temporary file that then replaces the
chosen file, and the live database (or its -wal/-shm) is refused as a target.

Source text budget for AI calls (backend decides what to send):

- Per call send at most ~600,000 characters of source text (~150k tokens).
- Choose sources for a topic: the topic's `sourceIds` if set, otherwise all
  `ready` sources of the notebook except `exam`/`quiz` kinds for lessons
  (past exams and quizzes are used for question style in quizzes and mock
  exams). Rank by relevance (topic title/description keywords in the text).
- If a single source is too large, keep the most relevant pages (split on
  the `[Page N]` / `[Slide N]` markers) up to the budget.
- Never cut silently: the lesson's `sourcesUsed` lists what was used,
  including page ranges when a source was cut (e.g. "Big Textbook.pdf, pages
  210-245").
- If no source text exists, throw `AppError('NO_SOURCES', ...)` except for
  topics with a description: then lessons may be generated from the topic
  title and description alone, and `sourcesUsed` says "No files: based on the
  topic description".

## AI (ai agent)

Read the claude-api skill notes summarised here (they override anything you
remember):

- Model ids: `claude-opus-5-5` (default), `claude-sonnet-5-5`,
  `claude-haiku-4-5`. Exact strings, no date suffixes.
- Use `client.beta.messages.stream({...})` and `await stream.finalMessage()`
  for every generation call (long inputs/outputs). `max_tokens` up to 64000
  for lessons/quizzes. Report progress from `stream.on('text', ...)`.
- Thinking: on Opus 5.5 thinking is always on; omit `thinking` (or send
  `{ type: 'adaptive' }`). Never send `budget_tokens` or `{type:'disabled'}`
  to Opus 5.5 / Sonnet 5.5. Control depth with
  `output_config: { effort: 'low'|'medium'|'high'|'xhigh'|'max' }`. Opus
  5.5's default effort is `medium`, so set it explicitly: `high` for lessons
  and syllabus extraction, `medium` for quizzes, flashcards, summaries and
  explanation grading. Haiku 4.5 does not support `effort` or adaptive
  thinking: send neither for Haiku.
- Structured output: `output_config: { format: { type: 'json_schema', schema } }`
  (JSON Schema with `additionalProperties: false` and every property in
  `required`). Parse the text block(s) with `JSON.parse` and validate with
  zod; on a validation failure retry once, then throw
  `AppError('AI_BAD_OUTPUT')`. No assistant prefill (it is a 400).
- Refusals: check `stop_reason` before reading content. `'refusal'` ->
  `AppError('AI_REFUSED')`; `'max_tokens'` -> retry once with a larger limit,
  then `AI_BAD_OUTPUT`. For Opus 5.5 and Sonnet 5.5 opt in to server-side
  fallbacks by default: `betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default'` (not for Haiku).
- Errors: catch the SDK's typed errors most-specific-first:
  `Anthropic.AuthenticationError` -> `INVALID_API_KEY`,
  `Anthropic.RateLimitError` -> `RATE_LIMITED`,
  `Anthropic.APIConnectionError` -> `NETWORK`,
  `Anthropic.InternalServerError` / other 5xx / overloaded -> `AI_UNAVAILABLE`,
  `Anthropic.BadRequestError` -> `AI_BAD_OUTPUT` with the message,
  no key -> `NO_API_KEY`. Never string-match error messages.
- Prompt caching: one stable system prompt for every task (the tutor persona
  and pedagogy rules) with `cache_control: { type: 'ephemeral' }`; then the
  sources as `document` content blocks (`source: { type: 'text', media_type:
  'text/plain', data }`, `title` = file name) with `cache_control` on the
  last one; then the task-specific instruction as a final text block. This
  way a lesson, its quiz and its flashcards made within a few minutes share
  the cached prefix. Keep everything before the breakpoints byte-stable (no
  timestamps, sorted inputs).
- Content quality bar (this is the product): lessons are in-depth and exact,
  grounded in the sources, use worked examples, code in fenced blocks with a
  language tag, math in `$...$`, and explain *why*, not just *what*. Check
  questions test understanding, not wording. Distractors are plausible
  misconceptions. Explanations say why the answer is right and why the
  tempting wrong answers are wrong. Flashcards are atomic (one fact or idea),
  phrased as questions, answerable from memory. `sourceRef` cites the file
  and page/slide (from the `[Page N]` markers). For CS subjects include code
  tracing and complexity questions where relevant. Questions must be
  answerable from the sources. `tf` options are exactly `["True", "False"]`.
  `mc` answers equal one of the options exactly. `fill` prompts contain
  `____`.
- Demo mode (`config.demo`): deterministic, offline content built from the
  inputs (e.g. pick sentences mentioning the topic from the source text,
  template questions from them), valid against the same schemas, fast (no
  delays). Used by all tests and e2e.

## Renderer

### Visual design (from the prototype)

A modern notebook: clean and calm, paper-like surfaces, a dot-grid page
background, lined "paper sheets" with a red margin line for lessons,
quizzes and notes, notebook covers with a darker spine and an elastic band,
handwritten-style accents (Caveat) for small encouraging notes, serif
display headings (Instrument Serif), DM Sans body text, generous spacing,
rounded corners (10-18px), soft shadows. No gradients, no emoji, no
left-border cards.

Tokens (light):

```
--paper: #F7F4EC        page background (with dot grid #D8D1C1, 22px)
--surface: #FFFDF8      cards/panels
--surface-2: #F3EFE6    segmented controls, table headers
--ink: #22201C          text, primary buttons
--ink-2: #4E4A43        secondary text
--muted: #6A655C        captions
--line: #E3DED2         borders
--line-2: #EEE9DE       inner dividers, empty bar tracks
--ruled: #E8E2D5        lined-paper rules (every 32px)
--margin-line: #E7B3A6  paper margin
--accent-hand: #A4521E  handwritten accent color
--highlight: #FCE79A    highlighter for key terms
--good: #2E6B45 on #E3F1E7, --bad: #9E3A24 on #F8E6E1, --warn: #8A6A12 on #F7EFD3, --info: #2F5D8A on #E6EEF6
Notebook colors (cover / tint / ink):
  blue #2F5D8A/#E6EEF6/#1F4266, orange #A4521E/#F8EBE1/#7A3A12,
  teal #2E7D73/#E2F1EE/#1C5850, purple #6B4FA0/#EEE9F6/#4A3475,
  green #3F7A3A/#E6F0E4/#2B5728, pink #A8456B/#F5E6EC/#7A2C4B,
  slate #4A5563/#E8EBEF/#2E3640, gold #8A6A12/#F7EFD3/#5E480C
```

Dark mode ("dark paper / chalkboard"): page #1C1B19 with dot grid #34322D,
surface #252420, surface-2 #2E2C27, ink #F1ECE2, ink-2 #CFC8BB, muted #A39C8F,
line #3A3731, ruled #2F2D28, margin-line #7A4A40, highlight rgba(252,231,154,.25)
with ink text; status tints become darker versions with lighter text. Covers
keep their colors. `data-theme="light|dark"` on `<html>`, driven by the
Settings theme (system follows `prefers-color-scheme`). Text contrast must
be at least 4.5:1 in both themes.

Minimum window is 960x640; layouts must work from 960px to 1920px wide.
Touch targets at least 40px tall. Real `<button>`, `<a>`, `<input>`,
`<label>`; visible focus rings; `aria-label` on icon-only buttons.

### Routes (HashRouter)

| Path | Screen | Owner |
|---|---|---|
| `/` | Today | screens-A |
| `/notebooks` | Notebook shelf + create notebook | screens-A |
| `/insights` | Insights | screens-A |
| `/settings` | Settings (API key, model, theme, timer, plan limits, retention, backup, data folder) | screens-A |
| `/notebooks/:notebookId` | Notebook: topics, sources, exams, notes, cards | screens-B |
| `/topics/:topicId` | Topic learning path (`?step=warmup|learn|explain|practice|remember`) | screens-C |
| `/session` | Today's session: mixed review, then weak spots, then learn (`?part=review|weak|learn`) | screens-C |
| `/review` | Free review of due cards (`?notebook=<id>` optional), or one topic's cards due or not (`?topic=<id>`) | screens-C |
| `/quiz/:quizId` | Quiz / mock exam runner and results | screens-C |

### Renderer ownership

- **Foundation agent** (runs first, others build on it):
  `src/renderer/index.html` (keep the CSP), `src/main.tsx`, `src/App.tsx`
  (providers, layout, routes), `src/styles/**` (tokens.css, base.css,
  fonts), `src/lib/**` (api.ts, queries.ts, format.ts, theme.tsx,
  pomodoro.tsx, aiProgress.ts, useHotkeys.ts), `src/components/ui/**`
  (primitives), `src/components/Markdown.tsx`,
  `src/components/NotebookCover.tsx`, `src/components/TopBar.tsx`,
  `src/components/MasteryPill.tsx`, `src/components/AiWorking.tsx`,
  `src/components/ErrorNotice.tsx`, and a placeholder file for every screen
  in `src/screens/` (each exporting a default component) so the router
  compiles. Also writes `src/renderer/README.md` documenting every primitive
  and hook with a one-line usage example.
- **screens-A**: `src/screens/Today.tsx`, `Notebooks.tsx`, `Insights.tsx`,
  `Settings.tsx` and their CSS, plus `src/components/today/**`,
  `src/components/insights/**`, `src/components/settings/**`.
- **screens-B**: `src/screens/Notebook.tsx` and CSS, plus
  `src/components/notebook/**`.
- **screens-C**: `src/screens/Topic.tsx`, `Session.tsx`, `Review.tsx`,
  `Quiz.tsx` and CSS, plus `src/components/topic/**`,
  `src/components/quiz/**` (QuestionView, ConfidencePicker, QuizRunner,
  QuizResults, QuizSettingsForm), `src/components/review/**` (ReviewCard,
  grade buttons).

### Data access in the renderer

- `api` (lib/api.ts) is a typed `StudyApi` proxy over `studyBridge.invoke`.
  It throws `ApiError` (`.code`, `.message`, `.friendly` from
  `ERROR_MESSAGES`).
- lib/queries.ts provides a react-query hook for every read method
  (`useNotebooks()`, `useTopic(id)`, `useLesson(topicId)`, ...) with stable
  query keys, and `useApiMutation(method)` for writes. Because everything is
  local and cheap, a successful mutation invalidates all queries.
- AI actions (generate lesson, quiz, syllabus, explanation grading,
  summaries, finishing a topic) can take 30-120 seconds. Run them with
  `useAiAction(method, key, { task, label, href, invalidate, onSuccess })`
  from lib/aiJobs.ts, never a component mutation: the call is an app-wide
  job keyed by e.g. `lesson:<topicId>`, so it survives leaving the page, a
  second start joins the running call, and its result or error stays until
  retried or dismissed. `<AiJobNotifier>` (mounted once in App) toasts jobs
  that finish while no screen shows them; the top bar shows running jobs.
  Always show `<AiWorking task=... startedAt={job.startedAt}
  subjectId=... />` (live progress, elapsed time, a calm explanation) and
  errors with `<ErrorNotice error=... onRetry onDismiss addFilesTo=... />`
  (friendly text; a Settings button for `NO_API_KEY`/`INVALID_API_KEY`, an
  "Add files" button for `NO_SOURCES`). For `AI_REFUSED`,
  `SOURCE_TOO_LARGE` and `INVALID_INPUT` the friendly text is the main
  process's own message, which says what to do.
- `refetchAfterMutation` (lib/queries.ts) resolves once the active queries
  have refetched; `useDayRollover` (in the App layout) refetches everything
  when the local date changes.
- Keyboard: review cards support Space/Enter to reveal and 1-4 to grade;
  quizzes support 1-5 / A-E to pick options.

### Screen specs (match the prototype)

**Today** (`/`): date in Caveat, "Good morning/afternoon/evening, Justine"
(name constant `LEARNER_NAME = 'Justine'` in lib/format.ts), one line on how
the plan is built. Left: "Today's plan" on a lined sheet: numbered blocks
(title, minutes, detail, Caveat reason), total minutes and Pomodoro count,
"Start today's session" (starts the focus timer and opens `/session`).
Empty states: no notebooks yet (create first notebook), nothing due
(celebrate briefly, suggest learning a new topic). Right: "Coming up" exams
with days left, readiness bar and weakest topics; "Memory check" (recall
rate 7 days, cards in long-term memory, minutes studied today). Bottom:
notebook shelf with covers and mastery bars.

**Notebooks** (`/notebooks`): shelf of covers (name, code, mastery, due
cards, next exam), "New notebook" dialog (name, course code, color picker
of the 8 cover colors), archive/rename/delete via a menu.

**Notebook** (`/notebooks/:id`): cover-colored header (code, name, next exam
and readiness, "Start mock exam" which creates a mock_exam quiz for the next
exam, and "Review due cards" when any are due). Main column: Topics list
(syllabus order; unit label, title, next review / status line, mastery pill,
mastery bar, primary action: Learn / Continue / Relearn / Review), legend,
"Find topics in syllabus" (when a syllabus source exists), "Add topic",
reorder (up/down buttons are fine), edit/delete via menu. Right column:
Sources panel (drop zone accepting drag-and-drop using
`studyBridge.pathForFile`, Upload button using `api.pickFiles`, list with
type badge, kind selector, status, summarize, open, delete), Exams panel
(add/edit/delete with date and covered topics), Notes (list + editor in a
modal or side sheet, Markdown preview), Flashcards (count, add card, browse
and edit cards). Mock exam attempts list with scores.

**Topic** (`/topics/:id`): back link to notebook, mastery pill, title,
5-step stepper (warm-up, learn, explain it, practice, remember) showing
done/current/upcoming; clicking a step navigates there (never locked, but
the recommended next step is emphasised). Persist the step with
`setTopicStep`. If there is no lesson yet, the first visit shows a
"Create my lesson" panel (with the sources it will use) that calls
`generateLesson` with `<AiWorking/>`. Warm-up: 2 questions with immediate
feedback ("Good guess" / "Not yet: it's X") and the rationale for
pre-testing. Learn: chunk progress bar, chunk on lined paper (Markdown,
worked example in a callout), check question that must be answered before
"Next part", Caveat margin notes for key terms, "Connects to" links.
Explain it: prompt, textarea, "Check my explanation" -> feedback (Got it /
Missing / Misconception / Try). Practice: question type chips, count (5,
10, 20), difficulty (easy/medium/hard/mixed), "Mix in earlier topics" and
"Focus on my weak spots" toggles, Generate -> runs the quiz inline (reuse
QuizRunner) with confidence per question -> results. Remember:
`finishTopic`, show cards created and the review plan timeline. Side rail:
key terms (highlighter chips with definitions on hover/focus), built from
(sources used), the learner's notes for the topic. Regenerate lesson in a
menu.

**Session** (`/session`): focus mode. Progress bar. Part 1 mixed review:
card with subject + topic chip, "Recall from memory", optional answer
textarea, "How sure are you?" (Sure / Unsure / Guessing) which reveals the
answer with its source, then Again/Hard/Good/Easy with the interval preview
from `ReviewCard.previews`, keyboard shortcuts. Missed cards come back at
the end of the part (relearning) when their new due time is within the
session. Summary: recalled, sure-but-wrong, coming back. Part 2 weak spots:
creates a `weak_spots` quiz (types: all, count 6-10, focusWeak) for the
plan's weak topics and runs it inline. Part 3 learn: links to the plan's
learn topic. Each part can be skipped; "End session" returns to Today.

**Review** (`/review`): same card flow as Session part 1 without parts.
With `?topic=<id>` ("Review: <topic>", from a weak topic's "Review cards" in
Insights, on the topic page and in the notebook's topic menu) it reviews that
topic's cards whether due or not: due cards first, then the ones closest to
being forgotten (lowest retrievability). Early grades go through `reviewCard`
like any other, so FSRS schedules from the real time since the last review.

**Quiz** (`/quiz/:id`): practice/weak spots: all questions on one lined
sheet, each with type label, topic, options or input, confidence chips,
"Check answers" -> per-question feedback (correct, answer, explanation,
"you were sure" flag) and score. Mock exam: one question at a time, timer
(counts down from the time limit; at 0 auto-submits), question navigator
grid (answered / flagged / current), flag for review, autosave each answer
(`saveQuizAnswer`), submit with confirmation listing unanswered count ->
results by topic with mastery impact and a "Review mistakes" list.

**Insights** (`/insights`): weak topics across subjects (lowest first, why,
mastery bar, Relearn -> topic, Review cards -> `/review?topic=` when the topic
has cards), calibration (accuracy when sure / unsure / guessing, with one
sentence of interpretation), reviews due next 7 days (bar chart), mistake log
(prompt, your answer, correct answer, date), study time by day (last 14 days)
and by subject, streak.

**Settings**: API key (password field, save, test connection, remove;
explain it is stored encrypted on this computer and costs a little per
use; link to console.anthropic.com), model select, theme, focus/break
minutes, new topics per day, max reviews per day, desired retention (slider
0.80-0.97 with explanation), backup (export), open data folder, demo-mode
notice when `settings.demoAi`.

**Top bar** (every screen): brand (notebook icon + "Study Notebook" in
Instrument Serif), nav (Today, Notebooks, Insights) as a segmented control,
streak, Pomodoro widget (mode label, mm:ss, progress, start/pause, reset;
logs focus sessions with the current notebook; desktop notification at the
end of each phase), settings icon button.

## Testing

- Unit/integration: `npx vitest run`. Services are tested end to end with an
  in-memory DB and demo AI (tests/fixtures may be generated in the test).
- E2E: `npx electron-vite build && xvfb-run -a npx playwright test` launches
  `out/main/index.js` with `STUDY_DEMO_AI=1`, a temp `STUDY_DATA_DIR` and
  `STUDY_ALLOW_MULTIPLE=1`.
- Packaged app (`electron-builder --linux dir` or `--win --dir`): the fuses
  turn off `--inspect`, which Playwright's `_electron` needs, so drive the
  real build over CDP (`--remote-debugging-port=0`, then
  `chromium.connectOverCDP`), or package a test copy with
  `-c.electronFuses.enableNodeCliInspectArguments=true`. It enforces the
  file-access rule, so import through a stubbed `pickFiles` or a real file
  passed to `pathForFile`, not a bare path.
- Real AI path without a key or network: point `ANTHROPIC_BASE_URL` at a
  local fake `/v1/messages` that streams SSE (the SDK client reads it).
