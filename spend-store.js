/**
 * The durable half of 对话消耗展示: one small JSON file of credit observations.
 *
 * WHY A FILE AND NOT MEMORY. The WorkBuddy connector keeps its per-session
 * ledger in a `Map` inside its host process, so a restart makes every old
 * session read "nothing measured yet" and the readout disappears until the next
 * request. This module is the part that outlives the process: it stores what the
 * connector has reported so far, merged by {@link applyCreditObservation} so a
 * restart neither loses the earlier spend nor double-counts a poll.
 *
 * The file is intentionally boring — `{ version, sessions: { <id>: entry } }` —
 * because it is the one piece of state this extension owns on disk and a reader
 * may need to inspect or delete it by hand.
 *
 * @module dsh-agents-models/spend-store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { applyCreditObservation, emptyEntry, sanitizeLedger, totalCredits } from './spend.js'

/** Marker so an unrelated JSON file is not silently adopted as a ledger. */
export const LEDGER_FORMAT = 'dsh-agent-modes-spend'

/** How many sessions the ledger keeps before the oldest rows are dropped. */
export const LEDGER_SESSIONS_MAX = 200

/** Absolute path of the ledger for the current host home. */
export function ledgerPath(home) {
  const root = home ?? process.env.DSH_HOME?.trim() ?? join(homedir(), '.dsh')
  return join(root, 'plugins-data', 'dsh-agents-models', 'session-spend.json')
}

/**
 * Read the ledger, repairing or discarding anything unusable.
 *
 * A missing file is a fresh ledger; a corrupt one is reported as `broken` so the
 * page can say so, but still yields a usable (empty) ledger — losing history must
 * not take the readout down with it.
 *
 * @param {string} path absolute path.
 * @returns {Promise<{ledger: {version: number, sessions: Record<string, object>}, exists: boolean, broken: boolean}>}
 */
export async function readLedger(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ledger: sanitizeLedger(null, LEDGER_SESSIONS_MAX), exists: false, broken: false }
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed?.format !== undefined && parsed.format !== LEDGER_FORMAT) {
      return { ledger: sanitizeLedger(null, LEDGER_SESSIONS_MAX), exists: true, broken: true }
    }
    return { ledger: sanitizeLedger(parsed, LEDGER_SESSIONS_MAX), exists: true, broken: false }
  } catch {
    return { ledger: sanitizeLedger(null, LEDGER_SESSIONS_MAX), exists: true, broken: true }
  }
}

/**
 * Write the ledger back in its on-disk shape.
 *
 * @param {string} path absolute path.
 * @param {{sessions: Record<string, object>}} ledger a sanitized ledger.
 * @returns {Promise<void>}
 */
export async function writeLedger(path, ledger) {
  const clean = sanitizeLedger(ledger, LEDGER_SESSIONS_MAX)
  const doc = { format: LEDGER_FORMAT, version: clean.version, sessions: clean.sessions }
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

/**
 * Fold one connector observation into the ledger.
 *
 * `changed` answers "does the FILE need rewriting", not "did the map change": the
 * map is always updated, while the file is skipped when a poll learned nothing
 * new, so a 15-second readout does not rewrite the JSON every poll.
 *
 * @param {{sessions: Record<string, object>}} ledger a sanitized ledger.
 * @param {string} sessionId the session the observation belongs to.
 * @param {{requests?: number, credit?: number}} observation what the connector reported.
 * @param {number} at epoch milliseconds.
 * @returns {{ledger: object, changed: boolean, entry: object}}
 */
export function mergeObservation(ledger, sessionId, observation, at) {
  const sessions = { ...(ledger?.sessions ?? {}) }
  const previous = sessions[sessionId] ?? emptyEntry()
  const next = applyCreditObservation(previous, observation, at)
  // Compare against what the LEDGER holds, not against the default entry: a
  // session that was never stored and observes nothing must still be written
  // once, or the next read cannot tell it apart from one never seen at all.
  // (`changed` only gates the FILE write, so the in-memory map is always current.)
  const stored = sessions[sessionId]
  const changed = stored === undefined
    || next.committedCredit !== stored.committedCredit
    || JSON.stringify(next.epoch) !== JSON.stringify(stored.epoch)
  sessions[sessionId] = next
  return { ledger: { version: ledger?.version ?? 1, sessions }, changed, entry: next }
}

/**
 * One session's durable credit total, or undefined when nothing was recorded.
 *
 * @param {{sessions: Record<string, object>}} ledger a sanitized ledger.
 * @param {string} sessionId the session to look up.
 * @returns {number|undefined} credits.
 */
export function creditOf(ledger, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return totalCredits(ledger?.sessions?.[sessionId])
}

/**
 * The newest `limit` sessions the ledger knows about, for the extension page.
 *
 * @param {{sessions: Record<string, object>}} ledger a sanitized ledger.
 * @param {number} limit how many rows to return.
 * @returns {Array<{sessionId: string, credit: number|undefined, updatedAt: number}>}
 */
export function recentSessions(ledger, limit = 20) {
  const rows = Object.entries(ledger?.sessions ?? {})
    .map(([sessionId, entry]) => ({
      sessionId,
      credit: totalCredits(entry),
      updatedAt: typeof entry?.updatedAt === 'number' ? entry.updatedAt : 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, limit))
  return rows
}
