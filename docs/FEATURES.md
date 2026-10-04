# Study App: Feature Scope

_Agreed 2026-10-03 with Justine Paras._

## Who and where
- **User:** Justine only (computer science student). No accounts or multi-user features.
- **Platform:** Desktop app on Windows (Tauri or Electron).
- **Data:** Stored locally on the laptop.
- **AI engine:** Claude API by default (needs internet and an API key). A local model through Ollama is a possible later option. _Default picked by Claude, not yet confirmed by Justine._

## Design direction
Modern notebook look: clean and minimal (Notion / GoodNotes style) with physical-notebook touches.
- **Home:** a shelf/grid of subject notebooks shown as colored covers, each with a subject name and icon.
- **Inside a notebook:** a sidebar with tabs like notebook dividers (Files, Lessons, Quizzes, Flashcards, Exams, Notes, Weak topics).
- **Pages:** soft paper-white background with subtle dot-grid or lined-paper accents; content in clean cards.
- **Typography:** a modern sans-serif for body text, with an optional handwritten-style accent font for headings and highlights.
- **Color:** muted, calm palette with one accent color per subject; highlighter-style marks for key terms.
- **Light and dark mode** (dark mode as a "chalkboard/dark paper" variant).
- Smooth, subtle animations (page turns, card flips for flashcards).
_Interpretation by Claude of "modern notebook design"; to be refined with a mockup._

## Learning approach (core of the design)
The app is organized around how memory works, not around file types.
- **Today plan:** each day builds one session from three sources: cards about to be forgotten (spaced repetition), weak topics, and the next syllabus topic before an upcoming exam. Starting it also starts the Pomodoro.
- **Active recall everywhere:** you answer from memory before seeing anything; reading alone is never the end of a step.
- **Interleaving:** reviews and practice mix subjects and older topics.
- **Topics, not files:** each notebook lists topics extracted from the syllabus in course order, each with a mastery state (Not started, Learning, Weak, Reviewing, Mastered) and its next review date. Files are sources behind the topics.
- **Topic learning path:** 1) Warm-up (guess before learning), 2) Learn in small parts, each with a quick check before moving on, 3) Explain it in your own words (Feynman technique) with AI feedback on what's missing, 4) Mixed practice with a confidence rating per answer, 5) Remember: an automatic review schedule plus flashcards made from the lesson and your mistakes.
- **Confidence tracking:** every answer records Sure / Unsure / Guessing. Answers you were sure about but got wrong are flagged and come back first.
- **Insights:** weak topics across all subjects, confidence vs accuracy, reviews due in the next 7 days, and a mistake log (each mistake becomes a flashcard).
- **Exam readiness:** each upcoming exam shows a readiness percentage based on mastery of the topics it covers.

## Must-have (v1)
1. **Subject notebooks**: one notebook per subject; all material for that subject lives inside it.
2. **File upload**: PDF, PPTX, DOCX, and plain text (lessons, quizzes, exams, syllabus, slides). Text is extracted so the AI can use it.
3. **Lesson generator**: an in-depth lesson generated from one or more files in a notebook.
4. **Quiz generator**: choose question types (multiple choice, fill in the blanks, identification, true or false), number of questions, and difficulty. Grades answers and explains them.
5. **Flashcards**: AI-generated from files or written by hand, reviewed with spaced repetition.
6. **Mock exams**: timed exams that mix question types, based on the syllabus and past exams, with a score report.
7. **Notes and summaries**: personal notes plus AI summaries of each file.
8. **Pomodoro timer**: focus/break timer that logs study time per subject.
9. **Weak-topic tracking**: tags each quiz, flashcard, and mock exam question by topic, tracks accuracy per topic in each notebook, shows the weakest topics, and lets quizzes and flashcard reviews focus on them.

## Later ideas
- Chat with a notebook (ask questions about its files).
- Study planner that works back from exam dates in the syllabus.
- Code exercises for CS subjects (write and run code in the app).
- OCR for scanned PDFs and images.
- Export to Anki or PDF; backup and sync.
