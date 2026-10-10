import type { ReactNode } from 'react'

export function SessionChrome({
  title,
  detail,
  hint,
  onExit,
  children,
}: {
  title: string
  detail: string
  hint?: string
  onExit: () => void
  children: ReactNode
}) {
  return (
    <section className="session">
      <div className="session-top">
        <button type="button" className="text-button back" onClick={onExit}>
          Wróć
        </button>
        <div>
          <h1>{title}</h1>
          <p className="muted">{detail}</p>
        </div>
      </div>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </section>
  )
}

export function DonePanel({
  kicker,
  title,
  text,
  onAgain,
  onExit,
}: {
  kicker: string
  title: string
  text: string
  onAgain?: () => void
  onExit: () => void
}) {
  return (
    <div className="done">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="row">
        {onAgain ? (
          <button type="button" className="button primary" onClick={onAgain}>
            Jeszcze raz
          </button>
        ) : null}
        <button type="button" className="button ghost" onClick={onExit}>
          Wróć do ćwiczeń
        </button>
      </div>
    </div>
  )
}
