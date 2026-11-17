/**
 * Conversation spend — the arithmetic half of the 对话消耗展示 extension.
 *
 * WHAT PROBLEM THIS SOLVES. The WorkBuddy connector already prints "本会话已用
 * N 积分", but its ledger is a `Map` inside the host process: restart the host
 * and every session reads as unmeasured again, and a session that has not sent a
 * request since that restart shows nothing at all. This module never remembers
 * anything in RAM — every figure is either folded out of the DURABLE session log
 * (tokens) or committed to a JSON file on disk (the credit observations the
 * connector reports), so both symptoms go away by construction.
 *
 * TWO UNITS, TWO SOURCES, AND THEY ARE NOT INTERCHANGEABLE:
 *
 * - WorkBuddy charges are reported by the upstream as `usage.credit` on the last
 *   frame of a stream. That number is the only truth about what was deducted and
 *   it is NOT money: a credit is a WorkBuddy unit, so it is shown as 积分.
 * - The official DeepSeek providers bill in CNY per million tokens, and the
 *   session log keeps the exact token split per message (`inputTokens` excluding
 *   cache, `cacheReadTokens`, `outputTokens`). Money therefore needs no
 *   observation at all — it is recomputed from the log every time, which is why
 *   it survives a restart without any ledger.
 *
 * WHY "≈" IS PART OF THE MONEY FIGURE. The price table below is the published
 * per-million rate with the peak/off-peak split; the authoritative number is the
 * provider's invoice (which also discounts, rounds and taxes). The readout says
 * ≈ and the page states the table version, so nobody reads it as a bill.
 *
 * @module dsh-agents-modes/spend
 */

/** Bumped when a stored ledger from an older reader would be misread. */
export const LEDGER_VERSION = 1

/** Bumped whenever the price table below changes meaning. */
export const PRICE_VERSION = '2026-08-17'
/**
 * Published CNY price per MILLION tokens, `[valley, peak]`.
 *
 * Source: DeepSeek API pricing effective 2026-08-17 (peak/valley), as published
 * by DeepSeek and already encoded in the bundled whale-widget provider table
 * (`BASE_PRICE` / `PRO_PRICE` in `dsh-whale-widget`, which cites the same
 * 2026-09-14 and 2026-09-19 announcements). Pro is 3× Flash.
 *
 * `hit` = cache-read tokens, `miss` = uncached input tokens, `out` = output.
 *
 * The alias keys exist so the "we guessed this model's rate" flag stays honest:
 * `deepseek-flash`, `deepseek-v4-flash` and `deepseek-v4.1-flash` were renamed
 * across releases but are all served at the Flash rate, so they match an explicit
 * key rather than falling through to `_default`. Only a model this table has
 * never heard of is reported as an assumption.
 */
export const PRICE_TABLE = Object.freeze({
  'deepseek-v4-pro': Object.freeze({ hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] }),
  'deepseek-v4.1-flash': Object.freeze({ hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }),
  'deepseek-v4-flash': Object.freeze({ hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }),
  'deepseek-flash': Object.freeze({ hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }),
  _default: Object.freeze({ hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }),
})

/**
 * Beijing-time peak windows, `[startHour, endHour)` on working days.
 *
 * Everything outside them is the valley rate, plus all day on Saturday/Sunday
 * and on the statutory holidays listed below. These are the same two windows the
 * official footnote names (09:00–12:00 and 14:00–18:00 on 周一至周五).
 */
export const PEAK_HOURS = Object.freeze([Object.freeze([9, 12]), Object.freeze([14, 18])])

/**
 * Statutory holidays that bill at the valley rate all day (Beijing calendar).
 *
 * 《国务院办公厅关于 2026 年部分节假日安排的通知》(国办发明电〔2025〕7 号). Only the
 * days OFF are listed: every 调休 working day in 2026 falls on a weekend, which
 * the weekend rule already prices as valley.
 *
 * MAINTENANCE: the State Council publishes next year's arrangement each
 * November. A year that is missing here is priced as if it had no holidays —
 * wrong by at most the peak surcharge, never by the whole rate — so the failure
 * degrades quietly instead of throwing.
 */
