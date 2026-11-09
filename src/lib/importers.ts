import { ApkgError, parseApkg, type ParsedDeck } from './apkg'
import { FORMATS_LABEL, fileKind } from './formats'

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Talia'
}

export async function parseFile(
  file: File,
  onProgress: (message: string) => void,
): Promise<ParsedDeck[]> {
  const kind = fileKind(file.name)
  if (!kind) throw new ApkgError(`Ten format nie jest obsługiwany. Wybierz plik: ${FORMATS_LABEL}.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = baseName(file.name)

  if (kind === 'apkg') {
    const { loadSql } = await import('./sql')
    const sql = await loadSql()
    return parseApkg(bytes, sql, { fileName: file.name, onProgress })
  }

  onProgress('Czytam fiszki…')
  const tab = await import('./tabular')
  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf')
    return tab.sourcesToDecks([{ name, rows: await parsePdf(bytes, onProgress) }], kind)
  }
  if (kind === 'xlsx') return tab.sourcesToDecks(tab.parseXlsx(bytes, name), kind)
  if (kind === 'ods') return tab.sourcesToDecks(tab.parseOds(bytes, name), kind)
  if (kind === 'docx') return tab.sourcesToDecks([{ name, rows: tab.parseDocx(bytes) }], kind)
  if (kind === 'odt') return tab.sourcesToDecks([{ name, rows: tab.parseOdt(bytes) }], kind)

  const text = tab.decodeText(bytes)
  if (kind === 'json') return tab.sourcesToDecks([{ name, rows: tab.parseJson(text) }], kind)
  if (kind === 'md') return tab.sourcesToDecks([{ name, rows: tab.parseMarkdown(text) }], kind)
  const table = tab.parseTextTable(text, name, kind === 'csv')
  if (table) return tab.sourcesToDecks(table, kind)
  return tab.sourcesToDecks([{ name, rows: tab.linesToRows(text.split(/\r?\n/)) }], kind)
}
