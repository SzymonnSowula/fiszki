import type { Grade, Progress } from '../types'

export const DAY = 86_400_000
export const TEN_MIN = 10 * 60_000
const HOUR = 60 * 60_000

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function blankProgress(key: string, deckId: string): Progress {
  return {
    key,
    deckId,
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: 0,
    state: 'new',
    reviews: 0,
    correct: 0,
    practiceSeen: 0,
    practiceCorrect: 0,
    delayMs: 0,
  }
}

/** Milliseconds until the next review. Older rows stored only whole days in `interval`. */
export function scheduledDelay(progress: Progress): number {
  if (typeof progress.delayMs === 'number') return progress.delayMs
  if (progress.interval > 0) return progress.interval * DAY
  return 0
}

export function nextDelays(previousMs: number, againRepeat: boolean): Record<Grade, number> {
  const again = againRepeat ? TEN_MIN : 0
  const good = previousMs < DAY ? DAY : Math.round(previousMs * 2.5)
  let easy = previousMs < 4 * DAY ? 4 * DAY : Math.round(previousMs * 3.5)
  if (easy <= good) easy = Math.round(good * 1.4)
  let hard = previousMs < DAY ? TEN_MIN : Math.min(DAY, Math.max(TEN_MIN, Math.round(previousMs * 0.4)))
  if (hard <= again) hard = HOUR
  if (hard >= good) hard = Math.max(HOUR, Math.round(good / 2))
  if (hard >= good) hard = Math.max(TEN_MIN, good - HOUR)
  return { again, hard, good, easy }
}

export function applyGrade(progress: Progress, grade: Grade, now = Date.now(), againRepeat = false): Progress {
  const delay = nextDelays(scheduledDelay(progress), grade === 'again' && againRepeat)[grade]
  const next: Progress = {
    ...progress,
    reviews: progress.reviews + 1,
    delayMs: delay,
    due: now + delay,
    interval: Math.floor(delay / DAY),
    state: 'review',
  }
  if (grade === 'good' || grade === 'easy') next.correct += 1
  if (grade === 'again') {
    next.reps = 0
    next.lapses = progress.lapses + 1
    next.ease = Math.max(1.3, round2(progress.ease - 0.2))
    return next
  }
  const quality = grade === 'hard' ? 3 : grade === 'good' ? 4 : 5
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  next.ease = Math.max(1.3, round2(progress.ease + delta))
  next.reps = progress.reps + 1
  return next
}

export function formatDelay(ms: number): string {
  if (ms <= 0) return 'w tej sesji'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 20) return hours === 1 ? '1 godz.' : `${hours} godz.`
  const days = ms / DAY
  if (days < 1.25) return '1 dzień'
  const rounded = Math.round(days * 10) / 10
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    const whole = Math.round(rounded)
    return whole === 1 ? '1 dzień' : `${whole} dni`
  }
  return `${rounded.toFixed(1).replace('.', ',')} dnia`
}
