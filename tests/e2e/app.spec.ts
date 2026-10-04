// End-to-end run of Study Notebook: launches the built app with the offline
// demo AI and a throwaway data folder, then studies one topic the way a
// learner would, from an empty shelf to a mock exam. Every main screen is
// screenshotted to test-results/screens for design review.
//
// Run: npx electron-vite build && xvfb-run -a npx playwright test

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { StudyBridge } from '../../src/shared/api'

// The renderer's globals, for code passed to page.evaluate (this file compiles without the DOM lib).
declare const window: { location: { hash: string }; studyBridge: StudyBridge }
declare const document: { fonts: { ready: Promise<unknown> } }

const ROOT = resolve(__dirname, '../..')
const MAIN = join(ROOT, 'out/main/index.js')
const SHOTS = join(ROOT, 'test-results/screens')

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let dataDir: string
let fixturesDir: string
let notebookId = ''
let shotNumber = 0
const problems: string[] = []

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const SYLLABUS = `CS 210 Data Structures - Course Syllabus
Fall 2026

Grading: quizzes 20%, exams 50%, labs 30%.
Office hours: Mondays 1-3pm.

Schedule
Week 1: Arrays and linked lists - contiguous storage, pointers, the cost of insertion and deletion.
Week 2: Stacks and queues - LIFO and FIFO order, array and linked implementations, amortized push.
Week 3: Binary search trees - ordered insertion, search, deletion and why balance matters.

Exams
Midterm exam: ${localDate(2)}, covers weeks 1-3.
`

const LECTURE = `# Lecture 4: Stacks and queues

A stack is a collection where the last element pushed is the first one popped. This order is called LIFO, last in first out.

A stack supports push, pop and peek in constant time when it is built on a dynamic array, because each operation only touches the top element.

A queue is a collection where the first element added is the first one removed. This order is called FIFO, first in first out.

A queue built on a circular buffer keeps a head index and a tail index, so enqueue and dequeue both run in constant time.

Function calls use a call stack: each call pushes a frame and each return pops it, which is why deep recursion can overflow the stack.

Breadth-first search uses a queue so that nodes are visited in order of their distance from the start node.

\`\`\`python
stack = []
stack.append(1)  # push
stack.append(2)
top = stack.pop()  # pops 2, the last element pushed
\`\`\`
`

async function makePdf(path: string): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = [
    [
      'Lecture 2: Arrays and linked lists',
      'An array stores its elements in contiguous memory, so indexing takes constant time.',
      'Inserting into the middle of an array shifts every later element, which takes linear time.'
    ],
    [
      'A linked list stores each element in a node that points to the next node.',
      'Inserting after a known node in a linked list takes constant time because no elements move.',
      'Finding the k-th element of a linked list takes linear time because the list must be walked.'
    ]
  ]
  for (const lines of pages) {
    const pdfPage = doc.addPage([612, 792])
    lines.forEach((line, i) => pdfPage.drawText(line, { x: 56, y: 720 - i * 22, size: 12, font }))
  }
  writeFileSync(path, await doc.save())
}

async function shot(name: string): Promise<void> {
  shotNumber += 1
  // Let fonts, transitions and toasts settle so the picture shows the resting state.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(SHOTS, `${String(shotNumber).padStart(2, '0')}-${name}.png`) })
}

