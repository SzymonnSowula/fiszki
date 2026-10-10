import { useMemo, useState } from 'react'
import { CardFace } from '../components/CardFace'
import { DonePanel, SessionChrome } from '../components/Session'
import { latinEnglishLabel, shuffle } from '../lib/answers'
import { recordPractice } from '../lib/db'
import { MODE_INFO } from '../modes'
import type { CardRow } from '../types'

interface PairItem {
  key: string
  label: string
  frontText: string
  mediaName: string | null
  css: string
}

function roundsOf(cards: readonly CardRow[], size = 5): PairItem[][] {
  const seen = new Set<string>()
  const unique: PairItem[] = []
  for (const card of shuffle(cards)) {
    const label = latinEnglishLabel(card)
    const id = label.toLowerCase()
    if (!label || label === '—' || seen.has(id)) continue
    if (!card.mediaName && !card.frontText) continue
    seen.add(id)
    unique.push({
      key: card.key,
      label,
      frontText: card.frontText,
      mediaName: card.mediaName,
      css: card.css,
    })
  }
  const rounds: PairItem[][] = []
  for (let i = 0; i < unique.length && rounds.length < 3; i += size) {
    const slice = unique.slice(i, i + size)
    if (slice.length >= 2) rounds.push(slice)
  }
  return rounds
}

export function PairsSession({ deckId, cards, onExit }: { deckId: string; cards: CardRow[]; onExit: () => void }) {
  const [game, setGame] = useState(() => roundsOf(cards))
  const [round, setRound] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [matched, setMatched] = useState<string[]>([])
  const [wrong, setWrong] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState(0)
  const [solved, setSolved] = useState(0)
  const items = game[round] ?? []
  const labels = useMemo(() => shuffle(items), [items])
  const info = MODE_INFO.pairs

  function restart() {
    setGame(roundsOf(cards))
    setRound(0)
    setSelected(null)
    setMatched([])
    setWrong(null)
    setMistakes(0)
    setSolved(0)
  }

  function chooseLabel(key: string) {
    if (!selected || matched.includes(key)) return
    if (key === selected) {
      const next = [...matched, key]
      setMatched(next)
      setSelected(null)
      setWrong(null)
      setSolved((count) => count + 1)
      void recordPractice(deckId, key, true).catch(() => undefined)
      return
    }
    setWrong(key)
    setMistakes((count) => count + 1)
    setSelected(null)
    void recordPractice(deckId, selected, false).catch(() => undefined)
    window.setTimeout(() => setWrong((current) => (current === key ? null : current)), 450)
  }

  const roundCleared = items.length > 0 && matched.length === items.length
  const finished = game.length === 0 || (roundCleared && round === game.length - 1)

  if (game.length === 0) {
    return (
      <SessionChrome title={info.title} detail="Za mało różnych kart" onExit={onExit}>
        <DonePanel kicker="Pary" title="Ta talia nie złoży się w pary" text="Potrzeba co najmniej dwóch kart z różnymi nazwami." onExit={onExit} />
      </SessionChrome>
    )
  }

  if (finished && roundCleared) {
    return (
      <SessionChrome title={info.title} detail="Koniec" onExit={onExit}>
        <DonePanel
          kicker={`${solved} par`}
          title={mistakes === 0 ? 'Czysto.' : 'Ułożone.'}
          text={mistakes === 0 ? 'Żadnej pomyłki.' : `Pomyłki: ${mistakes}.`}
          onAgain={restart}
          onExit={onExit}
        />
      </SessionChrome>
    )
  }

  return (
    <SessionChrome title={info.title} detail={`Runda ${round + 1} / ${game.length}`} hint={info.hint} onExit={onExit}>
      <div className="pair-grid">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pair-card ${selected === item.key ? 'selected' : ''} ${matched.includes(item.key) ? 'matched' : ''}`}
            onClick={() => setSelected(item.key)}
            disabled={matched.includes(item.key)}
          >
            {item.mediaName ? (
              <CardFace html={`<img alt="" src="anki-media:${encodeURIComponent(item.mediaName)}">`} css={item.css} deckId={deckId} />
            ) : (
              <p>{item.frontText || 'Fiszka'}</p>
            )}
          </button>
        ))}
      </div>
      <div className="choices">
        {labels.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`choice ${matched.includes(item.key) ? 'correct' : ''} ${wrong === item.key ? 'wrong' : ''}`}
            disabled={matched.includes(item.key)}
            onClick={() => chooseLabel(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {roundCleared && round < game.length - 1 ? (
        <button
          type="button"
          className="button primary wide"
          onClick={() => {
            setRound((value) => value + 1)
            setMatched([])
            setSelected(null)
          }}
        >
          Następna piątka
        </button>
      ) : null}
    </SessionChrome>
  )
}
