# Study Notebook

A Windows desktop study app built around how memory works: one notebook per subject, topics taken from your syllabus, a five-step learning path for each topic, spaced-repetition flashcards, quizzes, timed mock exams, notes, a Pomodoro timer and weak-topic tracking. Everything is stored on your laptop. Lessons, questions and feedback are written by Claude through your own Anthropic API key.

## Run it on Windows

You need two things installed once:

1. **Node.js 24 LTS** (or 22.12 or newer) from https://nodejs.org, using the Windows installer with its default options.
2. **Git** from https://git-scm.com (or download this repo as a ZIP from GitHub and unzip it).

Then open **PowerShell** and run:

```powershell
git clone https://github.com/Justine-paras/study-notebook.git
cd study-notebook
npm install
npm run dev
```

The app window opens. Go to **Settings**, paste your Anthropic API key (get one at https://console.anthropic.com), and click **Test connection**. The key is encrypted with Windows' own data protection and only ever sent to Anthropic.

To try the app without a key, start it in demo mode instead. Lessons and quizzes are then simple stand-ins built from your files, nothing is sent anywhere, and demo notebooks are kept apart from your real ones:

```powershell
npm run dev:demo
```

## Install it like a normal app

```powershell
npm run dist:win
```

This builds an installer at `dist\Study-Notebook-Setup-0.1.0.exe`. Run it: it installs for your Windows account only (no admin rights needed) and adds Study Notebook to the Start menu and the desktop. Windows SmartScreen may warn that the publisher is unknown, because the installer isn't code-signed; choose **More info → Run anyway**. Uninstalling keeps your notebooks.

## How to use it

1. **Notebooks → New notebook** for each subject (for example "CS 210 Data Structures").
2. **Upload** your syllabus, slides, lecture PDFs, past quizzes and exams (PDF, PPTX, DOCX, TXT, MD). Drag and drop works too.
3. Click **Find topics in syllabus**. The topics appear in course order, and exam dates from the syllabus become exams.
4. Open a topic and work through its five steps: **Warm-up** (guess first), **Learn** (small parts, each with a quick check), **Explain it** (in your own words, with feedback on what's missing), **Practice** (mixed questions with a confidence rating), **Remember** (flashcards and a review schedule).
5. Each day, open **Today** and press **Start today's session**. It mixes cards you're about to forget, your weak spots and the next topic before your nearest exam, and starts the Pomodoro.
6. Before an exam, take a **mock exam** from the notebook page. **Insights** shows your weak topics (with buttons to relearn one or review just its flashcards), whether your confidence matches your accuracy, and what's due this week.

## Where your data lives

Everything (the database and copies of your files) is in `%APPDATA%\Study Notebook`. **Settings → Open data folder** opens it, and **Settings → Export backup** saves a copy you can keep elsewhere.

## Costs

Each AI action is billed to your Anthropic account. Settings lets you pick the model: Claude Opus 5.5 writes the most thorough lessons, while Sonnet 5.5 and Haiku 4.5 are quicker and cheaper.

## For development

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run dev:demo` | Same, with offline demo AI |
| `npm start` | Run the last build without hot reload (`npm run start:demo` for demo mode) |
| `npm run typecheck` | TypeScript checks for the main and renderer code |
| `npm test` | Unit tests (Vitest) |
| `npm run build && npm run e2e` | Build, then run the end-to-end tests in Electron (Playwright) |
| `npm run dist:win` | Build the Windows installer |

Environment variables: `STUDY_DEMO_AI=1` (offline demo AI, same as the `--demo` switch), `STUDY_DATA_DIR` (use another data folder), `ANTHROPIC_API_KEY` (used when no key is saved in Settings).

The stack is Electron, React, TypeScript, SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile), ts-fsrs for spaced repetition and the Anthropic TypeScript SDK. `docs/ARCHITECTURE.md` describes how the pieces fit together, `docs/FEATURES.md` the agreed scope, and `docs/design/prototype.dc.html` the design prototype.
