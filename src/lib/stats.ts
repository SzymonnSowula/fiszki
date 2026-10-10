import type { Progress } from '../types'

export interface DeckStats {
  total: number
  fresh: number
  due: number
  mastered: number
  practiceSeen: number
  practiceCorrect: number
}

export function summarize(total: number, progress: readonly Progress[], now = Date.now()): DeckStats {
  let fresh = total
  let due = 0
  let mastered = 0
  let practiceSeen = 0
  let practiceCorrect = 0
  for (const row of progress) {
    practiceSeen += row.practiceSeen
    practiceCorrect += row.practiceCorrect
    if (row.state === 'new') continue
    fresh -= 1
    if (row.due <= now) due += 1
    else if (row.interval >= 21) mastered += 1
  }
  return {
    total,
    fresh: Math.max(0, fresh),
    due,
    mastered,
    practiceSeen,
    practiceCorrect,
  }
}

export function karty(count: number): string {
  if (count === 1) return '1 fiszka'
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} fiszki`
  return `${count} fiszek`
}
