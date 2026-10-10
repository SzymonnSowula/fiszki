import { useEffect, useState } from 'react'
import { cardsFor, getDeck, progressFor } from '../lib/db'
import { revokeDeckMedia } from '../lib/mediaCache'
import { MODE_INFO } from '../modes'
import type { CardRow, Mode, Progress } from '../types'
import { CardSession } from './CardSession'
import { PairsSession } from './PairsSession'
import { PinsSession } from './PinsSession'
import { SprintSession } from './SprintSession'

export function Study({
  deckId,
  mode,
  onExit,
}: {
  deckId: string
  mode: Mode
  onExit: () => void
}) {
  const [cards, setCards] = useState<CardRow[] | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    Promise.all([getDeck(deckId), cardsFor(deckId), progressFor(deckId)])
      .then(([deck, nextCards, nextProgress]) => {
        if (cancel) return
        if (!deck) {
          setError('Nie ma takiej talii.')
          return
        }
        document.title = `${MODE_INFO[mode].title} · ${deck.name}`
        setCards(nextCards)
        setProgress(nextProgress)
      })
      .catch(() => {
        if (!cancel) setError('Nie udało się otworzyć fiszek.')
      })
    return () => {
      cancel = true
      document.title = 'Fiszki'
      revokeDeckMedia(deckId)
    }
  }, [deckId, mode])

  if (error) {
    return (
      <div className="stack">
        <p className="banner bad">{error}</p>
        <button type="button" className="button ghost" onClick={onExit}>
          Wróć
        </button>
      </div>
    )
  }

  if (!cards) return <p className="muted">Układam fiszki…</p>

  if (mode === 'pairs') return <PairsSession deckId={deckId} cards={cards} onExit={onExit} />
  if (mode === 'pins') return <PinsSession deckId={deckId} cards={cards} onExit={onExit} />
  if (mode === 'sprint') return <SprintSession deckId={deckId} cards={cards} onExit={onExit} />
  return <CardSession deckId={deckId} mode={mode} cards={cards} progress={progress} onExit={onExit} />
}
