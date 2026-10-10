const ENTITY: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (full, name: string) => ENTITY[name.toLowerCase()] ?? full)
}

export function stripHtml(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

export function textLines(html: string): string[] {
  return stripHtml(html)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function rewriteMedia(html: string): string {
  const withSound = html.replace(/\[sound:([^\]]+)\]/gi, (_, file: string) => {
    const name = file.trim()
    return `<audio controls preload="none" src="anki-media:${encodeURIComponent(name)}"></audio>`
  })
  return withSound.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (full, prefix: string, quote: string, src: string) => {
    if (src.startsWith('anki-media:')) return full
    const file = safeDecode((src.split('/').pop() ?? src).split('?')[0] ?? src)
    return `${prefix}${quote}anki-media:${encodeURIComponent(file)}${quote}`
  })
}

export function firstMedia(html: string): string | null {
  const match = html.match(/anki-media:([^"'\s>]+)/)
  return match ? safeDecode(match[1]) : null
}

function fieldNonEmpty(fields: Record<string, string>, name: string): boolean {
  const value = fields[name.trim()] ?? ''
  return textLines(value).length > 0 || /<img\b/i.test(value) || /\[sound:/i.test(value) || /anki-media:/i.test(value)
}

export function applyCloze(text: string, ord: number, reveal: boolean): string {
  const active = ord + 1
  return text.replace(/\{\{c(\d+)::([^}]*)\}\}/g, (_full, numRaw: string, body: string) => {
    const num = Number(numRaw)
    const splitAt = body.indexOf('::')
    const answer = splitAt === -1 ? body : body.slice(0, splitAt)
    const hint = splitAt === -1 ? '' : body.slice(splitAt + 2)
    if (num !== active) return answer
    if (reveal) return `<span class="cloze">${answer}</span>`
    return `<span class="cloze">[${hint || '...'}]</span>`
  })
}

function expandToken(
  raw: string,
  fields: Record<string, string>,
  ord: number,
  reveal: boolean,
  frontSide: string,
  cloze: boolean,
): string {
  const token = raw.trim()
  if (!token || token.startsWith('#')) return ''
  if (token === 'FrontSide') return frontSide
  const modified = token.match(/^(cloze|text|type|hint):(.+)$/)
  if (modified) {
    const [, mod, fieldName] = modified
    const value = fields[fieldName.trim()] ?? ''
    if (mod === 'text') return textLines(value).join(' ')
    if (mod === 'hint') return reveal ? value : '…'
    if (mod === 'cloze') return applyCloze(value, ord, reveal)
    return value
  }
  const value = fields[token] ?? ''
  return cloze ? applyCloze(value, ord, reveal) : value
}

export function renderTemplate(
  template: string,
  fields: Record<string, string>,
  ord: number,
  reveal: boolean,
  frontSide = '',
  cloze = false,
): string {
  let current = template
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current
      .replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_full, name: string, inner: string) =>
        fieldNonEmpty(fields, name) ? inner : '',
      )
      .replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_full, name: string, inner: string) =>
        fieldNonEmpty(fields, name) ? '' : inner,
      )
    if (next === current) break
    current = next
  }
  const rendered = current.replace(/\{\{([^}]+)\}\}/g, (_full, raw: string) =>
    expandToken(raw, fields, ord, reveal, frontSide, cloze),
  )
  return rewriteMedia(rendered)
}

export function splitAnswer(full: string, front: string): string {
  const quoted = full.split(/<hr[^>]*id=(['"])answer\1[^>]*>/i)
  if (quoted.length > 1) return quoted.slice(1).join('')
  const bare = full.split(/<hr[^>]*id=answer[^>]*>/i)
  if (bare.length > 1) return bare.slice(1).join('')
  if (front && full.startsWith(front)) return full.slice(front.length)
  return full
}

export function isPlainAnswer(html: string): boolean {
  return !/<(?!br\s*\/?>)[a-z!]/i.test(html)
}
