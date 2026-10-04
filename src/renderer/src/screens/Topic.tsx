import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { BookOpen, RefreshCw } from 'lucide-react'
import type { ID, PathStep } from '@shared/types'
import { AiWorking } from '../components/AiWorking'
import { ErrorNotice } from '../components/ErrorNotice'
import { MasteryPill } from '../components/MasteryPill'
import { useStoredState } from '../components/quiz/useStoredState'
import { ExplainStep } from '../components/topic/ExplainStep'
import { KeyTermsRail } from '../components/topic/KeyTermsRail'
import { LearnStep } from '../components/topic/LearnStep'
import { LessonStart } from '../components/topic/LessonStart'
import { NotesRail } from '../components/topic/NotesRail'
import { PracticeStep } from '../components/topic/PracticeStep'
import { RememberStep } from '../components/topic/RememberStep'
import { SourcesRail } from '../components/topic/SourcesRail'
import { Stepper } from '../components/topic/Stepper'
import {
  initialChunk,
  lessonAnswersStorageKey,
  parseInstantAnswers,
  resolveStep,
  shouldPersistChunk,
  shouldPersistStep,
  type InstantAnswer,
  type InstantAnswers
} from '../components/topic/topicModel'
import { WarmupStep } from '../components/topic/WarmupStep'
import { BackLink, Button, EmptyState, LoadingBlock, Menu, Page, PageHeader, useConfirm } from '../components/ui'
import { isApiError } from '../lib/api'
import { formatMinutes, PATH_STEP_LABELS } from '../lib/format'
import { usePomodoroNotebook } from '../lib/pomodoro'
import { queryKeys, useApiMutation, useLesson, useNotebook, useTopic } from '../lib/queries'
import { ROUTES } from '../lib/routes'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import './Topic.css'

const EMPTY_ANSWERS: InstantAnswers = {}

function scrollPageToTop() {
  // Only <main> scrolls (see App.tsx), and it is reset on path changes, not on ?step= changes.
  document.getElementById('main')?.scrollTo({ top: 0 })
}

