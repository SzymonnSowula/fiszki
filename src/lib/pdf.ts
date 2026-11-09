import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { ApkgError } from './apkg'
import { linesToRows, type Rows } from './tabular'

GlobalWorkerOptions.workerSrc = workerUrl

interface Piece {
  str: string
  x: number
  y: number
  end: number
  size: number
}

interface Cell {
  x: number
  text: string
}

interface Line {
  y: number
  size: number
  cells: Cell[]
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Składa kawałki tekstu z jednej strony w linie, a linie w komórki (duża przerwa w poziomie = nowa kolumna). */
function pageLines(pieces: Piece[]): Line[] {
  const sorted = pieces.slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: Piece[][] = []
  for (const piece of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last[0].y - piece.y) <= Math.max(2, Math.min(last[0].size, piece.size) * 0.5)) last.push(piece)
    else groups.push([piece])
  }
  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x)
    const size = Math.max(...group.map((piece) => piece.size))
    const cells: Cell[] = []
    let previous: Piece | null = null
    for (const piece of group) {
      const gap = previous ? piece.x - previous.end : 0
      if (!previous || gap > size * 2.2) cells.push({ x: piece.x, text: piece.str })
      else {
        const cell = cells[cells.length - 1]
        const needsSpace = gap > size * 0.15 && !/\s$/.test(cell.text) && !/^\s/.test(piece.str)
        cell.text += (needsSpace ? ' ' : '') + piece.str
      }
      previous = piece
    }
    return {
      y: group[0].y,
      size,
      cells: cells.map((cell) => ({ x: cell.x, text: cell.text.replace(/\s+/g, ' ').trim() })).filter((cell) => cell.text),
    }
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

export async function parsePdf(data: Uint8Array, onProgress?: (message: string) => void): Promise<Rows> {
  const task = getDocument({ data, disableFontFace: true, verbosity: 0 })
  let pdf
  try {
    pdf = await task.promise
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    if (name === 'PasswordException') throw new ApkgError('Ten PDF jest zabezpieczony hasłem.')
    throw new ApkgError('Nie udało się otworzyć tego pliku PDF.')
  }
  try {
    const pages: Line[][] = []
    for (let number = 1; number <= pdf.numPages; number += 1) {
      onProgress?.(`Czytam PDF: strona ${number} z ${pdf.numPages}…`)
      if (number % 5 === 1) await tick()
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const pieces: Piece[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const [a, b, , d, x, y] = item.transform as number[]
        const size = Math.abs(d) || Math.hypot(a, b) || item.height || 10
        pieces.push({ str: item.str, x, y, end: x + item.width, size })
      }
      pages.push(pageLines(pieces.filter((piece) => piece.str.trim())))
      page.cleanup()
    }

    const all = pages.flat().filter((line) => line.cells.length)
    if (all.length === 0) {
      throw new ApkgError('W tym PDF nie ma tekstu do odczytania (to pewnie skan albo zdjęcia).')
    }
    const left = Math.min(...all.map((line) => line.cells[0].x))
    const tableLike = all.filter((line) => line.cells.length >= 2).length

    // Tabela: każda linia z co najmniej dwiema kolumnami to fiszka.
    if (tableLike >= 2 && tableLike >= all.length * 0.5) {
      return pages.flatMap((lines) => mergeWrapped(lines.filter((line) => line.cells.length), left)).map((line) => line.cells.map((cell) => cell.text))
    }

    // Zwykły tekst: kolumny jako tabulator, duże odstępy w pionie jako puste linie.
    const text: string[] = []
    for (const lines of pages) {
      let previous: Line | null = null
      for (const line of lines) {
        if (!line.cells.length) continue
        if (previous && previous.y - line.y > Math.max(line.size, previous.size) * 1.9) text.push('')
        text.push(line.cells.map((cell) => cell.text).join('\t'))
        previous = line
      }
      text.push('')
    }
    return linesToRows(text)
  } finally {
    void task.destroy()
  }
}