async function go(hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

async function invoke<T>(method: string, args: unknown[]): Promise<T> {
  const result = await page.evaluate(
    ([m, a]) => window.studyBridge.invoke(m as never, a as unknown[]),
    [method, args] as const
  )
  if (!result.ok) throw new Error(`${method} failed: ${result.error.code} ${result.error.message}`)
  return result.data as T
}

/** Answers one question: the first option, or a typed answer for fill-in and identification. */
async function answer(question: Locator, typed = 'stack'): Promise<void> {
  const options = question.locator('.quiz-option')
  if ((await options.count()) > 0) await options.first().click()
  else await question.getByRole('textbox').fill(typed)
}

async function dismissToasts(): Promise<void> {
  // Toasts sit over the bottom-right corner; close them so screenshots and clicks are clean.
  const closers = page.locator('.toast').getByRole('button', { name: /dismiss|close/i })
  for (let i = (await closers.count()) - 1; i >= 0; i -= 1) await closers.nth(i).click().catch(() => undefined)
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'study-e2e-data-'))
  fixturesDir = mkdtempSync(join(tmpdir(), 'study-e2e-files-'))
  rmSync(SHOTS, { recursive: true, force: true })
  mkdirSync(SHOTS, { recursive: true })

  writeFileSync(join(fixturesDir, 'CS210 Syllabus.txt'), SYLLABUS)
  writeFileSync(join(fixturesDir, 'Lecture 4 - Stacks and queues.md'), LECTURE)
  await makePdf(join(fixturesDir, 'Lecture 2 - Arrays and linked lists.pdf'))

  app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, STUDY_DEMO_AI: '1', STUDY_ALLOW_MULTIPLE: '1', STUDY_DATA_DIR: dataDir }
  })
  app.process().stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    // Main-process failures are logged by ipc.ts as "[ipc] <method> failed".
    if (text.includes('[ipc]')) problems.push(`main: ${text.trim()}`)
  })
  page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setSize(1440, 900)
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
})

test.afterEach(() => {
  // Any console error, uncaught page error or failed IPC call fails the step that caused it.
  const found = problems.splice(0)
  expect(found, found.join('\n')).toEqual([])
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(fixturesDir, { recursive: true, force: true })
})

