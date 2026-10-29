import { shuffle } from './answers'
import { limitOf } from './settings'
import type { CardRow, Progress } from '../types'

export function buildSrsQueue(cards: readonly CardRow[], progress: readonly Progress[], newLimit: number, now = Date.now()): CardRow[] {
  const byKey = new Map(progress.map((row) => [row.key, row]))
  const due: CardRow[] = []
  const fresh: CardRow[] = []
  for (const card of cards) {
    const row = byKey.get(card.key)
    if (!row || row.state === 'new') fresh.push(card)
    else if (row.due <= now) due.push(card)
  }
  fresh.sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }))
  return shuffle(due).concat(fresh.slice(0, limitOf(newLimit, fresh.length)))
}

export function buildPracticeQueue(cards: readonly CardRow[], limit: number): CardRow[] {
  return shuffle(cards).slice(0, limitOf(limit, cards.length))
}

export function buildBrowseQueue(cards: readonly CardRow[]): CardRow[] {
  return [...cards].sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }))
}
