import type { Rows } from './tabular'

export interface Piece {
  str: string
  x: number
  y: number
  end: number
  size: number
}

export interface Cell {
  x: number
  text: string
  /** Kawałki, z których złożono komórkę – pozwalają ją rozciąć na granicy kolumny tabeli. */
  parts?: Piece[]
}

export interface Line {
  y: number
  size: number
  cells: Cell[]
}

/** Składa kawałki tekstu z jednej strony w linie, a linie w komórki (duża przerwa w poziomie = nowa kolumna). */
export function pageLines(pieces: Piece[]): Line[] {
  const sorted = pieces.slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: Piece[][] = []
  for (const piece of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last[0].y - piece.y) <= Math.max(2, Math.min(last[0].size, piece.size) * 0.5)) last.push(piece)
    else groups.push([piece])
  }
  // Indeks górny/dolny (Ca²⁺, PO₄) to mniejszy tekst lekko przesunięty w pionie – dołącz go do linii obok.
  const groupSize = (group: Piece[]) => Math.max(...group.map((piece) => piece.size))
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]
    const size = groupSize(group)
    const host = [groups[i - 1], groups[i + 1]]
      .filter((other): other is Piece[] => !!other && groupSize(other) * 0.8 > size && Math.abs(other[0].y - group[0].y) < groupSize(other) * 0.7)
      .sort((a, b) => Math.abs(a[0].y - group[0].y) - Math.abs(b[0].y - group[0].y))[0]
    if (!host) continue
    host.push(...group.map((piece) => ({ ...piece, y: host[0].y })))
    groups.splice(i, 1)
    i -= 1
  }
  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x)
    const size = groupSize(group)
    const cells: Cell[] = []
    let previous: Piece | null = null
    for (const piece of group) {
      const gap = previous ? piece.x - previous.end : 0
      if (!previous || gap > size * 2.2) cells.push({ x: piece.x, text: piece.str, parts: [piece] })
      else {
        const cell = cells[cells.length - 1]
        cell.text += (needsSpace(gap, size, cell.text, piece.str) ? ' ' : '') + piece.str
        cell.parts!.push(piece)
      }
      previous = piece
    }
    return {
      y: group[0].y,
      size,
      cells: cells.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() })).filter((cell) => cell.text),
    }
  })
}

function needsSpace(gap: number, size: number, before: string, after: string): boolean {
  return gap > size * 0.15 && !/\s$/.test(before) && !/^\s/.test(after)
}

/** Rozcina komórkę, gdy któryś jej kawałek zaczyna się (po przerwie) przy początku innej kolumny. */
function splitAtColumns(cell: Cell, cols: number[], tolerance: number, size: number): Cell[] {
  const parts = cell.parts
  if (!parts || parts.length < 2) return [cell]
  const chunks: Piece[][] = [[parts[0]]]
  for (let i = 1; i < parts.length; i += 1) {
    const piece = parts[i]
    const current = chunks[chunks.length - 1]
    const gap = piece.x - parts[i - 1].end
    const atColumn = cols.some((x) => Math.abs(x - piece.x) <= tolerance * 0.5) && Math.abs(piece.x - current[0].x) > tolerance
    if (atColumn && gap > size * 0.3) chunks.push([piece])
    else current.push(piece)
  }
  if (chunks.length === 1) return [cell]
  return chunks.map((pieces) => {
    let text = pieces[0].str
    for (let i = 1; i < pieces.length; i += 1) text += (needsSpace(pieces[i].x - pieces[i - 1].end, size, text, pieces[i].str) ? ' ' : '') + pieces[i].str
    return { x: pieces[0].x, text: text.replace(/\s+/g, ' ').trim(), parts: pieces }
  })
}

