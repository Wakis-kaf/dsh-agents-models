/**
 * Agent Modes — host half.
 *
 * Registers one `@deepseek-ai/dsh-agent-preset` definition per configured mode,
 * so an operator's mode list becomes real agent presets. The Web page edits that
 * list through this plugin's own row config; nothing here rewrites the user's
 * profile patch.
 *
 * Two mode shapes exist:
 *
 * - ordinary — the checked tools plus persona and compaction;
 * - `pure` — persona and compaction only. Every tool and every plugin is opt-in
 *   from the mode detail page, so the model starts with no capability at all.
 *
 * The order of `mode.tools` is the priority order: rows are mounted in that
 * order and the persona suffix states the preference, because a preset cannot
 * set the host-plane `systemPrompt.toolOrder`.
 *
 * @module dsh-agents-modes
 */

import { readFile } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep, relative, isAbsolute } from 'node:path'

import {
  CATEGORIES,
  DEFAULT_TOOL_IDS,
  TOOLS,
  TOOL_BY_ID,
  isKnownToolId,
  toolLabel,
} from './catalog.js'
import { scanPluginTools } from './plugin-tools.js'
import { createPolicyScope, compilePolicy } from './capability-policy.js'
import { exportSkillResources, analyzeSkillResources, installSkillResources } from './skill-resources.js'
import { exportModePack, validateModePack, analyzeModePack, mergePackModes, installPackDependencies, installedPackage } from './mode-pack.js'
import {
  BUILTIN_TEMPLATES,
  applyPatch,
  resolveModeConfig,
  splitModeConfig,
  templateById,
} from './builtin-modes.js'
import {
  assignCategories,
  autoCategory,
  buildPack,
  editCategory,
  isCategoryId,
  parsePack,
  parseSkillFile,
  readStore,
  renderSkillFile,
  skillsRoot,
  storePath,
  writeStore,
} from './skill-store.js'
import { aggregateSessions, summarizeSession } from './stats.js'
import { extensionRows, isEnabled, readState, statePath, toggleExtension, writeState } from './extensions.js'
import { creditOf, ledgerPath, mergeObservation, readLedger, recentSessions, writeLedger } from './spend-store.js'
import {
  PRICE_VERSION,
  foldSpendEvents,
  spendOf,
} from './spend.js'

