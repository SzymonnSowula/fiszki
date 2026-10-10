import { unzipSync } from 'fflate'
import { decompress } from 'fzstd'
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { firstMedia, renderTemplate, splitAnswer, textLines } from './html'
import { protoStrings, protoText, protoVarint, readProto } from './proto'

export class ApkgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApkgError'
  }
}

export interface ParsedCard {
  cardId: string
  frontHtml: string
  answerHtml: string
  lines: string[]
  frontText: string
  mediaName: string | null
  css: string
}

export interface ParsedMedia {
  filename: string
  mime: string
  data: Uint8Array
}

export interface ParsedDeck {
  ankiId: string
  name: string
  cards: ParsedCard[]
  media: ParsedMedia[]
}

interface Model {
  id: string
  css: string
  cloze: boolean
  fields: string[]
  templates: { ord: number; qfmt: string; afmt: string }[]
}

const RESERVED = new Set(['meta', 'media', 'collection.anki2', 'collection.anki21', 'collection.anki21b'])

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function isZstd(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd
}

function isSqlite(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 15)).startsWith('SQLite format 3')
}

function decompressZstd(bytes: Uint8Array): Uint8Array {
  try {
    return decompress(bytes)
  } catch {
    throw new ApkgError('Nie udało się rozpakować skompresowanej bazy Anki.')
  }
}

function findEntry(files: Record<string, Uint8Array>, name: string): Uint8Array | undefined {
  if (files[name]) return files[name]
  const key = Object.keys(files).find((entry) => entry === name || entry.endsWith(`/${name}`))
  return key ? files[key] : undefined
}

function copyValue(value: SqlValue): string | number | Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return value
}

function rows(db: Database, sql: string): Record<string, string | number | Uint8Array | null>[] {
  const statement = db.prepare(sql)
  const out: Record<string, string | number | Uint8Array | null>[] = []
  while (statement.step()) {
    const object = statement.getAsObject()
    const copy: Record<string, string | number | Uint8Array | null> = {}
    for (const [key, value] of Object.entries(object)) copy[key] = copyValue(value)
    out.push(copy)
  }
  statement.free()
  return out
}

function textOf(value: string | number | Uint8Array | null | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return ''
}

function bytesOf(value: string | number | Uint8Array | null | undefined): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') return new TextEncoder().encode(value)
  return new Uint8Array()
}

function noteCount(db: Database): number {
  try {
    const result = db.exec('SELECT COUNT(*) FROM notes')
    return Number(result[0]?.values?.[0]?.[0] ?? 0)
  } catch {
    return 0
  }
}

function openDatabase(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  const fresh = () => new SQL.Database(new Uint8Array(bytes))
  let db = fresh()
  try {
    const hit = db.exec("SELECT COUNT(*) FROM sqlite_master WHERE typeof(sql) = 'text' AND sql LIKE '%unicase%'")
    const count = Number(hit[0]?.values?.[0]?.[0] ?? 0)
    if (!count) return db
    db.run('PRAGMA writable_schema=ON')
    db.run(
      "UPDATE sqlite_master SET sql = replace(replace(sql, ' COLLATE unicase', ''), 'COLLATE unicase', '') WHERE typeof(sql) = 'text' AND sql LIKE '%unicase%'",
    )
    db.run('PRAGMA writable_schema=OFF')
    const exported = new Uint8Array(db.export())
    db.close()
    db = new SQL.Database(exported)
    return db
  } catch {
    try {
      db.close()
    } catch {
      /* baza została już zamknięta */
    }
    return fresh()
  }
}

function openCollection(files: Record<string, Uint8Array>, SQL: SqlJsStatic): Database {
  const names = ['collection.anki21b', 'collection.anki21', 'collection.anki2']
  let fallback: Database | null = null
  for (const name of names) {
    const raw = findEntry(files, name)
    if (!raw) continue
    try {
      const bytes = isZstd(raw) ? decompressZstd(raw) : raw
      if (!isSqlite(bytes)) continue
      const db = openDatabase(SQL, bytes)
      if (noteCount(db) > 0) {
        fallback?.close()
        return db
      }
      fallback?.close()
      fallback = db
    } catch (error) {
      if (error instanceof ApkgError) throw error
    }
  }
  if (fallback) return fallback
  throw new ApkgError('W pliku .apkg nie ma bazy fiszek Anki.')
}

function prettyName(name: string): string {
  return name.replaceAll('\u001f', ' · ').trim()
}

