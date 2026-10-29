import 'fake-indexeddb/auto'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { answerMatches, answerMatchesLine, buildOptions, latinEnglishLabel } from '../src/lib/answers'
import { parseApkg } from '../src/lib/apkg'
import { cardsFor, deckStorageId, getMedia, saveImported } from '../src/lib/db'
import { renderTemplate } from '../src/lib/html'
import { DEFAULT_SETTINGS, limitOf, joinDelay, splitDelay } from '../src/lib/settings'
import { DAY, applyGrade, blankProgress, formatDelay, nextDelays } from '../src/lib/srs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function unit() {
  const question = renderTemplate('{{cloze:Text}}', { Text: '{{c1::serce}} pompuje {{c2::krew}}' }, 0, false)
  assert(question.includes('[...]'), question)
  assert(question.includes('krew'), question)
  assert(!question.includes('serce'), question)
  const answer = renderTemplate('{{cloze:Text}}', { Text: '{{c1::serce}} pompuje {{c2::krew}}' }, 0, true)
  assert(answer.includes('serce'), answer)

  const hidden = renderTemplate('{{#Back}}jest{{/Back}}{{^Back}}pusto{{/Back}}', { Back: '' }, 0, false)
  assert(hidden.includes('pusto'), hidden)
  const shown = renderTemplate('{{#Back}}{{Back}}{{/Back}}', { Back: 'żebro' }, 0, false)
  assert(shown.includes('żebro'), shown)

  const image = renderTemplate('{{Front}}', { Front: '<img src="kosci.jpg">' }, 0, false)
  assert(image.includes('anki-media:kosci.jpg'), image)

  assert(answerMatches('luk zebrowy', ['Arcus costalis', 'Costal arch', 'Łuk żebrowy']))
  assert(answerMatches('arcus costalis', ['Arcus costalis', 'Costal arch', 'Łuk żebrowy']))
  assert(!answerMatches('zebro', ['Arcus costalis', 'Costal arch', 'Łuk żebrowy']))

  const label = latinEnglishLabel({ lines: ['Arcus costalis', 'Costal arch', 'Łuk żebrowy'], frontText: '' })
  assert(label === 'Arcus costalis · Costal arch', label)
  assert(!label.includes('Łuk'), label)
  assert(answerMatchesLine('arcus costalis', 'Arcus costalis'))
  assert(!answerMatchesLine('luk zebrowy', 'Arcus costalis'))
  assert(!answerMatchesLine('luk zebrowy', 'Costal arch'))

  const TEN_MIN = 10 * 60_000
  let progress = blankProgress('card', 'deck')
  const freshDelays = nextDelays(0, false)
  const freshLabels = (['again', 'hard', 'good', 'easy'] as const).map((grade) => formatDelay(freshDelays[grade]))
  assert(new Set(freshLabels).size === 4, freshLabels.join(' | '))
  assert(freshDelays.again === 0 && freshDelays.hard === TEN_MIN && freshDelays.good === DAY && freshDelays.easy === 4 * DAY, JSON.stringify(freshDelays))
  progress = applyGrade(progress, 'good', 1_000_000)
  assert(progress.delayMs === DAY && progress.due === 1_000_000 + DAY && progress.reps === 1, JSON.stringify(progress))
  progress = applyGrade(progress, 'good', 1_000_000)
  assert(progress.delayMs === Math.round(DAY * 2.5) && progress.reps === 2, JSON.stringify(progress))
  const failed = applyGrade(blankProgress('card', 'deck'), 'again', 1_000_000, false)
  assert(failed.delayMs === 0 && failed.reps === 0 && failed.lapses === 1, JSON.stringify(failed))
  const failedAgain = applyGrade(failed, 'again', 1_000_000, true)
  assert(failedAgain.delayMs === TEN_MIN && failedAgain.due === 1_000_000 + TEN_MIN, JSON.stringify(failedAgain))
  const hardAfterGood = nextDelays(DAY, false).hard
  const goodAfterGood = nextDelays(DAY, false).good
  assert(hardAfterGood < goodAfterGood, `${hardAfterGood} vs ${goodAfterGood}`)

  const custom = { ...DEFAULT_SETTINGS, steps: { again: 5 * 60_000, hard: 3_600_000, good: 2 * DAY, easy: 7 * DAY }, growth: { hard: 1.5, good: 3, easy: 4 } }
  const customFresh = nextDelays(0, true, custom)
  assert(customFresh.again === 5 * 60_000 && customFresh.hard === 3_600_000 && customFresh.good === 2 * DAY && customFresh.easy === 7 * DAY, JSON.stringify(customFresh))
  const customLater = nextDelays(2 * DAY, false, custom)
  assert(customLater.good === 6 * DAY && customLater.hard === 3 * DAY && customLater.easy === 7 * DAY, JSON.stringify(customLater))
  assert(applyGrade(blankProgress('c', 'd'), 'good', 0, false, custom).delayMs === 2 * DAY, 'custom good')
  assert(limitOf(0, 37) === 37 && limitOf(20, 37) === 20 && limitOf(50, 37) === 37, 'limitOf')
  assert(splitDelay(4 * DAY).unit === 'day' && splitDelay(90 * 60_000).unit === 'min' && joinDelay(2, 'hour') === 7_200_000, 'units')

  const options = buildOptions(
    { key: 'a', lines: ['Arcus', 'arch', 'Łuk'], frontText: '' },
    [
      { key: 'a', lines: ['Arcus', 'arch', 'Łuk'], frontText: '' },
      { key: 'b', lines: ['Costa', 'rib', 'Żebro'], frontText: '' },
      { key: 'c', lines: ['Sternum', 'sternum', 'Mostek'], frontText: '' },
      { key: 'd', lines: ['Clavicula', 'clavicle', 'Obojczyk'], frontText: '' },
    ],
  )
  assert(options.length === 4, options.join('|'))
  assert(options.includes('Łuk'), options.join('|'))
}