export const HOLIDAYS_VALLEY = Object.freeze([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
])

/** Providers whose charge arrives as WorkBuddy credits rather than CNY. */
export const CREDIT_PROVIDERS = Object.freeze(['workbuddy'])

/** A token count, or 0 for anything that is not a non-negative finite number. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Whether one instant bills at the peak rate.
 *
 * The instant is shifted by +8h and then read in UTC, which is how a Beijing
 * wall-clock calendar day is derived without depending on the process timezone —
 * the same trick the whale-widget table uses, so both agree on the boundary hour.
 *
 * @param {number} atMs epoch milliseconds.
 * @returns {boolean} true when the peak rate applies.
 */
export function peakAt(atMs) {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return false
  const beijing = new Date(atMs + 8 * 3600 * 1000)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const day = beijing.toISOString().slice(0, 10)
  if (HOLIDAYS_VALLEY.includes(day)) return false
  const hour = beijing.getUTCHours()
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end)
}

/**
 * The rate card that applies to one model at one instant.
 *
 * Longest-key-first so `deepseek-v4-pro` is not eaten by a shorter prefix, and
 * `_default` last: an unknown model is priced as Flash, which is the cheapest
 * published card and therefore the least misleading guess when the real one is
 * absent. The returned object says which card was used so the page can admit it.
 *
 * @param {string} model the model id the session actually ran.
 * @param {number} atMs epoch milliseconds of the request.
 * @returns {{model: string, card: string, tier: 'peak'|'valley', hit: number, miss: number, out: number, currency: 'CNY', per: number, assumed: boolean}}
 */
export function priceFor(model, atMs) {
  const id = String(model ?? '').toLowerCase()
  const keys = Object.keys(PRICE_TABLE)
    .filter((key) => key !== '_default')
    .sort((a, b) => b.length - a.length)
  const card = keys.find((key) => id.includes(key)) ?? '_default'
  const table = PRICE_TABLE[card]
  const tier = peakAt(atMs) ? 'peak' : 'valley'
  const index = tier === 'peak' ? 1 : 0
  return {
    model: id,
    card,
    tier,
    hit: table.hit[index],
    miss: table.miss[index],
    out: table.out[index],
    currency: 'CNY',
    per: 1e6,
    // `_default` is a stand-in, not the model's own card: the page says so.
    assumed: card === '_default',
  }
}

/**
 * What one usage record costs in CNY at one rate card.
 *
 * `inputTokens` is the UNCACHED input (verified against the durable log: input +
 * cacheRead + output equals `totalTokens`), so it is billed at `miss` and
 * `cacheReadTokens` at `hit`. Billing input at the miss rate would overstate a
 * long conversation several times over, which is exactly the mistake that makes
 * a per-session money figure useless.
 *
 * @param {{inputTokens?: number, outputTokens?: number, cacheReadTokens?: number}} usage
 * @param {{hit: number, miss: number, out: number, per: number}} price
 * @returns {number} CNY, unrounded.
 */
export function cnyOf(usage, price) {
  const per = typeof price?.per === 'number' && price.per > 0 ? price.per : 1e6
  return (
    (count(usage?.inputTokens) * price.miss +
      count(usage?.cacheReadTokens) * price.hit +
      count(usage?.outputTokens) * price.out) /
    per
  )
}

/** Round to `digits` decimals without float dust (0.1+0.2 problems). */
function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Fold a session log into per-model token totals and a CNY figure.
 *
 * Reads only durable events: `assistant/message` carries the provider usage and
 * the model that produced it, and `event.time` is the instant that decides the
 * peak/valley rate for that message. A message with no usage contributes nothing
 * (and is not counted as a request), because "we were not told" must not become
 * "it was free".
 *
 * @param {Array<object>} events the session's durable events.
 * @returns {{requests: number, tokens: {input: number, output: number, cacheRead: number, total: number}, byModel: Array<object>, cny: number, creditProviders: string[], priceVersion: string}}
 */
