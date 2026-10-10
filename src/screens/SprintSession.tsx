import { useEffect, useRef, useState } from 'react'
import { CardFace } from '../components/CardFace'
import { DonePanel, SessionChrome } from '../components/Session'
import { buildOptions, choiceLabel } from '../lib/answers'
import { recordPractice } from '../lib/db'
import { MODE_INFO } from '../modes'
import type { CardRow } from '../types'

function nextCard(pool: readonly CardRow[], previous?: string): CardRow {
  if (pool.length === 1) return pool[0]
  let card = pool[Math.floor(Math.random() * pool.length)]
  for (let guard = 0; guard < 6 && card.key === previous; guard += 1) {
    card = pool[Math.floor(Math.random() * pool.length)]
  }
  return card
}

export function SprintSession({ deckId, cards, onExit }: { deckId: string; cards: CardRow[]; onExit: () => void }) {
  const [left, setLeft] = useState(60)
  const [score, setScore] = useState(0)
  const [misses, setMisses] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [done, setDone] = useState(cards.length === 0)
  const [card, setCard] = useState(() => (cards.length ? nextCard(cards) : null))
  const [options, setOptions] = useState(() => (card ? buildOptions(card, cards) : []))
  const [picked, setPicked] = useState<string | null>(null)
  const endAt = useRef(Date.now() + 60_000)
  const lock = useRef(false)
  const info = MODE_INFO.sprint

  useEffect(() => {
    const timer = window.setInterval(() => {
      const remain = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000))
      setLeft((current) => (current === remain ? current : remain))
      if (remain <= 0) setDone(true)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  function deal(previous?: string) {
    const next = nextCard(cards, previous)
    setCard(next)
    setOptions(buildOptions(next, cards))
    setPicked(null)
    lock.current = false
  }

  function pick(option: string) {
    if (!card || done || lock.current || left <= 0) return
    lock.current = true
    const ok = option === choiceLabel(card)
    setPicked(option)
    void recordPractice(deckId, card.key, ok).catch(() => undefined)
    if (ok) {
      setScore((value) => value + 1)
      setStreak((value) => {
        const next = value + 1
        setBest((record) => Math.max(record, next))
        return next
      })
    } else {
      setMisses((value) => value + 1)
      setStreak(0)
    }
    window.setTimeout(() => {
      if (Date.now() >= endAt.current) {
        setDone(true)
        return
      }
      deal(card.key)
    }, ok ? 220 : 420)
  }

  const pickRef = useRef(pick)
  pickRef.current = pick

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onExit()
      if (['1', '2', '3', '4'].includes(event.key)) {
        const option = options[Number(event.key) - 1]
        if (option) pickRef.current(option)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit, options])

  if (cards.length === 0 || !card) {
    return (
      <SessionChrome title={info.title} detail="Pusta talia" onExit={onExit}>
        <DonePanel kicker="Sprint" title="Nie ma czego mierzyć" text="Zaimportuj talię z fiszkami." onExit={onExit} />
      </SessionChrome>
    )
  }

  if (done) {
    return (
      <SessionChrome title={info.title} detail="Czas minął" onExit={onExit}>
        <DonePanel
          kicker={`${score} trafień`}
          title={score >= 15 ? 'Szybko.' : 'Minuta za tobą.'}
          text={`Pomyłki: ${misses}. Najdłuższa seria: ${best}.`}
          onAgain={() => {
            endAt.current = Date.now() + 60_000
            setLeft(60)
            setScore(0)
            setMisses(0)
            setStreak(0)
            setBest(0)
            setDone(false)
            deal()
          }}
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  const correctLabel = choiceLabel(card)

  return (
    <SessionChrome title={info.title} detail={`${left} s · seria ${streak}`} hint={info.hint} onExit={onExit}>
      <div className="timebar" aria-hidden="true">
        <span style={{ width: `${(left / 60) * 100}%` }} />
      </div>
      <div className="sheet">
        <CardFace html={card.frontHtml || `<p>${card.frontText || 'Fiszka'}</p>`} css={card.css} deckId={deckId} />
      </div>
      <div className="choices">
        {options.map((option, index) => {
          const state = picked ? (option === correctLabel ? 'correct' : option === picked ? 'wrong' : '') : ''
          return (
            <button key={`${card.key}-${option}`} type="button" className={`choice ${state}`} onClick={() => pick(option)}>
              <span className="index">{index + 1}</span>
              {option}
            </button>
          )
        })}
      </div>
    </SessionChrome>
  )
}
