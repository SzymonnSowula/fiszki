import { useEffect, useMemo, useRef, useState } from 'react'
import { CardFace, LineList } from '../components/CardFace'
import { DonePanel, SessionChrome } from '../components/Session'
import { answerMatches } from '../lib/answers'
import { putProgress, recordPractice } from '../lib/db'
import { isPlainAnswer } from '../lib/html'
import { exerciseFor, makePrompt } from '../lib/prompts'
import { buildBrowseQueue, buildPracticeQueue, buildSrsQueue } from '../lib/queue'
import { loadSettings, type Settings } from '../lib/settings'
import { applyGrade, blankProgress, formatDelay, nextDelays, scheduledDelay } from '../lib/srs'
import { MODE_INFO } from '../modes'
import type { CardRow, Grade, Mode, Progress } from '../types'

const GRADES: { id: Grade; label: string }[] = [
  { id: 'again', label: 'Znów' },
  { id: 'hard', label: 'Trudne' },
  { id: 'good', label: 'Dobrze' },
  { id: 'easy', label: 'Łatwo' },
]

function initialQueue(mode: Mode, cards: CardRow[], progress: Progress[], settings: Settings): CardRow[] {
  if (mode === 'srs') return buildSrsQueue(cards, progress, settings.newPerSession)
  if (mode === 'browse') return buildBrowseQueue(cards)
  return buildPracticeQueue(cards, settings.practiceSize)
}

function requeue<T>(items: readonly T[], at: number): T[] {
  if (items.length <= 1) return [...items]
  const [current, ...rest] = items
  rest.splice(Math.min(at, rest.length), 0, current)
  return rest
}

function tone(percent: number): string {
  if (percent >= 90) return 'Świetnie to wygląda.'
  if (percent >= 70) return 'Dobrze idzie.'
  if (percent >= 40) return 'Da się to jeszcze ułożyć w głowie.'
  return 'Spokojnie — kolejna runda to ogarnie.'
}