export function foldSpendEvents(events) {
  const byKey = new Map()
  const tokens = { input: 0, output: 0, cacheRead: 0, total: 0 }
  const creditProviders = new Set()
  let requests = 0
  let cny = 0

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message') continue
    const usage = event?.data?.usage
    if (typeof usage !== 'object' || usage === null) continue
    const source = event?.data?.message?.source
    const provider = typeof source?.provider === 'string' ? source.provider : ''
    const model = typeof source?.model === 'string' ? source.model : ''
    requests += 1

    const input = count(usage.inputTokens)
    const output = count(usage.outputTokens)
    const cacheRead = count(usage.cacheReadTokens)
    tokens.input += input
    tokens.output += output
    tokens.cacheRead += cacheRead
    tokens.total += count(usage.totalTokens) || input + output + cacheRead

    if (CREDIT_PROVIDERS.includes(provider)) creditProviders.add(provider)

    // A credit-billed request has no published CNY card: pricing it as Flash
    // would invent money nobody was charged. It is counted, not converted.
    if (CREDIT_PROVIDERS.includes(provider)) continue

    const price = priceFor(model, event.time)
    const cost = cnyOf(usage, price)
    cny += cost

    const key = `${provider}\u0000${model}`
    let row = byKey.get(key)
    if (row === undefined) {
      row = { provider, model, requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, total: 0 }, cny: 0, assumedPrice: price.assumed, cards: [] }
      byKey.set(key, row)
    }
    row.requests += 1
    row.tokens.input += input
    row.tokens.output += output
    row.tokens.cacheRead += cacheRead
    row.tokens.total += count(usage.totalTokens) || input + output + cacheRead
    row.cny += cost
    if (!row.cards.includes(price.tier)) row.cards.push(price.tier)
  }

  return {
    requests,
    tokens,
    byModel: [...byKey.values()]
      .map((row) => ({ ...row, cny: round(row.cny, 6) }))
      .sort((a, b) => b.cny - a.cny || b.requests - a.requests || a.model.localeCompare(b.model)),
    cny: round(cny, 6),
    creditProviders: [...creditProviders],
    priceVersion: PRICE_VERSION,
  }
}

/** A ledger entry for one session, before any observation landed. */
export function emptyEntry() {
  return { committedCredit: 0, epoch: null, updatedAt: 0 }
}

/**
 * Merge one observation of the connector's per-session ledger into a durable
 * entry, and return the new entry.
 *
 * THE HARD PART IS THE RESTART, and it is why `requests` is carried around. The
 * connector's ledger lives in its host process, so after a restart its counters
 * for an old session go back to zero and then climb again from one. Blindly
 * storing the observation would REPLACE 9.45 with 1.20 and lose the earlier
 * spend; blindly adding on every poll would re-add the same request forever.
 *
 * So each entry keeps two parts:
 *
 * - `committedCredit` — everything seen before the current connector epoch;
 * - `epoch` — the highest `{requests, credit}` seen in THIS epoch, which is
 *   monotone because the connector's own counters are.
 *
 * A poll whose `requests` is not lower than the epoch's is the same epoch, and
 * the epoch keeps the LARGER of the two counts (monotone, so a late or
 * out-of-order response cannot lower the figure). A poll whose `requests`
 * DROPPED is a new epoch: the old epoch is committed and the observation starts
 * the new one. The total is always `committedCredit + epoch.credit`, which is why
 * the figure neither resets on restart nor double-counts on poll.
 *
 * A non-finite or negative credit is treated as "not reported": the request
 * count still advances (so the epoch boundary is still detected) but no credit
 * is added.
 *
 * @param {object} entry the stored entry.
 * @param {{requests?: number, credit?: number}} observation
 * @param {number} at epoch milliseconds.
 * @returns {object} a new entry (never mutates the input).
 */
