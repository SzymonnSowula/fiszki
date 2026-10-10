import { useEffect, useRef, useState } from 'react'
import { CardFace } from '../components/CardFace'
import { DonePanel, SessionChrome } from '../components/Session'
import { answerMatchesLine, shuffle } from '../lib/answers'
import { recordPractice } from '../lib/db'
import { MODE_INFO } from '../modes'
import type { CardRow } from '../types'

const ROUND = 10
const SECONDS = 30

function pinQueue(cards: readonly CardRow[]): CardRow[] {
  const usable = cards.filter((card) => card.lines.length >= 2 && (card.mediaName || card.frontHtml || card.frontText))
  return shuffle(usable).slice(0, Math.min(ROUND, usable.length))
}

export function PinsSession({ deckId, cards, onExit }: { deckId: string; cards: CardRow[]; onExit: () => void }) {
  const [queue, setQueue] = useState(() => pinQueue(cards))
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'ask' | 'result'>('ask')
  const [left, setLeft] = useState(SECONDS)
  const [latin, setLatin] = useState('')
  const [english, setEnglish] = useState('')
  const [latinOk, setLatinOk] = useState(false)
  const [englishOk, setEnglishOk] = useState(false)
  const [both, setBoth] = useState(0)
  const [latinHits, setLatinHits] = useState(0)
  const [englishHits, setEnglishHits] = useState(0)
  const endAt = useRef(Date.now() + SECONDS * 1000)
  const lock = useRef(false)
  const latinRef = useRef<HTMLInputElement>(null)
  const englishRef = useRef<HTMLInputElement>(null)
  const info = MODE_INFO.pins
  const card = queue[index]
  const finished = !card

  function armTimer() {
    endAt.current = Date.now() + SECONDS * 1000
    setLeft(SECONDS)
    lock.current = false
  }

  function openCard(nextIndex: number, nextQueue = queue) {
    setQueue(nextQueue)
    setIndex(nextIndex)
    setPhase('ask')
    setLatin('')
    setEnglish('')
    setLatinOk(false)
    setEnglishOk(false)
    armTimer()
  }

  function finish(current: CardRow, latinValue: string, englishValue: string) {
    if (lock.current) return
    lock.current = true
    const latinCorrect = answerMatchesLine(latinValue, current.lines[0] ?? '')
    const englishCorrect = answerMatchesLine(englishValue, current.lines[1] ?? '')
    setLatinOk(latinCorrect)
    setEnglishOk(englishCorrect)
    setPhase('result')
    if (latinCorrect) setLatinHits((count) => count + 1)
    if (englishCorrect) setEnglishHits((count) => count + 1)
    if (latinCorrect && englishCorrect) setBoth((count) => count + 1)
    void recordPractice(deckId, current.key, latinCorrect && englishCorrect).catch(() => undefined)
  }

  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (phase !== 'ask' || !card) return
    const timer = window.setInterval(() => {
      const remain = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000))
      setLeft((current) => (current === remain ? current : remain))
      if (remain <= 0) finishRef.current(card, latinRef.current?.value ?? '', englishRef.current?.value ?? '')
    }, 200)
    return () => window.clearInterval(timer)
  }, [phase, card])

  useEffect(() => {
    if (phase === 'ask') latinRef.current?.focus()
  }, [phase, card?.key])

  function restart() {
    const next = pinQueue(cards)
    setBoth(0)
    setLatinHits(0)
    setEnglishHits(0)
    openCard(0, next)
  }

  if (queue.length === 0) {
    return (
      <SessionChrome title={info.title} detail="Za mało nazw" onExit={onExit}>
        <DonePanel
          kicker="Szpilki"
          title="Brakuje łaciny i angielskiego"
          text="Do szpilek potrzeba kart z co najmniej dwiema nazwami."
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  if (finished) {
    return (
      <SessionChrome title={info.title} detail="Koniec rundy" onExit={onExit}>
        <DonePanel
          kicker={`${both} / ${queue.length}`}
          title={both === queue.length ? 'Komplet.' : 'Runda szpilek'}
          text={`Obie nazwy: ${both} z ${queue.length}. Łacina ${latinHits}, angielski ${englishHits}.`}
          onAgain={restart}
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  return (
    <SessionChrome title={info.title} detail={`${index + 1} / ${queue.length} · ${phase === 'ask' ? `${left} s` : 'wynik'}`} hint={info.hint} onExit={onExit}>
      <div className="timebar" aria-hidden="true">
        <span style={{ width: `${(left / SECONDS) * 100}%` }} />
      </div>
      <div className="sheet">
        <CardFace html={card.frontHtml || `<p>${card.frontText || 'Fiszka'}</p>`} css={card.css} deckId={deckId} />
        {phase === 'result' ? (
          <div className="pin-result">
            <p className={latinOk ? 'verdict good' : 'verdict bad'}>Łacina: {latinOk ? 'dobrze' : card.lines[0]}</p>
            <p className={englishOk ? 'verdict good' : 'verdict bad'}>Angielski: {englishOk ? 'dobrze' : card.lines[1]}</p>
          </div>
        ) : null}
      </div>
      {phase === 'ask' ? (
        <form
          className="pin-fields"
          onSubmit={(event) => {
            event.preventDefault()
            finish(card, latin, english)
          }}
        >
          <label>
            Łacina
            <input
              ref={latinRef}
              value={latin}
              autoComplete="off"
              onChange={(event) => setLatin(event.target.value)}
            />
          </label>
          <label>
            Angielski
            <input
              ref={englishRef}
              value={english}
              autoComplete="off"
              onChange={(event) => setEnglish(event.target.value)}
            />
          </label>
          <button type="submit" className="button primary">
            Sprawdź
          </button>
          <p className="hint">Po polsku nie liczy się. Zostaje {left} s.</p>
        </form>
      ) : (
        <button type="button" className="button primary wide" onClick={() => openCard(index + 1)}>
          Dalej
        </button>
      )}
    </SessionChrome>
  )
}
