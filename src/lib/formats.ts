export type FileKind = 'apkg' | 'csv' | 'txt' | 'md' | 'json' | 'xlsx' | 'ods' | 'docx' | 'odt' | 'pdf'

const EXTENSIONS: Record<string, FileKind> = {
  apkg: 'apkg',
  colpkg: 'apkg',
  csv: 'csv',
  tsv: 'csv',
  tab: 'csv',
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  json: 'json',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  ods: 'ods',
  docx: 'docx',
  odt: 'odt',
  pdf: 'pdf',
}

export const ACCEPT = Object.keys(EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',')

export const FORMATS_LABEL = 'Anki .apkg, PDF, CSV, Excel, Word, TXT, JSON'

export function fileKind(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return EXTENSIONS[ext] ?? null
}
