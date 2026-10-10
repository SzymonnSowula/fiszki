import { useEffect, useState } from 'react'
import { mediaUrl } from '../lib/mediaCache'
import { safeDecode } from '../lib/html'
import { sanitizeCss, sanitizeHtml } from '../lib/sanitize'

function useResolvedHtml(html: string, deckId: string): { html: string; pending: boolean } {
  const [resolved, setResolved] = useState<string | null>(html.trim() ? null : '')

  useEffect(() => {
    if (!html.trim()) {
      setResolved('')
      return
    }
    let cancel = false
    setResolved(null)
    void resolveMedia(html, deckId).then((next) => {
      if (!cancel) setResolved(next)
    })
    return () => {
      cancel = true
    }
  }, [html, deckId])

  return { html: resolved ?? '', pending: resolved === null }
}

async function resolveMedia(html: string, deckId: string): Promise<string> {
  const names = [...html.matchAll(/anki-media:([^"'\s>]+)/g)].map((match) => safeDecode(match[1]))
  const urls = new Map<string, string>()
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const url = await mediaUrl(deckId, name)
      if (url) urls.set(name, url)
    }),
  )
  const replaced = html.replace(/anki-media:([^"'\s>]+)/g, (_full, raw: string) => urls.get(safeDecode(raw)) ?? '')
  return sanitizeHtml(replaced)
}

export function CardFace({ html, css, deckId }: { html: string; css: string; deckId: string }) {
  const view = useResolvedHtml(html, deckId)
  return (
    <div className="anki-wrap">
      {css ? <style>{sanitizeCss(css)}</style> : null}
      {view.pending ? (
        <div className="ghost" aria-hidden="true" />
      ) : (
        <div className="card anki-html" dangerouslySetInnerHTML={{ __html: view.html }} />
      )}
    </div>
  )
}

export function LineList({ lines }: { lines: string[] }) {
  return (
    <ol className="lines">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`} className={index === lines.length - 1 ? 'primary' : undefined}>
          {line}
        </li>
      ))}
    </ol>
  )
}
