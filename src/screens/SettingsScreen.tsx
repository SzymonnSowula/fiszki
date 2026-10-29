import { useState } from 'react'
import { DEFAULT_SETTINGS, joinDelay, loadSettings, saveSettings, splitDelay, UNITS, type Settings, type UnitId } from '../lib/settings'
import { formatDelay, nextDelays } from '../lib/srs'
import type { Grade } from '../types'

type Steps = Settings['steps']
type Growth = Settings['growth']

const GRADE_ROWS: { id: Grade; label: string; growth?: keyof Growth }[] = [
  { id: 'again', label: 'Znów' },
  { id: 'hard', label: 'Trudne', growth: 'hard' },
  { id: 'good', label: 'Dobrze', growth: 'good' },
  { id: 'easy', label: 'Łatwo', growth: 'easy' },
]

/** Keeps what the user is typing, and only reports values that are valid. */
function NumberInput({
  value,
  min,
  step,
  placeholder,
  disabled,
  onCommit,
}: {
  value: number | null
  min: number
  step?: number | 'any'
  placeholder?: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  const shown = focused ? text : value === null ? '' : String(value)
  return (
    <input
      type="number"
      min={min}
      step={step ?? 1}
      inputMode={step === 'any' || (typeof step === 'number' && step < 1) ? 'decimal' : 'numeric'}
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => {
        setText(value === null ? '' : String(value))
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setText(event.target.value)
        const next = Number(event.target.value.replace(',', '.'))
        if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min) onCommit(next)
      }}
    />
  )
}

function CountField({
  label,
  note,
  value,
  onChange,
}: {
  label: string
  note: string
  value: number
  onChange: (value: number) => void
}) {
  const all = value === 0
  const [last, setLast] = useState(all ? 20 : value)
  return (
    <div className="setting">
      <div>
        <p className="setting-title">{label}</p>
        <p className="muted small">{note}</p>
      </div>
      <div className="setting-controls">
        <NumberInput
          min={1}
          value={all ? null : value}
          placeholder="wszystkie"
          disabled={all}
          onCommit={(next) => {
            const whole = Math.max(1, Math.round(next))
            setLast(whole)
            onChange(whole)
          }}
        />
        <label className="check">
          <input type="checkbox" checked={all} onChange={(event) => onChange(event.target.checked ? 0 : last)} />
          Cała talia
        </label>
      </div>
    </div>
  )
}