/** Rows every mode mounts before its own tool selection. */
const BASE_ROWS = Object.freeze([
  { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
])

/**
 * Config keys a mode is allowed to override on one catalog row.
 *
 * `provider` is deliberately excluded: it is what scopes the guard to WorkBuddy
 * sessions at all, and a mode that could retarget it would be switching the
 * guard off while looking like a tuning knob.
 *
 * @param entry a catalog entry.
 * @returns the writable key set.
 */
export function paramKeys(entry) {
  const keys = new Set(Object.keys(entry?.config ?? {}))
  for (const param of entry?.params ?? []) keys.add(param.key)
  keys.delete('provider')
  return keys
}

/**
 * The schema fields one catalog row exposes, with the shipped config resolved
 * as the default value the page shows.
 *
 * @param entry a catalog entry.
 * @returns one row per tunable field.
 */
export function paramSchema(entry) {
  return (entry?.params ?? []).map((param) => ({
    ...param,
    default: entry?.config?.[param.key] ?? param.default,
  }))
}

/**
 * Map one catalog entry to a fresh preset row, or undefined when unknown.
 *
 * Rows are cloned per call: a group row is shared by every preset that mounts
 * it, and the Loader treats a row as mutable material.
 *
 * @param id catalog id.
 * @param overrides per-mode parameter overrides, keyed by catalog id. Keys that
 *   the row does not declare are ignored, so a mode cannot smuggle arbitrary
 *   config into a package it merely mounts.
 */
export function toolRow(id, overrides) {
  const entry = TOOL_BY_ID[id]
  if (entry === undefined) return undefined
  if (typeof entry.row === 'object') return structuredClone(entry.row)
  const row = { id: entry.row, name: entry.pkg }
  const config = { ...(entry.config ?? {}) }
  const override = overrides?.[id]
  if (override !== null && typeof override === 'object' && !Array.isArray(override)) {
    const allowed = paramKeys(entry)
    for (const [key, value] of Object.entries(override)) {
      if (allowed.has(key) && value !== undefined) config[key] = value
    }
  }
  if (Object.keys(config).length > 0) row.config = config
  return row
}

/**
 * Resolve the ordered tool ids a mode uses.
 *
 * A `pure` mode mounts exactly what it stored — which may be nothing — plus
 * compaction, which is locked on because a pure session that outgrows the
 * context window must still be able to compact rather than fail. An ordinary
 * mode falls back to the catalog defaults only when it never stored a list at
 * all, so an operator who unchecks everything keeps an empty set.
 */
export function resolveTools(mode) {
  if (Array.isArray(mode?.tools)) {
    const stored = mode.tools.filter((id) => isKnownToolId(id))
    return mode?.pure === true && !stored.includes('compaction')
      ? [...stored, 'compaction']
      : stored
  }
  return mode?.pure === true ? ['compaction'] : [...DEFAULT_TOOL_IDS]
}

/** Sanitize one plugin package name into a stable preset row id. */function pluginRowId(packageName) {
  return `plugin-${String(packageName).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/**
 * Model-facing preference paragraph.
 *
 * The only supported lever: sort the mounted rows, then tell the model the
 * order is meaningful. Emitted only when the order differs from the catalog
 * default, so a stock mode keeps a clean prompt.
 */
function preferenceSuffix(mode, orderedIds) {
  const flat = []
  for (const id of orderedIds) {
    for (const tool of TOOL_BY_ID[id]?.tools ?? []) flat.push(tool)
  }
  const unique = [...new Set(flat)]
  if (unique.length < 2) return ''

  const baseline = DEFAULT_TOOL_IDS.flatMap((id) => TOOL_BY_ID[id]?.tools ?? [])
  const sameAsDefault =
    unique.length === baseline.length && unique.every((name, i) => name === baseline[i])
  if (sameAsDefault) return ''

  return [
    'Tool preference: when more than one available tool can accomplish the next step,',
    `prefer the earliest in this list — ${unique.join(', ')}.`,
    'Later entries are fallbacks; use them only when the earlier ones cannot do the job.',
  ].join(' ')
}

/** Build the `plugins` array a preset declaration expects. */
export function buildPlugins(mode, policyScope) {
  const orderedIds = resolveTools(mode)
  const prefix =
    (typeof mode?.persona === 'string' && mode.persona.trim()) ||
    'You are a coding agent powered by the {{model}} model.'
  const suffix = preferenceSuffix(mode, orderedIds)

  // `persona: false` means one of the mode's own plugins owns the persona
  // section. Mounting the stock row as well would register the same section
  // name twice in one scope, which the prompt registry rejects at activation.
  const plugins = mode?.persona === false
    ? []
    : [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: suffix === '' ? { prefix } : { prefix, suffix },
      },
    ]
  plugins.push(
    ...BASE_ROWS.filter((row) => row.id === 'agent-instructions' ? mode?.context?.projectInstructions !== false : mode?.context?.timeContext !== false).map((row) => structuredClone(row)),
  )

  plugins.push({
    id: 'mode-capability-policy', name: 'dsh-agents-modes/capability-policy',
    config: { scope: policyScope ?? '', mode: mode.id },
  })

  const mountedRows = new Set()
  for (const id of orderedIds) {
    const row = toolRow(id, mode?.config)
    if (row === undefined) continue
    // A repeated row id would mount the same entry twice and fail activation.
    if (mountedRows.has(row.id)) continue
    mountedRows.add(row.id)
    plugins.push(row)
  }

  // Operator-added packages, after the catalog rows so the priority list keeps
  // meaning. A package already mounted by a catalog row is not mounted twice.
  // `pluginConfig` is the only way to reach a row that needs settings (a
  // subpath export such as `dsh-work-fish/core/persona` needs `complete: true`).
  const mountedNames = new Set(plugins.map((row) => row.name))
  const seenExtra = new Set()
  const extras = Array.isArray(mode?.plugins) ? mode.plugins : []
  const pluginConfig = mode?.pluginConfig !== null && typeof mode?.pluginConfig === 'object' ? mode.pluginConfig : {}
  for (const value of extras) {
    if (typeof value !== 'string' || value.trim() === '') continue
    const name = value.trim()
    if (mountedNames.has(name) || seenExtra.has(name)) continue
    seenExtra.add(name)
    const config = pluginConfig[name]
    plugins.push({
      id: pluginRowId(name),
      name,
      ...(config !== null && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).length > 0
        ? { config: structuredClone(config) }
        : {}),
    })
  }

  return plugins
}

/** Build one preset definition from a stored mode. */
export function buildDefinition(mode, index, policyScope) {
  return {
    id: mode.id,
    name: typeof mode.name === 'string' && mode.name ? mode.name : mode.id,
    ...(typeof mode.description === 'string' && mode.description
      ? { description: mode.description }
      : {}),
    order: typeof mode.order === 'number' ? mode.order : 50 + index,
    plugins: buildPlugins(mode, policyScope),
  }
}

/**
 * Read the packages a preset can actually mount.
 *
 * A candidate is a dependency the profile declares (or ships as a bundle) whose
 * manifest carries a `dsh` declaration — the same field the client-module scan
 * reads. Non-plugin dependencies such as `zod` are skipped, so the list stays a
 * plugin list rather than a node_modules dump.
 *
 * This plugin excludes itself: mounting it inside a preset would register this
 * very mode list a second time and fail on the duplicate preset ids.
 */
async function discoverPlugins(profileDir, activeNames, selfNames) {
  if (typeof profileDir !== 'string' || profileDir === '') return []
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return []
  }
  const declared = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
    ...(Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []),
  ])

  const found = []
  for (const name of [...declared].sort()) {
    if (selfNames.has(name)) continue
    const packageDir = join(profileDir, 'node_modules', ...name.split('/'))
    let pkg
    try {
      pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    const isDshPlugin = pkg?.dsh !== undefined || pkg?.keywords?.includes?.('dsh-plugin')
    if (isDshPlugin !== true) continue
    found.push({
      name,
      version: typeof pkg.version === 'string' ? pkg.version : undefined,
      title: typeof pkg.displayName === 'string' ? pkg.displayName : pkg.name,
      description: typeof pkg.description === 'string' ? pkg.description : undefined,
      hasClient: typeof pkg?.dsh?.client === 'object' && pkg.dsh.client !== null,
      isBundle: pkg?.dsh?.bundle !== undefined,
      enabled: activeNames.has(name),
      // Tool names the package declares. Checked rows mount the package, so the
      // editor shows what a mount actually brings in.
      tools: [...(await scanPluginTools(packageDir, pkg))],
    })
  }
  return found
}

/**
 * Package names this row is known by, so it can exclude itself from its own
 * inventory. Mounting this plugin inside a preset would register the same mode
 * list a second time and fail on the duplicate preset ids.
 *
 * The old `@local/dsh-agent-modes` id stays listed: a profile that still links
 * the package under its pre-open-source name would otherwise see itself.
 */
export const SELF_PACKAGE_NAMES = Object.freeze([
  'dsh-agents-modes',
  '@local/dsh-agent-modes',
])

/**
 * Profile entry id of the agent-preset registry, and the volatile field it
 * resolves a session's preset from. `selectedDefault` wins over the row's static
 * `default`, which is what makes "set as new-task default" live rather than a
 * profile edit plus restart.
 */
const PRESET_REGISTRY_NS = 'agent-preset-registry'

/**
 * The preset a new session would start on, read from the same registry getter
 * the host itself resolves at session creation.
 *
 * @param ctx host context that may carry `agentPresets`.
 * @returns the default preset id, or '' when the registry is absent.
 */
function currentDefaultId(ctx) {
  try {
    const registry = ctx.get('agentPresets')
    const id = registry?.defaultId
    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
}

/** Optional Cordis services must be resolved explicitly, not through injected property getters. */
function getService(ctx, name) {
  return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name]
}

/** Module names of every non-group Loader row that currently has a fiber. */
function activeModuleNames(loader) {
  const names = new Set()
  try {
    for (const entry of loader.entries()) {
      if (entry.options?.group === true) continue
      const name = entry.options?.name
      if (typeof name === 'string') names.add(name)
    }
  } catch {
    /* an absent or unreadable tree simply yields no active names */
  }
  return names
}

/** One JSON response with caching disabled. */
function json(value) {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

/**
 * The installed package a skill directory belongs to, if any.
 *
 * A plugin that ships skills (ds-work-fish, a workbench plugin, anyone else)
 * exposes them through a provider whose path points inside its own package. The
 * operator needs that name — "bundled" cannot distinguish a DSH built-in from a
 * third-party plugin the mode mounts, and those two are edited in different
 * places.
 *
 * @param path absolute skill directory or SKILL.md path.
 * @param profileDir the profile root, whose `node_modules` holds the packages.
 * @returns the package name (`@scope/name` or `name`), or undefined.
 */
export function skillPackage(path, profileDir) {
  if (typeof path !== 'string' || path === '' || typeof profileDir !== 'string' || profileDir === '') return undefined
  let rel
  try {
    rel = relative(join(profileDir, 'node_modules'), path)
  } catch {
    return undefined
  }
  if (rel === '' || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') return undefined
  const parts = rel.split(sep)
  if (parts.length < 2) return undefined
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Which root a discovered skill came from.
 *
 * The registry hands back a provider name and an absolute path; the pane needs
 * one word for "is this row mine". A user skill lives under the writable root
 * this plugin writes to, so the path decides it rather than the provider name —
 * providers get renamed, paths do not.
 *
 * @param skill a registry summary.
 * @returns `user` | `project` | `bundled` | `other`.
 */
function skillSource(skill) {
  const path = typeof skill?.path === 'string' ? skill.path : ''
  if (path !== '' && isUserSkillPath(path)) return 'user'
  const provider = typeof skill?.provider === 'string' ? skill.provider.toLowerCase() : ''
  if (provider.includes('filesystem')) return 'project'
  if (provider.includes('bundled') || provider.includes('office')) return 'bundled'
  return 'other'
}

/**
 * Whether a path lives under the writable user skill root.
 *
 * The registry returns `realpath()`-resolved paths, so the comparison has to be
 * case-insensitive on Windows and accept either separator; a bare prefix test
 * would misclassify every row the moment the home path differs in case.
 *
 * @param path an absolute skill path.
 * @returns true when this plugin may write it directly.
 */
function isUserSkillPath(path) {
  if (typeof path !== 'string' || path === '') return false
  const lower = path.toLowerCase()
  const base = skillsRoot().toLowerCase()
  return lower === base || lower.startsWith(`${base}${sep}`) || lower.startsWith(`${base}/`)
}

/**
 * The bucket a skill actually lands in, derived or filed.
 *
 * @param skill a registry summary.
 * @param store a normalized category store.
 * @returns the category id, or '' when nothing applies.
 */
function skillCategory(skill, store) {
  const explicit = store?.assignments?.[skill?.name]
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const derived = autoCategory(skill)
  return typeof derived === 'string' ? derived : ''
}

/**
 * Rows a running session can gain or lose without re-selecting its preset.
 *
 * The registry refuses `select()` once a session has produced a turn
 * (`agent-preset/locked`), so a preset binding is immutable for the life of a
 * conversation. Tool registration is not: `dsh-tools` resolves the visible set
 * on every step, so mounting an extra tool row into the Agent's own scope makes
 * it usable from the next turn on. Only rows that mount cleanly on their own
 * quality — the catalog rows the editor offers — are eligible here.
 */
const HOT_TOOL_ROWS = new Set(TOOLS.filter((tool) => tool.hostOnly !== true).map((tool) => tool.id))

/** Rows that are never hot-applied: compaction is preset-plane and locked; the
 * persistent shell owns an isolated terminals realm that belongs to preset
 * construction. */
const HOT_EXCLUDED = new Set(['compaction', 'tool-pwsh-persistent'])

/**
 * Diff two tool id lists.
 *
 * @param before previous selection.
 * @param after requested selection.
 * @returns the ids to mount and the ids to release.
 */
function diffTools(before, after) {
  const had = new Set(Array.isArray(before) ? before : [])
  const want = new Set(Array.isArray(after) ? after : [])
  const added = []
  const removed = []
  for (const id of want) {
    if (had.has(id)) continue
    if (!HOT_TOOL_ROWS.has(id) || HOT_EXCLUDED.has(id)) continue
    added.push(id)
  }
  for (const id of had) {
    if (want.has(id)) continue
    if (!HOT_TOOL_ROWS.has(id) || HOT_EXCLUDED.has(id)) continue
    removed.push(id)
  }
  return { added, removed }
}

/**
 * Apply a tool-set change to every live session currently bound to one preset.
 *
 * This is best-effort and deliberately narrow: it mounts catalog tool rows into
 * the Agent context, which `dsh-tools` picks up on the next step, and releases
 * the ones the operator unchecked. Persona, plugin rows, and the preset
 * binding itself stay untouched — those still need a new task.
 *
 * @param ctx host context holding `agents` and `agentPresets`.
 * @param presetId the mode whose tool list changed.
 * @param before tool ids the mode mounted previously.
 * @param after tool ids the mode mounts now.
 * @param overrides per-mode parameter overrides, so a hot-mounted row starts on
 *   the same tuning as the rows the preset built at load.
 * @returns a report the settings page can show verbatim, or null when the
 *   change is not one hot apply can express.
 */
async function hotApplyTools(ctx, presetId, before, after, overrides) {
  const { added, removed } = diffTools(before, after)
  if (added.length === 0 && removed.length === 0) return null

  let live = []
  try {
    live = getService(ctx, 'agents')?.list?.() ?? []
  } catch {
    live = []
  }

  const skipped = []
  const announced = []
  let touched = 0
  for (const agent of live) {
    const bound = getService(ctx, 'agentPresets')?.composedPreset?.(agent.ctx)
    if (bound !== presetId) continue
    let changed = false
    try {
      // eslint-disable-next-line no-await-in-loop -- one session at a time keeps diagnostics attributable
      await applyRowsToAgent(agent, added, removed, overrides)
      changed = true
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : String(error))
    }
    if (!changed) continue
    touched++
    // The rows are visible now, but the conversation that already concluded it
    // had no such tool would keep saying so. Record the change in band.
    if (announceToolChange(agent, added, removed)) announced.push(agent.id)
  }

  return { presetId, sessions: touched, added, removed, announced, skipped }
}

/**
 * Entry id a hot tool row uses inside an Agent's Loader tree.
 *
 * The prefix keeps hot rows distinguishable from the rows the preset mounted,
 * so releasing one cannot remove a row the preset still needs.
 *
 * @param toolId catalog id.
 * @returns the entry id to mount under.
 */
const hotRowId = (toolId) => `hot-${toolId}`

/**
 * Tool names a hot apply makes newly available, in catalog order.
 *
 * The models on the receiving end only ever learn about their tools from the
 * request envelope, so a silent schema swap is not enough: a conversation that
 * already concluded "I have no web tools" repeats that conclusion even after
 * `web_search` appears in the next request. This list is what the notice says.
 *
 * @param added catalog ids mounted by this apply.
 * @returns the flattened tool names, deduplicated, in mount order.
 */
export function addedToolNames(added) {
  const names = []
  for (const id of Array.isArray(added) ? added : []) {
    for (const name of TOOL_BY_ID[id]?.tools ?? []) {
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

/**
 * Tell a live session, in band, that its tool set just changed.
 *
 * The session log is the only channel the model reads, and a preset cannot be
 * re-bound mid-conversation, so the change is reported the way every other
 * mid-session change is: one sourced `runtime-context` notice carrying the new
 * names. `form: 'notice'` marks it as a one-shot announcement rather than a
 * durable snapshot, which is what keeps it from being re-admitted on every
 * later step.
 *
 * Best-effort: a session whose surface rejects the append keeps the mounted
 * rows, because the mount itself already succeeded.
 *
 * @param agent live agent the rows were mounted into.
 * @param added catalog ids that were just mounted.
 * @param removed catalog ids that were just released.
 * @returns true when the notice was recorded.
 */
function announceToolChange(agent, added, removed) {
  const gained = addedToolNames(added)
  const lost = addedToolNames(removed)
  if (gained.length === 0 && lost.length === 0) return false
  const session = agent?.session
  if (session === undefined || typeof session.append !== 'function') return false

  const parts = []
  if (gained.length > 0) {
    parts.push(
      `This session's tool set changed: ${gained.join(', ')} ${
        gained.length === 1 ? 'is' : 'are'
      } now available and can be called from this reply on.`,
    )
  }
  if (lost.length > 0) {
    parts.push(`${lost.join(', ')} ${lost.length === 1 ? 'is' : 'are'} no longer available.`)
  }
  parts.push(
    'Earlier statements about which tools exist describe the moment they were made; this notice supersedes them.',
  )

  const summary = [
    gained.length > 0 ? `added ${gained.join(', ')}` : '',
    lost.length > 0 ? `removed ${lost.join(', ')}` : '',
  ].filter((part) => part !== '').join('; ')

  try {
    session.append(
      'user/message',
      {
        role: 'user',
        content: [{ type: 'text', text: parts.join(' ') }],
        source: { kind: 'runtime-context', form: 'notice', summary: `Tools updated: ${summary}` },
      },
      // A surface event must declare how it enters the surface; an append adds
      // it after the retained history. Without this the host rejects the event.
      { surfaceOp: 'append' },
    )
    return true
  } catch {
    return false
  }
}

/**
 * Mount and unmount catalog rows inside one live Agent.
 *
 * `dsh-tools` resolves the visible set per step, so a row mounted here is
 * usable from the Agent's next turn without touching its preset binding.
 *
 * @param agent live agent whose Loader tree receives the rows.
 * @param added tool ids to mount.
 * @param removed tool ids to release.
 * @param overrides per-mode parameter overrides.
 */
async function applyRowsToAgent(agent, added, removed, overrides) {
  const loader = getService(agent.ctx, 'loader')
  if (loader === undefined || typeof loader.create !== 'function') {
    throw new Error('the running session exposes no Loader tree')
  }
  for (const toolId of removed) {
    const id = hotRowId(toolId)
    try {
      loader.remove(id)
    } catch {
      // Not mounted in this session: nothing to release.
    }
  }
  for (const toolId of added) {
    const row = toolRow(toolId, overrides)
    if (row === undefined) continue
    const id = hotRowId(toolId)
    try {
      loader.resolve(id)
      continue
    } catch {
      // Not mounted yet.
    }
    await loader.create({ ...row, id })
  }
}

export const name = 'agent-modes'

/** How long one folded session stays fresh before it is read again. */
const STATS_TTL_MS = 20_000

/** Upper bound on cached per-session folds in one host process. */
const STATS_CACHE_MAX = 400

/**
 * How long a spend fold is reused.
 *
 * The readout polls every 15 s and the log cannot change without a request being
 * answered, so a 10 s window collapses the common case (several mounted
 * composers, one session) to one fold while still moving within one poll of a
 * new request. Measured on a 9.7 MB log: ~100 ms to read and inflate, so folding
 * per poll without a cache would cost real time for no new information.
 */
const SPEND_TTL_MS = 10_000

/** Upper bound on cached spend folds; a long-running host cannot grow it. */
const SPEND_CACHE_MAX = 50

/**
 * Fold one session's spend, reusing a recent result.
 *
 * A read failure is NOT swallowed into an empty fold: "the log could not be read"
 * and "this conversation spent nothing" are different claims, and the route turns
 * the throw into an error rather than a zero.
 *
 * @param {object} query the mounted `sessionQuery` service.
 * @param {string} sessionId the session to fold.
 * @param {Map} cache per-process cache keyed by session id.
 * @returns {Promise<object>} the `foldSpendEvents` result.
 */
async function foldSessionSpend(query, sessionId, cache) {
  const cached = cache.get(sessionId)
  const now = Date.now()
  if (cached !== undefined && now - cached.at < SPEND_TTL_MS) return cached.fold
  const loaded = await query.readSession(sessionId)
  const fold = foldSpendEvents(loaded?.events ?? [])
  if (cache.size >= SPEND_CACHE_MAX) cache.clear()
  cache.set(sessionId, { at: now, fold })
  return fold
}

/**
 * Fold one session, reusing a recent result.
 *
 * A full log read is the expensive part (a long session is megabytes of
 * events), so the fold is cached for a short window. A read failure falls back
 * to the cached value rather than dropping a session the operator can still see.
 *
 * @param query the mounted `sessionQuery` service.
 * @param record one `listSessions()` row.
 * @param cache per-process cache keyed by session id.
 * @returns the summary, or null when the log cannot be read at all.
 */
async function readSessionSummary(query, record, cache) {
  const id = record?.header?.id
  if (typeof id !== 'string' || id === '') return null
  const cached = cache.get(id)
  const now = Date.now()
  if (cached !== undefined && now - cached.at < STATS_TTL_MS) return cached.summary
  try {
    const loaded = await query.readSession(id)
    const summary = summarizeSession(loaded?.session ?? record.header, loaded?.events ?? [])
    summary.live = record.live === true
    if (cache.size >= STATS_CACHE_MAX) cache.clear()
    cache.set(id, { at: now, summary })
    return summary
  } catch {
    return cached === undefined ? null : cached.summary
  }
}

/**
 * One parameter value against its schema.
 *
 * Range checks run in *display* units, because that is the number the operator
 * typed: `maxReadBytes` is stored in bytes and compared as MB.
 *
 * @param param a resolved schema field (carrying `default`).
 * @param raw the value from the request body.
 * @returns a short problem description, or null when the value is fine.
 */
function checkParamValue(param, raw) {
  if (param.type === 'bool') {
    return typeof raw === 'boolean' ? null : 'must be true or false'
  }
  // A string field is an endpoint or a name, not a measurement: no scale, no
  // range. It is rejected only when empty or the wrong type, so a typo reaches
  // the plugin and fails there with the plugin's own message.
  if (param.type === 'string') {
    if (typeof raw !== 'string') return 'must be text'
    return raw.trim() === '' ? 'must not be empty' : null
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'must be a number'
  const scale = Number.isFinite(param.scale) && param.scale > 0 ? param.scale : 1
  const shown = raw / scale
  const unit = typeof param.unit === 'string' ? param.unit : ''
  if (Number.isFinite(param.min) && shown < param.min) return `must be at least ${param.min}${unit}`
  if (Number.isFinite(param.max) && shown > param.max) return `must be at most ${param.max}${unit}`
  return null
}

/**
 * Validate and slim one mode's parameter overrides.
 *
 * Only declared fields survive, and a value equal to the shipped default is
 * dropped rather than stored — so "reset" and "never touched" end up identical
 * on disk, and the config the operator reads back is the diff, not a snapshot.
 *
 * @param mode one entry from the save request.
 * @param mounted the tool ids this mode actually mounts; an override left
 *   behind by an unchecked row is dropped rather than rejected, because
 *   unticking a tool is a normal edit and not an error.
 * @returns `{ error }` when the overrides are invalid, else `{ clean }` where
 *   `clean` is null for "leave config absent".
 */
function normalizeModeConfig(mode, mounted) {
  const source = mode?.config
  if (source === undefined) return { clean: null }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return { error: `mode "${mode.id}" parameters must be an object` }
  }
  const clean = {}
  for (const [toolId, values] of Object.entries(source)) {
    // A row that is no longer mounted keeps no tuning; it is not an error.
    if (!mounted.has(toolId)) continue
    const entry = TOOL_BY_ID[toolId]
    if (entry === undefined) {
      return { error: `mode "${mode.id}" sets parameters on unknown tool id: ${toolId}` }
    }
    const label = toolLabel(entry, 'zh')
    const schema = paramSchema(entry)
    if (schema.length === 0) return { error: `「${label}」没有可调参数` }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      return { error: `「${label}」的参数必须是一个对象` }
    }
    const kept = {}
    for (const [key, raw] of Object.entries(values)) {
      const param = schema.find((item) => item.key === key)
      if (param === undefined) return { error: `「${label}」没有参数 ${key}` }
      const problem = checkParamValue(param, raw)
      if (problem !== null) return { error: `「${label}」的 ${key} ${problem}` }
      if (raw === param.default) continue
      kept[key] = raw
    }
    if (Object.keys(kept).length > 0) clean[toolId] = kept
  }
  return { clean: Object.keys(clean).length === 0 ? null : clean }
}

/** Shared preflight for save, export and import, before any installation. */
export function validateModes(input) {
  if (!Array.isArray(input) || input.length > 100) return { error: 'modes must be an array of at most 100 entries' }
  const next = structuredClone(input)
  const seen = new Set()
  for (const mode of next) {
    if (typeof mode?.id !== 'string' || mode.id.trim() === '') {
      return { ok: false, error: 'every mode needs a non-empty id' }
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(mode.id)) {
      return {
        ok: false,
        error: `mode id "${mode.id}" must be lowercase letters, digits, and dashes`,
      }
    }
    if (seen.has(mode.id)) {
      return { ok: false, error: `duplicate mode id: ${mode.id}` }
    }
    seen.add(mode.id)
    if (mode.id.length > 128) return { error: 'mode id is too long' }
    for (const field of ['name', 'description']) if (mode[field] !== undefined && (typeof mode[field] !== 'string' || mode[field].length > 500000)) return { error: `mode "${mode.id}" has invalid ${field}` }
    // `persona: false` is the "one of my plugins owns the prompt section" marker.
    if (mode.persona !== undefined && mode.persona !== false && (typeof mode.persona !== 'string' || mode.persona.length > 500000)) return { error: `mode "${mode.id}" has invalid persona` }
    if (mode.pure !== undefined && typeof mode.pure !== 'boolean') return { error: `mode "${mode.id}" has invalid pure flag` }
    if (mode.context !== undefined && (!mode.context || typeof mode.context !== 'object' || Array.isArray(mode.context)
      || Object.entries(mode.context).some(([key, value]) => !['projectInstructions', 'timeContext'].includes(key) || typeof value !== 'boolean'))) return { error: `mode "${mode.id}" has invalid context controls` }

    if (mode.skills !== undefined && (!Array.isArray(mode.skills) || mode.skills.length > 500 || mode.skills.some((name) => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)))) return { error: `mode "${mode.id}" has invalid skills` }
    if (mode.tools !== undefined && !Array.isArray(mode.tools)) return { error: `mode "${mode.id}" has invalid tools` }
    for (const field of ['allowedTools', 'disabledTools']) {
      if (mode[field] !== undefined && (!Array.isArray(mode[field]) || mode[field].length > 500
        || mode[field].some((name) => typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(name)))) {
        return { ok: false, error: `mode "${mode.id}" has invalid ${field}` }
      }
    }
    if (mode.plugins !== undefined && (!Array.isArray(mode.plugins)
      || mode.plugins.length > 200 || mode.plugins.some((name) => typeof name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(name)))) {
      return { ok: false, error: `mode "${mode.id}" has invalid plugin names` }
    }
    // A subpath export can need settings (`complete: true` on a persona row), so
    // the config is allowed — but only for a package the mode actually mounts.
    if (mode.pluginConfig !== undefined) {
      if (mode.pluginConfig === null || typeof mode.pluginConfig !== 'object' || Array.isArray(mode.pluginConfig)) {
        return { ok: false, error: `mode "${mode.id}" has invalid plugin config` }
      }
      for (const [name, config] of Object.entries(mode.pluginConfig)) {
        if (!Array.isArray(mode.plugins) || !mode.plugins.includes(name)) {
          return { ok: false, error: `mode "${mode.id}" configures an unlisted plugin: ${name}` }
        }
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
          return { ok: false, error: `mode "${mode.id}" plugin config for ${name} must be an object` }
        }
        if (Object.keys(config).length === 0) return { ok: false, error: `mode "${mode.id}" plugin config for ${name} is empty` }
      }
    }
    const tools = Array.isArray(mode.tools) ? mode.tools : []
    const seenTool = new Set()
    for (const id of tools) {
      const tool = TOOL_BY_ID[id]
      if (tool === undefined) {
        return {
          ok: false,
          error: `mode "${mode.id}" lists unknown tool id: ${String(id)}`,
        }
      }
      if (seenTool.has(id)) {
        return { ok: false, error: `mode "${mode.id}" lists ${id} twice` }
      }
      seenTool.add(id)
      if (tool.hostOnly === true) {
        return {
          ok: false,
          error: `「${toolLabel(tool, 'zh')}」只能在宿主平面运行，不能放进模式`,
        }
      }
    }
    for (const id of tools) {
      const clash = (TOOL_BY_ID[id]?.exclusiveWith ?? []).find((other) => tools.includes(other))
      if (clash !== undefined) {
        const a = toolLabel(TOOL_BY_ID[id], 'zh')
        const b = toolLabel(TOOL_BY_ID[clash], 'zh')
        return {
          ok: false,
          error: `「${a}」与「${b}」注册同一个工具名，只能二选一`,
        }
      }
    }

    // Parameters are stored as a diff against the shipped config, so a mode
    // that never touched a knob carries no config at all.
    const normalized = normalizeModeConfig(mode, new Set(tools))
    if (normalized.error !== undefined) {
      return { ok: false, error: normalized.error }
    }
    if (normalized.clean === null) delete mode.config
    else mode.config = normalized.clean
  }
  return { value: next }
}

export async function apply(root, rawConfig) {
  const profileKey = root.get('profileContext')?.dir
  // A built-in mode whose `requires` package is absent is skipped rather than
  // registered as a preset that cannot mount. The check is per load, so
  // installing the package later brings the mode in on the next start.
  const available = new Set()
  for (const template of BUILTIN_TEMPLATES) {
    if (typeof template.requires !== 'string') { available.add(template.id); continue }
    if (typeof profileKey === 'string' && profileKey !== '' && await installedPackage(profileKey, template.requires)) available.add(template.id)
  }
  // Shipped templates plus the operator's field-level overrides. A legacy
  // profile (one that stored whole modes) is returned untouched, so upgrading
  // the plugin never rewrites a mode list that was already in use; the page
  // offers the one-way conversion instead.
  const layer = resolveModeConfig(rawConfig, available)
  const modes = layer.modes
  const unregisters = []
  // A *stable* scope name, not a random id. A running session's guard captured
  // this string when its preset was built; if re-applying the plugin forked a new
  // id, that session would stop resolving its policy and — under an earlier
  // fail-closed guard — have every tool denied mid-conversation.
  const policyScope = createPolicyScope(profileKey ? `agent-modes:${profileKey}` : 'agent-modes')
  const refreshPolicies = async (next) => {
    const profile = root.get('profileContext')
    const inventory = await discoverPlugins(profile?.dir, new Set(), new Set(SELF_PACKAGE_NAMES))
    const retained = new Set(next.map((mode) => mode.id))
    for (const [id, policy] of policyScope.modes) if (!retained.has(id)) policyScope.modes.set(id, { allowed: new Set(), denied: new Set(), skills: new Set(), events: policy.events, retired: true })
    for (const mode of next) {
      const policy = compilePolicy({ ...mode, tools: resolveTools(mode) }, TOOLS, inventory)
      policy.events = policyScope.modes.get(mode.id)?.events ?? []
      policyScope.modes.set(mode.id, policy)
    }
  }
  await refreshPolicies(modes)
  root.effect(() => policyScope.dispose, 'agent-modes: capability policies')

  // The tool selection as the *running* profile has it. `modes` is the snapshot
  // captured at load, so a second save in the same process would otherwise
  // diff against stale values and miss the rows the first save mounted.
  const currentTools = new Map(modes.map((mode) => [mode?.id, resolveTools(mode)]))

  // Register every configured mode as a real preset.
  if (modes.length > 0) {
    root.inject(['agentPresets'], (ctx) => {
      const registry = ctx.agentPresets
      if (typeof registry?.register !== 'function') return

      modes.forEach((mode, index) => {
        if (typeof mode?.id !== 'string' || mode.id.trim() === '') return
        Promise.resolve()
          .then(() => registry.register(buildDefinition(mode, index, policyScope.id)))
          .then((dispose) => { if (typeof dispose === 'function') unregisters.push(dispose) })
          .catch((error) => {
            ctx.logger?.warn?.(
              `agent-modes: cannot register mode "${mode.id}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          })
      })

      ctx.effect(() => () => {
        for (const dispose of unregisters.splice(0)) {
          Promise.resolve().then(() => dispose()).catch(() => {})
        }
      }, 'agent-modes: registered presets')
    })
  }

  // HTTP surface for the settings page and the sidebar panel.
  root.inject(['connection'], (ctx) => {
    const connection = ctx.get('connection')
    const registerFn = connection?.fetch?.register
    if (typeof registerFn !== 'function') return

    const route = (path, handler, label) =>
      ctx.effect(
        () =>
          registerFn.call(connection.fetch, {
            path,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: handler,
          }),
        label,
      )

    const hostPackages = [...new Set([
      ...BASE_ROWS.map((row) => row.name), '@deepseek-ai/dsh-persona',
      ...TOOLS.flatMap((entry) => {
        const names = []
        const collect = (row) => row?.group ? (row.config ?? []).forEach(collect) : names.push(row?.name)
        if (typeof entry.row === 'object') collect(entry.row)
        else names.push(entry.pkg)
        return names.filter((name) => typeof name === 'string' && name.startsWith('@deepseek-ai/'))
      }),
    ])]
    let importing = false
    const packRoute = (path, handler) => route(path, async (request) => {
      try {
        const body = await request.json()
        const profileDir = ctx.get('profileContext')?.dir
        if (!profileDir) throw new Error('This host exposes no profile directory')
        return json({ ok: true, value: await handler(body, profileDir) })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }, `agent-modes: ${path}`)

    packRoute('/api/agent-modes/pack-export', async (body, profileDir) => {
      const checked = validateModes(Array.isArray(body.modes) ? body.modes : modes.filter((mode) => mode.id === body.mode))
      if (checked.error) throw new Error(checked.error)
      const selected = checked.value
      if (!selected.length || selected.length > 100) throw new Error('Select modes to export')
      const scope = body.scope ?? 'mode'
      const packages = new Set()
      const collect = (rows) => {
        for (const row of rows) {
          if (row.group === true) collect(row.config ?? [])
          else if (typeof row.name === 'string' && !row.name.startsWith('dsh-agents-modes/') && !row.name.startsWith('cordis:')) packages.add(row.name)
        }
      }
      if (scope === 'mode') for (const mode of selected) collect(buildPlugins(mode))
      if (scope === 'tools') for (const mode of selected) collect(resolveTools(mode).map((id) => toolRow(id)).filter(Boolean))
      if (scope === 'plugins') for (const mode of selected) for (const name of mode.plugins ?? []) packages.add(name)
      const pack = await exportModePack({ modes: selected, profileDir, packages: [...packages], scope, hostPackages })
      if (scope === 'mode') pack.resources = await exportSkillResources(selected.flatMap((mode) => mode.skills ?? []), ctx.get('skills'))
      validateModePack(pack)
      return { pack, file: `${selected.length === 1 ? selected[0].id : 'modes'}-${scope}-pack.json` }
    })
    const resourcePlan = async (pack, plan) => {
      const registry = ctx.get('skills')
      plan.resources = await analyzeSkillResources(pack.resources, skillsRoot(), registry)
      for (const resource of plan.resources) {
        if (resource.status === 'conflict') plan.errors.push(`Skill already exists with different content: ${resource.name}`)
        if (resource.shadowed) plan.warnings.push(`Import creates a user copy shadowing an existing skill: ${resource.name}`)
        if (resource.instructionsOnly) plan.warnings.push(`${resource.name}: only instructions are included; its provider exposes no local resource directory`)
      }
      for (const mode of pack.modes) for (const name of mode.skills ?? []) {
        if (!(pack.resources ?? []).some((resource) => resource.name === name) && !await registry?.get?.(name, {})) plan.errors.push(`Missing skill resource: ${name}`)
      }
      if (pack.scope === 'mode' && pack.modes.some((mode) => !Array.isArray(mode.skills))) plan.warnings.push('Unrestricted skill access follows the recipient workspace; choose an explicit skill list for reproducible sharing')
      return plan
    }
    const reservedModeIds = async () => (await liveRoster()).filter((row) => !modes.some((mode) => mode.id === row.id)).map((row) => row.id)
    packRoute('/api/agent-modes/pack-analyze', async (body, profileDir) => {
      const base = validateModes(body.currentModes ?? modes)
      if (base.error) throw new Error(base.error)
      const { pack, ...plan } = await analyzeModePack(body.pack, { profileDir, modes: base.value, catalog: TOOLS, hostPackages, validateModes, target: body.target, reserved: await reservedModeIds() })
      await resourcePlan(pack, plan)
      return { ...plan, scope: pack.scope, modes: pack.modes.map(({ id, name }) => ({ id, name })) }
    })
    packRoute('/api/agent-modes/pack-import', async (body, profileDir) => {
      if (importing) throw new Error('Another import is running')
      importing = true
      try {
        const base = validateModes(body.currentModes ?? modes)
        if (base.error) throw new Error(base.error)
        const plan = await analyzeModePack(body.pack, { profileDir, modes: base.value, catalog: TOOLS, hostPackages, validateModes, target: body.target, reserved: await reservedModeIds() })
        await resourcePlan(plan.pack, plan)
        if (plan.errors.length) throw new Error(plan.errors.join('; '))
        const merged = mergePackModes(plan.pack, base.value, { target: body.target, conflict: body.conflict, reserved: await reservedModeIds() })
        const checked = validateModes(merged)
        if (checked.error) throw new Error(checked.error)
        const next = checked.value
        await installPackDependencies(plan, profileDir, body.install === true)
        await installSkillResources(plan.pack.resources, plan.resources, skillsRoot(), body.install === true)
        // Import prepares a draft. The normal save route remains the validation
        // and activation boundary, including parameter schemas and live policy.
        return { modes: next, restartRequired: plan.dependencies.some((dep) => dep.status === 'download' || dep.status === 'bundled') }
      } finally { importing = false }
    })

    /** Fold cache shared by every stats request in this host process. */
    const statsCache = new Map()
    /** Spend folds for the 对话消耗展示 readout; see {@link foldSessionSpend}. */
    const spendFoldCache = new Map()

    /** Live roster, including each preset's activation diagnostic. */
    const liveRoster = async () => {
      const live = []
      const registry = ctx.get('agentPresets')
      if (registry && typeof registry.list === 'function') {
        try {
          for (const entry of await registry.list()) {
            live.push({
              id: entry.id,
              name: entry.name,
              ...(entry.description === undefined ? {} : { description: entry.description }),
              ...(typeof entry.broken === 'string' && entry.broken !== ''
                ? { broken: entry.broken }
                : {}),
            })
          }
        } catch {
          /* the roster is an enhancement; an empty list still answers */
        }
      }
      return live
    }

    const sessionCapabilities = (modeId) => {
      const sessions = []
      let agents
      let presets
      try {
        agents = getService(ctx, 'agents')?.list?.() ?? []
        presets = getService(ctx, 'agentPresets')
      } catch { return sessions }
      if (!Array.isArray(agents)) return sessions
      for (const agent of agents) {
        try {
          if (presets?.composedPreset?.(agent.ctx) !== modeId) continue
        } catch { continue }
        try {
          const registry = getService(agent.ctx, 'tools') ?? getService(ctx, 'tools')
          sessions.push({ id: agent.id, registered: typeof registry?.definitions === 'function'
            ? registry.definitions(agent).map((definition) => definition.name) : null,
            mounts: [...activeModuleNames(getService(agent.ctx, 'loader'))],
          })
        } catch { sessions.push({ id: agent.id, registered: null, mounts: [] }) }
      }
      return sessions
    }

    route('/api/agent-modes/roster', async () => {
      const profile = ctx.get('profileContext')
      const activeNames = activeModuleNames(ctx.get('loader'))
      const plugins = await discoverPlugins(profile?.dir, activeNames, new Set(SELF_PACKAGE_NAMES))
      return json({
        ok: true,
        value: {
          configured: modes,
          capabilities: Object.fromEntries([...policyScope.modes].filter(([id, policy]) => !policy.retired || sessionCapabilities(id).length > 0).map(([id, policy]) => [id, {
            ...(policy.retired ? { retired: true } : {}),
            allowed: [...policy.allowed].filter((tool) => !policy.denied.has(tool)),
            disabled: [...policy.denied], events: policy.events, sessions: sessionCapabilities(id),
          }])),
          implicit: [...BASE_ROWS, { id: 'persona', name: '@deepseek-ai/dsh-persona' },
            { id: 'mode-capability-policy', name: 'dsh-agents-modes/capability-policy' }],
          live: await liveRoster(),
          // Which mode a *new* task starts on. The registry owns it, so the page
          // reads it here instead of guessing from the roster order.
          defaultMode: currentDefaultId(ctx),
          catalog: TOOLS.map((entry) => ({
            id: entry.id,
            package: entry.pkg,
            category: entry.category,
            zh: entry.zh,
            en: entry.en,
            descZh: entry.descZh,
            descEn: entry.descEn,
            tools: entry.tools,
            // The tunable fields this row exposes, with the shipped value as
            // the default. An empty list means the row has nothing to tune.
            params: paramSchema(entry),
            defaultOn: entry.defaultOn === true,
            locked: entry.locked === true,
            hostOnly: entry.hostOnly === true,
            risky: entry.risky === true,
            exclusiveWith: entry.exclusiveWith ?? [],
          })),
          categories: CATEGORIES,
          plugins,
          defaults: DEFAULT_TOOL_IDS,
          // Which modes are package-owned templates and which of their fields
          // hold operator overrides. `conflicts` lists an overridden field whose
          // template moved since the override was written; the page offers
          // "adopt upstream" instead of deciding silently.
          templates: {
            enabled: layer.enabled,
            legacy: layer.legacy,
            conflicts: layer.conflicts,
            overridden: Object.keys(layer.overrides ?? {}),
            removed: layer.removed,
            builtin: [...available],
          },
        },
      })
    }, 'agent-modes: roster route')

    // A duplicated tool, a host-plane-only row, or two rows registering the
    // same tool name would fail the mount; reject those here with a message the
    // page can show verbatim.
    route('/api/agent-modes/save', async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, error: 'body is not JSON' })
      }
      const checked = validateModes(body?.modes)
      if (checked.error) return json({ ok: false, error: checked.error })
      const next = checked.value

      const entry = ctx.fiber?.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        return json({ ok: false, error: 'configuration cannot be saved in this profile' })
      }
      // With templates on, the page still sends full modes; what lands on disk is
      // the diff. Storing the full list was what froze every shipped mode at the
      // first save and made later package updates unreachable.
      const split = layer.enabled ? splitModeConfig(next) : null
      if (split !== null) {
        // Deleting a mode means "it was on screen and the operator removed it".
        // A template that was never in the current roster was simply never seen
        // by this page — a mode shipped after the page loaded must not be
        // recorded as deleted just because a stale draft omits it.
        const visible = new Set(modes.map((mode) => mode?.id))
        split.removedTemplates = split.removedTemplates.filter((id) => visible.has(id))
      }
      try {
        await editor.edit(entry, (current) => (split === null
          ? { ...current, modes: next }
          : {
            ...current,
            templates: 'builtin',
            modes: split.modes,
            overrides: split.overrides,
            removedTemplates: split.removedTemplates,
          }))
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (split !== null) {
        layer.overrides = split.overrides
        layer.removed = split.removedTemplates
        // The fields just written are the operator's current answer for those
        // fields, so a conflict is acknowledged by saving.
        layer.conflicts = {}
      }

      await refreshPolicies(next)
      // Keep roster and subsequent imports consistent with the configuration just saved.
      modes.splice(0, modes.length, ...next)

      // Persisted config alone only reaches *new* tasks: a running session keeps
      // the preset it bound at creation. Tool rows are the exception — the tool
      // set is resolved on every step — so a changed tool selection is applied
      // to the live sessions of that mode right here.
      const hot = []
      for (const mode of next) {
        if (typeof mode?.id !== 'string') continue
        const from = currentTools.get(mode.id) ?? resolveTools(mode)
        const to = resolveTools(mode)
        // Remember the new selection so the next save in this process diffs
        // against it rather than against the snapshot taken at load.
        currentTools.set(mode.id, to)
        if (from.length === to.length && from.every((id, i) => id === to[i])) continue
        // eslint-disable-next-line no-await-in-loop -- one mode at a time keeps the report readable
        const report = await hotApplyTools(ctx, mode.id, from, to, mode.config)
        if (report !== null) hot.push(report)
      }

      return json({ ok: true, value: { restartRequired: true, hot } })
    }, 'agent-modes: save route')

    /**
     * Move a legacy profile onto template layering, or drop one mode's overrides.
     *
     * `enable` is the migration the update story depends on: the current mode
     * list becomes diffs against the shipped templates, so the next package
     * update reaches every field the operator never changed. `reset` throws one
     * mode's overrides away and takes the template as it stands now.
     *
     * Both write the profile config and rebuild the in-process list, because the
     * new-task preset list is built from memory, not re-read from disk.
     */
    route('/api/agent-modes/template', async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, error: 'body is not JSON' })
      }
      const entry = ctx.fiber?.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        return json({ ok: false, error: 'configuration cannot be saved in this profile' })
      }
      const action = body?.action
      const fail = (error) => json({ ok: false, error })

      if (action === 'enable') {
        if (layer.enabled) return json({ ok: true, value: { enabled: true, alreadyEnabled: true } })
        const checked = validateModes(modes)
        if (checked.error) return fail(checked.error)
        const split = splitModeConfig(checked.value)
        // A legacy snapshot says nothing about templates it never contained. The
        // mode shipped after this profile was installed is exactly the one that
        // must appear here, so migration records no removals at all.
        split.removedTemplates = []
        try {
          await editor.edit(entry, (current) => ({ ...current, ...split }))
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
        const resolved = resolveModeConfig(split, available)
        layer.enabled = true
        layer.legacy = false
        layer.overrides = split.overrides
        layer.removed = split.removedTemplates
        layer.conflicts = {}
        modes.splice(0, modes.length, ...resolved.modes)
        await refreshPolicies(modes)
        return json({ ok: true, value: {
          enabled: true,
          overridden: Object.keys(split.overrides),
          removed: split.removedTemplates,
          modes: resolved.modes.map((mode) => ({ id: mode.id, name: mode.name })),
        } })
      }

      if (action === 'reset') {
        const id = typeof body?.mode === 'string' ? body.mode : ''
        const template = templateById(id)
        if (!layer.enabled) return fail('built-in templates are not enabled in this profile')
        if (template === undefined) return fail(`not a built-in mode: ${id}`)
        const overrides = { ...(layer.overrides ?? {}) }
        delete overrides[id]
        const removed = (layer.removed ?? []).filter((value) => value !== id)
        try {
          await editor.edit(entry, (current) => ({
            ...current,
            templates: 'builtin',
            overrides,
            removedTemplates: removed,
          }))
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
        layer.overrides = overrides
        layer.removed = removed
        if (layer.conflicts !== undefined) delete layer.conflicts[id]
        const fresh = applyPatch(template, {})
        const index = modes.findIndex((mode) => mode.id === id)
        if (index >= 0) modes[index] = fresh
        else modes.push(fresh)
        await refreshPolicies(modes)
        return json({ ok: true, value: { mode: fresh, restartRequired: true } })
      }

      return fail('unknown template action')
    }, 'agent-modes: template route')

    /**
     * Make one configured mode the default for sessions created later.
     *
     * The default is not a preset property: the registry resolves
     * `selectedDefault ?? default` at session creation, so writing that field is
     * the only way a *new* task starts on the chosen mode. The field is
     * `volatile`, and only the settings service merges the volatile layer
     * correctly, so the write goes through `settings.update` rather than a raw
     * `configEditor.edit` of the registry entry.
     */
    route('/api/agent-modes/default', async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, error: 'body is not JSON' })
      }
      const id = typeof body?.mode === 'string' ? body.mode.trim() : ''
      if (id === '') return json({ ok: false, error: 'mode is required' })
      if (!modes.some((mode) => mode?.id === id)) {
        return json({ ok: false, error: `unknown mode: ${id}` })
      }
      const settings = ctx.get('settings')
      if (settings === undefined || typeof settings.update !== 'function') {
        return json({ ok: false, error: 'this host exposes no settings service' })
      }
      try {
        await settings.update(PRESET_REGISTRY_NS, { selectedDefault: id })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return json({ ok: true, value: { defaultMode: id } })
    }, 'agent-modes: default route')

    /**
     * Session statistics for one mode.
     *
     * The preset a session runs on is not a cheap index: a session starts on
     * its header's preset but `agent-preset/selected` events can re-bind it, so
     * each candidate log is folded and filtered afterwards. The newest `limit`
     * sessions are scanned and the folds are cached, which keeps a repeated
     * open of the tab cheap without making the first one read the whole corpus.
     */
    route('/api/agent-modes/stats', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const modeId = typeof body?.mode === 'string' ? body.mode : ''
      if (modeId === '') return json({ ok: false, error: 'mode is required' })
      const requested = Number(body?.limit)
      const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, Math.trunc(requested))) : 40

      const query = ctx.get('sessionQuery')
      if (query === undefined || typeof query.listSessions !== 'function') {
        return json({ ok: false, error: 'this host exposes no session history service' })
      }

      let records
      try {
        records = await query.listSessions()
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const candidates = (Array.isArray(records) ? records : [])
        .filter((record) => record?.header?.origin !== 'subagent')
        .slice(0, limit)

      const sessions = []
      let skipped = 0
      for (const record of candidates) {
        // eslint-disable-next-line no-await-in-loop -- one durable log at a time keeps memory flat
        const summary = await readSessionSummary(query, record, statsCache)
        if (summary === null) {
          skipped += 1
          continue
        }
        if (summary.preset !== modeId) continue
        sessions.push(summary)
      }

      return json({
        ok: true,
        value: {
          mode: modeId,
          sessions,
          totals: aggregateSessions(sessions),
          scanned: candidates.length,
          skipped,
        },
      })
    }, 'agent-modes: stats route')

    /**
     * Installed skills, for the mode page's read-only Skills pane.
     *
     * Skills are discovered per workspace, not per mode: the host's registry
     * scans project and user roots, and this route only reports what it found.
     * A mode cannot mount its own skill directory, so the pane says so instead
     * of implying a per-mode switch that does not exist.
     */
    route('/api/agent-modes/skills', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const cwd = typeof body?.cwd === 'string' && body.cwd !== '' ? body.cwd : undefined

      const skills = ctx.get('skills')
      if (skills === undefined || typeof skills.snapshot !== 'function') {
        return json({ ok: false, error: 'this host exposes no skill registry' })
      }

      let snapshot
      try {
        snapshot = await skills.snapshot(cwd === undefined ? {} : { cwd })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }

      const profileDir = ctx.get('profileContext')?.dir
      const items = (Array.isArray(snapshot?.skills) ? snapshot.skills : []).map((skill) => {
        const pkg = skillPackage(skill.path, profileDir)
        return {
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          modelInvocable: skill.invocation?.modelInvocable !== false,
          userInvocable: skill.invocation?.userInvocable !== false,
          ...(skill.provider === undefined ? {} : { provider: skill.provider }),
          ...(skill.path === undefined ? {} : { path: skill.path }),
          // The package that ships this skill, when it lives inside one. "bundled"
          // alone cannot tell a DSH built-in from a plugin the mode mounts.
          ...(pkg === undefined ? {} : { package: pkg }),
          // Which root the skill came from. The pane groups by category, but an
          // operator still needs to know whether a row is theirs to edit: a
          // bundled skill is read-only, and only the user root is writable.
          origin: skillSource(skill),
          // Every skill can be switched: turning a bundled one off writes a
          // shadowing copy under the user root, which outranks the package. True
          // whenever the registry returned a body to copy.
          switchable: typeof skill.path === 'string',
          // Whether this row is already shadowed by a copy in the user root, so the
          // page can say "yours" instead of "bundled" after the first switch.
          shadowed: isUserSkillPath(skill.path),
        }
      })

      // The category store is this plugin's own state; a broken file degrades to
      // the shipped buckets rather than hiding the catalog.
      const store = await readStore(storePath())
      const filed = assignCategories(items, store)

      return json({
        ok: true,
        value: {
          skills: filed,
          categories: store.categories,
          complete: snapshot?.complete !== false,
          storeBroken: store.broken === true,
        },
      })
    }, 'agent-modes: skills route')

    /**
     * Switch one user skill on or off.
     *
     * The switch is the frontmatter field the provider actually reads,
     * `disable-model-invocation`. Off means "the model stops seeing it in the
     * catalog"; the operator can still invoke it by hand, which is what the
     * host's own policy already means by that field — this route invents no
     * second meaning.
     *
     * Any skill can be switched, not only one already under the user root.
     *
     * The host ranks roots by precedence (`user-dsh` 400 beats `bundled` 600), so
     * writing a copy into `~/.dsh/skills/<name>/` shadows the original without
     * touching a package or a repository. That is the only honest way to switch a
     * bundled skill: its own file belongs to the package that ships it and would
     * be restored on the next upgrade.
     *
     * The file is rewritten through the shared renderer, so the body survives
     * byte for byte and only the one frontmatter line changes.
     */
    route('/api/agent-modes/skill-toggle', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        return json({ ok: false, error: 'name must be kebab-case' })
      }
      if (typeof body?.enabled !== 'boolean') {
        return json({ ok: false, error: 'enabled must be a boolean' })
      }

      const file = join(skillsRoot(), name, 'SKILL.md')
      let current
      let shadowed = false
      try {
        current = await readFile(file, 'utf8')
      } catch (error) {
        // Not in the user root yet. If the registry knows the name, take its body
        // and write a shadowing copy; otherwise the name is simply unknown.
        const skills = ctx.get('skills')
        let known
        try {
          known = await skills?.get?.(name, {})
        } catch {
          known = undefined
        }
        if (known === undefined) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        if (typeof known.content !== 'string' || known.content.trim() === '') {
          return json({ ok: false, error: `"${name}" has no body to copy` })
        }
        const copy = renderSkillFile({
          name,
          description: known.description ?? '',
          whenToUse: known.whenToUse ?? '',
          content: known.content,
          // The copy starts in the requested state, so one click both shadows the
          // original and applies the switch.
          enabled: body.enabled,
        })
        try {
          await mkdir(join(skillsRoot(), name), { recursive: true })
          await writeFile(file, copy, 'utf8')
        } catch (writeError) {
          return json({
            ok: false,
            error: writeError instanceof Error ? writeError.message : String(writeError),
          })
        }
        return json({
          ok: true,
          value: {
            name, enabled: body.enabled, changed: true, shadowed: true,
            origin: skillSource(known),
          },
        })
      }

      const parsed = parseSkillFile(current)
      if (parsed === null) {
        return json({ ok: false, error: 'this SKILL.md has no frontmatter to edit' })
      }
      if (parsed.enabled === body.enabled) {
        // Already in the requested state: rewriting would only churn the file.
        return json({ ok: true, value: { name, enabled: body.enabled, changed: false, shadowed } })
      }

      const next = renderSkillFile({
        name,
        description: parsed.description,
        whenToUse: parsed.whenToUse,
        content: parsed.content,
        enabled: body.enabled,
      })
      try {
        await writeFile(file, next, 'utf8')
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }

      return json({ ok: true, value: { name, enabled: body.enabled, changed: true, shadowed } })
    }, 'agent-modes: skill-toggle route')

    /**
     * One skill's full SKILL.md body.
     *
     * A skill is a whole instruction set -- often hundreds of lines -- so the
     * pane must be able to show it verbatim rather than a summary. Loaded on
     * demand because fetching every body up front would read the entire skill
     * tree to render a list.
     */
    route('/api/agent-modes/skill', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const name = typeof body?.name === 'string' ? body.name : ''
      if (name === '') return json({ ok: false, error: 'name is required' })
      const cwd = typeof body?.cwd === 'string' && body.cwd !== '' ? body.cwd : undefined

      const skills = ctx.get('skills')
      if (skills === undefined || typeof skills.get !== 'function') {
        return json({ ok: false, error: 'this host exposes no skill registry' })
      }

      let skill
      try {
        skill = await skills.get(name, cwd === undefined ? {} : { cwd })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      if (skill === undefined) return json({ ok: false, error: `no skill named "${name}"` })

      return json({
        ok: true,
        value: {
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          ...(skill.provider === undefined ? {} : { provider: skill.provider }),
          ...(skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase }),
          content: typeof skill.content === 'string' ? skill.content : '',
        },
      })
    }, 'agent-modes: skill route')

    /**
     * Create or overwrite one user skill at `~/.dsh/skills/<name>/SKILL.md`.
     *
     * The user root is the only place this plugin writes: project roots belong
     * to a repository, and bundled skills belong to their package. The name is
     * validated against the same kebab-case grammar the loader enforces, so a
     * write that the registry would silently ignore is rejected here instead.
     */
    route('/api/agent-modes/skill-save', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const description = typeof body?.description === 'string' ? body.description.trim() : ''
      const content = typeof body?.content === 'string' ? body.content : ''
      const whenToUse = typeof body?.whenToUse === 'string' ? body.whenToUse.trim() : ''
      const category = typeof body?.category === 'string' ? body.category.trim() : ''

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        return json({ ok: false, error: 'name must be kebab-case: lowercase letters, digits and hyphens' })
      }
      if (description === '') return json({ ok: false, error: 'description is required' })
      if (content.trim() === '') return json({ ok: false, error: 'content is required' })

      // Frontmatter is assembled by the shared writer, so the file the loader
      // parses and the file this route wrote cannot drift -- including the
      // quoting of a description that happens to contain a colon.
      const file = join(skillsRoot(), name, 'SKILL.md')
      try {
        await mkdir(join(skillsRoot(), name), { recursive: true })
        await writeFile(file, renderSkillFile({ name, description, whenToUse, content }), 'utf8')
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }

      // A category sent with the write is stored in the same round trip, so
      // filing a skill does not need a second request that can fail alone.
      let filed = false
      if (isCategoryId(category)) {
        try {
          const path = storePath()
          const store = await readStore(path)
          await writeStore(path, {
            categories: store.categories,
            assignments: { ...store.assignments, [name]: category },
          })
          filed = true
        } catch {
          filed = false
        }
      }

      return json({ ok: true, value: { name, path: file, filed } })
    }, 'agent-modes: skill-save route')

    /**
     * File one skill into a category, or edit the category list itself.
     *
     * One route for both because they touch one file and one lock-free
     * read-modify-write: splitting them would let a rename and an assignment
     * interleave and lose the other's edit.
     */
    route('/api/agent-modes/skill-category', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const path = storePath()
      const store = await readStore(path)
      const action = typeof body?.action === 'string' ? body.action : ''

      // The common case: file one skill. An empty category unfiles it, which
      // puts the row back under the auto-derived bucket.
      if (action === '' || action === 'assign') {
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (name === '') return json({ ok: false, error: 'name is required' })
        const category = typeof body?.category === 'string' ? body.category.trim() : ''
        if (category !== '' && !store.categories.some((c) => c.id === category)) {
          return json({ ok: false, error: `no category named "${category}"` })
        }
        const assignments = { ...store.assignments }
        if (category === '') delete assignments[name]
        else assignments[name] = category
        try {
          const clean = await writeStore(path, { categories: store.categories, assignments })
          return json({ ok: true, value: { categories: clean.categories, assignments: clean.assignments } })
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }

      try {
        const clean = await writeStore(path, editCategory(store, action, body))
        return json({ ok: true, value: { categories: clean.categories, assignments: clean.assignments } })
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }, 'agent-modes: skill-category route')

    /**
     * Export skills as one portable pack.
     *
     * Bodies are read from the registry rather than from disk so a bundled or
     * project skill exports as faithfully as a user one. Only `user` skills can
     * be re-imported over themselves, but exporting a bundled skill is the
     * point: that is how it moves to another machine.
     */
    route('/api/agent-modes/skill-pack-export', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const wanted = Array.isArray(body?.names)
        ? body.names.filter((name) => typeof name === 'string' && name !== '')
        : []
      if (wanted.length === 0) return json({ ok: false, error: 'pick at least one skill to export' })

      const skills = ctx.get('skills')
      if (skills === undefined || typeof skills.get !== 'function') {
        return json({ ok: false, error: 'this host exposes no skill registry' })
      }

      const store = await readStore(storePath())
      const rows = []
      const missing = []
      for (const name of wanted) {
        let skill
        try {
          // eslint-disable-next-line no-await-in-loop -- one body at a time keeps memory flat
          skill = await skills.get(name, {})
        } catch {
          skill = undefined
        }
        if (skill === undefined) {
          missing.push(name)
          continue
        }
        rows.push({
          name: skill.name,
          description: skill.description,
          whenToUse: skill.whenToUse,
          content: typeof skill.content === 'string' ? skill.content : '',
          // The *effective* bucket, not only the hand-filed one: a recipient
          // should see the same grouping the sender saw, including the derived
          // ones. A derived id that the recipient's store does not have is
          // dropped on import, so nothing points at a category that is missing.
          category: store.assignments[skill.name]
            ?? (skillCategory(skill, store) ?? ''),
        })
      }
      if (rows.length === 0) {
        return json({ ok: false, error: `no skill named ${missing.join(', ')}` })
      }

      const pack = buildPack(rows, {
        title: typeof body?.title === 'string' ? body.title : '',
      })
      return json({
        ok: true,
        value: { pack, file: `${pack.title.replace(/[^\w.-]+/g, '-') || 'skills'}-skill-pack.json`, missing },
      })
    }, 'agent-modes: skill-pack-export route')

    /**
     * Import one pack into the user skill root.
     *
     * Each skill is written with the same renderer `/skill-save` uses, so an
     * imported file is byte-identical to one typed on this machine. A skill that
     * already exists is overwritten only when the caller asked to overwrite;
     * otherwise it is reported as skipped, because silently replacing an
     * operator's own instructions is the one thing this route must not do.
     */
    route('/api/agent-modes/skill-pack-import', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, error: 'body is not JSON' })
      }
      const overwrite = body?.overwrite === true
      const { skills: incoming, errors } = parsePack(body?.pack)
      if (incoming.length === 0) {
        return json({ ok: false, error: errors.join('; ') || 'the pack carries no usable skill' })
      }

      const path = storePath()
      const store = await readStore(path)
      const assignments = { ...store.assignments }
      const written = []
      const skipped = []
      const failed = []

      for (const skill of incoming) {
        const dir = join(skillsRoot(), skill.name)
        // Windows is case-insensitive, so `Foo` and `foo` are the same skill.
        // The registry would see one of them; refusing here keeps this route
        // honest instead of writing a directory the loader silently drops.
        // eslint-disable-next-line no-await-in-loop -- one skill at a time keeps failures attributable
        const exists = await fileExists(join(dir, 'SKILL.md'))
        if (exists && !overwrite) {
          skipped.push(skill.name)
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop -- see above
          await mkdir(dir, { recursive: true })
          // eslint-disable-next-line no-await-in-loop -- see above
          await writeFile(join(dir, 'SKILL.md'), renderSkillFile(skill), 'utf8')
          written.push(skill.name)
          if (skill.category !== undefined && store.categories.some((c) => c.id === skill.category)) {
            assignments[skill.name] = skill.category
          }
        } catch (error) {
          failed.push({ name: skill.name, error: error instanceof Error ? error.message : String(error) })
        }
      }

      if (written.length > 0) {
        try {
          await writeStore(path, { categories: store.categories, assignments })
        } catch {
          /* the files are written; the category assignment is the lesser half */
        }
      }

      return json({
        ok: written.length > 0 || failed.length === 0,
        value: { written, skipped, failed, warnings: errors },
        ...(written.length === 0 && failed.length > 0 ? { error: 'every skill failed to write' } : {}),
      })
    }, 'agent-modes: skill-pack-import route')
    /**
     * 对话消耗展示 — one session's spend, durable across restarts.
     *
     * TWO SOURCES, AND THE REASON EACH IS NEEDED:
     *
     * - **Money** is folded out of the session log every time. The log carries
     *   the exact token split per message (`inputTokens` excludes cache reads,
     *   `cacheReadTokens` is the cached prefix) plus the model and instant, so a
     *   CNY figure needs no stored state at all. That is why it survives a
     *   restart without a ledger.
     * - **Credits** cannot be derived: only the upstream knows what it charged,
     *   and it says so once, on the last frame. The connector already reads that
     *   number but keeps it in a `Map` in ITS process, so a restart blanks it —
     *   the bug this route exists to fix. Here every read also commits whatever
     *   the connector currently reports into this plugin's own JSON ledger, so a
     *   later restart loses nothing.
     *
     * The connector is consulted only when it is mounted and only for the same
     * loopback host (`127.0.0.1`), and a failure there is reported as
     * `connector: 'unavailable'` rather than as "you spent nothing".
     */
    route('/api/agent-modes/spend', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
      if (sessionId === '') return json({ ok: false, error: 'sessionId is required' })

      // The extension switch is enforced HERE rather than in the client, so
      // turning it off stops the work as well as the pixels: no ledger write, no
      // connector read, no log fold. The client renders nothing for `disabled`.
      if (!isEnabled((await readState(statePath())).state, 'conversation-spend')) {
        return json({ ok: true, value: { sessionId, disabled: true } })
      }

      const path = ledgerPath()
      const { ledger, broken } = await readLedger(path)
      let nextLedger = ledger
      let ledgerDirty = false

      // The connector's own reading, when its process is reachable. Free: the
      // route it exposes is local and reads memory, never the upstream.
      let connector = lookupConnector(ctx.get('webServer'))
      if (connector !== null) {
        try {
          const response = await fetch(`${connector.base}${connector.path}?sessionId=${encodeURIComponent(sessionId)}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          })
          if (!response.ok) {
            connector = { ...connector, status: `HTTP ${response.status}` }
          } else {
            const value = await response.json()
            const spent = value?.spent
            if (typeof spent?.requests === 'number' && spent.requests > 0) {
              const merged = mergeObservation(nextLedger, sessionId, {
                requests: spent.requests,
                credit: spent.credit,
              }, Date.now())
              nextLedger = merged.ledger
              if (merged.changed) ledgerDirty = true
            }
            connector = { ...connector, status: 'ok' }
          }
        } catch (error) {
          connector = { ...connector, status: error instanceof Error ? error.message : String(error) }
        }
      }

      if (ledgerDirty) {
        try {
          await writeLedger(path, nextLedger)
        } catch {
          /* the figure is still correct for this answer; the file retries next poll */
        }
      }

      // Tokens and money come from the log, not from anything stored above.
      let fold = foldSpendEvents([])
      const query = ctx.get('sessionQuery')
      if (query !== undefined && typeof query.readSession === 'function') {
        try {
          fold = await foldSessionSpend(query, sessionId, spendFoldCache)
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }

      return json({
        ok: true,
        value: {
          sessionId,
          spend: spendOf({ fold, credit: creditOf(nextLedger, sessionId) }),
          priceVersion: PRICE_VERSION,
          ledger: { stored: creditOf(nextLedger, sessionId) !== undefined, broken },
          connector: connector === null ? { mounted: false } : { mounted: true, base: connector.base, status: connector.status },
        },
      })
    }, 'agent-modes: spend route')

    /**
     * 工具管理 → 扩展管理: the extension list and its switches.
     *
     * One route, two verbs' worth of work: an absent `toggle` reports, a present
     * one flips first and reports after — so a press is confirmed by the same
     * payload that draws the row, and the page never shows a switch state it has
     * not read back.
     */
    route('/api/agent-modes/extensions', async (request) => {
      let body = {}
      try {
        body = await request.json()
      } catch {
        body = {}
      }
      const path = statePath()
      const { state, broken } = await readState(path)

      if (typeof body?.toggle === 'string') {
        const result = toggleExtension(state, body.toggle, body.enabled)
        if (result.error !== undefined) return json({ ok: false, error: result.error })
        try {
          await writeState(path, result.state)
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }

      const current = typeof body?.toggle === 'string'
        ? (await readState(path)).state
        : state

      // What the shipped extension can actually show right now: the durable
      // ledger is the one piece of state a reader can verify without a session.
      const { ledger, exists: ledgerExists } = await readLedger(ledgerPath())
      const recent = recentSessions(ledger, 10)

      return json({
        ok: true,
        value: {
          extensions: extensionRows(current),
          stateBroken: broken,
          ledger: {
            path: ledgerPath(),
            exists: ledgerExists,
            sessions: recent,
            total: Object.keys(ledger.sessions).length,
          },
          priceVersion: PRICE_VERSION,
          connector: connectorSummary(ctx.get('webServer')),
        },
      })
    }, 'agent-modes: extensions route')
  })
}

/**
 * Where the WorkBuddy connector's local routes are, if its process is up.
 *
 * THE PORT COMES FROM THIS HOST'S OWN WEB SERVER, not from the connector's
 * heartbeat file: `dsh-connect-workbuddy`'s heartbeat records pid and start time
 * but NO port (verified by reading `writeHostHeartbeat` in the shipped bundle),
 * and its routes are registered on the SAME `webServer` service this plugin's
 * routes use. So the port is already in hand, and asking for it costs one
 * property read instead of a process-discovery guess.
 *
 * The connector's routes are still checked with a real request before anything
 * is presented as measured, so a host without that plugin reports "no credits"
 * rather than showing a number from nowhere.
 *
 * @param {object|undefined} webServer the mounted web server service.
 * @returns {{base: string, path: string}|null} null when no port is known yet.
 */
function lookupConnector(webServer) {
  const port = Number(webServer?.port)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  return { base: `http://127.0.0.1:${port}`, path: '/plugins/dsh-connect-workbuddy/session-credits' }
}

/** A one-line version of {@link lookupConnector} for the extension card. */
function connectorSummary(webServer) {
  const connector = lookupConnector(webServer)
  return connector === null ? { mounted: false } : { mounted: true, base: connector.base }
}

/**
 * Whether a path exists, without importing a second fs helper for one call.
 *
 * @param path absolute path.
 * @returns true when a directory entry is readable there.
 */
async function fileExists(path) {
  try {
    await readFile(path, 'utf8')
    return true
  } catch (error) {
    return error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR'
  }
}
