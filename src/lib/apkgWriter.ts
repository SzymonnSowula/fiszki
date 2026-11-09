import { strToU8, zipSync } from 'fflate'
import type { SqlJsStatic } from 'sql.js'

/** Jedna fiszka do zapisania w paczce Anki. Pola mogą zawierać prosty HTML. */
export interface ExportCard {
  front: string
  back: string
  tags?: string[]
}

export interface ExportOptions {
  deckName: string
  cards: ExportCard[]
  /** Dla każdej fiszki także karta odwrotna (odpowiedź → pytanie). */
  reversed?: boolean
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`

const CSS = `.card { font-family: -apple-system, "Segoe UI", Arial, sans-serif; font-size: 20px; line-height: 1.45; text-align: left; color: #1b1b1b; background: #fdfdfd; padding: 8px 14px; }
.nightMode.card, .night_mode .card { color: #e8e8e8; background: #1e1e1e; }
.q { font-weight: 600; }
hr#answer { border: none; border-top: 1px solid #ccc; margin: 14px 0; }`

const LATEX_PRE =
  '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n'

function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stabilne id (talii/modelu) z nazwy – ten sam plik zaimportowany ponownie trafia do tej samej talii. */
function stableId(text: string): number {
  return 1_000_000_000 + (hash32(text) % 1_000_000_000)
}

function guidFor(text: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~'
  let a = hash32(text)
  let b = hash32(`${text}\u0001`)
  let out = ''
  for (let i = 0; i < 10; i += 1) {
    const source = i < 5 ? a : b
    out += alphabet[source % alphabet.length]
    if (i < 5) a = Math.floor(a / alphabet.length) + i * 7919
    else b = Math.floor(b / alphabet.length) + i * 104729
  }
  return out
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
}

async function checksum(text: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  const bytes = new Uint8Array(digest)
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
}

/** Buduje plik .apkg (format kolekcji Anki 2.1, schemat 11 – otwiera każdy Anki, AnkiDroid i AnkiMobile). */
export async function buildApkg(sql: SqlJsStatic, options: ExportOptions): Promise<Uint8Array> {
  const deckName = options.deckName.trim() || 'Fiszki'
  const cards = options.cards.filter((card) => stripHtml(card.front) && stripHtml(card.back))
  if (cards.length === 0) throw new Error('Nie ma żadnej pełnej fiszki (z pytaniem i odpowiedzią).')

  const now = Date.now()
  const nowSec = Math.floor(now / 1000)
  const deckId = stableId(`deck:${deckName}`)
  const modelId = stableId(options.reversed ? 'fiszki-model-basic-reversed-v1' : 'fiszki-model-basic-v1')

  const field = (name: string, ord: number) => ({ name, ord, font: 'Arial', media: [], rtl: false, size: 20, sticky: false })
  const template = (name: string, ord: number, qfmt: string, afmt: string) => ({ name, ord, qfmt, afmt, bqfmt: '', bafmt: '', bfont: '', bsize: 0, did: null })
  const tmpls = [template('Karta 1', 0, '<div class="q">{{Przód}}</div>', '{{FrontSide}}<hr id="answer">{{Tył}}')]
  if (options.reversed) tmpls.push(template('Karta 2', 1, '<div class="q">{{Tył}}</div>', '{{FrontSide}}<hr id="answer">{{Przód}}'))
  const model = {
    id: modelId,
    name: options.reversed ? 'Fiszki – przód/tył (+ odwrotna)' : 'Fiszki – przód/tył',
    type: 0,
    mod: nowSec,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls,
    flds: [field('Przód', 0), field('Tył', 1)],
    css: CSS,
    latexPre: LATEX_PRE,
    latexPost: '\\end{document}',
    latexsvg: false,
    req: options.reversed ? [[0, 'any', [0]], [1, 'any', [1]]] : [[0, 'any', [0]]],
    tags: [],
    vers: [],
  }
  const deckBase = { collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 10, extendRev: 50, lrnToday: [0, 0], newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0], usn: -1, mod: nowSec }
  const decks = {
    '1': { ...deckBase, id: 1, name: 'Default', usn: 0 },
    [deckId]: { ...deckBase, id: deckId, name: deckName },
  }
  const dconf = {
    '1': {
      id: 1, name: 'Default', mod: 0, usn: 0, autoplay: true, maxTaken: 60, replayq: true, timer: 0,
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
    },
  }
  const conf = {
    activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(modelId), dueCounts: true, estTimes: true,
    newBury: true, newSpread: 0, nextPos: cards.length + 1, sortBackwards: false, sortType: 'noteFld', timeLim: 0,
  }

  const db = new sql.Database()
  try {
    db.run(SCHEMA)
    db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      Math.floor(nowSec / 86400) * 86400, now, now,
      JSON.stringify(conf), JSON.stringify({ [modelId]: model }), JSON.stringify(decks), JSON.stringify(dconf), '{}',
    ])
    const insertNote = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)')
    const insertCard = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)')
    let id = now
    const seen = new Set<string>()
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i]
      const sortField = stripHtml(card.front)
      let guid = guidFor(`${deckName}\u0000${card.front}\u0000${card.back}`)
      while (seen.has(guid)) guid = guidFor(`${guid}+`)
      seen.add(guid)
      const tags = (card.tags ?? []).map((tag) => tag.trim().replace(/\s+/g, '_')).filter(Boolean)
      const noteId = (id += 1)
      insertNote.run([noteId, guid, modelId, nowSec, tags.length ? ` ${tags.join(' ')} ` : '', `${card.front}\u001f${card.back}`, sortField, await checksum(sortField), ''])
      for (let ord = 0; ord < tmpls.length; ord += 1) insertCard.run([(id += 1), noteId, deckId, ord, nowSec, i + 1, ''])
    }
    insertNote.free()
    insertCard.free()
    const collection = db.export()
    return zipSync({ 'collection.anki2': collection, media: strToU8('{}') }, { level: 6 })
  } finally {
    db.close()
  }
}
