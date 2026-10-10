export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}

export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost)
      previous = saved
    }
  }
  return row[b.length]
}

export interface AnswerCard {
  key: string
  lines: string[]
  frontText: string
}

export function choiceLabel(card: Pick<AnswerCard, 'lines' | 'frontText'>): string {
  if (card.lines.length > 0) return card.lines[card.lines.length - 1]
  const front = card.frontText.trim()
  return front || '—'
}

/** Latin and English only. Three-line anatomy cards are Latin, English, Polish. */
export function latinEnglishLabel(card: Pick<AnswerCard, 'lines' | 'frontText'>): string {
  const latin = card.lines[0]?.trim() ?? ''
  const english = card.lines.length >= 2 ? card.lines[1].trim() : ''
  if (latin && english) return `${latin} · ${english}`
  if (latin) return latin
  const front = card.frontText.trim()
  return front || '—'
}

export function answerMatchesLine(input: string, expected: string): boolean {
  return answerMatches(input, [expected])
}

export function answerMatches(input: string, lines: string[]): boolean {
  const typed = normalizeAnswer(input)
  if (typed.length < 2) return false
  return lines.some((line) => {
    const expected = normalizeAnswer(line)
    if (!expected) return false
    if (expected === typed) return true
    if (expected.includes(typed) && typed.length >= Math.max(4, Math.ceil(expected.length * 0.72))) return true
    if (typed.includes(expected) && expected.length >= 4) return true
    const limit = expected.length <= 8 ? 1 : expected.length <= 18 ? 2 : 3
    return levenshtein(typed, expected) <= limit
  })
}

export function buildOptions(card: AnswerCard, pool: readonly AnswerCard[]): string[] {
  const correct = choiceLabel(card)
  const used = new Set([normalizeAnswer(correct)])
  const options = [correct]
  for (const other of shuffle(pool)) {
    if (other.key === card.key) continue
    let label = choiceLabel(other)
    if (used.has(normalizeAnswer(label))) {
      const extra = other.lines[0]
      if (extra && normalizeAnswer(extra) !== normalizeAnswer(label)) label = `${label} · ${extra}`
    }
    const key = normalizeAnswer(label)
    if (!key || used.has(key)) continue
    used.add(key)
    options.push(label)
    if (options.length >= 4) break
  }
  return shuffle(options)
}

export function buildTruth(
  card: AnswerCard,
  pool: readonly AnswerCard[],
  rng: () => number = Math.random,
): { statement: string; truthful: boolean } {
  const correct = choiceLabel(card)
  const wantTruth = rng() < 0.5
  if (wantTruth) return { statement: correct, truthful: true }
  const others = pool.filter((other) => other.key !== card.key && normalizeAnswer(choiceLabel(other)) !== normalizeAnswer(correct))
  if (others.length === 0) return { statement: correct, truthful: true }
  const other = others[Math.floor(rng() * others.length)]
  return { statement: choiceLabel(other), truthful: false }
}
