import { blankProgress } from './srs'
import type { CardRow, DeckRow, MediaRow, Progress } from '../types'
import type { ParsedDeck } from './apkg'

const DB_NAME = 'fiszki'
const DB_VERSION = 1

let opening: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('cards')) {
        const cards = db.createObjectStore('cards', { keyPath: 'key' })
        cards.createIndex('deckId', 'deckId', { unique: false })
      }
      if (!db.objectStoreNames.contains('media')) {
        const media = db.createObjectStore('media', { keyPath: 'key' })
        media.createIndex('deckId', 'deckId', { unique: false })
      }
      if (!db.objectStoreNames.contains('progress')) {
        const progress = db.createObjectStore('progress', { keyPath: 'key' })
        progress.createIndex('deckId', 'deckId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error('Nie udało się otworzyć zapisanych talii.'))
    }
  })
  return opening
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function deckStorageId(ankiId: string, name: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${ankiId}:${(hash >>> 0).toString(16)}`
}

function blobFrom(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: mime })
}

export async function replaceDeck(deck: DeckRow, cards: CardRow[], media: { filename: string; mime: string; data: Uint8Array }[]): Promise<void> {
  const previous = await progressFor(deck.id)
  const live = new Set(cards.map((card) => card.key))
  const kept = previous.filter((row) => live.has(row.key))
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['decks', 'cards', 'media', 'progress'], 'readwrite')
    let failed = false
    const fail = (error: DOMException | null) => {
      if (failed) return
      failed = true
      const quota = error?.name === 'QuotaExceededError'
      reject(new Error(quota ? 'Przeglądarka nie ma miejsca na obrazy tej talii.' : 'Nie udało się zapisać talii.'))
    }
    tx.oncomplete = () => {
      if (!failed) resolve()
    }
    tx.onerror = () => fail(tx.error)
    tx.onabort = () => fail(tx.error)

    tx.objectStore('decks').put(deck)
    const cardStore = tx.objectStore('cards')
    const cardKeys = cardStore.index('deckId').getAllKeys(deck.id)
    cardKeys.onerror = () => fail(cardKeys.error)
    cardKeys.onsuccess = () => {
      for (const key of cardKeys.result) cardStore.delete(key)
      for (const card of cards) cardStore.put(card)
    }

    const mediaStore = tx.objectStore('media')
    const mediaKeys = mediaStore.index('deckId').getAllKeys(deck.id)
    mediaKeys.onerror = () => fail(mediaKeys.error)
    mediaKeys.onsuccess = () => {
      for (const key of mediaKeys.result) mediaStore.delete(key)
      for (const item of media) {
        const row: MediaRow = {
          key: `${deck.id}:${item.filename}`,
          deckId: deck.id,
          filename: item.filename,
          mime: item.mime,
          data: blobFrom(item.data, item.mime),
        }
        mediaStore.put(row)
      }
    }

    const progressStore = tx.objectStore('progress')
    const progressKeys = progressStore.index('deckId').getAllKeys(deck.id)
    progressKeys.onerror = () => fail(progressKeys.error)
    progressKeys.onsuccess = () => {
      for (const key of progressKeys.result) progressStore.delete(key)
      for (const row of kept) progressStore.put(row)
    }
  })
}

export async function saveImported(decks: ParsedDeck[], sourceFile: string): Promise<string[]> {
  const now = Date.now()
  const ids: string[] = []
  for (const parsed of decks) {
    const id = deckStorageId(parsed.ankiId, parsed.name)
    ids.push(id)
    const existing = await getDeck(id)
    const deck: DeckRow = {
      id,
      ankiId: parsed.ankiId,
      name: parsed.name,
      sourceFile,
      importedAt: existing?.importedAt ?? now,
      studiedAt: existing?.studiedAt ?? now,
      cardCount: parsed.cards.length,
    }
    const cards: CardRow[] = parsed.cards.map((card) => ({
      key: `${id}:${card.cardId}`,
      deckId: id,
      cardId: card.cardId,
      frontHtml: card.frontHtml,
      answerHtml: card.answerHtml,
      lines: card.lines,
      frontText: card.frontText,
      mediaName: card.mediaName,
      css: card.css,
    }))
    await replaceDeck(deck, cards, parsed.media)
  }
  return ids
}

export async function listDecks(): Promise<DeckRow[]> {
  const db = await openDb()
  const rows = await requestToPromise(db.transaction('decks', 'readonly').objectStore('decks').getAll() as IDBRequest<DeckRow[]>)
  return rows.slice().sort((a, b) => b.studiedAt - a.studiedAt || b.importedAt - a.importedAt)
}

export async function listProgress(): Promise<Progress[]> {
  const db = await openDb()
  return requestToPromise(db.transaction('progress', 'readonly').objectStore('progress').getAll() as IDBRequest<Progress[]>)
}

export async function getDeck(id: string): Promise<DeckRow | null> {
  const db = await openDb()
  const row = await requestToPromise(db.transaction('decks', 'readonly').objectStore('decks').get(id) as IDBRequest<DeckRow | undefined>)
  return row ?? null
}

export async function cardsFor(deckId: string): Promise<CardRow[]> {
  const db = await openDb()
  const rows = await requestToPromise(
    db.transaction('cards', 'readonly').objectStore('cards').index('deckId').getAll(deckId) as IDBRequest<CardRow[]>,
  )
  return rows.slice().sort((a, b) => a.cardId.localeCompare(b.cardId, undefined, { numeric: true }))
}

export async function progressFor(deckId: string): Promise<Progress[]> {
  const db = await openDb()
  return requestToPromise(
    db.transaction('progress', 'readonly').objectStore('progress').index('deckId').getAll(deckId) as IDBRequest<Progress[]>,
  )
}

export async function getProgress(key: string): Promise<Progress | null> {
  const db = await openDb()
  const row = await requestToPromise(db.transaction('progress', 'readonly').objectStore('progress').get(key) as IDBRequest<Progress | undefined>)
  return row ?? null
}

export async function getMedia(key: string): Promise<MediaRow | null> {
  const db = await openDb()
  const row = await requestToPromise(db.transaction('media', 'readonly').objectStore('media').get(key) as IDBRequest<MediaRow | undefined>)
  return row ?? null
}

export async function putProgress(row: Progress): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['progress', 'decks'], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore('progress').put(row)
    const deckRequest = tx.objectStore('decks').get(row.deckId)
    deckRequest.onsuccess = () => {
      const deck = deckRequest.result as DeckRow | undefined
      if (!deck) return
      tx.objectStore('decks').put({ ...deck, studiedAt: Date.now() })
    }
  })
}

export async function recordPractice(deckId: string, cardKey: string, ok: boolean): Promise<void> {
  const current = (await getProgress(cardKey)) ?? blankProgress(cardKey, deckId)
  const next: Progress = {
    ...current,
    practiceSeen: current.practiceSeen + 1,
    practiceCorrect: current.practiceCorrect + (ok ? 1 : 0),
  }
  await putProgress(next)
}

async function clearStore(storeName: 'cards' | 'media' | 'progress', deckId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    const store = tx.objectStore(storeName)
    const keys = store.index('deckId').getAllKeys(deckId)
    keys.onsuccess = () => {
      for (const key of keys.result) store.delete(key)
    }
  })
}

export async function resetProgress(deckId: string): Promise<void> {
  await clearStore('progress', deckId)
}

export async function deleteDeck(deckId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['decks', 'cards', 'media', 'progress'], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore('decks').delete(deckId)
    for (const name of ['cards', 'media', 'progress'] as const) {
      const store = tx.objectStore(name)
      const keys = store.index('deckId').getAllKeys(deckId)
      keys.onsuccess = () => {
        for (const key of keys.result) store.delete(key)
      }
    }
  })
}
