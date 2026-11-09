import { unzipSync } from 'fflate'
import { ApkgError, type ParsedCard, type ParsedDeck } from './apkg'
import { applyCloze, decodeBasicEntities, firstMedia, rewriteMedia, textLines } from './html'

// Import fiszek z „zwykłych” plików: CSV/TSV/TXT/MD/JSON/XLSX/ODS/DOCX/ODT (PDF w pdf.ts).
// Wszystko sprowadzamy do wierszy komórek: pierwsza komórka = pytanie, reszta = odpowiedź
// (każda komórka to osobna linia odpowiedzi, tak jak pola notatki w Anki).

export type Rows = string[][]

export interface TableSource {
  name: string
  rows: Rows
  /** Komórki zawierają HTML (np. eksport notatek z Anki z `#html:true`). */
  html?: boolean
}

// ---------- tekst ----------

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    // Stare polskie pliki z Excela/Notatnika bywają w Windows-1250.
    return new TextDecoder('windows-1250').decode(bytes)
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function plain(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim()
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

const HEADER_WORDS = new Set(
  [
    'front', 'back', 'przod', 'tyl', 'pytanie', 'pytania', 'odpowiedz', 'odpowiedzi', 'question', 'answer',
    'term', 'termin', 'pojecie', 'definition', 'definicja', 'word', 'slowo', 'slowko', 'tlumaczenie',
    'translation', 'meaning', 'znaczenie', 'polski', 'angielski', 'english', 'polish', 'latin', 'lacina',
    'nazwa', 'name', 'pl', 'en', 'de', 'es', 'fr', 'it', 'ru', 'lat', 'ang', 'pol', 'niemiecki', 'german', 'opis', 'description', 'text', 'tekst', 'extra', 'uwagi', 'notes', 'q', 'a',
  ].map(fold),
)

function isHeaderRow(row: string[]): boolean {
  const cells = row.map(fold).filter(Boolean)
  if (cells.length < 2) return false
  return HEADER_WORDS.has(cells[0]) && cells.slice(1).every((cell) => HEADER_WORDS.has(cell) || cell.length <= 12)
}

// ---------- karty ----------

function cellHtml(value: string, html: boolean): string {
  if (html) return rewriteMedia(value.trim())
  return escapeHtml(plain(value)).replace(/\n/g, '<br>')
}

function card(id: number, frontHtml: string, answerHtml: string): ParsedCard {
  return {
    cardId: String(id),
    frontHtml,
    answerHtml,
    lines: textLines(answerHtml),
    frontText: textLines(frontHtml).join(' · '),
    mediaName: firstMedia(frontHtml) ?? firstMedia(answerHtml),
    css: '',
  }
}

export function rowsToCards(rows: Rows, html = false): ParsedCard[] {
  const cards: ParsedCard[] = []
  let first = true
  for (const raw of rows) {
    const row = raw.map((cell) => (html ? cell.trim() : plain(cell)))
    while (row.length && !row[row.length - 1]) row.pop()
    if (!row.some(Boolean)) continue
    if (first) {
      first = false
      if (isHeaderRow(row)) continue
    }
    const [front = '', ...rest] = row
    const backs = rest.filter(Boolean)
    if (!front || backs.length === 0) {
      // Pojedyncza komórka: może to być „słowo - tłumaczenie” w jednej kolumnie.
      if (row.length === 1 && front) {
        const split = splitBySeparator(front, pickSeparator([front]))
        if (split) cards.push(card(cards.length + 1, cellHtml(split[0], html), split.slice(1).map((v) => cellHtml(v, html)).join('<br>')))
      }
      continue
    }
    if (/\{\{c\d+::/.test(front)) {
      const numbers = [...new Set([...front.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
      const base = cellHtml(front, html)
      const extra = backs.map((value) => cellHtml(value, html))
      for (const number of numbers) {
        const answer = [applyCloze(base, number - 1, true), ...extra].join('<br>')
        cards.push(card(cards.length + 1, applyCloze(base, number - 1, false), answer))
      }
      continue
    }
    cards.push(card(cards.length + 1, cellHtml(front, html), backs.map((value) => cellHtml(value, html)).join('<br>')))
  }
  return cards
}

export function sourcesToDecks(sources: TableSource[], kind: string): ParsedDeck[] {
  const decks: ParsedDeck[] = []
  for (const source of sources) {
    const cards = rowsToCards(source.rows, source.html)
    if (cards.length) decks.push({ ankiId: `plik-${kind}`, name: source.name, cards, media: [] })
  }
  return decks.sort((a, b) => b.cards.length - a.cards.length)
}

// ---------- CSV / TSV ----------

export function parseDelimited(text: string, delimiter: string): Rows {
  const rows: Rows = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let atStart = true
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && atStart) {
      quoted = true
      atStart = false
      continue
    }
    if (ch === delimiter) {
      row.push(cell)
      cell = ''
      atStart = true
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atStart = true
      continue
    }
    if (atStart && (ch === ' ' || ch === '\t') && ch !== delimiter) {
      cell += ch
      continue
    }
    atStart = false
    cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function delimiterScore(text: string, delimiter: string): number {
  const rows = parseDelimited(text.slice(0, 40000), delimiter)
    .slice(0, 200)
    .filter((row) => row.some((cell) => cell.trim()))
  if (rows.length === 0) return 0
  const counts = new Map<number, number>()
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)
  let mode = 1
  let modeCount = 0
  for (const [length, count] of counts) {
    if (count > modeCount || (count === modeCount && length > mode)) {
      mode = length
      modeCount = count
    }
  }
  if (mode < 2) return 0
  const filled = rows.filter((row) => row.length >= 2 && row[0].trim() && row.slice(1).some((cell) => cell.trim())).length
  return Math.min(modeCount, filled) / rows.length
}

export function detectDelimiter(text: string, allowComma: boolean): string | null {
  const candidates = allowComma ? ['\t', ';', ',', '|'] : ['\t', ';', '|']
  let best: string | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = delimiterScore(text, candidate)
    if (score > bestScore + 0.05) {
      best = candidate
      bestScore = score
    }
  }
  const needed = best === '\t' || best === ';' ? 0.5 : allowComma ? 0.6 : 0.85
  return bestScore >= needed ? best : null
}

const ANKI_SEPARATORS: Record<string, string> = {
  tab: '\t', comma: ',', semicolon: ';', space: ' ', pipe: '|', colon: ':',
}

/** CSV/TSV/TXT, w tym eksport „Notatki jako zwykły tekst” z Anki (nagłówki `#separator:` itd.). */
export function parseTextTable(text: string, name: string, allowComma: boolean): TableSource[] | null {
  const lines = text.split(/\r?\n/)
  let headerEnd = 0
  let separator: string | null = null
  let html = false
  let deckColumn = -1
  const skip = new Set<number>()
  while (headerEnd < lines.length && /^#[a-z ]+:/i.test(lines[headerEnd])) {
    const [, keyRaw, valueRaw] = lines[headerEnd].match(/^#([^:]+):(.*)$/) ?? []
    const key = (keyRaw ?? '').trim().toLowerCase()
    const value = (valueRaw ?? '').trim()
    if (key === 'separator') separator = ANKI_SEPARATORS[value.toLowerCase()] ?? (value || null)
    else if (key === 'html') html = value.toLowerCase() === 'true'
    else if (key === 'deck column') deckColumn = Number(value) - 1
    else if (key === 'notetype column' || key === 'guid column' || key === 'tags column') skip.add(Number(value) - 1)
    headerEnd += 1
  }
  const body = lines.slice(headerEnd).join('\n')
  if (headerEnd > 0 && !separator) separator = '\t'
  const delimiter = separator ?? detectDelimiter(body, allowComma)
  if (!delimiter) return null
  if (deckColumn >= 0) skip.add(deckColumn)

  const grouped = new Map<string, Rows>()
  for (const row of parseDelimited(body, delimiter)) {
    const deck = deckColumn >= 0 ? (row[deckColumn] ?? '').replaceAll('::', ' · ').trim() || name : name
    const cells = row.filter((_, index) => !skip.has(index))
    const list = grouped.get(deck) ?? []
    list.push(cells)
    grouped.set(deck, list)
  }
  return [...grouped].map(([deckName, rows]) => ({ name: deckName, rows, html }))
}

// ---------- luźny tekst (TXT, MD, PDF, DOCX bez tabel) ----------

// 'dash' = dowolny myślnik otoczony spacjami (-, –, —), bo w notatkach często się mieszają.
const SEPARATORS = ['\t', 'dash', ' = ', ' => ', ' -> ', ' → ', ' : ', ': ', ' ; ']

function pickSeparator(lines: string[]): string | null {
  const filled = lines.filter((line) => line.trim())
  if (filled.length === 0) return null
  let best: string | null = null
  let bestCount = 0
  for (const separator of SEPARATORS) {
    const count = filled.filter((line) => splitBySeparator(line, separator) !== null).length
    if (count > bestCount) {
      best = separator
      bestCount = count
    }
  }
  const needed = filled.length === 1 ? 1 : Math.max(2, Math.ceil(filled.length * 0.4))
  return bestCount >= needed ? best : null
}

function splitBySeparator(line: string, separator: string | null): string[] | null {
  if (!separator) return null
  if (separator === '\t') {
    const parts = line.split('\t').map((part) => part.trim()).filter(Boolean)
    return parts.length >= 2 ? parts : null
  }
  let at = line.indexOf(separator)
  let length = separator.length
  if (separator === 'dash') {
    const match = line.match(/\s[-–—]\s/)
    at = match?.index ?? -1
    length = match?.[0].length ?? 0
  }
  if (at <= 0) return null
  const front = line.slice(0, at).trim()
  const back = line.slice(at + length).trim()
  return front && back ? [front, back] : null
}

const BULLET = /^\s*(?:\d{1,4}[.)]\s+|[-•*–▪◦·]\s+)/
const QUESTION = /^\s*(?:[QP]\s*\d*\s*:|(?:pytanie|pyt\.?|question)\s*\d*\s*[:.)])\s*/i
const ANSWER = /^\s*(?:[AO]\s*:|(?:odpowied[zź]|odp\.?|answer)\s*[:.)])\s*/i

function isContinuation(line: string): boolean {
  return /^[a-ząćęłńóśźż(,;)]/.test(line.trim())
}

/** Zamienia linie tekstu (puste linie = przerwy) na wiersze pytanie/odpowiedź. */
export function linesToRows(input: string[]): Rows {
  const lines = input.map((line) => line.replace(/ /g, ' ').replace(/\s+$/, ''))
  const filled = lines.filter((line) => line.trim())
  if (filled.length === 0) return []

  // 1. Pytanie: … / Odpowiedź: …
  const questions = filled.filter((line) => QUESTION.test(line)).length
  const answers = filled.filter((line) => ANSWER.test(line)).length
  if (questions >= 2 && answers >= 2) {
    const rows: Rows = []
    let current: string[] | null = null
    let target = 0
    for (const line of filled) {
      if (QUESTION.test(line)) {
        current = [line.replace(QUESTION, '').trim(), '']
        rows.push(current)
        target = 0
      } else if (current && ANSWER.test(line)) {
        target = 1
        current[1] = [current[1], line.replace(ANSWER, '').trim()].filter(Boolean).join('\n')
      } else if (current) {
        current[target] = [current[target], line.trim()].filter(Boolean).join(target === 0 ? ' ' : '\n')
      }
    }
    return rows
  }

  const unbulleted = lines.map((line) => line.replace(BULLET, ''))

  // 2. „słowo - tłumaczenie”, „pojęcie: definicja”, tabulator…
  const separator = pickSeparator(unbulleted)
  if (separator) {
    const rows: Rows = []
    for (const line of unbulleted) {
      if (!line.trim()) continue
      const split = splitBySeparator(line, separator)
      if (split) rows.push(split)
      else if (rows.length && isContinuation(line)) {
        const last = rows[rows.length - 1]
        last[last.length - 1] = `${last[last.length - 1]} ${line.trim()}`
      }
    }
    return rows
  }

  // 3. Bloki rozdzielone pustą linią: pierwsza linia = pytanie, reszta = odpowiedź.
  const blocks: string[][] = []
  let block: string[] = []
  for (const line of unbulleted) {
    if (line.trim()) block.push(line.trim())
    else if (block.length) {
      blocks.push(block)
      block = []
    }
  }
  if (block.length) blocks.push(block)
  const multi = blocks.filter((item) => item.length >= 2).length
  if (blocks.length >= 2 && multi >= blocks.length * 0.6) {
    return blocks.filter((item) => item.length >= 2).map(([front, ...rest]) => [front, ...rest])
  }

  // 4. Ostatecznie: linie na zmianę pytanie / odpowiedź.
  const plainLines = unbulleted.map((line) => line.trim()).filter(Boolean)
  const rows: Rows = []
  for (let i = 0; i + 1 < plainLines.length; i += 2) rows.push([plainLines[i], plainLines[i + 1]])
  return rows
}

export function parseMarkdown(text: string): Rows {
  const lines = text.split(/\r?\n/)
  const table = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line))
  if (table.length >= 2) {
    return table
      .filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line))
      .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => stripMarkdown(cell)))
  }
  return linesToRows(lines.map((line) => (/^\s*#{1,6}\s/.test(line) || /^\s*(---|\*\*\*)\s*$/.test(line) ? '' : stripMarkdown(line))))
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

// ---------- JSON ----------

const FRONT_KEYS = ['front', 'question', 'term', 'word', 'q', 'pytanie', 'przod', 'przód', 'prompt', 'key', 'pojecie', 'pojęcie', 'slowo', 'słowo']
const BACK_KEYS = ['back', 'answer', 'definition', 'meaning', 'translation', 'a', 'odpowiedz', 'odpowiedź', 'tyl', 'tył', 'value', 'definicja', 'tlumaczenie', 'tłumaczenie']

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('\n')
  return ''
}

function jsonRows(value: unknown, depth = 0): Rows {
  if (depth > 4 || value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    const rows: Rows = []
    for (const item of value) {
      if (Array.isArray(item)) rows.push(item.map(asText))
      else if (item && typeof item === 'object') {
        const entries = Object.entries(item as Record<string, unknown>)
        const lower = new Map(entries.map(([key, val]) => [key.toLowerCase(), val]))
        const frontKey = FRONT_KEYS.find((key) => lower.has(key))
        const backKey = BACK_KEYS.find((key) => lower.has(key))
        if (frontKey && backKey) rows.push([asText(lower.get(frontKey)), asText(lower.get(backKey))])
        else {
          const texts = entries.map(([, val]) => asText(val)).filter(Boolean)
          if (texts.length >= 2) rows.push(texts)
        }
      }
    }
    return rows
  }
  const record = value as Record<string, unknown>
  for (const key of ['cards', 'flashcards', 'fiszki', 'items', 'terms', 'notes', 'data', 'questions']) {
    const nested = record[key] ?? record[key[0].toUpperCase() + key.slice(1)]
    if (Array.isArray(nested)) return jsonRows(nested, depth + 1)
  }
  const pairs = Object.entries(record).filter(([, val]) => typeof val === 'string' || typeof val === 'number')
  if (pairs.length >= 2) return pairs.map(([key, val]) => [key, asText(val)])
  for (const nested of Object.values(record)) {
    const rows = jsonRows(nested, depth + 1)
    if (rows.length) return rows
  }
  return []
}

export function parseJson(text: string): Rows {
  try {
    return jsonRows(JSON.parse(text))
  } catch {
    throw new ApkgError('Plik JSON jest uszkodzony.')
  }
}

// ---------- XML z paczek ZIP (XLSX, ODS, DOCX, ODT) ----------

function unzip(data: Uint8Array, label: string): Record<string, Uint8Array> {
  try {
    return unzipSync(data)
  } catch {
    throw new ApkgError(`Nie udało się otworzyć pliku ${label}.`)
  }
}

function xmlText(xml: string): string {
  return decodeBasicEntities(xml.replace(/<[^>]+>/g, ''))
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`))
  return match ? decodeBasicEntities(match[2]) : null
}

function columnIndex(ref: string | null): number | null {
  const letters = ref?.match(/^[A-Z]+/i)?.[0]
  if (!letters) return null
  let index = 0
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

function xlsxText(si: string): string {
  const clean = si.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '')
  return [...clean.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decodeBasicEntities(m[1])).join('')
}

export function parseXlsx(data: Uint8Array, name: string): TableSource[] {
  const files = unzip(data, 'Excela')
  const text = (path: string) => (files[path] ? new TextDecoder().decode(files[path]) : '')
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => xlsxText(m[1]))

  const rels = new Map<string, string>()
  for (const [tag] of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
  }
  const sheets: { title: string; path: string }[] = []
  for (const [tag] of text('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const path = rels.get(attr(tag, 'r:id') ?? '')
    if (path && files[path]) sheets.push({ title: attr(tag, 'name') ?? '', path })
  }
  if (sheets.length === 0) {
    for (const path of Object.keys(files).filter((key) => /^xl\/worksheets\/[^/]+\.xml$/.test(key)).sort()) {
      sheets.push({ title: path.split('/').pop()!.replace('.xml', ''), path })
    }
  }

  const sources: TableSource[] = []
  for (const sheet of sheets) {
    const rows: Rows = []
    for (const [, inner] of text(sheet.path).matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const row: string[] = []
      let next = 0
      for (const match of inner.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const tag = match[1]
        const body = match[2] ?? ''
        const index = columnIndex(attr(tag, 'r')) ?? next
        next = index + 1
        const type = attr(tag, 't')
        const raw = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? ''
        let value = ''
        if (type === 's') value = shared[Number(raw)] ?? ''
        else if (type === 'inlineStr') value = xlsxText(body)
        else if (type === 'b') value = raw === '1' ? 'PRAWDA' : 'FAŁSZ'
        else value = decodeBasicEntities(raw)
        while (row.length < index) row.push('')
        row[index] = value
      }
      rows.push(row)
    }
    sources.push({ name: sheets.length > 1 ? `${name} · ${sheet.title}` : name, rows })
  }
  return sources
}

function odfCellText(cell: string): string {
  const paragraphs = [...cell.matchAll(/<text:(?:p|h)\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:(?:p|h)>)/g)].map((m) =>
    xmlText(
      (m[1] ?? '')
        .replace(/<text:s\b[^>]*?c="(\d+)"[^>]*\/>/g, (_full, count: string) => ' '.repeat(Number(count)))
        .replace(/<text:s\b[^>]*\/>/g, ' ')
        .replace(/<text:tab\b[^>]*\/>/g, '\t')
        .replace(/<text:line-break\b[^>]*\/>/g, '\n'),
    ),
  )
  return paragraphs.join('\n')
}

function odfTables(xml: string): { title: string; rows: Rows }[] {
  const tables: { title: string; rows: Rows }[] = []
  for (const match of xml.matchAll(/<table:table(?=[\s>])([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows: Rows = []
    for (const rowMatch of match[2].matchAll(/<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const row: string[] = []
      for (const cell of (rowMatch[1] ?? '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const repeat = Math.min(Number(attr(cell[1], 'table:number-columns-repeated') ?? 1) || 1, 100)
        const value = odfCellText(cell[2] ?? '')
        for (let i = 0; i < repeat; i += 1) row.push(value)
      }
      rows.push(row)
    }
    tables.push({ title: attr(match[1], 'table:name') ?? '', rows })
  }
  return tables
}

export function parseOds(data: Uint8Array, name: string): TableSource[] {
  const files = unzip(data, 'arkusza')
  const xml = files['content.xml'] ? new TextDecoder().decode(files['content.xml']) : ''
  const tables = odfTables(xml).filter((table) => table.rows.some((row) => row.some((cell) => cell.trim())))
  return tables.map((table) => ({ name: tables.length > 1 ? `${name} · ${table.title}` : name, rows: table.rows }))
}

function usableTable(rows: Rows): boolean {
  return rows.filter((row) => row.filter((cell) => cell.trim()).length >= 2).length >= 2
}

export function parseDocx(data: Uint8Array): Rows {
  const files = unzip(data, 'Worda')
  const xml = files['word/document.xml'] ? new TextDecoder().decode(files['word/document.xml']) : ''
  const paragraphText = (p: string) =>
    decodeBasicEntities(
      p
        .replace(/<w:tab\b[^>]*\/>/g, '<w:t>\t</w:t>')
        .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '<w:t>\n</w:t>')
        .replace(/<w:delText\b[\s\S]*?<\/w:delText>/g, '')
        .match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g)
        ?.map((t) => t.replace(/<[^>]+>/g, ''))
        .join('') ?? '',
    )
  const paragraphs = (xmlPart: string) => [...xmlPart.matchAll(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g)].map((m) => paragraphText(m[0]))

  const tableRows: Rows = []
  for (const table of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
    for (const row of table[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      tableRows.push([...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) => paragraphs(cell[0]).join('\n')))
    }
  }
  if (usableTable(tableRows)) return tableRows
  return linesToRows(paragraphs(xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '')).flatMap((p) => p.split('\n')))
}

export function parseOdt(data: Uint8Array): Rows {
  const files = unzip(data, 'dokumentu')
  const xml = files['content.xml'] ? new TextDecoder().decode(files['content.xml']) : ''
  const tableRows = odfTables(xml).flatMap((table) => table.rows)
  if (usableTable(tableRows)) return tableRows
  const body = xml.replace(/<table:table(?=[\s>])[\s\S]*?<\/table:table>/g, '')
  const lines = [...body.matchAll(/<text:(?:p|h)\b[^>]*?(?:\/>|>[\s\S]*?<\/text:(?:p|h)>)/g)].flatMap((m) => odfCellText(m[0]).split('\n'))
  return linesToRows(lines)
}
