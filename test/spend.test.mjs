// 对话消耗展示 — the arithmetic and the durable ledger.
//
// These tests are the honest half of the feature: the readout's whole claim is
// that a number survives a restart and that a yuan figure is not invented, so
// each of those claims gets a test that fails if the claim stops holding.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PRICE_VERSION,
  applyCreditObservation,
  cnyOf,
  emptyEntry,
  foldSpendEvents,
  peakAt,
  priceFor,
  sanitizeLedger,
  spendOf,
  totalCredits,
} from '../spend.js'
import {
  LEDGER_FORMAT,
  creditOf,
  ledgerPath,
  mergeObservation,
  readLedger,
  recentSessions,
  writeLedger,
} from '../spend-store.js'
import {
  EXTENSIONS,
  extensionRows,
  isEnabled,
  isExtensionId,
  normalizeState,
  readState,
  statePath,
  toggleExtension,
  writeState,
} from '../extensions.js'

/** One `assistant/message` event as the durable log stores it. */
function message(provider, model, usage, time) {
  return { type: 'assistant/message', time, data: { message: { source: { provider, model } }, usage } }
}

// ── pricing ────────────────────────────────────────────────────────────────

test('the peak window is 09-12 and 14-18 on Beijing working days only', () => {
  const bj = (day, hour) => Date.UTC(2026, 10, day, hour - 8, 0, 0) // Nov 2026, Tue=17
  assert.equal(peakAt(bj(17, 8)), false, '08:00 is valley')
  assert.equal(peakAt(bj(17, 9)), true, '09:00 is peak')
  assert.equal(peakAt(bj(17, 11)), true, '11:00 is peak')
  assert.equal(peakAt(bj(17, 12)), false, '12:00 is valley')
  assert.equal(peakAt(bj(17, 14)), true, '14:00 is peak')
  assert.equal(peakAt(bj(17, 18)), false, '18:00 is valley')
  assert.equal(peakAt(bj(21, 10)), false, 'Saturday is valley all day')
  assert.equal(peakAt(bj(22, 10)), false, 'Sunday is valley all day')
})

test('a statutory holiday bills at the valley rate even on a weekday', () => {
  // 2026-10-01 is a Thursday and a listed holiday.
  const oct1 = Date.UTC(2026, 9, 1, 10 - 8, 0, 0)
  assert.equal(new Date(oct1 + 8 * 3600 * 1000).getUTCDay(), 4, 'the fixture really is a Thursday')
  assert.equal(peakAt(oct1), false)
})

test('the rate card picks pro over flash and reports an unknown model as an assumption', () => {
  const peak = Date.UTC(2026, 10, 17, 11 - 8, 0, 0)
  const pro = priceFor('deepseek-v4-pro', peak)
  assert.equal(pro.card, 'deepseek-v4-pro')
  assert.equal(pro.assumed, false)
  assert.deepEqual([pro.hit, pro.miss, pro.out], [0.3, 9, 27], 'peak pro rates')

  const flash = priceFor('deepseek-v4.1-flash', peak)
  assert.equal(flash.card, 'deepseek-v4.1-flash', 'a renamed Flash is still an explicit card')
  assert.equal(flash.assumed, false)

  const unknown = priceFor('some-new-model', peak)
  assert.equal(unknown.card, '_default')
  assert.equal(unknown.assumed, true, 'an unknown model must say the rate was assumed')
})

test('cached input is billed at the hit rate, not the miss rate', () => {
  const price = { hit: 0.02, miss: 1, out: 4, per: 1e6 }
  // 1M cached tokens cost 0.02, not 1.0: the difference is the whole point of
  // reading `cacheReadTokens` separately.
  assert.equal(cnyOf({ inputTokens: 0, cacheReadTokens: 1e6, outputTokens: 0 }, price), 0.02)
  assert.equal(cnyOf({ inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0 }, price), 1)
  assert.equal(cnyOf({ inputTokens: 0, outputTokens: 1e6, cacheReadTokens: 0 }, price), 4)
})

// ── folding a real log ─────────────────────────────────────────────────────

