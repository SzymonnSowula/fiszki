import { buildOptions, buildTruth, choiceLabel, type AnswerCard } from './answers'
import type { CardRow, Mode } from '../types'

export type Exercise = 'quiz' | 'type' | 'tf' | 'reveal'

export interface Prompt {
  card: CardRow
  exercise: Exercise
  options: string[]
  correctOption: string
  statement: string
  truthful: boolean
}

export function exerciseFor(mode: Mode, index: number): Exercise {
  if (mode === 'quiz' || mode === 'sprint') return 'quiz'
  if (mode === 'type') return 'type'
  if (mode === 'truefalse') return 'tf'
  if (mode === 'mixed') return (['quiz', 'type', 'tf', 'reveal'] as const)[index % 4]
  return 'reveal'
}

export function makePrompt(card: CardRow, exercise: Exercise, pool: readonly AnswerCard[]): Prompt {
  const correctOption = choiceLabel(card)
  if (exercise === 'quiz') {
    return { card, exercise, options: buildOptions(card, pool), correctOption, statement: '', truthful: true }
  }
  if (exercise === 'tf') {
    const truth = buildTruth(card, pool)
    return { card, exercise, options: [], correctOption, statement: truth.statement, truthful: truth.truthful }
  }
  return { card, exercise, options: [], correctOption, statement: '', truthful: true }
}
