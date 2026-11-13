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
import { join } from 'node:path'

import {
  CATEGORIES,
  DEFAULT_TOOL_IDS,
  TOOLS,
  TOOL_BY_ID,
  isKnownToolId,
  toolLabel,
} from './catalog.js'
import { scanPluginTools } from './plugin-tools.js'
import { aggregateSessions, summarizeSession } from './stats.js'

/** Rows every mode mounts before its own tool selection. */
const BASE_ROWS = Object.freeze([
  { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
])

/**
 * Map one catalog entry to a fresh preset row, or undefined when unknown.
 *
 * Rows are cloned per call: a group row is shared by every preset that mounts
 * it, and the Loader treats a row as mutable material.
 */
export function toolRow(id) {
  const entry = TOOL_BY_ID[id]
  if (entry === undefined) return undefined
  if (typeof entry.row === 'object') return structuredClone(entry.row)
  const row = { id: entry.row, name: entry.pkg }
  if (entry.config !== undefined) row.config = { ...entry.config }
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
export function buildPlugins(mode) {
  const orderedIds = resolveTools(mode)
  const prefix =
    (typeof mode?.persona === 'string' && mode.persona.trim()) ||
    'You are a coding agent powered by the {{model}} model.'
  const suffix = preferenceSuffix(mode, orderedIds)

  const plugins = [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: suffix === '' ? { prefix } : { prefix, suffix },
    },
    ...BASE_ROWS.map((row) => structuredClone(row)),
  ]

  const mountedRows = new Set()
  for (const id of orderedIds) {
    const row = toolRow(id)
    if (row === undefined) continue
    // A repeated row id would mount the same entry twice and fail activation.
    if (mountedRows.has(row.id)) continue
    mountedRows.add(row.id)
    plugins.push(row)
  }

  // Operator-added packages, after the catalog rows so the priority list keeps
  // meaning. A package already mounted by a catalog row is not mounted twice.
  const mountedNames = new Set(plugins.map((row) => row.name))
  const seenExtra = new Set()
  const extras = Array.isArray(mode?.plugins) ? mode.plugins : []
  for (const value of extras) {
    if (typeof value !== 'string' || value.trim() === '') continue
    const name = value.trim()
    if (mountedNames.has(name) || seenExtra.has(name)) continue
    seenExtra.add(name)
    plugins.push({ id: pluginRowId(name), name })
  }

  return plugins
}

/** Build one preset definition from a stored mode. */
export function buildDefinition(mode, index) {
  return {
    id: mode.id,
    name: typeof mode.name === 'string' && mode.name ? mode.name : mode.id,
    ...(typeof mode.description === 'string' && mode.description
      ? { description: mode.description }
      : {}),
    order: typeof mode.order === 'number' ? mode.order : 50 + index,
    plugins: buildPlugins(mode),
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

/** Rows that are never hot-applied: compaction is preset-plane and locked. */
const HOT_EXCLUDED = new Set(['compaction'])

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
 * @returns a report the settings page can show verbatim, or null when the
 *   change is not one hot apply can express.
 */
async function hotApplyTools(ctx, presetId, before, after) {
  const { added, removed } = diffTools(before, after)
  if (added.length === 0 && removed.length === 0) return null

  let live = []
  try {
    live = ctx.agents?.list?.() ?? []
  } catch {
    live = []
  }

  const skipped = []
  const announced = []
  let touched = 0
  for (const agent of live) {
    const bound = ctx.agentPresets?.composedPreset?.(agent.ctx)
    if (bound !== presetId) continue
    let changed = false
    try {
      // eslint-disable-next-line no-await-in-loop -- one session at a time keeps diagnostics attributable
      await applyRowsToAgent(agent, added, removed)
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
 */
async function applyRowsToAgent(agent, added, removed) {
  const loader = agent.ctx?.loader
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
    const row = toolRow(toolId)
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

export async function apply(root, rawConfig) {
  const modes = Array.isArray(rawConfig?.modes) ? rawConfig.modes : []
  const unregisters = []

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
          .then(() => registry.register(buildDefinition(mode, index)))
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

    /** Fold cache shared by every stats request in this host process. */
    const statsCache = new Map()

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

    route('/api/agent-modes/roster', async () => {
      const profile = ctx.get('profileContext')
      const activeNames = activeModuleNames(ctx.get('loader'))
      const plugins = await discoverPlugins(profile?.dir, activeNames, new Set(SELF_PACKAGE_NAMES))
      return json({
        ok: true,
        value: {
          configured: modes,
          live: await liveRoster(),
          catalog: TOOLS.map((entry) => ({
            id: entry.id,
            category: entry.category,
            zh: entry.zh,
            en: entry.en,
            descZh: entry.descZh,
            descEn: entry.descEn,
            tools: entry.tools,
            defaultOn: entry.defaultOn === true,
            locked: entry.locked === true,
            hostOnly: entry.hostOnly === true,
            risky: entry.risky === true,
            exclusiveWith: entry.exclusiveWith ?? [],
          })),
          categories: CATEGORIES,
          plugins,
          defaults: DEFAULT_TOOL_IDS,
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
      const next = Array.isArray(body?.modes) ? body.modes : null
      if (next === null) return json({ ok: false, error: 'modes must be an array' })

      const seen = new Set()
      for (const mode of next) {
        if (typeof mode?.id !== 'string' || mode.id.trim() === '') {
          return json({ ok: false, error: 'every mode needs a non-empty id' })
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(mode.id)) {
          return json({
            ok: false,
            error: `mode id "${mode.id}" must be lowercase letters, digits, and dashes`,
          })
        }
        if (seen.has(mode.id)) {
          return json({ ok: false, error: `duplicate mode id: ${mode.id}` })
        }
        seen.add(mode.id)

        const tools = Array.isArray(mode.tools) ? mode.tools : []
        const seenTool = new Set()
        for (const id of tools) {
          const tool = TOOL_BY_ID[id]
          if (tool === undefined) {
            return json({
              ok: false,
              error: `mode "${mode.id}" lists unknown tool id: ${String(id)}`,
            })
          }
          if (seenTool.has(id)) {
            return json({ ok: false, error: `mode "${mode.id}" lists ${id} twice` })
          }
          seenTool.add(id)
          if (tool.hostOnly === true) {
            return json({
              ok: false,
              error: `「${toolLabel(tool, 'zh')}」只能在宿主平面运行，不能放进模式`,
            })
          }
        }
        for (const id of tools) {
          const clash = (TOOL_BY_ID[id]?.exclusiveWith ?? []).find((other) => tools.includes(other))
          if (clash !== undefined) {
            const a = toolLabel(TOOL_BY_ID[id], 'zh')
            const b = toolLabel(TOOL_BY_ID[clash], 'zh')
            return json({
              ok: false,
              error: `「${a}」与「${b}」注册同一个工具名，只能二选一`,
            })
          }
        }
      }

      const entry = ctx.fiber?.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        return json({ ok: false, error: 'configuration cannot be saved in this profile' })
      }
      try {
        await editor.edit(entry, (current) => ({ ...current, modes: next }))
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }

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
        const report = await hotApplyTools(ctx, mode.id, from, to)
        if (report !== null) hot.push(report)
      }

      return json({ ok: true, value: { restartRequired: true, hot } })
    }, 'agent-modes: save route')

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
  })
}
