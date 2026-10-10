import { getMedia } from './db'

const urls = new Map<string, string>()

export async function mediaUrl(deckId: string, filename: string): Promise<string | null> {
  const key = `${deckId}:${filename}`
  const cached = urls.get(key)
  if (cached) return cached
  const row = await getMedia(key)
  if (!row) return null
  const url = URL.createObjectURL(row.data)
  urls.set(key, url)
  return url
}

export function revokeDeckMedia(deckId: string): void {
  const prefix = `${deckId}:`
  for (const [key, url] of urls) {
    if (!key.startsWith(prefix)) continue
    URL.revokeObjectURL(url)
    urls.delete(key)
  }
}