function loadModels(db: Database): Map<string, Model> {
  const models = new Map<string, Model>()
  try {
    const notetypes = rows(db, 'SELECT id, name, config FROM notetypes')
    const fields = rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')
    const templates = rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')
    for (const note of notetypes) {
      const id = textOf(note.id)
      const config = bytesOf(note.config)
      const css = protoText(config, 3) || protoStrings(config).find((item) => item.includes('.card')) || ''
      models.set(id, {
        id,
        css,
        cloze: protoVarint(config, 1) === 1,
        fields: [],
        templates: [],
      })
    }
    for (const field of fields) {
      const model = models.get(textOf(field.ntid))
      if (!model) continue
      model.fields[Number(field.ord)] = textOf(field.name)
    }
    for (const template of templates) {
      const model = models.get(textOf(template.ntid))
      if (!model) continue
      const config = bytesOf(template.config)
      const strings = protoStrings(config)
      model.templates.push({
        ord: Number(template.ord),
        qfmt: protoText(config, 1) || strings[0] || '',
        afmt: protoText(config, 2) || strings[1] || '',
      })
    }
  } catch {
    models.clear()
  }

  if (models.size > 0) return models

  try {
    const column = rows(db, 'SELECT models FROM col')
    const raw = textOf(column[0]?.models).trim()
    if (!raw.startsWith('{')) return models
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        name?: string
        type?: number
        css?: string
        flds?: { name: string; ord: number }[]
        tmpls?: { ord: number; qfmt: string; afmt: string }[]
      }
    >
    for (const [id, model] of Object.entries(parsed)) {
      const fields = (model.flds ?? []).slice().sort((a, b) => a.ord - b.ord)
      models.set(id, {
        id,
        css: model.css ?? '',
        cloze: model.type === 1,
        fields: fields.map((field) => field.name),
        templates: (model.tmpls ?? []).map((template) => ({
          ord: template.ord,
          qfmt: template.qfmt,
          afmt: template.afmt,
        })),
      })
    }
  } catch {
    /* starszy format bez JSON */
  }
  return models
}

function loadDeckNames(db: Database): Map<string, string> {
  const names = new Map<string, string>()
  try {
    for (const deck of rows(db, 'SELECT id, name FROM decks')) {
      names.set(textOf(deck.id), prettyName(textOf(deck.name)) || 'Talia')
    }
  } catch {
    names.clear()
  }
  if (names.size > 0) return names
  try {
    const column = rows(db, 'SELECT decks FROM col')
    const raw = textOf(column[0]?.decks).trim()
    if (!raw.startsWith('{')) return names
    const parsed = JSON.parse(raw) as Record<string, { id?: number; name?: string }>
    for (const [id, deck] of Object.entries(parsed)) {
      names.set(String(deck.id ?? id), prettyName(deck.name ?? '') || 'Talia')
    }
  } catch {
    /* brak nazw talii */
  }
  return names
}

function fallbackModel(fieldCount: number): Model {
  const fields = Array.from({ length: Math.max(fieldCount, 1) }, (_, index) => {
    if (index === 0) return 'Front'
    if (index === 1) return 'Back'
    return `Pole ${index + 1}`
  })
  const back = fields
    .slice(1)
    .map((name) => `{{${name}}}`)
    .join('<br>')
  return {
    id: '',
    css: '',
    cloze: false,
    fields,
    templates: [
      {
        ord: 0,
        qfmt: `{{${fields[0]}}}`,
        afmt: `{{FrontSide}}<hr id="answer">${back || `{{${fields[0]}}}`}`,
      },
    ],
  }
}

function renderFields(model: Model, flds: string, ord: number): { frontHtml: string; answerHtml: string } {
  const values = flds.split('\u001f')
  const fields: Record<string, string> = {}
  model.fields.forEach((name, index) => {
    if (name) fields[name] = values[index] ?? ''
  })
  const template = model.templates.find((item) => item.ord === ord) ?? model.templates[0]
  const qfmt = template?.qfmt || `{{${model.fields[0] || 'Front'}}}`
  const afmt = template?.afmt || `{{FrontSide}}<hr id="answer">{{${model.fields[1] || model.fields[0] || 'Back'}}}`
  let frontHtml = renderTemplate(qfmt, fields, ord, false, '', model.cloze)
  const full = renderTemplate(afmt, fields, ord, true, frontHtml, model.cloze)
  const answerHtml = splitAnswer(full, frontHtml)
  if (!textLines(frontHtml).length && !/<img\b/i.test(frontHtml) && !/<audio\b/i.test(frontHtml)) {
    const fallback = values.find((value) => textLines(value).length > 0 || /<img\b/i.test(value))
    if (fallback) frontHtml = renderTemplate(fallback, fields, ord, false, '', model.cloze)
  }
  return { frontHtml, answerHtml }
}

