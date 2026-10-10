export type Mode = 'srs' | 'pins' | 'mixed' | 'quiz' | 'type' | 'truefalse' | 'pairs' | 'sprint' | 'browse'

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface CardRow {
  key: string
  deckId: string
  cardId: string
  frontHtml: string
  answerHtml: string
  lines: string[]
  frontText: string
  mediaName: string | null
  css: string
}

export interface DeckRow {
  id: string
  ankiId: string
  name: string
  sourceFile: string
  importedAt: number
  studiedAt: number
  cardCount: number
}

export interface MediaRow {
  key: string
  deckId: string
  filename: string
  mime: string
  data: Blob
}

export interface Progress {
  key: string
  deckId: string
  ease: number
  interval: number
  reps: number
  lapses: number
  due: number
  state: 'new' | 'review'
  reviews: number
  correct: number
  practiceSeen: number
  practiceCorrect: number
  /** Gap until the next review. Older saves only have `interval` in days. */
  delayMs?: number
}
