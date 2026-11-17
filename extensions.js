/**
 * The extension registry behind 工具管理 → 扩展管理.
 *
 * WHY A REGISTRY AND NOT A HARD-CODED CARD. This build ships one extension
 * (对话消耗展示), and the page has to be a place where the NEXT one can be added
 * without re-laying-out the pane. So the list is data: each entry names its id,
 * its labels, and the facts it wants on screen, and the pane renders whatever is
 * registered — the switch state is the only per-extension thing stored on disk.
 *
 * STATE IS OURS, NOT THE HOST'S. An extension here is a feature of this plugin,
 * not a mounted package: turning one off must not unmount a row the mode
 * configuration owns. So the switch writes one JSON file and the feature reads it
 * at request time — the same "plain file this plugin owns" pattern the skill
 * categories already use, and the reason an extension can be toggled without a
 * host restart.
 *
 * @module dsh-agents-models/extensions
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Bumped only when an older reader would misread a newer state file. */
export const STATE_VERSION = 1

/**
 * Every extension this build knows how to run.
 *
 * `defaultOn` is true for the shipped one on purpose: it fixes a bug the user
 * reported (the credit readout vanishing after a switch or a restart), so it has
 * to be on for anyone who never opens this page.
 */
export const EXTENSIONS = Object.freeze([
  Object.freeze({
    id: 'conversation-spend',
    nameZh: '对话消耗展示',
    nameEn: 'Conversation spend',
    version: '1.0.0',
    descZh: '在会话里显示这次对话花了多少：WorkBuddy 按积分，官方通道按元（≈）。读数来自会话日志与本机台账，重启与切换会话都不会丢。',
    descEn: 'Shows what this conversation cost: credits on WorkBuddy, yuan (≈) on the official channel. Read from the session log plus a local ledger, so it survives restarts and session switches.',
    defaultOn: true,
    /** What the card claims it does, so the pane can prove each line. */
    featuresZh: [
      '积分台账落盘：重启后仍显示，不再归零',
      '官方通道按公开单价折算成元，标注「≈」',
      '缓存命中按 hit 价、未命中按 miss 价分档',
      '只读本地数据，不额外消耗任何积分',
    ],
    featuresEn: [
      'Credit ledger on disk: survives a restart instead of resetting',
      'Official channel converted to yuan at the published rate, marked ≈',
      'Cache reads billed at the hit rate, uncached input at the miss rate',
      'Reads local data only; costs no credits',
    ],
  }),
])

/** Whether an id belongs to a known extension. */
export function isExtensionId(value) {
  return EXTENSIONS.some((entry) => entry.id === value)
}

/** Absolute path of the extension state file for the current host home. */
export function statePath(home) {
  const root = home ?? process.env.DSH_HOME?.trim() ?? join(homedir(), '.dsh')
  return join(root, 'plugins-data', 'dsh-agents-models', 'extensions.json')
}

/**
 * Coerce a stored state file into `{ enabled: { <id>: boolean } }`.
 *
 * Unknown ids are dropped (an extension removed from a later build must not keep
 * resurrecting in the file) and a missing id falls back to its `defaultOn`, so a
 * hand-edited or half-written file cannot switch a shipped feature off by
 * accident.
 *
 * @param {unknown} raw parsed JSON, or anything at all.
 * @returns {{version: number, enabled: Record<string, boolean>}}
 */
export function normalizeState(raw) {
  const source = raw !== null && typeof raw === 'object' && raw.enabled !== null && typeof raw.enabled === 'object'
    ? raw.enabled
    : {}
  const enabled = {}
  for (const entry of EXTENSIONS) {
    enabled[entry.id] = typeof source[entry.id] === 'boolean' ? source[entry.id] : entry.defaultOn
  }
  return { version: STATE_VERSION, enabled }
}

/**
 * Read the state file.
 *
 * @param {string} path absolute path.
 * @returns {Promise<{state: object, exists: boolean, broken: boolean}>}
 */
export async function readState(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { state: normalizeState(null), exists: false, broken: false }
  }
  try {
    return { state: normalizeState(JSON.parse(text)), exists: true, broken: false }
  } catch {
    return { state: normalizeState(null), exists: true, broken: true }
  }
}

/**
 * Write the state file back.
 *
 * @param {string} path absolute path.
 * @param {unknown} state the next state.
 * @returns {Promise<object>} the normalized state that was written.
 */
export async function writeState(path, state) {
  const clean = normalizeState(state)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return clean
}

/**
 * Flip one extension, refusing ids this build does not know.
 *
 * @param {unknown} state the current state.
 * @param {string} id the extension to change.
 * @param {boolean} enabled the requested value.
 * @returns {{state?: object, error?: string}}
 */
export function toggleExtension(state, id, enabled) {
  if (!isExtensionId(id)) return { error: `unknown extension: ${id}` }
  if (typeof enabled !== 'boolean') return { error: 'enabled must be true or false' }
  const clean = normalizeState(state)
  return { state: { version: STATE_VERSION, enabled: { ...clean.enabled, [id]: enabled } } }
}

/**
 * Whether one extension is on, defaulting to its shipped value.
 *
 * @param {unknown} state the current state.
 * @param {string} id the extension.
 * @returns {boolean}
 */
export function isEnabled(state, id) {
  return normalizeState(state).enabled[id] === true
}

/**
 * The registry as the page renders it: labels, copy, and the live switch.
 *
 * @param {unknown} state the current state.
 * @returns {Array<object>} one row per extension.
 */
export function extensionRows(state) {
  const clean = normalizeState(state)
  return EXTENSIONS.map((entry) => ({ ...entry, enabled: clean.enabled[entry.id] === true }))
}
