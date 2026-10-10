import { useEffect, useState } from 'react'
import { cardsFor, deleteDeck, getDeck, progressFor, resetProgress } from '../lib/db'
import { revokeDeckMedia } from '../lib/mediaCache'
import { NEW_LIMIT } from '../lib/queue'
import { karty, summarize, type DeckStats } from '../lib/stats'
import { STUDY_MODES } from '../modes'
import type { DeckRow, Mode } from '../types'

export function DeckHome({
  deckId,
  revision,
  onBack,
  onStudy,
  onDeleted,
}: {
  deckId: string
  revision: number
  onBack: () => void
  onStudy: (mode: Mode) => void
  onDeleted: () => void
}) {
  const [deck, setDeck] = useState<DeckRow | null>(null)
  const [stats, setStats] = useState<DeckStats | null>(null)
  const [missing, setMissing] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null)

  useEffect(() => {
    let cancel = false
    Promise.all([getDeck(deckId), cardsFor(deckId), progressFor(deckId)])
      .then(([row, cards, progress]) => {
        if (cancel) return
        if (!row) {
          setMissing(true)
          return
        }
        setDeck(row)
        setStats(summarize(cards.length || row.cardCount, progress))
        document.title = `${row.name} · Fiszki`
      })
      .catch(() => {
        if (!cancel) setMissing(true)
      })
    return () => {
      cancel = true
      document.title = 'Fiszki'
    }
  }, [deckId, revision])

  if (missing) {
    return (
      <div className="stack">
        <p>Nie znalazłem tej talii.</p>
        <button type="button" className="button ghost" onClick={onBack}>
          Wróć
        </button>
      </div>
    )
  }

  if (!deck || !stats) return <p className="muted">Otwieram talię…</p>

  const sessionCount = stats.due + Math.min(NEW_LIMIT, stats.fresh)
  const accuracy = stats.practiceSeen === 0 ? null : Math.round((stats.practiceCorrect / stats.practiceSeen) * 100)

  return (
    <div className="stack">
      <button type="button" className="text-button back" onClick={onBack}>
        Wszystkie talie
      </button>
      <header className="deck-hero">
        <p className="kicker">Talia</p>
        <h1>{deck.name}</h1>
        <p className="lead">
          {karty(stats.total)}
          {sessionCount > 0 ? ` · teraz wejdzie ${sessionCount}` : ' · powtórki na dziś zrobione'}
          {accuracy !== null ? ` · ćwiczenia ${accuracy}%` : ''}
        </p>
        <button type="button" className="button primary" onClick={() => onStudy(sessionCount > 0 ? 'srs' : 'browse')}>
          {sessionCount > 0 ? 'Mądre uczenie' : 'Przeglądaj talię'}
        </button>
      </header>

      <div className="modes">
        {STUDY_MODES.map((mode) => (
          <button key={mode.id} type="button" className="mode" onClick={() => onStudy(mode.id)}>
            <span className="mode-title">{mode.title}</span>
            <span className="muted">{mode.text}</span>
          </button>
        ))}
      </div>

      <div className="row quiet">
        <button type="button" className="text-button" onClick={() => onStudy('browse')}>
          Przeglądaj bez ocen
        </button>
        {confirm === 'reset' ? (
          <>
            <span className="muted">Wyczyścić terminy powtórek?</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void resetProgress(deckId).then(() => {
                  setConfirm(null)
                  setStats(summarize(stats.total, []))
                })
              }}
            >
              Wyczyść
            </button>
            <button type="button" className="text-button" onClick={() => setConfirm(null)}>
              Anuluj
            </button>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => setConfirm('reset')}>
            Resetuj postęp
          </button>
        )}
        {confirm === 'delete' ? (
          <>
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => {
                void deleteDeck(deckId).then(() => {
                  revokeDeckMedia(deckId)
                  onDeleted()
                })
              }}
            >
              Usuń na pewno
            </button>
            <button type="button" className="text-button" onClick={() => setConfirm(null)}>
              Zostaw
            </button>
          </>
        ) : (
          <button type="button" className="text-button danger-text" onClick={() => setConfirm('delete')}>
            Usuń talię
          </button>
        )}
      </div>
    </div>
  )
}
