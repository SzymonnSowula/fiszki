import { useEffect, useRef, useState } from 'react'
import { saveImported } from './lib/db'
import { revokeDeckMedia } from './lib/mediaCache'
import { karty } from './lib/stats'
import type { Mode } from './types'
import { DeckHome } from './screens/DeckHome'
import { Library } from './screens/Library'
import { Study } from './screens/Study'

type Screen = { name: 'library' } | { name: 'deck'; deckId: string } | { name: 'study'; deckId: string; mode: Mode }

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
    if (!file.name.toLowerCase().endsWith('.apkg')) {
      setError('Wybierz plik .apkg wyeksportowany z Anki.')
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
      const [{ parseApkg }, { loadSql }] = await Promise.all([import('./lib/apkg'), import('./lib/sql')])
      const sql = await loadSql()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await parseApkg(bytes, sql, { fileName: file.name, onProgress: setImporting })
      if (parsed.length === 0) throw new Error('W tej paczce nie ma fiszek.')
      setImporting('Zapisuję talię w przeglądarce…')
      await waitPaint()
      const ids = await saveImported(parsed, file.name)
      ids.forEach(revokeDeckMedia)
      const count = parsed.reduce((sum, deck) => sum + deck.cards.length, 0)
      setNotice(parsed.length === 1 ? `Zapisano: ${parsed[0].name} (${karty(count)}).` : `Zapisano talie: ${parsed.length}, razem ${karty(count)}.`)
      setRevision((value) => value + 1)
      setScreen(parsed.length === 1 ? { name: 'deck', deckId: ids[0] } : { name: 'library' })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Nie udało się wczytać tej paczki.'
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
      if (place === 'study' || importingRef.current) return
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
          <span className="muted brand-note">lokalnie, z pliku .apkg</span>
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
