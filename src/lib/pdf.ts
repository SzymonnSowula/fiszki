import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { ApkgError } from './apkg'
import { layoutToRows, pageLines, type Line, type Piece } from './pdfLayout'
import { linesToRows, type Rows } from './tabular'

GlobalWorkerOptions.workerSrc = workerUrl

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function parsePdf(data: Uint8Array, onProgress?: (message: string) => void): Promise<Rows> {
  const result = layoutToRows(await extractPdfPages(data, onProgress))
  return 'rows' in result ? result.rows : linesToRows(result.text)
}

/** Odczytuje tekst każdej strony z położeniem i rozmiarem czcionki, ułożony w linie i komórki. */
export async function extractPdfPages(data: Uint8Array, onProgress?: (message: string) => void): Promise<Line[][]> {
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

    if (!pages.some((lines) => lines.some((line) => line.cells.length))) {
      throw new ApkgError('W tym PDF nie ma tekstu do odczytania (to pewnie skan albo zdjęcia).')
    }
    return pages
  } finally {
    void task.destroy()
  }
}