async function integration() {
  const downloads = 'C:\\Users\\szymo\\Downloads'
  const filename = readdirSync(downloads).find((name) => name.endsWith('.apkg') && name.includes('Osteologia'))
  assert(filename, 'Brak pliku apkg w Downloads')
  const require = createRequire(import.meta.url)
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const wasm = readFileSync(wasmPath)
  const SQL = await initSqlJs({
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  })
  const bytes = readFileSync(`${downloads}\\${filename}`)
  const decks = await parseApkg(bytes, SQL, { fileName: filename })
  const deck = decks[0]
  const targetName = 'img1278922014682121683.jpg'
  const card = deck?.cards.find((item) => item.mediaName === targetName)
  const media = deck?.media.find((item) => item.filename === targetName)
  const summary = {
    decks: decks.map((item) => ({ name: item.name, cards: item.cards.length, media: item.media.length })),
    sample: card
      ? { lines: card.lines, front: card.frontHtml.slice(0, 180), css: card.css.slice(0, 180) }
      : null,
    mediaBytes: media?.data.length ?? null,
    mediaHead: media ? Array.from(media.data.slice(0, 3)) : null,
  }
  writeFileSync('C:\\Users\\szymo\\AppData\\Local\\Temp\\fiszki-check.json', JSON.stringify(summary, null, 2))

  assert(deck, 'brak talii')
  assert(deck.name.includes('·'), deck.name)
  assert(deck.name.includes('Kości'), deck.name)
  assert(deck.cards.length === 211, String(deck.cards.length))
  assert(deck.media.length === 211, String(deck.media.length))
  assert(card, 'brak karty z obrazem łuku')
  assert(card.lines.some((line) => line.includes('Łuk żebrowy')), card.lines.join(' | '))
  assert(card.lines.some((line) => line.includes('Arcus costalis')), card.lines.join(' | '))
  assert(card.frontHtml.includes('anki-media:'), card.frontHtml)
  assert(card.css.includes('.card'), card.css.slice(0, 200))
  assert(media, 'brak obrazu')
  assert(media.data.length > 20_000, String(media.data.length))
  assert(media.data[0] === 0xff && media.data[1] === 0xd8 && media.data[2] === 0xff, 'to nie jest jpeg')

  const ids = await saveImported(decks, filename)
  const saved = await cardsFor(ids[0])
  assert(saved.length === 211, String(saved.length))
  assert(deckStorageId(deck.ankiId, deck.name) === ids[0])
  const stored = await getMedia(`${ids[0]}:${targetName}`)
  assert(stored, 'obraz nie zapisany')
  const storedBytes = new Uint8Array(await stored.data.arrayBuffer())
  assert(storedBytes.length === media.data.length, String(storedBytes.length))
  assert(storedBytes[0] === 0xff && storedBytes[1] === 0xd8)
}

unit()
integration()
  .then(() => {
    console.log('OK')
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