export function applyCreditObservation(entry, observation, at) {
  const base = entry === null || typeof entry !== 'object' ? emptyEntry() : entry
  const committedCredit = count(base.committedCredit)
  const seen = typeof observation?.requests === 'number' && Number.isFinite(observation.requests)
    ? Math.max(0, Math.trunc(observation.requests))
    : 0
  const credit = typeof observation?.credit === 'number' && Number.isFinite(observation.credit) && observation.credit >= 0
    ? observation.credit
    : 0
  const previous = base.epoch !== null && typeof base.epoch === 'object' ? base.epoch : null

  // Nothing observed and nothing before: stay empty rather than claiming 0.
  if (seen === 0 && credit === 0 && previous === null) {
    return { ...emptyEntry(), committedCredit }
  }

  const restarted = previous !== null && seen < count(previous.requests)
  const nextCommitted = restarted ? committedCredit + count(previous.credit) : committedCredit
  const nextEpoch = restarted || previous === null
    ? { requests: seen, credit }
    : { requests: Math.max(count(previous.requests), seen), credit: Math.max(count(previous.credit), credit) }

  return {
    committedCredit: round(nextCommitted, 6),
    epoch: nextEpoch,
    updatedAt: typeof at === 'number' ? at : Date.now(),
  }
}

/**
 * The total credit spend an entry currently stands for.
 *
 * `undefined` — not 0 — when nothing was ever observed: "no measurement" and
 * "cost 0" are different claims and the readout renders nothing in the first
 * case, exactly as the connector already does.
 *
 * @param {object} entry a stored entry.
 * @returns {number|undefined} credits, rounded to 4 decimals.
 */
export function totalCredits(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const committed = count(entry.committedCredit)
  const epoch = entry.epoch !== null && typeof entry.epoch === 'object' ? count(entry.epoch.credit) : undefined
  if (epoch === undefined && committed === 0) return undefined
  return round(committed + (epoch ?? 0), 4)
}

/**
 * A stored ledger file, read back into a shape the routes can trust.
 *
 * Anything unreadable degrades to an empty ledger rather than throwing: a
 * corrupt JSON file must cost the readout its history, not the whole page.
 *
 * @param {unknown} raw parsed file contents.
 * @param {number} cap how many sessions to keep.
 * @returns {{version: number, sessions: Record<string, object>}}
 */
export function sanitizeLedger(raw, cap = 200) {
  const sessions = {}
  const source = raw !== null && typeof raw === 'object' && raw.sessions !== null && typeof raw.sessions === 'object'
    ? raw.sessions
    : {}
  const rows = Object.entries(source)
    .filter(([id, entry]) => typeof id === 'string' && id !== '' && entry !== null && typeof entry === 'object')
    .sort(([, a], [, b]) => count(b?.updatedAt) - count(a?.updatedAt))
    .slice(0, Math.max(1, cap))
  for (const [id, entry] of rows) {
    sessions[id] = {
      committedCredit: count(entry.committedCredit),
      epoch: entry.epoch !== null && typeof entry.epoch === 'object'
        ? { requests: count(entry.epoch.requests), credit: count(entry.epoch.credit) }
        : null,
      updatedAt: count(entry.updatedAt),
    }
  }
  return { version: LEDGER_VERSION, sessions }
}

/**
 * One session's spend as the readout wants it.
 *
 * @param {object} parts
 * @param {object} parts.fold the result of {@link foldSpendEvents}.
 * @param {number|undefined} parts.credit the durable credit total, if any.
 * @returns {{credit?: number, cny: number, requests: number, creditBilled: boolean, priceVersion: string, byModel: Array<object>}}
 */
export function spendOf({ fold, credit }) {
  const safe = fold ?? foldSpendEvents([])
  return {
    ...(credit === undefined ? {} : { credit }),
    cny: round(safe.cny, 4),
    requests: safe.requests,
    creditBilled: safe.creditProviders.length > 0,
    priceVersion: safe.priceVersion,
    byModel: safe.byModel,
  }
}