function DelayField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [unit, setUnit] = useState<UnitId>(() => splitDelay(value).unit)
  const size = UNITS.find((item) => item.id === unit)?.ms ?? 60_000
  const amount = Math.round((value / size) * 100) / 100
  return (
    <span className="delay-field">
      <NumberInput value={amount} min={0.1} step="any" onCommit={(next) => onChange(joinDelay(next, unit))} />
      <select
        value={unit}
        onChange={(event) => {
          const nextUnit = event.target.value as UnitId
          setUnit(nextUnit)
          onChange(joinDelay(amount, nextUnit))
        }}
      >
        {UNITS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(loadSettings)
  const [saved, setSaved] = useState(false)
  const [resets, setResets] = useState(0)

  function change(patch: Partial<Settings>) {
    setSettings((current) => saveSettings({ ...current, ...patch }))
    setSaved(true)
  }

  function setStep(id: keyof Steps, value: number) {
    change({ steps: { ...settings.steps, [id]: value } })
  }

  function setGrowth(id: keyof Growth, value: number) {
    change({ growth: { ...settings.growth, [id]: value } })
  }

  const fresh = nextDelays(0, true, settings)
  const later = nextDelays(settings.steps.good, false, settings)
  const pinsTimed = settings.pinsSeconds > 0

  return (
    <div className="stack settings" key={resets}>
      <button type="button" className="text-button back" onClick={onBack}>
        Wróć
      </button>
      <header className="deck-hero">
        <p className="kicker">Ustawienia</p>
        <h1>Jak chcesz się uczyć</h1>
        <p className="lead">Zmiany zapisują się od razu i działają od następnej sesji.{saved ? ' Zapisano.' : ''}</p>
      </header>

      <section className="setting-group">
        <h2>Ile fiszek na raz</h2>
        <CountField
          label="Nowe karty w mądrym uczeniu"
          note="Powtórki z terminem na dziś wchodzą zawsze, niezależnie od tej liczby."
          value={settings.newPerSession}
          onChange={(value) => change({ newPerSession: value })}
        />
        <CountField
          label="Karty w ćwiczeniach"
          note="Quiz, wpisywanie, prawda/fałsz, trening mieszany i pary."
          value={settings.practiceSize}
          onChange={(value) => change({ practiceSize: value })}
        />
        <CountField
          label="Karty w szpilkach"
          note="Ile struktur w jednej rundzie próbnych szpilek."
          value={settings.pinsSize}
          onChange={(value) => change({ pinsSize: value })}
        />
      </section>

      <section className="setting-group">
        <h2>Czas</h2>
        <div className="setting">
          <div>
            <p className="setting-title">Limit czasu w szpilkach</p>
            <p className="muted small">Wyłącz, jeśli chcesz się spokojnie uczyć bez zegara.</p>
          </div>
          <div className="setting-controls">
            <NumberInput
              min={5}
              value={pinsTimed ? settings.pinsSeconds : null}
              placeholder="bez limitu"
              disabled={!pinsTimed}
              onCommit={(next) => change({ pinsSeconds: Math.round(next) })}
            />
            <span className="muted">s</span>
            <label className="check">
              <input type="checkbox" checked={pinsTimed} onChange={(event) => change({ pinsSeconds: event.target.checked ? 30 : 0 })} />
              Na czas
            </label>
          </div>
        </div>
        <div className="setting">
          <div>
            <p className="setting-title">Długość sprintu</p>
            <p className="muted small">Sprint zawsze jest na czas — to jego sens.</p>
          </div>
          <div className="setting-controls">
            <NumberInput min={10} value={settings.sprintSeconds} onCommit={(next) => change({ sprintSeconds: Math.round(next) })} />
            <span className="muted">s</span>
          </div>
        </div>
      </section>

      <section className="setting-group">
        <h2>Przyciski oceny</h2>
        <p className="muted small">
          „Pierwszy raz” to odstęp dla karty bez historii. „Potem ×” mnoży poprzedni odstęp przy kolejnych powtórkach. „Znów” najpierw
          wraca jeszcze w tej sesji, a przy drugim „Znów” — po ustawionym czasie.
        </p>
        <div className="grade-table">
          <span />
          <span className="muted small">Pierwszy raz</span>
          <span className="muted small">Potem ×</span>
          {GRADE_ROWS.map((row) => (
            <div key={row.id} className="grade-row">
              <span className={`grade-name ${row.id}`}>{row.label}</span>
              <DelayField value={settings.steps[row.id]} onChange={(value) => setStep(row.id, value)} />
              {row.growth ? (
                <NumberInput min={1} step={0.1} value={settings.growth[row.growth]} onCommit={(next) => setGrowth(row.growth!, next)} />
              ) : (
                <span className="muted small">—</span>
              )}
            </div>
          ))}
        </div>
        <p className="muted small">
          Podgląd nowej karty: Trudne {formatDelay(fresh.hard)} · Dobrze {formatDelay(fresh.good)} · Łatwo {formatDelay(fresh.easy)}. Po
          „Dobrze” następnym razem: Dobrze {formatDelay(later.good)} · Łatwo {formatDelay(later.easy)}.
        </p>
      </section>

      <div className="row">
        <button
          type="button"
          className="button ghost"
          onClick={() => {
            setSettings(saveSettings(DEFAULT_SETTINGS))
            setResets((value) => value + 1)
            setSaved(true)
          }}
        >
          Przywróć domyślne
        </button>
      </div>
    </div>
  )
}
