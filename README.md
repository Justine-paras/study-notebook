# Study Notebook

A Windows desktop study app built around how memory works: one notebook per subject, topics taken from your syllabus, a five-step learning path for each topic, spaced-repetition flashcards, quizzes, timed mock exams, notes, a Pomodoro timer and weak-topic tracking. Everything is stored on your laptop. Lessons, questions and feedback are written by Claude through your own Anthropic API key, or for free on your own computer with [Ollama](#use-ollama-instead-of-claude-free-offline).

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

The app window opens. Go to **Settings**, paste your Anthropic API key (get one at https://console.anthropic.com), and click **Test connection**. The key is encrypted with Windows' own data protection and only ever sent to Anthropic. To use a free model on your own computer instead, see [Use Ollama instead of Claude](#use-ollama-instead-of-claude-free-offline).

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

## Use Ollama instead of Claude (free, offline)

[Ollama](https://ollama.com) is a free app that runs AI models on your own computer. With it, Study Notebook needs no API key, costs nothing per use, and your files never leave your computer. The catch: a model small enough to run on a laptop is slower than Claude and less accurate, so read its lessons and questions with a critical eye. A computer with **16 GB of memory** is recommended; 8 GB works with a smaller model.

1. **Install Ollama for Windows** from https://ollama.com/download (Windows 10 22H2 or newer). The installer needs no admin rights. Ollama then runs in the background, with its icon near the clock, and starts again when you sign in to Windows.
2. **Download a model.** Open PowerShell and run one of these (a one-time download of a few GB):

   ```powershell
   ollama pull qwen3:8b    # 16 GB of memory or more (about 5 GB to download)
   ollama pull qwen3:4b    # laptops with 8 GB of memory (about 2.5 GB)
   ```

   `ollama list` shows the models you have.
3. **Keep Ollama running** while you study. If you quit it from its icon, open it again from the Start menu.
4. **Choose it in Study Notebook:** **Settings → AI tutor → AI provider → Ollama**. Leave the address at `http://127.0.0.1:11434` unless you changed where Ollama listens. Pick your model, then click **Test connection**. You can switch back to Claude at any time; your notebooks, cards and progress stay the same.

**Context size** (in Settings) is how much text the model handles in one go, counted in tokens (a token is about three quarters of a word). Part of it is kept for the instructions and the answer; the rest holds your files, so each lesson, quiz or summary uses the most relevant parts of your files that fit:

| Context size | Roughly how much of your files one AI action reads |
| --- | --- |
| 8K | 2 pages |
| 16K (the default) | 8 pages |
| 32K | 25 pages |
| 64K | 65 pages |
| 128K | 150 pages |

A bigger size needs more memory and makes every answer slower. Start with 16K. On an 8 GB laptop, use `qwen3:4b` and drop to 8K only if you run out of memory. Choose 32K or more only with plenty of memory or a graphics card with a lot of its own memory.

**What to expect.** Lessons are shorter and plainer than Claude's, a question can now and then be wrong or off the topic, and feedback on your explanations can miss things. Check anything that looks wrong against your files. Writing a lesson can take several minutes, more on a laptop without a dedicated graphics card; you can keep using the app meanwhile.

**Troubleshooting**

- **"Couldn't reach Ollama"**: Ollama isn't running, or the address is wrong. Open Ollama from the Start menu and try again. Visiting http://127.0.0.1:11434 in your browser should show "Ollama is running"; if it does, check the address in Settings.
- **"Choose an Ollama model in Settings"**, **"... isn't installed in Ollama"**, or a model marked "not installed": the model in Settings isn't in Ollama (any more). Run `ollama list`, download one with `ollama pull qwen3:8b`, then press **Refresh** in Settings and pick it.
- **Out of memory, errors about memory, or the computer slows to a crawl**: choose a smaller **Context size**, switch to a smaller model (`qwen3:4b`), and close other heavy apps such as games or many browser tabs. `ollama ps` shows the loaded model and whether it runs on your graphics card ("GPU", fast) or your processor ("CPU", slow).
- **"Ollama didn't start answering"**: Ollama took the request but never began to answer (after half an hour or so with the usual context size). Restart Ollama from its icon near the clock and try again; if it keeps happening, the model or context size is too much for your computer.
- **A model you used with Ollama Cloud isn't listed**: Study Notebook only offers models that run on your computer, so your files never leave it.
- **"...leave the model no room to answer"**: the context size is too small for this request and your files. Choose a larger one in Settings. Some models can't read more than a set amount; Test connection says so when yours is one of them.
- **Answers are poor**: a bigger model writes better, if your computer can run it. For the best lessons, switch back to Claude.

## Where your data lives

Everything (the database and copies of your files) is in `%APPDATA%\Study Notebook`. **Settings → Open data folder** opens it, and **Settings → Export backup** saves a copy you can keep elsewhere.

## Costs

With Claude, each AI action is billed to your Anthropic account. Settings lets you pick the model: Claude Opus 5.5 writes the most thorough lessons, while Sonnet 5.5 and Haiku 4.5 are quicker and cheaper. With Ollama there is nothing to pay; the model runs on your own computer.

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

The stack is Electron, React, TypeScript, SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile), ts-fsrs for spaced repetition, the Anthropic TypeScript SDK for Claude and Ollama's HTTP API for local models. `docs/ARCHITECTURE.md` describes how the pieces fit together, `docs/FEATURES.md` the agreed scope, and `docs/design/prototype.dc.html` the design prototype.