function mimeOf(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'mp4' || ext === 'm4a') return 'audio/mp4'
  return 'application/octet-stream'
}

function readMediaMap(raw: Uint8Array | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!raw || raw.length === 0) return map
  const bytes = isZstd(raw) ? decompressZstd(raw) : raw
  const first = bytes.find((byte) => byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32)
  if (first === 0x7b || first === 0x5b) {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
    for (const [archive, original] of Object.entries(parsed)) {
      if (typeof original === 'string' && original) map.set(archive, original)
    }
    return map
  }
  let index = 0
  for (const field of readProto(bytes)) {
    if (field.field !== 1 || !(field.value instanceof Uint8Array)) continue
    const name = protoText(field.value, 1)
    if (name) map.set(String(index), name)
    index += 1
  }
  return map
}

function unpackMedia(data: Uint8Array): Uint8Array {
  return isZstd(data) ? decompressZstd(data) : data
}

function collectMedia(files: Record<string, Uint8Array>): ParsedMedia[] {
  const mapped = readMediaMap(findEntry(files, 'media'))
  const media = new Map<string, ParsedMedia>()
  if (mapped.size > 0) {
    for (const [archive, filename] of mapped) {
      const data = findEntry(files, archive)
      if (!data) continue
      media.set(filename, { filename, mime: mimeOf(filename), data: unpackMedia(data) })
    }
  }
  if (media.size === 0) {
    for (const [name, data] of Object.entries(files)) {
      const base = name.split('/').pop() ?? name
      if (RESERVED.has(base)) continue
      media.set(base, { filename: base, mime: mimeOf(base), data: unpackMedia(data) })
    }
  }
  return [...media.values()]
}

export async function parseApkg(
  data: Uint8Array,
  SQL: SqlJsStatic,
  options: { fileName?: string; onProgress?: (message: string) => void } = {},
): Promise<ParsedDeck[]> {
  options.onProgress?.('Rozpakowuję paczkę…')
  await tick()
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new ApkgError('To nie wygląda na plik .apkg z Anki.')
  }

  options.onProgress?.('Czytam fiszki…')
  await tick()
  const db = openCollection(files, SQL)
  try {
    const models = loadModels(db)
    const deckNames = loadDeckNames(db)
    const fileLabel = (options.fileName ?? '').replace(/\.apkg$/i, '').trim()
    const grouped = new Map<string, ParsedCard[]>()

    let cardRows: ReturnType<typeof rows> = []
    try {
      cardRows = rows(
        db,
        `SELECT c.id AS cid, c.ord AS ord, c.did AS did, n.mid AS mid, n.flds AS flds
         FROM cards c JOIN notes n ON n.id = c.nid`,
      )
    } catch {
      throw new ApkgError('Baza Anki jest w nieobsługiwanym układzie.')
    }

    for (const row of cardRows) {
      const values = textOf(row.flds).split('\u001f')
      const model = models.get(textOf(row.mid)) ?? fallbackModel(values.length)
      const rendered = renderFields(model, textOf(row.flds), Number(row.ord) || 0)
      const lines = textLines(rendered.answerHtml)
      const frontText = textLines(rendered.frontHtml).join(' · ')
      if (!rendered.frontHtml.trim() && !rendered.answerHtml.trim()) continue
      const card: ParsedCard = {
        cardId: textOf(row.cid),
        frontHtml: rendered.frontHtml,
        answerHtml: rendered.answerHtml,
        lines,
        frontText,
        mediaName: firstMedia(rendered.frontHtml) ?? firstMedia(rendered.answerHtml),
        css: model.css,
      }
      const deckId = textOf(row.did) || '1'
      const list = grouped.get(deckId) ?? []
      list.push(card)
      grouped.set(deckId, list)
    }

    options.onProgress?.('Zbieram obrazy…')
    await tick()
    const media = collectMedia(files)
    const decks: ParsedDeck[] = []
    for (const [ankiId, cards] of grouped) {
      if (cards.length === 0) continue
      cards.sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }))
      const name = deckNames.get(ankiId) || fileLabel || 'Talia'
      decks.push({ ankiId, name, cards, media })
    }
    decks.sort((a, b) => b.cards.length - a.cards.length)
    return decks
  } finally {
    db.close()
  }
}