/** Linia bez pierwszej kolumny, ale wyrównana do kolumn poprzedniej = zawinięty tekst w tabeli. */
function mergeWrapped(lines: Line[], left: number): Line[] {
  const out: Line[] = []
  for (const line of lines) {
    const previous = out[out.length - 1]
    const first = line.cells[0]
    if (previous && previous.cells.length >= 2 && first && first.x > left + line.size * 2 && previous.y - line.y < line.size * 2) {
      for (const cell of line.cells) {
        let target = previous.cells[0]
        for (const candidate of previous.cells) if (Math.abs(candidate.x - cell.x) < Math.abs(target.x - cell.x)) target = candidate
        target.text = `${target.text} ${cell.text}`
      }
      previous.y = line.y
      continue
    }
    out.push({ ...line, cells: line.cells.map((cell) => ({ ...cell })) })
  }
  return out
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function lineText(line: Line): string {
  return line.cells.map((cell) => cell.text).join(' ')
}

/** Usuwa nagłówki i stopki: ten sam tekst (bez cyfr) na ponad połowie stron. */
function dropRunningLines(pages: Line[][]): Line[][] {
  if (pages.length < 3) return pages
  const key = (line: Line) => lineText(line).replace(/\d+/g, '#').toLowerCase()
  const count = new Map<string, number>()
  for (const lines of pages) for (const k of new Set(lines.map(key))) count.set(k, (count.get(k) ?? 0) + 1)
  return pages.map((lines) => lines.filter((line) => (count.get(key(line)) ?? 0) <= pages.length / 2))
}

/**
 * Szuka w PDF tabeli (np. „pytanie | odpowiedź”) także wtedy, gdy obok niej są zwykłe strony z tekstem.
 * Komórki zawinięte na kilka linii są sklejane: nowy wiersz zaczyna się po większym odstępie w pionie
 * (gdy tabela ma odstępy między wierszami) albo gdy pojawia się tekst w pierwszej kolumnie.
 */
function tableRows(source: Line[][]): { rows: Rows; lines: number } | null {
  const pages = source.map((lines) => lines.map((line) => ({ ...line, cells: line.cells.slice() })))
  const tablePages = pages.filter((lines) => {
    const multi = lines.filter((line) => line.cells.length >= 2).length
    return multi >= 3 && multi >= lines.length * 0.4
  })
  if (tablePages.length === 0) return null

  const multiLines = tablePages.flat().filter((line) => line.cells.length >= 2)
  const body = median(multiLines.map((line) => line.size))
  const tolerance = body * 1.5

  // Kolumny = skupiska początków komórek w liniach wielokolumnowych.
  const columns: { x: number; n: number }[] = []
  for (const x of multiLines.flatMap((line) => line.cells.map((cell) => cell.x)).sort((a, b) => a - b)) {
    const last = columns[columns.length - 1]
    if (last && x - last.x <= tolerance) {
      last.x = (last.x * last.n + x) / (last.n + 1)
      last.n += 1
    } else columns.push({ x, n: 1 })
  }
  const cols = columns.filter((column) => column.n >= 3).map((column) => column.x)
  if (cols.length < 2) return null
  // Pytanie dochodzące prawie do drugiej kolumny zlewa się z odpowiedzią w jedną komórkę – rozetnij je.
  for (const lines of tablePages) {
    for (const line of lines) line.cells = line.cells.flatMap((cell) => splitAtColumns(cell, cols, tolerance, line.size))
  }
  const columnOf = (cell: Cell) => {
    let best = -1
    for (let i = 0; i < cols.length; i += 1) {
      if (Math.abs(cols[i] - cell.x) <= tolerance && (best < 0 || Math.abs(cols[i] - cell.x) < Math.abs(cols[best] - cell.x))) best = i
    }
    return best
  }
  const isTableLine = (line: Line) =>
    line.cells.length > 0 && Math.abs(line.size - body) <= body * 0.2 && line.cells.every((cell) => columnOf(cell) >= 0)

  // Czy wiersze tabeli są oddzielone większym odstępem niż linie wewnątrz komórki?
  const gaps: number[] = []
  for (const lines of tablePages) {
    for (let i = 1; i < lines.length; i += 1) {
      if (isTableLine(lines[i]) && isTableLine(lines[i - 1])) gaps.push((lines[i - 1].y - lines[i].y) / body)
    }
  }
  const byGap = gaps.some((gap) => gap > 1.6) && gaps.some((gap) => gap < 1.45)

  const rows: Rows = []
  const heights: number[] = []
  let used = 0
  let hyphenated = 0
  for (const lines of tablePages) {
    let current: string[] | null = null
    let previousY = 0
    for (const line of lines) {
      if (!isTableLine(line)) {
        current = null
        continue
      }
      used += 1
      const indexes = line.cells.map(columnOf)
      if (line.cells.some((cell, i) => indexes[i] < cols.length - 1 && /\p{L}-$/u.test(cell.text))) hyphenated += 1
      const startsRow = byGap ? previousY - line.y > body * 1.6 : indexes[0] === 0 && current !== null && current[0] !== ''
      if (!current || startsRow) {
        current = cols.map(() => '')
        rows.push(current)
        heights.push(0)
      }
      heights[heights.length - 1] += 1
      line.cells.forEach((cell, i) => {
        const index = indexes[i]
        const joiner = /^[•●▪◦‣–-]\s/.test(cell.text) ? '\n' : ' '
        current![index] = current![index] ? `${current![index]}${joiner}${cell.text}` : cell.text
      })
      previousY = line.y
    }
  }

  const full = rows.filter((row) => row[0] && row.slice(1).some(Boolean))
  if (full.length < 3 || full.length < rows.length * 0.6) return null
  // Wiersz fiszki to kilka linii i krótkie pytanie; całe akapity = tekst w dwóch szpaltach, nie tabela.
  if (median(heights) > 5) return null
  if (median(full.map((row) => row[0].length)) > 140) return null
  // W tekście w szpaltach linie lewej szpalty często kończą się przeniesieniem wyrazu („wy-”).
  if (hyphenated > used * 0.06) return null
  // „1. Pytanie…” – numeracja z tabeli nie jest częścią pytania.
  const numbered = full.filter((row) => /^\d{1,4}[.)]\s+\S/.test(row[0])).length
  if (numbered >= full.length * 0.8) for (const row of full) row[0] = row[0].replace(/^\d{1,4}[.)]\s+/, '')
  return { rows: withHeaders(full), lines: used }
}

