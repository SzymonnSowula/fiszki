import { useEffect, useMemo, useState } from 'react'
import { listDecks, listProgress, deleteDeck } from '../lib/db'
import { revokeDeckMedia } from '../lib/mediaCache'
import { karty, summarize } from '../lib/stats'
import type { DeckRow, Progress } from '../types'

export function Library({
  revision,
  dragging,
  onFile,
  onOpen,
}: {
  revision: number
  dragging: boolean
  onFile: (file: File) => void
  onOpen: (deckId: string) => void
}) {
  const [decks, setDecks] = useState<DeckRow[] | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    Promise.all([listDecks(), listProgress()])
      .then(([nextDecks, nextProgress]) => {
        if (cancel) return
        setDecks(nextDecks)
        setProgress(nextProgress)
      })
      .catch(() => {
        if (!cancel) setError('Nie udało się odczytać zapisanych talii.')
      })
    return () => {
      cancel = true
    }
  }, [revision])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (decks ?? []).filter((deck) => deck.name.toLowerCase().includes(needle))
  }, [decks, query])

  async function remove(deckId: string) {
    await deleteDeck(deckId)
    revokeDeckMedia(deckId)
    setConfirmId(null)
    setDecks((current) => (current ?? []).filter((deck) => deck.id !== deckId))
    setProgress((current) => current.filter((row) => row.deckId !== deckId))
  }

  return (
    <div className="stack">
      <div className={dragging ? 'drop hot' : 'drop'}>
        <p className="kicker">Anki .apkg</p>
        <h1>Upuść tutaj paczkę z fiszkami</h1>
        <p className="lead">
          Plik zostaje w tej przeglądarce. Możesz wrócić do talii bez ponownego importu i odpalić fiszki albo inne ćwiczenia.
        </p>
        <label className="button primary">
          Wybierz plik
          <input
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (file) onFile(file)
            }}
          />
        </label>
      </div>

      {error ? <p className="banner bad">{error}</p> : null}

      {decks === null ? <p className="muted">Szukam zapisanych talii…</p> : null}

      {decks && decks.length > 0 ? (
        <section>
          <div className="section-head">
            <h2>Zapisane talie</h2>
            {decks.length > 3 ? (
              <input
                className="search"
                value={query}
                placeholder="Szukaj talii"
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : null}
          </div>
          <div className="deck-list">
            {shown.map((deck) => {
              const stats = summarize(
                deck.cardCount,
                progress.filter((row) => row.deckId === deck.id),
              )
              const learned = deck.cardCount === 0 ? 0 : Math.round(((deck.cardCount - stats.fresh) / deck.cardCount) * 100)
              return (
                <article key={deck.id} className="deck">
                  <button type="button" className="deck-open" onClick={() => onOpen(deck.id)}>
                    <span className="deck-name">{deck.name}</span>
                    <span className="muted">
                      {karty(deck.cardCount)}
                      {stats.due > 0 ? ` · ${stats.due} do powtórki` : ''}
                      {stats.fresh > 0 ? ` · ${stats.fresh} nowych` : ''}
                    </span>
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${learned}%` }} />
                    </span>
                  </button>
                  {confirmId === deck.id ? (
                    <div className="confirm">
                      <span>Usunąć tę talię z przeglądarki?</span>
                      <button type="button" className="button danger" onClick={() => void remove(deck.id)}>
                        Usuń
                      </button>
                      <button type="button" className="button ghost" onClick={() => setConfirmId(null)}>
                        Zostaw
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="text-button" onClick={() => setConfirmId(deck.id)}>
                      Usuń
                    </button>
                  )}
                </article>
              )
            })}
            {shown.length === 0 ? <p className="muted">Żadna talia nie pasuje do szukania.</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
