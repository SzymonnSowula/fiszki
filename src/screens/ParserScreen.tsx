import { useMemo, useRef, useState } from 'react'
import { saveImported } from '../lib/db'
import { ACCEPT, fileKind } from '../lib/formats'
import type { StrategyId } from '../lib/pdfLayout'
import { karty } from '../lib/stats'
import type { Rows } from '../lib/tabular'

interface Draft {
  id: number
  front: string
  back: string
}

interface Option {
  id: StrategyId | 'file'
  label: string
  hint: string
  rows: Rows
}

const PAGE = 60

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Fiszki'
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function toHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, '<br>')
}

function htmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n')
  return (div.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

let nextId = 1
function toDrafts(rows: Rows): Draft[] {
  return rows
    .map((row) => {
      const [front = '', ...rest] = row.map((cell) => cell.trim())
      return { id: nextId++, front, back: rest.filter(Boolean).join('\n') }
    })
    .filter((draft) => draft.front || draft.back)
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer],{ type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ParserScreen({ onBack, onSaved }: { onBack: () => void; onSaved: (deckId: string, message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [chosen, setChosen] = useState<Option['id'] | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [deckName, setDeckName] = useState('')
  const [tags, setTags] = useState('')
  const [reversed, setReversed] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [hot, setHot] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const edited = useRef(false)

  const complete = useMemo(() => drafts.filter((draft) => draft.front.trim() && draft.back.trim()), [drafts])

  async function load(file: File) {
    const kind = fileKind(file.name)
    if (!kind) {
      setError('Wybierz plik PDF (albo CSV, Excel, Word, TXT, JSON, .apkg).')
      return
    }
    setError(null)
    setDone(null)
    setBusy('Otwieram plik…')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let found: Option[] = []
      if (kind === 'pdf') {
        const [{ extractPdfPages }, { pdfStrategies }, { linesToRows }] = await Promise.all([
          import('../lib/pdf'),
          import('../lib/pdfLayout'),
          import('../lib/tabular'),
        ])
        const pages = await extractPdfPages(bytes, setBusy)
        setBusy('Szukam pytań i odpowiedzi…')
        await new Promise((resolve) => setTimeout(resolve, 20))
        found = pdfStrategies(pages, linesToRows)
      } else {
        const { parseFile } = await import('../lib/importers')
        const decks = await parseFile(file, setBusy)
        const rows = decks.flatMap((deck) => deck.cards.map((card) => [htmlToText(card.frontHtml), htmlToText(card.answerHtml)]))
        if (rows.length) found = [{ id: 'file', label: 'Z pliku', hint: 'Fiszki odczytane tak jak przy zwykłym imporcie.', rows }]
      }
      if (found.length === 0) throw new Error('Nie znalazłem w tym pliku tekstu, z którego da się zrobić fiszki (to może być skan albo same obrazy).')
      setFileName(file.name)
      setDeckName(baseName(file.name))
      setOptions(found)
      choose(found[0], true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się odczytać pliku.')
    } finally {
      setBusy(null)
    }
  }

  function choose(option: Option, force = false) {
    if (!force && edited.current && !window.confirm('Zmienić sposób odczytu? Twoje poprawki fiszek przepadną.')) return
    edited.current = false
    setChosen(option.id)
    setDrafts(toDrafts(option.rows))
    setShown(PAGE)
    setDone(null)
  }

  function update(id: number, patch: Partial<Draft>) {
    edited.current = true
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  function remove(id: number) {
    edited.current = true
    setDrafts((current) => current.filter((draft) => draft.id !== id))
  }

  function swapAll() {
    edited.current = true
    setDrafts((current) => current.map((draft) => ({ ...draft, front: draft.back, back: draft.front })))
  }

  function tagList(): string[] {
    return tags.split(/[,;\s]+/).map((tag) => tag.trim()).filter(Boolean)
  }

  async function exportApkg() {
    setError(null)
    setBusy('Buduję paczkę Anki…')
    try {
      const [{ loadSql }, { buildApkg }] = await Promise.all([import('../lib/sql'), import('../lib/apkgWriter')])
      const sql = await loadSql()
      const tagsForCards = tagList()
      const bytes = await buildApkg(sql, {
        deckName: deckName.trim() || 'Fiszki',
        reversed,
        cards: complete.map((draft) => ({ front: toHtml(draft.front), back: toHtml(draft.back), tags: tagsForCards })),
      })
      const name = `${(deckName.trim() || 'Fiszki').replace(/[\\/:*?"<>|]+/g, '-')}.apkg`
      download(bytes, name)
      setDone(`Pobrano ${name} (${karty(complete.length)}). Otwórz plik w Anki: Plik → Importuj albo dwuklikiem.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się zbudować pliku .apkg.')
    } finally {
      setBusy(null)
    }
  }

  async function saveHere() {
    setError(null)
    setBusy('Zapisuję talię…')
    try {
      const { rowsToCards } = await import('../lib/tabular')
      // Jawny nagłówek: rowsToCards pominie go zamiast przypadkiem wziąć pierwszą fiszkę za nagłówek tabeli.
      const cards = rowsToCards([['Pytanie', 'Odpowiedź'], ...complete.map((draft) => [draft.front, draft.back])])
      const name = deckName.trim() || 'Fiszki'
      const [id] = await saveImported([{ ankiId: 'parser', name, cards, media: [] }], fileName ?? name)
      onSaved(id, `Zapisano: ${name} (${karty(cards.length)}).`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się zapisać talii.')
      setBusy(null)
    }
  }

  const current = options.find((option) => option.id === chosen)

  return (
    <div className="stack parser">
      <button type="button" className="text-button back" onClick={onBack}>
        Wróć
      </button>
      <div>
        <p className="kicker">PDF → Anki .apkg</p>
        <h1>Parser Anki</h1>
        <p className="lead">
          Wrzuć dowolny PDF: tabelę z pytaniami, notatkę, skrypt albo rozdział podręcznika. Parser rozpozna tabele, nagłówki z treścią i linie „pojęcie – definicja”, a Ty poprawisz fiszki i pobierzesz gotową talię do Anki. Wszystko dzieje się w tej przeglądarce.
        </p>
      </div>

      <div
        className={hot ? 'drop hot' : 'drop'}
        onDragOver={(event) => {
          event.preventDefault()
          setHot(true)
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(event) => {
          event.preventDefault()
          setHot(false)
          const file = event.dataTransfer.files?.[0]
          if (file && !busy) void load(file)
        }}
      >
        <h2>{fileName ? fileName : 'Upuść tutaj PDF'}</h2>
        <p className="muted">{fileName ? 'Wrzuć inny plik, żeby zacząć od nowa.' : 'Najlepiej PDF z tekstem (nie skan). Działa też CSV, Excel, Word i TXT.'}</p>
        <label className="button primary">
          {fileName ? 'Wybierz inny plik' : 'Wybierz plik'}
          <input
            type="file"
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (file) void load(file)
            }}
          />
        </label>
      </div>

      {error ? <p className="banner bad">{error}</p> : null}

      {options.length > 0 ? (
        <section className="stack">
          <div>
            <h2>Jak czytać ten plik?</h2>
            <p className="hint">Pierwsza opcja to propozycja parsera. Kliknij inną, jeśli fiszki wyglądają źle.</p>
          </div>
          <div className="strategy-list" role="radiogroup" aria-label="Sposób odczytu">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === chosen}
                className={option.id === chosen ? 'strategy on' : 'strategy'}
                onClick={() => option.id !== chosen && choose(option)}
              >
                <span className="strategy-title">{option.label}</span>
                <span className="strategy-count">{karty(option.rows.length)}</span>
                <span className="muted small">{option.hint}</span>
              </button>
            ))}
          </div>

          <div className="parser-settings">
            <label>
              Nazwa talii
              <input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="np. Histologia::Chrząstka" />
            </label>
            <label>
              Tagi (oddzielone przecinkami)
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="np. histologia, kolokwium" />
            </label>
            <label className="check">
              <input type="checkbox" checked={reversed} onChange={(event) => setReversed(event.target.checked)} />
              Dodaj też kartę odwrotną (odpowiedź → pytanie)
            </label>
            <p className="hint">Podtalie w Anki tworzysz przez „::”, np. „Biologia::Chrząstka”.</p>
          </div>

          <div className="parser-actions">
            <button type="button" className="button primary" disabled={!complete.length || !!busy} onClick={() => void exportApkg()}>
              Pobierz .apkg ({karty(complete.length)})
            </button>
            <button type="button" className="button ghost" disabled={!complete.length || !!busy} onClick={() => void saveHere()}>
              Dodaj do moich talii
            </button>
            <button type="button" className="text-button" onClick={swapAll}>
              Zamień przód z tyłem
            </button>
          </div>
          {done ? <p className="notice">{done}</p> : null}
          {drafts.length > complete.length ? (
            <p className="hint">
              {karty(drafts.length - complete.length)} bez pytania albo odpowiedzi – nie trafi do paczki, dopóki ich nie uzupełnisz.
            </p>
          ) : null}

          <div className="section-head">
            <h2>Podgląd fiszek</h2>
            <span className="muted">{current ? current.label : ''}</span>
          </div>
          <ol className="draft-list">
            {drafts.slice(0, shown).map((draft, index) => (
              <li key={draft.id} className={draft.front.trim() && draft.back.trim() ? 'draft' : 'draft incomplete'}>
                <div className="draft-head">
                  <span className="muted small">#{index + 1}</span>
                  <button type="button" className="text-button" onClick={() => remove(draft.id)}>
                    Usuń
                  </button>
                </div>
                <label>
                  <span className="small muted">Przód</span>
                  <textarea rows={Math.min(4, Math.max(1, Math.ceil(draft.front.length / 70)))} value={draft.front} onChange={(event) => update(draft.id, { front: event.target.value })} />
                </label>
                <label>
                  <span className="small muted">Tył</span>
                  <textarea
                    rows={Math.min(10, Math.max(2, draft.back.split('\n').length + Math.floor(draft.back.length / 90)))}
                    value={draft.back}
                    onChange={(event) => update(draft.id, { back: event.target.value })}
                  />
                </label>
              </li>
            ))}
          </ol>
          <div className="row">
            {shown < drafts.length ? (
              <button type="button" className="button ghost" onClick={() => setShown((value) => value + PAGE * 2)}>
                Pokaż więcej ({drafts.length - shown})
              </button>
            ) : null}
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                edited.current = true
                setDrafts((current) => [...current, { id: nextId++, front: '', back: '' }])
                setShown((value) => Math.max(value, drafts.length + 1))
              }}
            >
              Dodaj fiszkę
            </button>
          </div>
        </section>
      ) : null}

      {busy ? (
        <div className="overlay" role="status">
          <div className="panel">
            <div className="spinner" />
            <p>{busy}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