/**
 * Tabela z nagłówkiem i 3+ kolumnami (np. „# | Nazwa | Cena | Opis”): pytaniem jest pierwsza kolumna z treścią
 * (nie sam numer), a odpowiedź to pozostałe kolumny podpisane nagłówkami.
 */
function withHeaders(rows: Rows): Rows {
  const trim = (row: string[]) => {
    const copy = row.slice()
    while (copy.length && !copy[copy.length - 1]) copy.pop()
    return copy
  }
  const width = Math.max(...rows.map((row) => row.length))
  const head = rows[0]
  const headerLike = width >= 3 && head.filter(Boolean).length >= Math.min(width, 3) && head.every((cell) => cell.length <= 40 && !/[.?!]$/.test(cell))
  if (!headerLike || rows.length < 3) return rows.map(trim)
  const data = rows.slice(1)
  const isIndex = (value: string) => /^#?\d{1,4}[.)]?$/.test(value.trim()) || !value.trim()
  let key = 0
  while (key < width - 1 && data.filter((row) => isIndex(row[key] ?? '')).length >= data.length * 0.7) key += 1
  return data
    .map((row) => {
      const back = row
        .map((value, i) => (i === key || !value || isIndex(value) ? '' : head[i] ? `${head[i]}: ${value}` : value))
        .filter(Boolean)
      return row[key] && back.length ? [row[key], back.join('\n')] : []
    })
    .filter((row) => row.length)
}

function cleanPages(rawPages: Line[][]): Line[][] {
  return dropRunningLines(rawPages.map((lines) => lines.filter((line) => line.cells.length && !/^\d{1,4}$/.test(lineText(line)))))
}

/** Tabela z kolumnami ułożonymi tak, że każda linia z ≥2 komórkami to fiszka (stary, prosty przypadek). */
function simpleTable(pages: Line[][]): Rows | null {
  const all = pages.flat()
  if (all.length === 0) return null
  const left = Math.min(...all.map((line) => line.cells[0].x))
  const tableLike = all.filter((line) => line.cells.length >= 2).length
  if (tableLike < 2 || tableLike < all.length * 0.5) return null
  return pages.flatMap((lines) => mergeWrapped(lines, left)).map((line) => line.cells.map((cell) => cell.text))
}

