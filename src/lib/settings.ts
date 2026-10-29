// Kept local: srs.ts imports this module, so importing DAY back would be circular.
const DAY = 86_400_000

const KEY = 'fiszki.settings'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Card counts use 0 for "the whole deck". Timer seconds use 0 for "no limit". */
export interface Settings {
  newPerSession: number
  practiceSize: number
  pinsSize: number
  pinsSeconds: number
  sprintSeconds: number
  /** First gap after each button, before the card has any history. */
  steps: { again: number; hard: number; good: number; easy: number }
  /** How much the previous gap grows on later reviews. */
  growth: { hard: number; good: number; easy: number }
}

export const DEFAULT_SETTINGS: Settings = {
  newPerSession: 20,
  practiceSize: 15,
  pinsSize: 10,
  pinsSeconds: 30,
  sprintSeconds: 60,
  steps: { again: 10 * MINUTE, hard: 10 * MINUTE, good: DAY, easy: 4 * DAY },
  growth: { hard: 1.2, good: 2.5, easy: 3.5 },
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function clean(raw: Partial<Settings> | null | undefined): Settings {
  const d = DEFAULT_SETTINGS
  const steps: Partial<Settings['steps']> = raw?.steps ?? {}
  const growth: Partial<Settings['growth']> = raw?.growth ?? {}
  const maxStep = 3650 * DAY
  return {
    newPerSession: Math.round(number(raw?.newPerSession, d.newPerSession, 0, 100_000)),
    practiceSize: Math.round(number(raw?.practiceSize, d.practiceSize, 0, 100_000)),
    pinsSize: Math.round(number(raw?.pinsSize, d.pinsSize, 0, 100_000)),
    pinsSeconds: Math.round(number(raw?.pinsSeconds, d.pinsSeconds, 0, 3600)),
    sprintSeconds: Math.round(number(raw?.sprintSeconds, d.sprintSeconds, 10, 3600)),
    steps: {
      again: number(steps.again, d.steps.again, MINUTE, maxStep),
      hard: number(steps.hard, d.steps.hard, MINUTE, maxStep),
      good: number(steps.good, d.steps.good, MINUTE, maxStep),
      easy: number(steps.easy, d.steps.easy, MINUTE, maxStep),
    },
    growth: {
      hard: number(growth.hard, d.growth.hard, 1, 10),
      good: number(growth.good, d.growth.good, 1, 10),
      easy: number(growth.easy, d.growth.easy, 1, 20),
    },
  }
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY)
    return clean(text ? (JSON.parse(text) as Partial<Settings>) : null)
  } catch {
    return clean(null)
  }
}

export function saveSettings(settings: Settings): Settings {
  const next = clean(settings)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode or full storage: settings still apply until the page reloads.
  }
  return next
}

export function limitOf(count: number, available: number): number {
  return count <= 0 ? available : Math.min(count, available)
}

export const UNITS = [
  { id: 'min', label: 'min', ms: MINUTE },
  { id: 'hour', label: 'godz.', ms: HOUR },
  { id: 'day', label: 'dni', ms: DAY },
] as const

export type UnitId = (typeof UNITS)[number]['id']

/** Picks the largest unit that shows the gap as a whole number. */
export function splitDelay(ms: number): { value: number; unit: UnitId } {
  for (const unit of [...UNITS].reverse()) {
    if (ms >= unit.ms && ms % unit.ms === 0) return { value: ms / unit.ms, unit: unit.id }
  }
  return { value: Math.max(1, Math.round(ms / MINUTE)), unit: 'min' }
}

export function joinDelay(value: number, unit: UnitId): number {
  const size = UNITS.find((item) => item.id === unit)?.ms ?? MINUTE
  return Math.round(value * size)
}