/** A topic's 5-step learning path: warm-up, learn, explain it, practice, remember. */
export default function TopicScreen() {
  const { topicId } = useParams()
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const topic = useTopic(topicId)
  const lesson = useLesson(topicId)
  const notebookId = topic.data?.notebookId
  const notebook = useNotebook(notebookId)
  usePomodoroNotebook(notebookId)
  useDocumentTitle(topic.data?.title ?? 'Topic')

  const generate = useApiMutation('generateLesson')
  const { mutate: persistStep } = useApiMutation('setTopicStep', {
    invalidate: [
      queryKeys.topic(topicId ?? ''),
      queryKeys.topics(notebookId ?? ''),
      queryKeys.notebook(notebookId ?? ''),
      queryKeys.notebooks(),
      queryKeys.today()
    ]
  })

  const lessonData = lesson.data ?? null
  const [answers, setAnswers] = useStoredState<InstantAnswers>(
    lessonData ? lessonAnswersStorageKey(lessonData.id) : null,
    EMPTY_ANSWERS,
    parseInstantAnswers
  )
  const recordInstant = useCallback(
    (key: string, answer: InstantAnswer) => setAnswers((current) => ({ ...current, [key]: answer })),
    [setAnswers]
  )
  const [chunkState, setChunkState] = useState<{ lessonId: ID; index: number } | null>(null)
  // Set when the learner continues from Practice, so Remember starts on its own.
  const [autoFinish, setAutoFinish] = useState(false)

  const current = topic.data
  const step = current ? resolveStep(params.get('step'), current.pathStep) : null
  const chunkCount = lessonData?.content.chunks.length ?? 0
  const chunkIndex =
    lessonData && chunkState?.lessonId === lessonData.id
      ? chunkState.index
      : initialChunk(current?.pathStep ?? null, current?.chunkIndex ?? 0, chunkCount)

  // Save forward progress so the notebook's "Continue" (and a later visit) resumes here.
  const persistedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!current || !lessonData || !step || !shouldPersistStep(step, current.pathStep)) return
    const key = `${current.id}:${step}`
    if (persistedRef.current === key) return
    persistedRef.current = key
    persistStep([current.id, step, step === 'learn' ? chunkIndex : undefined])
  }, [current, lessonData, step, chunkIndex, persistStep])

  const goTo = useCallback(
    (next: PathStep) => {
      setParams({ step: next })
      scrollPageToTop()
    },
    [setParams]
  )

  const changeChunk = (index: number) => {
    if (!current || !lessonData) return
    setChunkState({ lessonId: lessonData.id, index })
    if (shouldPersistChunk(current.pathStep)) persistStep([current.id, 'learn', index])
  }

  const regenerate = async () => {
    if (!current) return
    const ok = await confirm({
      title: 'Write a new lesson?',
      message:
        "The lesson is written again from your files, with new parts and questions. Your place in the learning path, your notes and your flashcards stay as they are.",
      confirmLabel: 'Write a new lesson'
    })
    if (ok) generate.mutate([current.id, { regenerate: true }])
  }

  if (topic.isPending) {
    return (
      <Page width="wide">
        <LoadingBlock label="Opening the topic…" />
      </Page>
    )
  }

  if (topic.error || !current || !step) {
    const gone = isApiError(topic.error) && topic.error.code === 'NOT_FOUND'
    return (
      <Page width="narrow">
        <BackLink to={ROUTES.notebooks}>Notebooks</BackLink>
        {gone ? (
          <EmptyState
            kicker="this page was torn out"
            title="This topic doesn't exist anymore"
            action={
              <Button to={ROUTES.notebooks} icon={<BookOpen size={16} aria-hidden="true" />}>
                Back to notebooks
              </Button>
            }
          >
            It may have been deleted from its notebook.
          </EmptyState>
        ) : (
          <ErrorNotice error={topic.error} onRetry={() => void topic.refetch()} title="This topic couldn't be opened" />
        )}
      </Page>
    )
  }

  const meta = [current.unitLabel, lessonData ? `about ${formatMinutes(lessonData.content.estMinutes)}` : null].filter(Boolean).join(' · ')

  let main: ReactNode
  if (lesson.isPending) {
    main = <LoadingBlock label="Opening your lesson…" />
  } else if (lesson.error) {
    main = <ErrorNotice error={lesson.error} onRetry={() => void lesson.refetch()} title="Your lesson couldn't be opened" />
  } else if (!lessonData) {
    main = <LessonStart topic={current} onGenerate={() => generate.mutate([current.id])} pending={generate.isPending} error={generate.error} />
  } else if (generate.isPending) {
    main = <AiWorking task="lesson" title={`Writing a new lesson on ${current.title}`} />
  } else {
    const content: Record<PathStep, ReactNode> = {
      warmup: <WarmupStep topic={current} lesson={lessonData} answers={answers} onAnswer={recordInstant} onNext={() => goTo('learn')} />,
      learn: (
        <LearnStep
          topic={current}
          lesson={lessonData}
          chunkIndex={chunkIndex}
          onChunkChange={changeChunk}
          answers={answers}
          onAnswer={recordInstant}
          onBack={() => goTo('warmup')}
          onFinish={() => goTo('explain')}
        />
      ),
      explain: <ExplainStep key={lessonData.id} topic={current} lesson={lessonData} onNext={() => goTo('practice')} />,
      practice: (
        <PracticeStep
          topic={current}
          onContinue={() => {
            setAutoFinish(true)
            goTo('remember')
          }}
        />
      ),
      remember: <RememberStep key={`${lessonData.id}-${autoFinish}`} topic={current} autoStart={autoFinish} />
    }
    main = (
      <>
        <ErrorNotice error={generate.error} onRetry={() => generate.mutate([current.id, { regenerate: true }])} title="A new lesson couldn't be written" compact />
        {content[step]}
      </>
    )
  }

  return (
    <Page width="wide" className="topic-page">
      <PageHeader
        before={
          <div className="topic-page__top">
            <BackLink to={ROUTES.notebook(current.notebookId)}>{notebook.data?.name ?? 'Notebook'}</BackLink>
            <MasteryPill state={current.progress.state} mastery={current.progress.mastery} size="md" />
          </div>
        }
        title={current.title}
        description={meta || undefined}
        actions={
          lessonData && !generate.isPending ? (
            <Menu
              label={`Lesson actions for ${current.title}`}
              variant="subtle"
              size="md"
              items={[{ label: 'Write a new lesson', icon: <RefreshCw size={16} aria-hidden="true" />, onSelect: () => void regenerate() }]}
            />
          ) : undefined
        }
      />

      <Stepper current={step} pathStep={current.pathStep} onSelect={goTo} />

      <div className="split">
        <section className="split__main topic-page__main" aria-label={PATH_STEP_LABELS[step].label}>
          {main}
        </section>
        <aside className="split__side topic-page__side" aria-label="About this topic">
          <KeyTermsRail terms={lessonData?.content.keyTerms ?? null} />
          <SourcesRail sources={lessonData?.content.sourcesUsed ?? null} />
          <NotesRail notebookId={current.notebookId} topicId={current.id} />
        </aside>
      </div>
    </Page>
  )
}