/** Tekst strony jako linie (kolumny tabulatorem, duże odstępy w pionie = pusta linia). */
function plainText(pages: Line[][]): string[] {
  const text: string[] = []
  for (const lines of pages) {
    let previous: Line | null = null
    for (const line of lines) {
      if (previous && previous.y - line.y > Math.max(line.size, previous.size) * 1.9) text.push('')
      text.push(line.cells.map((cell) => cell.text).join('\t'))
      previous = line
    }
    text.push('')
  }
  return text
}

/** Zamienia ułożone na stronach linie na wiersze fiszek albo zwraca tekst do dalszego rozpoznania. */
export function layoutToRows(rawPages: Line[][]): { rows: Rows } | { text: string[] } {
  const pages = cleanPages(rawPages)
  const all = pages.flat()
  if (all.length === 0) return { text: [] }
  // Tabela – także gdy PDF ma obok niej notatkę lub stronę tytułową.
  const table = tableRows(pages)
  if (table && (table.rows.length >= 10 || table.lines >= all.length * 0.5)) return { rows: table.rows }
  const simple = simpleTable(pages)
  if (simple) return { rows: simple }
  return { text: plainText(pages) }
}

// ---------- tekst ciągły: kolejność czytania, akapity, nagłówki ----------

/** Strona złożona w dwóch szpaltach: najpierw cała lewa, potem cała prawa. */
function readingOrder(lines: Line[]): Line[] {
  if (lines.length < 8) return lines
  // Szpalty: wiele linii ma fragment tekstu zaczynający się w tym samym miejscu w prawej części strony.
  const pieces = lines.flatMap((line) => line.cells.flatMap((cell) => cell.parts ?? []))
  if (pieces.length) {
    const minX = Math.min(...pieces.map((piece) => piece.x))
    const maxX = Math.max(...pieces.map((piece) => piece.end))
    const width = maxX - minX
    const size = median(lines.map((line) => line.size))
    const starts = new Map<number, number>()
    for (const line of lines) {
      const seen = new Set<number>()
      const parts = line.cells.flatMap((cell) => cell.parts ?? [])
      for (let i = 1; i < parts.length; i += 1) {
        const piece = parts[i]
        const rel = (piece.x - minX) / width
        if (rel < 0.3 || rel > 0.7 || piece.x - parts[i - 1].end < size * 0.6) continue
        const key = Math.round(piece.x / (size * 1.5))
        if (!seen.has(key)) {
          seen.add(key)
          starts.set(key, (starts.get(key) ?? 0) + 1)
        }
      }
    }
    const best = [...starts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] >= lines.length * 0.25) {
      const split = (best[0] - 0.5) * size * 1.5
      const left: Line[] = []
      const right: Line[] = []
      for (const line of lines) {
        const parts = line.cells.flatMap((cell) => cell.parts ?? [])
        const make = (chunk: Piece[]): Line | null => {
          if (!chunk.length) return null
          let text = chunk[0].str
          for (let i = 1; i < chunk.length; i += 1) text += (needsSpace(chunk[i].x - chunk[i - 1].end, line.size, text, chunk[i].str) ? ' ' : '') + chunk[i].str
          text = text.replace(/\s+/g, ' ').trim()
          return text ? { ...line, cells: [{ x: chunk[0].x, text, parts: chunk }] } : null
        }
        const l = make(parts.filter((piece) => piece.x < split))
        const r = make(parts.filter((piece) => piece.x >= split))
        if (l) left.push(l)
        if (r) right.push(r)
      }
      return [...left, ...right]
    }
  }
  const two = lines.filter((line) => line.cells.length === 2)
  if (two.length < 6 || two.length < lines.length * 0.3) return lines
  const xs = two.map((line) => line.cells[1].x).sort((a, b) => a - b)
  const split = median(xs)
  const size = median(lines.map((line) => line.size))
  const inBand = xs.filter((x) => Math.abs(x - split) <= size * 3).length
  if (inBand < two.length * 0.7) return lines
  const left: Line[] = []
  const right: Line[] = []
  for (const line of lines) {
    const l = line.cells.filter((cell) => cell.x < split - size * 3)
    const r = line.cells.filter((cell) => cell.x >= split - size * 3)
    if (l.length) left.push({ ...line, cells: l })
    if (r.length) right.push({ ...line, cells: r })
  }
  return [...left, ...right]
}