export function CardSession({
  deckId,
  mode,
  cards,
  progress,
  onExit,
}: {
  deckId: string
  mode: Mode
  cards: CardRow[]
  progress: Progress[]
  onExit: () => void
}) {
  const [settings] = useState(loadSettings)
  const boot = useRef<CardRow[] | null>(null)
  if (boot.current === null) boot.current = initialQueue(mode, cards, progress, settings)
  const [queue, setQueue] = useState(boot.current)
  const [total, setTotal] = useState(boot.current.length)
  const [phase, setPhase] = useState<'ask' | 'feedback'>('ask')
  const [picked, setPicked] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [verdict, setVerdict] = useState<boolean | null>(null)
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [visit, setVisit] = useState(0)
  const [grades, setGrades] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const progressRef = useRef(new Map(progress.map((row) => [row.key, row])))
  const attempts = useRef(new Map<string, number>())
  const inputRef = useRef<HTMLInputElement>(null)
  const info = MODE_INFO[mode]
  const card = queue[0]
  const exercise = exerciseFor(mode, visit)
  const prompt = useMemo(() => (card ? makePrompt(card, exercise, cards) : null), [card, exercise, cards])

  useEffect(() => {
    if (phase === 'ask' && exercise === 'type') inputRef.current?.focus()
  }, [phase, exercise, card?.key])

  function advance(nextQueue = queue.slice(1)) {
    setQueue(nextQueue)
    setPhase('ask')
    setPicked(null)
    setDraft('')
    setVerdict(null)
    setVisit((value) => value + 1)
  }

  function markPractice(ok: boolean) {
    if (!card || mode === 'srs' || mode === 'browse') return
    void recordPractice(deckId, card.key, ok).catch(() => undefined)
  }

  function reveal() {
    if (phase === 'ask') setPhase('feedback')
  }

  function count(ok: boolean) {
    setAnswered((value) => value + 1)
    if (ok) setCorrect((value) => value + 1)
  }

  function submitTyped() {
    if (!card || phase !== 'ask') return
    const ok = answerMatches(draft, card.lines.length ? card.lines : [card.frontText])
    setVerdict(ok)
    setPhase('feedback')
    count(ok)
    markPractice(ok)
  }

  function pickOption(option: string) {
    if (!prompt || phase !== 'ask') return
    const ok = option === prompt.correctOption
    setPicked(option)
    setVerdict(ok)
    setPhase('feedback')
    count(ok)
    markPractice(ok)
  }

  function answerTruth(value: boolean) {
    if (!prompt || phase !== 'ask') return
    const ok = value === prompt.truthful
    setVerdict(ok)
    setPhase('feedback')
    count(ok)
    markPractice(ok)
  }

  function selfGrade(ok: boolean) {
    count(ok)
    markPractice(ok)
    advance()
  }

  function grade(kind: Grade) {
    if (!card || phase !== 'feedback') return
    const previous = progressRef.current.get(card.key) ?? blankProgress(card.key, deckId)
    const againRepeat = kind === 'again' && (attempts.current.get(card.key) ?? 0) >= 1
    const next = applyGrade(previous, kind, Date.now(), againRepeat, settings)
    progressRef.current.set(card.key, next)
    void putProgress(next).catch(() => undefined)
    setGrades((current) => ({ ...current, [kind]: current[kind] + 1 }))
    count(kind === 'good' || kind === 'easy')
    if (kind === 'again' && (attempts.current.get(card.key) ?? 0) < 1) {
      attempts.current.set(card.key, 1)
      setQueue(requeue(queue, 2))
      setPhase('ask')
      setVerdict(null)
      return
    }
    advance()
  }

  function next() {
    if (mode === 'browse') count(true)
    advance()
  }

  function replay() {
    const nextQueue = initialQueue(mode, cards, [...progressRef.current.values()], settings)
    boot.current = nextQueue
    setQueue(nextQueue)
    setTotal(nextQueue.length)
    setPhase('ask')
    setPicked(null)
    setDraft('')
    setVerdict(null)
    setAnswered(0)
    setCorrect(0)
    setVisit(0)
    setGrades({ again: 0, hard: 0, good: 0, easy: 0 })
    attempts.current.clear()
  }

  const actions = useRef({ reveal, submitTyped, pickOption, answerTruth, grade, next })
  actions.current = { reveal, submitTyped, pickOption, answerTruth, grade, next }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card) return
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === 'Escape') {
        onExit()
        return
      }
      if (typing) return
      const api = actions.current
      if (event.key === ' ') event.preventDefault()
      if ((mode === 'srs' || mode === 'browse' || exercise === 'reveal') && phase === 'ask' && (event.key === ' ' || event.key === 'Enter')) {
        api.reveal()
        return
      }
      if (phase === 'feedback' && (event.key === 'Enter' || (event.key === ' ' && mode !== 'srs'))) {
        if (mode === 'srs') return
        if (mode === 'mixed' && exercise === 'reveal') return
        api.next()
        return
      }
      if (mode === 'srs' && phase === 'feedback' && ['1', '2', '3', '4'].includes(event.key)) {
        api.grade(GRADES[Number(event.key) - 1].id)
        return
      }
      if (exercise === 'quiz' && phase === 'ask' && ['1', '2', '3', '4'].includes(event.key)) {
        const option = prompt?.options[Number(event.key) - 1]
        if (option) api.pickOption(option)
      }
      if (exercise === 'tf' && phase === 'ask' && (event.key === '1' || event.key === 'p' || event.key === 'P')) api.answerTruth(true)
      if (exercise === 'tf' && phase === 'ask' && (event.key === '2' || event.key === 'f' || event.key === 'F')) api.answerTruth(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, exercise, mode, onExit, phase, prompt])

  if (!card && answered === 0) {
    return (
      <SessionChrome title={info.title} detail={`${cards.length} kart w talii`} onExit={onExit}>
        <DonePanel
          kicker="Plan"
          title="Na dziś wszystko powtórzone"
          text="Nie ma fiszek czekających na ocenę. Możesz przejrzeć talię albo odpalić quiz."
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  if (!card || !prompt) {
    const percent = answered === 0 ? 0 : Math.round((correct / answered) * 100)
    const gradeText = `Znów ${grades.again} · Trudne ${grades.hard} · Dobrze ${grades.good} · Łatwo ${grades.easy}`
    return (
      <SessionChrome title={info.title} detail="Koniec sesji" onExit={onExit}>
        <DonePanel
          kicker={mode === 'srs' ? `${answered} ocen` : mode === 'browse' ? `${answered} kart` : `${percent}%`}
          title={mode === 'browse' ? 'Koniec talii' : mode === 'srs' ? 'Sesja zapisana' : tone(percent)}
          text={
            mode === 'srs'
              ? `${gradeText}. Terminy kolejnych powtórek są już w tej przeglądarce.`
              : mode === 'browse'
                ? 'Oceny nie zostały ruszone.'
                : `${correct} z ${answered}.`
          }
          onAgain={replay}
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  const showLines = phase === 'feedback' && isPlainAnswer(card.answerHtml) && card.lines.length > 0
  const showHtml = phase === 'feedback' && !showLines && card.answerHtml.trim().length > 0
  const position = phase === 'ask' ? Math.min(answered + 1, Math.max(total, 1)) : Math.min(Math.max(answered, 1), Math.max(total, 1))
  const current = progressRef.current.get(card.key) ?? blankProgress(card.key, deckId)

  return (
    <SessionChrome
      title={info.title}
      detail={mode === 'srs' ? `Zostało ${queue.length}` : `${position} / ${total}`}
      hint={info.hint}
      onExit={onExit}
    >
      <div className="sheet">
        <CardFace html={card.frontHtml || `<p>${card.frontText || 'Fiszka'}</p>`} css={card.css} deckId={deckId} />
        {prompt.exercise === 'tf' ? <p className="statement">To jest: {prompt.statement}</p> : null}
        {showLines ? <LineList lines={card.lines} /> : null}
        {showHtml ? <CardFace html={card.answerHtml} css={card.css} deckId={deckId} /> : null}
        {phase === 'feedback' && verdict !== null ? (
          <p className={verdict ? 'verdict good' : 'verdict bad'}>
            {verdict ? 'Dobrze.' : `Chodziło o: ${card.lines.join(' · ') || prompt.correctOption}`}
          </p>
        ) : null}
      </div>

      {phase === 'ask' && prompt.exercise === 'reveal' ? (
        <button type="button" className="button primary wide" onClick={reveal}>
          Pokaż odpowiedź
        </button>
      ) : null}

      {prompt.exercise === 'quiz' ? (
        <div className="choices">
          {prompt.options.map((option, index) => {
            const state = phase === 'feedback' ? (option === prompt.correctOption ? 'correct' : option === picked ? 'wrong' : '') : ''
            return (
              <button key={`${card.key}-${option}`} type="button" className={`choice ${state}`} disabled={phase === 'feedback'} onClick={() => pickOption(option)}>
                <span className="index">{index + 1}</span>
                {option}
              </button>
            )
          })}
        </div>
      ) : null}

      {prompt.exercise === 'type' && phase === 'ask' ? (
        <form
          className="type-row"
          onSubmit={(event) => {
            event.preventDefault()
            submitTyped()
          }}
        >
          <input ref={inputRef} value={draft} placeholder="Wpisz nazwę" onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
          <button type="submit" className="button primary" disabled={draft.trim().length < 2}>
            Sprawdź
          </button>
        </form>
      ) : null}

      {prompt.exercise === 'tf' && phase === 'ask' ? (
        <div className="row">
          <button type="button" className="button primary" onClick={() => answerTruth(true)}>
            Prawda
          </button>
          <button type="button" className="button ghost" onClick={() => answerTruth(false)}>
            Fałsz
          </button>
        </div>
      ) : null}

      {phase === 'feedback' && mode === 'srs' ? (
        <div className="grades">
          {GRADES.map((item) => (
            <button key={item.id} type="button" className={`grade ${item.id}`} onClick={() => grade(item.id)}>
              <span>{item.label}</span>
              <small>
                {formatDelay(nextDelays(scheduledDelay(current), (attempts.current.get(card.key) ?? 0) >= 1, settings)[item.id])}
              </small>
            </button>
          ))}
        </div>
      ) : null}

      {phase === 'feedback' && mode === 'mixed' && prompt.exercise === 'reveal' ? (
        <div className="row">
          <button type="button" className="button primary" onClick={() => selfGrade(true)}>
            Znam
          </button>
          <button type="button" className="button ghost" onClick={() => selfGrade(false)}>
            Nie znam
          </button>
        </div>
      ) : null}

      {phase === 'feedback' && mode !== 'srs' && !(mode === 'mixed' && prompt.exercise === 'reveal') ? (
        <button type="button" className="button primary wide" onClick={next}>
          Dalej
        </button>
      ) : null}
    </SessionChrome>
  )
}
