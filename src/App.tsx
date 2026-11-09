import { useEffect, useRef, useState } from 'react'
import { saveImported } from './lib/db'
import { FORMATS_LABEL, fileKind } from './lib/formats'
import { revokeDeckMedia } from './lib/mediaCache'
import { karty } from './lib/stats'
import type { Mode } from './types'
import { DeckHome } from './screens/DeckHome'
import { Library } from './screens/Library'
import { ParserScreen } from './screens/ParserScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Study } from './screens/Study'

type Screen =
  | { name: 'library' }
  | { name: 'deck'; deckId: string }
  | { name: 'study'; deckId: string; mode: Mode }
  | { name: 'settings'; back: Screen }
  | { name: 'parser'; back: Screen }

function waitPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 30))
  })
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [revision, setRevision] = useState(0)
  const screenRef = useRef(screen)
  const importingRef = useRef(importing)
  screenRef.current = screen
  importingRef.current = importing

  async function handleFile(file: File) {
    if (importingRef.current) return
    if (!fileKind(file.name)) {
      setError(`Ten format nie jest obsługiwany. Wybierz plik: ${FORMATS_LABEL}.`)
      return
    }
    if (file.size > 250 * 1024 * 1024) {
      setError('Plik jest za duży. Limit to 250 MB.')
      return
    }
    setError(null)
    setNotice(null)
    setImporting('Otwieram plik…')
    try {
      await waitPaint()
      const { parseFile } = await import('./lib/importers')
      const parsed = await parseFile(file, setImporting)
      if (parsed.length === 0) {
        throw new Error(
          fileKind(file.name) === 'apkg'
            ? 'W tej paczce nie ma fiszek.'
            : 'Nie znalazłem w pliku par pytanie–odpowiedź. Najlepiej działa tabela (pytanie w 1. kolumnie, odpowiedź w 2.) albo linie „pojęcie - definicja”.',
        )
      }
      setImporting('Zapisuję talię w przeglądarce…')
      await waitPaint()
      const ids = await saveImported(parsed, file.name)
      ids.forEach(revokeDeckMedia)
      const count = parsed.reduce((sum, deck) => sum + deck.cards.length, 0)
      setNotice(parsed.length === 1 ? `Zapisano: ${parsed[0].name} (${karty(count)}).` : `Zapisano talie: ${parsed.length}, razem ${karty(count)}.`)
      setRevision((value) => value + 1)
      setScreen(parsed.length === 1 ? { name: 'deck', deckId: ids[0] } : { name: 'library' })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Nie udało się wczytać tego pliku.'
      setError(message)
    } finally {
      setImporting(null)
    }
  }

  const onFileRef = useRef(handleFile)
  onFileRef.current = handleFile

  useEffect(() => {
    function over(event: DragEvent) {
      if (!event.dataTransfer?.types?.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    }
    function leave(event: DragEvent) {
      if (event.clientX === 0 && event.clientY === 0) setDragging(false)
    }
    function drop(event: DragEvent) {
      event.preventDefault()
      setDragging(false)
      const place = screenRef.current.name
      if (place === 'study' || place === 'parser' || importingRef.current) return
      const file = event.dataTransfer?.files?.[0]
      if (file) void onFileRef.current(file)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <div className={dragging ? 'app dragging' : 'app'}>
      <header className="top">
        <div className="shell bar">
          <button
            type="button"
            className="brand"
            onClick={() => {
              document.title = 'Fiszki'
              setScreen({ name: 'library' })
            }}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <rect x="8" y="5" width="16" height="18" rx="3" fill="#f4efe6" />
              <rect x="5" y="9" width="16" height="18" rx="3" fill="#e07a3d" />
            </svg>
            <span className="wordmark">Fiszki</span>
          </button>
          <div className="bar-end">
            <span className="muted brand-note">lokalnie, z Anki, PDF, CSV…</span>
            {screen.name !== 'study' ? (
              <nav className="nav" aria-label="Menu">
                <button
                  type="button"
                  className={screen.name === 'parser' ? 'button ghost settings-button active' : 'button ghost settings-button'}
                  aria-current={screen.name === 'parser' ? 'page' : undefined}
                  onClick={() => screen.name !== 'parser' && setScreen({ name: 'parser', back: screen })}
                >
                  Parser Anki
                </button>
                <button
                  type="button"
                  className={screen.name === 'settings' ? 'button ghost settings-button active' : 'button ghost settings-button'}
                  aria-current={screen.name === 'settings' ? 'page' : undefined}
                  onClick={() => screen.name !== 'settings' && setScreen({ name: 'settings', back: screen })}
                >
                  Ustawienia
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      </header>
      <main className="shell">
        {notice ? <p className="notice">{notice}</p> : null}
        {error ? <p className="banner bad">{error}</p> : null}
        {screen.name === 'library' ? (
          <Library revision={revision} dragging={dragging} onFile={(file) => void handleFile(file)} onOpen={(deckId) => setScreen({ name: 'deck', deckId })} />
        ) : null}
        {screen.name === 'deck' ? (
          <DeckHome
            deckId={screen.deckId}
            revision={revision}
            onBack={() => setScreen({ name: 'library' })}
            onStudy={(mode) => {
              setNotice(null)
              setScreen({ name: 'study', deckId: screen.deckId, mode })
            }}
            onDeleted={() => {
              setRevision((value) => value + 1)
              setScreen({ name: 'library' })
            }}
          />
        ) : null}
        {screen.name === 'settings' ? <SettingsScreen onBack={() => setScreen(screen.back)} /> : null}
        {screen.name === 'parser' ? (
          <ParserScreen
            onBack={() => setScreen(screen.back)}
            onSaved={(deckId, message) => {
              setNotice(message)
              setRevision((value) => value + 1)
              setScreen({ name: 'deck', deckId })
            }}
          />
        ) : null}
        {screen.name === 'study' ? (
          <Study deckId={screen.deckId} mode={screen.mode} onExit={() => setScreen({ name: 'deck', deckId: screen.deckId })} />
        ) : null}
      </main>
      {importing ? (
        <div className="overlay" role="status">
          <div className="panel">
            <div className="spinner" />
            <p>{importing}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