interface Block {
  kind: 'heading' | 'item'
  text: string
  size: number
  /** Punkt listy (•, –, 1.) – w odpowiedzi trafia do osobnej linii. */
  bullet: boolean
}

const BULLET_RE = /^([•●▪◦‣■□➢➤✓✔→]|[-–—*](?=\s)|\d{1,3}[.)](?=\s)|[a-z][.)](?=\s))\s*/
const NUMBERED_HEADING = /^(\d+(\.\d+)+\.?|[IVXLC]+\.|Rozdział|ROZDZIAŁ|Część|CZĘŚĆ|Chapter|CHAPTER)\s+\S/

function isCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '')
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

/** Dzieli dokument na nagłówki i akapity/punkty, skleja przeniesienia wyrazów. */
function blocks(rawPages: Line[][]): Block[] {
  const pages = cleanPages(rawPages).map(readingOrder)
  const all = pages.flat()
  if (all.length === 0) return []
  // Rozmiar tekstu głównego = najczęstszy (ważony długością tekstu).
  const weight = new Map<number, number>()
  for (const line of all) {
    const key = Math.round(line.size * 2) / 2
    weight.set(key, (weight.get(key) ?? 0) + lineText(line).length)
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0]

  const out: Block[] = []
  for (const lines of pages) {
    let previous: Line | null = null
    for (const line of lines) {
      const text = line.cells.map((cell) => cell.text).join(' | ')
      if (line.size < body * 0.75) {
        previous = line
        continue // przypisy, podpisy pod rycinami drobnym drukiem, numery
      }
      const big = line.size >= body * 1.08
      const heading =
        text.length <= 120 &&
        !/[,;]$/.test(text) &&
        (big || (text.length <= 90 && (NUMBERED_HEADING.test(text) || (isCaps(text) && text.length <= 70))))
      const last = out[out.length - 1]
      const gap = previous ? previous.y - line.y : 0
      const near = previous !== null && gap > 0 && gap < Math.max(line.size, previous.size) * 1.6
      if (heading) {
        if (last?.kind === 'heading' && near && Math.abs(last.size - line.size) < 0.6) last.text += ` ${text}`
        else out.push({ kind: 'heading', text, size: line.size, bullet: false })
      } else {
        const bullet = BULLET_RE.test(text)
        const clean = text.replace(/^[•●▪◦‣■□➢➤✓✔→]\s*/, '')
        if (last?.kind === 'item' && near && !bullet) {
          last.text = /\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(clean) ? last.text.slice(0, -1) + clean : `${last.text} ${clean}`
        } else out.push({ kind: 'item', text: clean, size: line.size, bullet })
      }
      previous = line
    }
  }
  return out
    .map((block) => {
      let text = block.text.replace(/\s+/g, ' ').trim()
      // Ozdobniki przed nagłówkami („› ”, „■ ”, „+ ”) nie są częścią tytułu.
      if (block.kind === 'heading') text = text.replace(/^[^\p{L}\p{N}(„"]+/u, '').trim()
      return { ...block, text }
    })
    .filter((block) => block.text)
}

/** „Nagłówek → treść”: każdy podrozdział to fiszka (długie dzielone na części). */
function outlineRows(rawPages: Line[][]): Rows {
  const list = blocks(rawPages)
  const sizes = [...new Set(list.filter((b) => b.kind === 'heading').map((b) => Math.round(b.size * 2) / 2))].sort((a, b) => b - a)
  const level = (size: number) => sizes.indexOf(Math.round(size * 2) / 2)
  const stack: { level: number; text: string }[] = []
  const rows: Rows = []
  let items: Block[] = []
  const flush = () => {
    if (!stack.length || !items.length) {
      items = []
      return
    }
    const title = stack.slice(-2).map((entry) => entry.text).join(' › ')
    const chunks: string[][] = [[]]
    let length = 0
    for (const item of items) {
      const line = item.bullet ? `• ${item.text.replace(BULLET_RE, '')}` : item.text
      if (length + line.length > 650 && chunks[chunks.length - 1].length) {
        chunks.push([])
        length = 0
      }
      chunks[chunks.length - 1].push(line)
      length += line.length
    }
    chunks.forEach((chunk, i) => rows.push([chunks.length > 1 ? `${title} (cz. ${i + 1}/${chunks.length})` : title, chunk.join('\n')]))
    items = []
  }
  for (const block of list) {
    if (block.kind === 'heading') {
      flush()
      const lvl = level(block.size)
      while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop()
      stack.push({ level: lvl, text: block.text })
    } else items.push(block)
  }
  flush()
  return rows
}

const DEFINITION_RES = [
  /^(.{2,70}?)\s+[–—-]\s+(.{4,})$/u, // pojęcie – definicja
  /^([^:]{2,60}):\s+(.{4,})$/u, // pojęcie: definicja
  /^(.{2,60}?)\s+\(([^)]{2,40})\)\s+[–—-]\s+(.{4,})$/u, // pojęcie (łac.) – definicja
]

/** „Pojęcie – definicja”: punkty i akapity zaczynające się od krótkiego terminu i myślnika/dwukropka. */
function definitionRows(rawPages: Line[][]): Rows {
  const rows: Rows = []
  let section = ''
  for (const block of blocks(rawPages)) {
    if (block.kind === 'heading') {
      section = block.text
      continue
    }
    const text = block.text.replace(BULLET_RE, '')
    for (const re of DEFINITION_RES) {
      const match = text.match(re)
      if (!match) continue
      const term = match[1].trim()
      // Termin nie może być zdaniem – bez kropek w środku i nie dłuższy niż kilka słów.
      if (/[.!?]/.test(term) || term.split(/\s+/).length > 8) break
      const answer = (match[3] ? `(${match[2]}) ${match[3]}` : match[2]).trim()
      rows.push([term, section ? `${answer}\n— ${section}` : answer])
      break
    }
  }
  return rows
}

export type StrategyId = 'table' | 'outline' | 'definitions' | 'text'

export interface Strategy {
  id: StrategyId
  label: string
  hint: string
  rows: Rows
}

/** Wszystkie sposoby odczytania PDF-a – strona parsera pokazuje je do wyboru, pierwszy jest polecany. */
export function pdfStrategies(rawPages: Line[][], textToRows: (lines: string[]) => Rows): Strategy[] {
  const pages = cleanPages(rawPages)
  const all = pages.flat()
  if (all.length === 0) return []
  const table = tableRows(pages)
  const simple = table ? null : simpleTable(pages)
  const out: Strategy[] = []
  const tableRowsFound = table?.rows ?? simple
  if (tableRowsFound?.length) {
    out.push({ id: 'table', label: 'Tabela', hint: 'Pytanie w pierwszej kolumnie tabeli, odpowiedź w kolejnych.', rows: tableRowsFound })
  }
  const outline = outlineRows(rawPages)
  if (outline.length) out.push({ id: 'outline', label: 'Nagłówek → treść', hint: 'Każdy podrozdział notatki/podręcznika to fiszka: tytuł na przodzie, treść z tyłu.', rows: outline })
  const definitions = definitionRows(rawPages)
  if (definitions.length) out.push({ id: 'definitions', label: 'Pojęcie – definicja', hint: 'Linie typu „termin – opis” albo „termin: opis”.', rows: definitions })
  const text = textToRows(plainText(pages))
  if (text.length) out.push({ id: 'text', label: 'Automatycznie (tekst)', hint: '„Pytanie: … / Odpowiedź: …”, pary w liniach albo bloki oddzielone pustą linią.', rows: text })

  // Kolejność = polecenie: dobra tabela > Q/A z tekstu > definicje (gdy jest ich dużo) > nagłówki.
  const score = (s: Strategy) => {
    if (s.id === 'table') return table && (table.rows.length >= 10 || table.lines >= all.length * 0.5) ? 100 : simple ? 90 : 40
    if (s.id === 'text') {
      const qa = plainText(pages).filter((line) => /^\s*(pytanie|q|question|odpowied[zź]|a|answer)\s*[:.)]/i.test(line)).length
      return qa >= 4 ? 80 : 10
    }
    if (s.id === 'definitions') return s.rows.length >= Math.max(15, outline.length) ? 60 : 30
    return 50
  }
  return out.sort((a, b) => score(b) - score(a))
}