test('starts on an empty Today and creates a notebook', async () => {
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Justine/ })).toBeVisible()
  await shot('today-empty')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Notebooks' }).click()
  await expect(page.getByRole('heading', { name: 'No notebooks yet' })).toBeVisible()
  await shot('notebooks-empty')

  await page.getByRole('button', { name: 'Create your first notebook' }).click()
  const dialog = page.getByRole('dialog', { name: 'New notebook' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Create notebook' }).click()
  await expect(dialog.getByText(/name/i).first()).toBeVisible()
  await dialog.getByLabel('Name').fill('Data Structures')
  await dialog.getByLabel('Course code').fill('CS 210')
  await dialog.getByText('Teal').click()
  await shot('notebook-dialog')
  await dialog.getByRole('button', { name: 'Create notebook' }).click()

  await expect(page).toHaveURL(/#\/notebooks\/[\w-]+$/)
  notebookId = page.url().split('/notebooks/')[1]!
  await expect(page.getByRole('heading', { name: 'Data Structures', level: 1 })).toBeVisible()
  await expect(page.getByText('CS 210').first()).toBeVisible()
})

test('imports course files and finds topics in the syllabus', async () => {
  // Native file dialogs and OS drag-and-drop can't be driven here, so the files go in through the API.
  const result = await invoke<{ sources: { fileName: string; kind: string; status: string }[]; failed: unknown[] }>('importSources', [
    notebookId,
    [
      { path: join(fixturesDir, 'CS210 Syllabus.txt') },
      { path: join(fixturesDir, 'Lecture 4 - Stacks and queues.md') },
      { path: join(fixturesDir, 'Lecture 2 - Arrays and linked lists.pdf') }
    ]
  ])
  expect(result.failed).toEqual([])
  expect(result.sources.map((s) => s.status)).toEqual(['ready', 'ready', 'ready'])
  expect(result.sources[0]!.kind).toBe('syllabus')

  await page.reload()
  for (const name of ['CS210 Syllabus.txt', 'Lecture 4 - Stacks and queues.md', 'Lecture 2 - Arrays and linked lists.pdf']) {
    await expect(page.locator('.source-row__name', { hasText: name })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Find topics in syllabus' }).first().click()
  await expect(page.getByText(/Added 3 topics/)).toBeVisible()
  for (const title of ['Arrays and linked lists', 'Stacks and queues', 'Binary search trees']) {
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Midterm exam').first()).toBeVisible()
  await dismissToasts()
  await shot('notebook')
})

test('learns a topic through all five steps', async () => {
  await page.getByRole('link', { name: 'Learn Stacks and queues' }).click()
  await expect(page.getByRole('heading', { name: 'Stacks and queues', level: 1 })).toBeVisible()
  await expect(page.getByText('Lecture 4 - Stacks and queues.md')).toBeVisible()
  await shot('topic-create-lesson')

  // 1. Warm-up: two guesses with instant feedback.
  await page.getByRole('button', { name: 'Create my lesson' }).click()
  const warmup = page.getByRole('region', { name: 'Warm-up' }).locator('.warmup')
  await expect(warmup).toBeVisible()
  const warmupQuestions = warmup.locator('.warmup__list > li')
  await expect(warmupQuestions).toHaveCount(2)
  for (let i = 0; i < 2; i += 1) {
    await answer(warmupQuestions.nth(i))
    await expect(warmupQuestions.nth(i).getByText(/Good guess\.|Not yet: it's/)).toBeVisible()
  }
  await shot('topic-warmup')
  await page.getByRole('button', { name: 'Start learning' }).click()

  // 2. Learn: every part's quick check must be answered before moving on.
  const partLabel = page.locator('.learn__main .caps-label').first()
  await expect(partLabel).toHaveText(/Part 1 of \d/)
  const parts = Number((await partLabel.textContent())!.match(/of (\d+)/)![1])
  expect(parts).toBeGreaterThanOrEqual(3)
  for (let part = 1; part <= parts; part += 1) {
    await expect(partLabel).toHaveText(`Part ${part} of ${parts}`)
    const next = page.getByRole('button', { name: part === parts ? 'Finish: explain it' : 'Next part' })
    await expect(next).toBeDisabled()
    const check = page.locator('.learn__check')
    await answer(check)
    await expect(check.getByText(/Correct\.|Not quite\./)).toBeVisible()
    if (part === 1) await shot('topic-learn')
    await expect(next).toBeEnabled()
    await next.click()
  }

  // 3. Explain it: the AI checks the explanation against the rubric.
  await expect(page.getByRole('button', { name: 'Check my explanation' })).toBeDisabled()
  await page
    .getByRole('textbox', { name: 'Your explanation' })
    .fill(
      'A stack is last in first out: push and pop both work on the top, so they are constant time. A queue is first in first out, ' +
        'and a circular buffer with head and tail indexes gives constant time enqueue and dequeue. Function calls use a call stack.'
    )
  await page.getByRole('button', { name: 'Check my explanation' }).click()
  const feedback = page.getByRole('status', { name: 'Feedback on your explanation' })
  await expect(feedback).toBeVisible()
  await expect(feedback.getByText(/\d+ \/ 100/)).toBeVisible()
  await expect(feedback.getByText('Got it').first()).toBeVisible()
  await shot('topic-explain')
  await feedback.getByRole('button', { name: 'Go to practice' }).click()

  // 4. Practice: a 5-question quiz with a confidence rating on every answer.
  const settings = page.getByRole('form', { name: 'Practice settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('radio', { name: '5', exact: true }).click()
  await settings.getByRole('radio', { name: 'Mixed' }).click()
  await settings.getByRole('button', { name: 'Write my questions' }).click()
  const items = page.locator('.quiz-sheet__item')
  await expect(items).toHaveCount(5)
  const confidences = ['Sure', 'Unsure', 'Guessing', 'Sure', 'Unsure']
  for (let i = 0; i < 5; i += 1) {
    await answer(items.nth(i))
    await items.nth(i).getByRole('button', { name: confidences[i]!, exact: true }).click()
  }
  await expect(page.getByText('5 of 5 questions answered')).toBeVisible()
  await shot('topic-practice')
  await page.getByRole('button', { name: 'Check answers' }).click()
  await expect(page.getByRole('heading', { name: 'Practice results' })).toBeVisible()
  await expect(page.getByText(/Score \d \/ 5/)).toBeVisible()
  await shot('topic-practice-results')

  // 5. Remember: flashcards and the review plan.
  await page.getByRole('button', { name: 'Continue to Remember' }).click()
  await expect(page.getByRole('heading', { name: 'Your review plan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Added to your flashcards \(\d+\)/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Upcoming reviews' }).getByRole('listitem').first()).toBeVisible()
  await shot('topic-remember')

  await page.getByRole('link', { name: 'Done, back to topics' }).click()
  await expect(page.getByRole('heading', { name: 'Data Structures', level: 1 })).toBeVisible()
  const row = page.locator('.topic-row', { has: page.getByRole('link', { name: 'Stacks and queues', exact: true }) })
  await expect(row.locator('.mastery-pill')).not.toHaveText(/Not started/)
})

test('reviews due flashcards', async () => {
  await go('#/review')
  await expect(page.getByRole('heading', { name: 'Review due cards' })).toBeVisible()
  await expect(page.getByText(/Card 1 of \d+/)).toBeVisible()
  await shot('review-card')

  // First card by mouse: confidence reveals the answer, then a grade.
  await page.getByRole('button', { name: /^Sure/ }).click()
  await expect(page.getByRole('region', { name: 'Answer' })).toBeVisible()
  await shot('review-revealed')
  await page.getByRole('button', { name: /^Again:/ }).click()
  // Grading is a round trip; keys pressed before the next card shows are ignored.
  await expect(page.getByRole('region', { name: 'Answer' })).toBeHidden()

  // The rest by keyboard: 1 = sure, then 3 = Good.
  for (let i = 0; i < 60; i += 1) {
    if (await page.getByRole('heading', { name: 'Review finished' }).isVisible()) break
    await expect(page.getByText(/Card \d+ of \d+/)).toBeVisible()
    await page.keyboard.press('1')
    await expect(page.getByRole('region', { name: 'Answer' })).toBeVisible()
    await page.keyboard.press('3')
    await expect(page.getByRole('region', { name: 'Answer' })).toBeHidden()
  }
  await expect(page.getByRole('heading', { name: 'Review finished' })).toBeVisible()
  await expect(page.getByText('coming back soon')).toBeVisible()
  await shot('review-summary')
})

test('takes a timed mock exam', async () => {
  await go(`#/notebooks/${notebookId}`)
  await expect(page.getByRole('heading', { name: 'Data Structures', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Start mock exam' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Start a mock exam' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radiogroup', { name: 'Number of questions' }).getByRole('radio', { name: '10', exact: true }).click()
  await dialog.getByRole('radiogroup', { name: 'Time limit' }).getByRole('radio', { name: '30 min', exact: true }).click()
  await shot('mock-exam-dialog')
  await dialog.getByRole('button', { name: 'Write my mock exam' }).click()

  await expect(page).toHaveURL(/#\/quiz\//)
  await expect(page.getByRole('timer', { name: 'Time left' })).toHaveText(/^(29|30):\d\d$/)
  const total = 10
  for (let q = 1; q <= total; q += 1) {
    await expect(page.locator('.exam__bar .caps-label')).toHaveText(`Question ${q} of ${total}`)
    const sheet = page.locator('.exam__sheet')
    await answer(sheet, 'linked list')
    await sheet.getByRole('button', { name: q % 2 ? 'Sure' : 'Unsure', exact: true }).click()
    if (q === 3) {
      await page.getByRole('button', { name: 'Flag for review' }).click()
      await shot('mock-exam')
    }
    if (q < total) await page.getByRole('button', { name: 'Next question' }).click()
  }
  await expect(page.getByText(`${total} of ${total} answered`)).toBeVisible()
  await page.getByRole('button', { name: 'Review and submit' }).click()
  const confirm = page.getByRole('dialog', { name: 'Submit your exam?' })
  await expect(confirm.getByText('You answered every question.')).toBeVisible()
  await confirm.getByRole('button', { name: 'Submit exam' }).click()

  await expect(page.getByRole('heading', { name: 'Mock exam results' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'By topic' })).toBeVisible()
  await expect(page.getByText(/Score \d+ \/ 10/)).toBeVisible()
  await dismissToasts()
  await shot('mock-exam-results')

  await go(`#/notebooks/${notebookId}`)
  await expect(page.getByText(/\d+ \/ 10|\d+%/).first()).toBeVisible()
})

test('keeps notes, flashcards, exams and file summaries in the notebook', async () => {
  await go(`#/notebooks/${notebookId}`)
  await expect(page.getByRole('heading', { name: 'Data Structures', level: 1 })).toBeVisible()

  // A note with Markdown and math, checked in the preview tab.
  await page.getByRole('button', { name: 'New note' }).click()
  const noteDialog = page.getByRole('dialog', { name: 'New note' })
  await noteDialog.getByLabel('Title').fill('Amortized push')
  await noteDialog.getByLabel('Topic').selectOption({ label: 'Week 2 · Stacks and queues' })
  await noteDialog.getByRole('textbox', { name: 'Note' }).fill('Doubling the array makes **push** cost $O(1)$ amortized.')
  await noteDialog.getByRole('radio', { name: 'Preview' }).click()
  await expect(noteDialog.getByLabel('Note preview').locator('strong', { hasText: 'push' })).toBeVisible()
  await expect(noteDialog.getByLabel('Note preview').locator('.katex').first()).toBeVisible()
  await shot('note-dialog')
  await noteDialog.getByRole('button', { name: 'Save note' }).click()
  await expect(noteDialog).toBeHidden()
  await expect(page.getByText('Amortized push')).toBeVisible()

  // A hand-written flashcard.
  await page.getByRole('button', { name: 'Add card' }).click()
  const cardDialog = page.getByRole('dialog', { name: 'New card' })
  await cardDialog.getByLabel('Front (question)').fill('What order does a queue serve elements in?')
  await cardDialog.getByLabel('Back (answer)').fill('FIFO: first in, first out.')
  await cardDialog.getByRole('button', { name: 'Add card', exact: true }).click()
  await expect(cardDialog).toBeHidden()
  const cards = await invoke<{ front: string; origin: string }[]>('listCards', [notebookId])
  expect(cards.some((c) => c.origin === 'manual' && c.front.startsWith('What order does a queue'))).toBe(true)

  // A second exam, covering one topic.
  await page.getByRole('button', { name: 'Add exam' }).click()
  const examDialog = page.getByRole('dialog', { name: 'Add an exam' })
  await examDialog.getByLabel('Name').fill('Quiz 2')
  await examDialog.getByLabel('Date').fill(localDate(9))
  await examDialog.getByRole('checkbox', { name: 'Binary search trees' }).check()
  await examDialog.getByRole('button', { name: 'Add exam' }).click()
  await expect(examDialog).toBeHidden()
  await expect(page.getByRole('list', { name: 'Upcoming exams' }).getByText('Quiz 2')).toBeVisible()

  // An AI summary of a file, read back in its dialog.
  await page.getByRole('button', { name: 'Summarize Lecture 4 - Stacks and queues.md' }).click()
  const row = page.locator('.source-row', { hasText: 'Lecture 4 - Stacks and queues.md' })
  await row.getByRole('button', { name: 'Summary' }).click()
  const summary = page.getByRole('dialog', { name: 'Summary' })
  await expect(summary.locator('.markdown, p').first()).toBeVisible()
  await shot('source-summary')
  await summary.getByRole('button', { name: 'Close' }).last().click()
  await dismissToasts()
  await shot('notebook-filled')
})

test('shows Today, Session, Insights and Settings, and switches to dark', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { name: "Today's plan" })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible()
  await expect(page.getByText('Midterm exam').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Memory check' })).toBeVisible()
  // The plan mixes due reviews, a weak spot, the next topic to learn and the mock exam two days out.
  const plan = page.locator('.today-plan')
  await expect(plan.getByRole('link', { name: /^Review \d+ cards?/ })).toBeVisible()
  await expect(plan.getByRole('link', { name: /^Fix 1 weak spot/ })).toBeVisible()
  await expect(plan.getByRole('link', { name: /^Learn: / })).toBeVisible()
  await expect(plan.getByRole('link', { name: /^Mock exam: Midterm exam/ })).toBeVisible()
  await shot('today')

  await page.getByRole('button', { name: "Start today's session" }).click()
  await expect(page).toHaveURL(/#\/session/)
  await expect(page.getByRole('timer', { name: /Focus timer, .* running/ })).toBeVisible()
  await expect(page.getByText('Part 1 of 3 · Mixed review')).toBeVisible()
  await expect(page.getByText(/Card 1 of \d+/)).toBeVisible()
  await shot('session')

  // Part 2: a weak-spots quiz on the plan's weak topic, answered inline.
  await page.getByRole('button', { name: 'Skip this part' }).click()
  await expect(page.getByText(/^Part 2 of 3/)).toBeVisible()
  await page.getByRole('button', { name: 'Write my questions' }).click()
  const weakItems = page.locator('.quiz-sheet__item')
  await expect(weakItems.first()).toBeVisible()
  const weakCount = await weakItems.count()
  expect(weakCount).toBeGreaterThanOrEqual(6)
  for (let i = 0; i < weakCount; i += 1) {
    await answer(weakItems.nth(i))
    await weakItems.nth(i).getByRole('button', { name: 'Unsure', exact: true }).click()
  }
  await shot('session-weak-spots')
  await page.getByRole('button', { name: 'Check answers' }).click()
  await expect(page.getByText(new RegExp(`Score \\d+ / ${weakCount}`))).toBeVisible()
  await page.getByRole('button', { name: 'Continue to part 3: learn something new' }).click()

  // Part 3: the next topic to learn.
  await expect(page.getByRole('heading', { name: 'Learn something new' })).toBeVisible()
  await shot('session-learn')
  await page.getByRole('button', { name: 'End session' }).last().click()
  await expect(page.getByRole('heading', { name: "Today's plan" })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click()
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Weak topics/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Do you know what you think you know?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reviews due, next 7 days' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mistake log' })).toBeVisible()
  await expect(page.getByText('Correct answer').first()).toBeVisible()
  await shot('insights')

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByText(/demo/i).first()).toBeVisible()
  await shot('settings')

  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const settings = await invoke<{ theme: string }>('getSettings', [])
  expect(settings.theme).toBe('dark')
  await dismissToasts()
  await shot('settings-dark')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { name: "Today's plan" })).toBeVisible()
  await shot('today-dark')

  await go(`#/notebooks/${notebookId}`)
  await expect(page.getByRole('heading', { name: 'Data Structures', level: 1 })).toBeVisible()
  await shot('notebook-dark')

  await page.getByRole('link', { name: 'Stacks and queues', exact: true }).click()
  await page.getByRole('button', { name: /Step 2: Learn/ }).click()
  await expect(page.locator('.learn__sheet')).toBeVisible()
  await shot('topic-learn-dark')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click()
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible()
  await shot('insights-dark')
})

test("reviews a weak topic's flashcards from Insights", async () => {
  // The step before ended in dark mode; this one is shot in light, like the others.
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await dismissToasts()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click()
  const row = page.locator('.weak-topics__row', { has: page.getByRole('link', { name: /^Review cards for / }) }).first()
  await expect(row).toBeVisible()
  const title = (await row.locator('.weak-topics__title').textContent())!.trim()
  await row.getByRole('link', { name: `Review cards for ${title}` }).click()

  await expect(page).toHaveURL(/#\/review\?topic=[\w-]+$/)
  const topicId = page.url().split('topic=')[1]!
  await expect(page.getByRole('heading', { name: `Review: ${title}`, level: 1 })).toBeVisible()
  await expect(page.getByText(/Card 1 of \d+/)).toBeVisible()
  await expect(page.locator('.review-card__tags').getByText(title)).toBeVisible()
  await shot('review-weak-topic')

  // Grading goes through the normal review, even for a card that isn't due yet.
  const before = Date.now()
  await page.getByRole('button', { name: /^Sure/ }).click()
  await expect(page.getByRole('region', { name: 'Answer' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Good: .*, back in / })).toBeVisible()
  await page.getByRole('group', { name: 'How did you do?' }).scrollIntoViewIfNeeded()
  await shot('review-weak-topic-revealed')
  await page.getByRole('button', { name: /^Good:/ }).click()
  await expect(page.getByRole('region', { name: 'Answer' })).toBeHidden()
  const cards = await invoke<{ topicId: string | null; lastReview: string | null }[]>('listCards', [notebookId, topicId])
  expect(cards.filter((c) => c.lastReview !== null && Date.parse(c.lastReview) >= before - 1000)).toHaveLength(1)

  await page.locator('.page-header').getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await shot('topic-after-weak-review')
})