test('a CNY fold prices each message at the rate in force at its own instant', () => {
  const valley = message('deepseek-official', 'deepseek-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 0, 0, 0))
  const peak = message('deepseek-official', 'deepseek-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 11 - 8, 0, 0))
  const fold = foldSpendEvents([valley, peak])
  assert.equal(fold.requests, 2)
  assert.equal(fold.cny, 3, '1 valley + 2 peak for one million uncached input tokens')
  assert.equal(fold.priceVersion, PRICE_VERSION)
})

test('a credit-billed request is counted but never converted to money', () => {
  const events = [
    message('workbuddy', 'deepseek-v4.1-flash', { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 0, 0, 0)),
  ]
  const fold = foldSpendEvents(events)
  assert.equal(fold.requests, 1, 'the request still counts')
  assert.deepEqual(fold.creditProviders, ['workbuddy'])
  assert.equal(fold.cny, 0, 'inventing a yuan figure for credits would be a lie')
  assert.equal(fold.byModel.length, 0)
  assert.equal(spendOf({ fold, credit: 9.45 }).creditBilled, true)
})

test('a message with no usage is not counted as a request', () => {
  const fold = foldSpendEvents([
    { type: 'assistant/message', time: 1, data: { message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
    { type: 'user/message', time: 2, data: {} },
  ])
  assert.equal(fold.requests, 0)
  assert.equal(fold.tokens.total, 0)
})

test('a mixed session reports credits and money side by side', () => {
  const fold = foldSpendEvents([
    message('workbuddy', 'deepseek-v4.1-flash', { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 0, 0, 0)),
    message('deepseek-official', 'deepseek-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 0, 0, 0)),
  ])
  const spend = spendOf({ fold, credit: 2.5 })
  assert.equal(spend.credit, 2.5)
  assert.equal(spend.cny, 1)
  assert.equal(spend.requests, 2)
  assert.equal(spend.creditBilled, true)
})

test('spendOf leaves credit absent rather than zero when nothing was measured', () => {
  const spend = spendOf({ fold: foldSpendEvents([]), credit: undefined })
  assert.equal(Object.hasOwn(spend, 'credit'), false)
  assert.equal(spend.cny, 0)
})

// ── the ledger: the actual bug ─────────────────────────────────────────────

test('a credit observation accumulates and never double-counts a repeated poll', () => {
  let entry = emptyEntry()
  entry = applyCreditObservation(entry, { requests: 1, credit: 1.5 }, 1000)
  entry = applyCreditObservation(entry, { requests: 2, credit: 3.5 }, 2000)
  assert.equal(totalCredits(entry), 3.5)
  // The same answer again (a poll before the next request) must not add up.
  entry = applyCreditObservation(entry, { requests: 2, credit: 3.5 }, 3000)
  assert.equal(totalCredits(entry), 3.5)
})

test('a restarted connector continues the total instead of resetting it', () => {
  // Before the restart: 10 requests, 9.45 credits.
  let entry = applyCreditObservation(emptyEntry(), { requests: 10, credit: 9.45 }, 1000)
  assert.equal(totalCredits(entry), 9.45)

  // After the restart the connector's Map is empty, so its counters restart at 1.
  entry = applyCreditObservation(entry, { requests: 1, credit: 1.2 }, 2000)
  assert.equal(totalCredits(entry), 10.65, 'the pre-restart spend is committed, not lost')

  // ...and the new epoch keeps accumulating from there.
  entry = applyCreditObservation(entry, { requests: 2, credit: 2.75 }, 3000)
  assert.equal(totalCredits(entry), 12.2, '9.45 committed + 2.75 in the new epoch')
})

test('an out-of-order or lower answer inside one epoch cannot lower the total', () => {
  let entry = applyCreditObservation(emptyEntry(), { requests: 5, credit: 5 }, 1000)
  entry = applyCreditObservation(entry, { requests: 3, credit: 2 }, 2000)
  // A lower request count means "a new epoch" — that is the restart signal — so
  // the earlier 5 is committed and the total stays >= 5 rather than dropping to 2.
  assert.ok(totalCredits(entry) >= 5, `total went backwards: ${totalCredits(entry)}`)
})

test('an unreported credit advances the request count without inventing a charge', () => {
  const entry = applyCreditObservation(emptyEntry(), { requests: 1, credit: undefined }, 1000)
  assert.equal(totalCredits(entry), 0)
  const second = applyCreditObservation(entry, { requests: 2, credit: 4 }, 2000)
  assert.equal(totalCredits(second), 4)
})

test('nothing observed reads as "no measurement", not as zero', () => {
  assert.equal(totalCredits(emptyEntry()), undefined)
  assert.equal(totalCredits({ committedCredit: 0, epoch: null }), undefined)
  assert.equal(totalCredits({ committedCredit: 0, epoch: { requests: 0, credit: 0 } }), 0)
})

test('sanitizeLedger drops junk and keeps the newest rows', () => {
  const raw = {
    sessions: {
      a: { committedCredit: 1, epoch: { requests: 2, credit: 3 }, updatedAt: 100 },
      b: { committedCredit: 'x', updatedAt: 200 },
      '': { updatedAt: 300 },
      c: null,
      d: { committedCredit: 5, epoch: null, updatedAt: 50 },
    },
  }
  const clean = sanitizeLedger(raw, 2)
  // Newest by `updatedAt` first (b=200, a=100), so the cap of two keeps those.
  assert.deepEqual(Object.keys(clean.sessions).sort(), ['a', 'b'], 'newest two, junk dropped')
  assert.equal(clean.sessions.b.committedCredit, 0, 'a non-number becomes 0 rather than NaN')
})

// ── the ledger file ────────────────────────────────────────────────────────

test('the ledger round-trips through disk and survives a fresh read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-spend-'))
  try {
    const path = join(dir, 'session-spend.json')
    const first = mergeObservation(sanitizeLedger(null), 'session-1', { requests: 4, credit: 7.79 }, 100)
    await writeLedger(path, first.ledger)

    const read = await readLedger(path)
    assert.equal(read.exists, true)
    assert.equal(read.broken, false)
    assert.equal(creditOf(read.ledger, 'session-1'), 7.79, 'the number is the same after the process is gone')

    const doc = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(doc.format, LEDGER_FORMAT, 'the file says what it is')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt ledger file degrades to empty instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-spend-'))
  try {
    const path = join(dir, 'session-spend.json')
    await writeFile(path, '{not json', 'utf8')
    const read = await readLedger(path)
    assert.equal(read.broken, true)
    assert.equal(creditOf(read.ledger, 'anything'), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing ledger file is a fresh ledger, not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-spend-'))
  try {
    const read = await readLedger(join(dir, 'nope.json'))
    assert.equal(read.exists, false)
    assert.equal(read.broken, false)
    assert.deepEqual(read.ledger.sessions, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mergeObservation reports whether the FILE needs a write, and always updates the map', () => {
  const first = mergeObservation(sanitizeLedger(null), 's', { requests: 1, credit: 1 }, 10)
  assert.equal(first.changed, true)
  const again = mergeObservation(first.ledger, 's', { requests: 1, credit: 1 }, 20)
  assert.equal(again.changed, false, 'an unchanged poll must not rewrite the file')
  assert.equal(creditOf(again.ledger, 's'), 1, 'but the map still holds the entry')

  // The first observation of a session that observed nothing is still a write,
  // or the next read could not distinguish it from a session never seen.
  const zero = mergeObservation(sanitizeLedger(null), 'z', { requests: 0, credit: 0 }, 10)
  assert.equal(zero.changed, true)
  assert.ok(Object.hasOwn(zero.ledger.sessions, 'z'))
})

test('recentSessions orders by the time it was last seen', () => {
  const ledger = sanitizeLedger({ sessions: {
    old: { committedCredit: 1, epoch: null, updatedAt: 10 },
    new: { committedCredit: 2, epoch: null, updatedAt: 20 },
  } })
  assert.deepEqual(recentSessions(ledger).map((row) => row.sessionId), ['new', 'old'])
})

test('ledgerPath lives under this plugin own data directory', () => {
  assert.match(ledgerPath('/home/x'), /plugins-data[\\/]dsh-agents-modes[\\/]session-spend\.json$/)
})

// ── the extension registry ─────────────────────────────────────────────────

test('the shipped extension is on by default, because it fixes a reported bug', () => {
  const rows = extensionRows(null)
  const row = rows.find((entry) => entry.id === 'conversation-spend')
  assert.ok(row !== undefined)
  assert.equal(row.nameZh, '对话消耗展示')
  assert.equal(row.enabled, true)
  assert.equal(isEnabled(null, 'conversation-spend'), true)
})

test('a toggle is stored, rejected for unknown ids, and never silently lost', () => {
  const off = toggleExtension(null, 'conversation-spend', false)
  assert.equal(isEnabled(off.state, 'conversation-spend'), false)

  const bad = toggleExtension(null, 'not-an-extension', false)
  assert.match(bad.error ?? '', /unknown extension/)

  const wrongType = toggleExtension(null, 'conversation-spend', 'yes')
  assert.match(wrongType.error ?? '', /true or false/)
})

test('an unknown id in the state file cannot resurrect, and a missing id falls back to the default', () => {
  const state = normalizeState({ enabled: { 'conversation-spend': false, ghost: true } })
  assert.deepEqual(Object.keys(state.enabled), ['conversation-spend'])
  assert.equal(state.enabled['conversation-spend'], false)

  const partial = normalizeState({ enabled: {} })
  assert.equal(partial.enabled['conversation-spend'], true, 'absent means shipped behaviour')
})

test('the extension state round-trips through disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-ext-'))
  try {
    const path = join(dir, 'extensions.json')
    await writeState(path, toggleExtension(null, 'conversation-spend', false).state)
    const read = await readState(path)
    assert.equal(read.broken, false)
    assert.equal(isEnabled(read.state, 'conversation-spend'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt extension file is reported but still yields the shipped default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-ext-'))
  try {
    const path = join(dir, 'extensions.json')
    await writeFile(path, 'nope', 'utf8')
    const read = await readState(path)
    assert.equal(read.broken, true)
    assert.equal(isEnabled(read.state, 'conversation-spend'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the registry is data: every entry carries the copy the card renders', () => {
  assert.ok(EXTENSIONS.length >= 1)
  for (const entry of EXTENSIONS) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(isExtensionId(entry.id))
    assert.ok(entry.nameZh.length > 0 && entry.nameEn.length > 0)
    assert.ok(entry.featuresZh.length > 0 && entry.featuresEn.length > 0)
    assert.equal(entry.featuresZh.length, entry.featuresEn.length, `${entry.id}: feature lists must pair up`)
  }
})

test('statePath lives beside the ledger, under this plugin own data directory', () => {
  assert.match(statePath('/home/x'), /plugins-data[\\/]dsh-agents-modes[\\/]extensions\.json$/)
})
