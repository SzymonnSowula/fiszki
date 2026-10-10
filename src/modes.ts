import type { Mode } from './types'

export interface ModeInfo {
  id: Mode
  title: string
  text: string
  hint: string
}

export const STUDY_MODES: ModeInfo[] = [
  {
    id: 'srs',
    title: 'Mądre uczenie',
    text: 'Oceniasz kartę, a na przycisku widać, kiedy wróci: w tej sesji, za 10 min, za dzień albo za 4 dni.',
    hint: 'Spacja odkrywa · 1–4 ocena',
  },
  {
    id: 'pins',
    title: 'Próbne szpilki',
    text: '30 sekund na strukturę. Wpisz nazwę po łacinie i po angielsku.',
    hint: 'Enter sprawdza · ogonki nie są konieczne',
  },
  {
    id: 'mixed',
    title: 'Trening mieszany',
    text: 'Quiz, wpisywanie, prawda/fałsz i odkrywanie — na zmianę.',
    hint: 'Enter przechodzi dalej',
  },
  {
    id: 'quiz',
    title: 'Quiz',
    text: 'Cztery podpisy. Wybierz ten, który pasuje do rysunku.',
    hint: 'Klawisze 1–4',
  },
  {
    id: 'type',
    title: 'Wpisz nazwę',
    text: 'Zobacz strukturę i wpisz nazwę po polsku, łacinie albo angielsku.',
    hint: 'Enter sprawdza · ogonki nie są konieczne',
  },
  {
    id: 'pairs',
    title: 'Pary',
    text: 'Połącz obraz z nazwą łacińską i angielską.',
    hint: 'Najpierw obraz, potem podpis',
  },
  {
    id: 'truefalse',
    title: 'Prawda czy fałsz',
    text: 'Czy ten podpis naprawdę opisuje rysunek?',
    hint: '1 prawda · 2 fałsz',
  },
  {
    id: 'sprint',
    title: 'Sprint',
    text: 'Minuta na zegarze. Ile podpisów rozpoznasz?',
    hint: 'Klawisze 1–4',
  },
]

export const MODE_INFO: Record<Mode, ModeInfo> = {
  ...Object.fromEntries(STUDY_MODES.map((mode) => [mode.id, mode])),
  browse: {
    id: 'browse',
    title: 'Przegląd',
    text: 'Przekartkuj całą talię bez ocen.',
    hint: 'Spacja odkrywa i przechodzi dalej',
  },
} as Record<Mode, ModeInfo>
