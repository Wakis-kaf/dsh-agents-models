// Preset construction checks: catalog integrity, the registry's own row
// validator, and the host half driven through a fake Cordis context.
//
// Run with: node --test test/   (or: node test/presets.test.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORIES,
  DEFAULT_TOOL_IDS,
  TOOLS,
  TOOL_BY_ID,
} from '../catalog.js'
import {
  apply,
  buildDefinition,
  buildPlugins,
  resolveTools,
  toolRow,
} from '../index.js'

/**
 * Copied verbatim from @deepseek-ai/dsh-agent-preset-registry: the exact check
 * the registry runs before mounting a declaration. A row it rejects makes the
 * preset "broken" and unusable for a new task.
 */
function entryListProblem(rows, at = '') {
  if (!Array.isArray(rows)) {
    return at === ''
      ? 'the composition must be a top-level list of plugin rows'
      : `group ${at} must hold a list of plugin rows`
  }
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return `${label} is not a plugin row (expected a map with a "name")`
    }
    const { name, group, config } = row
    if (typeof name !== 'string' || name === '') {
      return `${label} names no plugin (a "name" string is required)`
    }
    if (group === true) {
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Every row id a flattened composition would mount. */
function rowIds(rows, prefix = '') {
  const out = []
  for (const row of rows) {
    if (row.group === true) {
      out.push(...rowIds(row.config, `${prefix}${row.id}/`))
      continue
    }
    out.push(`${prefix}${row.id}`)
  }
  return out
}

test('catalog rows are internally consistent', () => {
  const seen = new Set()
  for (const tool of TOOLS) {
    assert.equal(seen.has(tool.id), false, `duplicate catalog id ${tool.id}`)
    seen.add(tool.id)
    assert.ok(
      CATEGORIES.some((category) => category.id === tool.category),
      `${tool.id} names an unknown category ${tool.category}`,
    )
    assert.ok(tool.zh.length > 0 && tool.en.length > 0, `${tool.id} lacks copy`)
    assert.ok(Array.isArray(tool.tools), `${tool.id} tools is not an array`)
    assert.ok(
      tool.pkg.startsWith('@deepseek-ai/') ||
        tool.pkg.startsWith('cordis:') ||
        tool.pkg.startsWith('dsh-agents-modes/'),
      `${tool.id} has an unusable package ${tool.pkg}`,
    )
  }
})

test('rows that register the same tool name declare mutual exclusion', () => {
  const owners = new Map()
  for (const tool of TOOLS) {
    if (tool.hostOnly === true) continue
    for (const name of tool.tools) {
      if (!owners.has(name)) owners.set(name, [])
      owners.get(name).push(tool)
    }
  }
  for (const [name, entries] of owners) {
    if (entries.length < 2) continue
    for (const entry of entries) {
      for (const rival of entries) {
        if (entry === rival) continue
        assert.ok(
          (entry.exclusiveWith ?? []).includes(rival.id),
          `${entry.id} must declare exclusion with ${rival.id} (both register ${name})`,
        )
      }
    }
  }
})

test('a default mode keeps the clean personless prompt', () => {
  const rows = buildPlugins({ id: 'flash', tools: [...DEFAULT_TOOL_IDS] })
  assert.equal(rows[0].id, 'persona')
  assert.equal(rows[0].config.suffix, undefined)
  assert.ok(rows.length > 3)
})

test('a pure mode mounts persona, instructions, time, and compaction only', () => {
  const rows = buildPlugins({ id: 'flash-pure', pure: true, tools: [] })
  const ids = rows.map((row) => row.id)
  for (const required of ['persona', 'agent-instructions', 'time-context', 'compaction']) {
    assert.ok(ids.includes(required), `pure mode lost ${required}`)
  }
  assert.deepEqual(
    ids.filter((id) => !['persona', 'agent-instructions', 'time-context', 'compaction'].includes(id)),
    [],
    'pure mode mounted a model-facing tool row',
  )
  // Compaction is not a tool: nothing here appears in the model's tool catalog.
  assert.deepEqual(rows.flatMap((row) => row.config?.tools ?? []), [])
})

test('a pure mode always keeps compaction', () => {
  assert.deepEqual(resolveTools({ pure: true }), ['compaction'])
  assert.deepEqual(resolveTools({ pure: true, tools: ['tool-fs'] }), ['tool-fs', 'compaction'])
  // An ordinary mode that stored an empty list stays empty.
  assert.deepEqual(resolveTools({ tools: [] }), [])
})

test('opt-in from pure mounts the chosen row and the locked one', () => {
  const ids = buildPlugins({ id: 'x', pure: true, tools: ['tool-fs-search'] }).map((row) => row.id)
  assert.deepEqual(ids, ['persona', 'agent-instructions', 'time-context', 'fs-search', 'compaction'])
})

test('stored order survives into the mounted rows', () => {
  const ids = buildPlugins({ id: 'x', tools: ['tool-fs-search', 'tool-fs', 'tool-pwsh'] })
    .map((row) => row.id)
  assert.ok(ids.indexOf('fs-search') < ids.indexOf('fs'), ids.join(','))
})

test('a reordered mode states the preference in the persona suffix', () => {
  const [persona] = buildPlugins({ id: 'x', tools: ['tool-fs-search', 'tool-fs', 'tool-pwsh'] })
  assert.equal(typeof persona.config.suffix, 'string')
  assert.match(persona.config.suffix, /glob/)
  assert.match(persona.config.suffix, /prefer the earliest/)
})

test('extra plugin packages mount once and get a sane row id', () => {
  const rows = buildPlugins({
    id: 'x',
    tools: ['tool-fs'],
    plugins: ['@opdsh/unity-plugin', '@opdsh/unity-plugin'],
  })
  const extras = rows.filter((row) => row.name === '@opdsh/unity-plugin')
  assert.equal(extras.length, 1)
  assert.match(extras[0].id, /^plugin-[a-z0-9-]+$/)
})

test('a package already mounted by a catalog row is not added twice', () => {
  const rows = buildPlugins({
    id: 'x',
    tools: ['tool-fs'],
    plugins: ['@deepseek-ai/dsh-tool-fs'],
  })
  assert.equal(rows.filter((row) => row.name === '@deepseek-ai/dsh-tool-fs').length, 1)
})

test('the WorkBuddy guard mounts as an infra row', () => {
  const rows = buildPlugins({ id: 'x', tools: ['workbuddy-guard'] })
  const guard = rows.find((row) => row.id === 'workbuddy-guard')
  assert.ok(guard, 'guard row missing')
  assert.equal(guard.name, 'dsh-agents-modes/guard')
  assert.equal(guard.config.provider, 'workbuddy')
  assert.equal(guard.config.maxJobWaitMs, 30_000)
  assert.equal(guard.config.denyRepeats, true)
  assert.equal(entryListProblem(rows), undefined)
})

test('the WorkBuddy Flash mode mounts its strict guard and lean tool set', () => {
  const tools = [
    'tool-fs',
    'tool-fs-search',
    'tool-pwsh',
    'workbuddy-guard-strict',
    'tool-jobs',
    'tool-ask-user',
    'compaction',
  ]
  const rows = buildPlugins({ id: 'workbuddy-flash', tools })
  const ids = rows.map((row) => row.id)
  assert.ok(ids.includes('workbuddy-guard-strict'))
  assert.equal(ids.includes('web'), false)
  assert.equal(ids.includes('todo'), false)
  const guard = rows.find((row) => row.id === 'workbuddy-guard-strict')
  assert.equal(guard.name, 'dsh-agents-modes/guard')
  assert.equal(guard.config.maxToolSteps, 30)
  assert.equal(guard.config.denyRepeats, true)
  assert.equal(entryListProblem(rows), undefined)
})

test('group rows are cloned per preset, not shared', () => {
  const a = buildPlugins({ id: 'a', tools: ['compaction'] }).find((row) => row.id === 'compaction')
  const b = buildPlugins({ id: 'b', tools: ['compaction'] }).find((row) => row.id === 'compaction')
  assert.notEqual(a, b)
  assert.notEqual(a.config, b.config)
  assert.notEqual(a.config[0], b.config[0])
})

test('the skill row carries its own discovery', () => {
  const skills = buildPlugins({ id: 'x', tools: ['tool-skill'] }).find((row) => row.id === 'skills')
  assert.equal(skills?.group, true)
  assert.ok(skills.config.some((row) => row.name === '@deepseek-ai/dsh-skill-filesystem'))
})

test('unknown tool ids are dropped rather than mounted', () => {
  assert.equal(toolRow('tool-nope'), undefined)
  const rows = buildPlugins({ id: 'x', tools: ['tool-fs', 'tool-nope'] })
  assert.ok(rows.some((row) => row.id === 'fs'))
  assert.equal(rows.length, 4, rows.map((row) => row.id).join(','))
})

test('every mode shape passes the registry row validator', () => {
  const modes = [
    { id: 'flash', tools: [...DEFAULT_TOOL_IDS] },
    { id: 'flash-pure', pure: true, tools: [] },
    { id: 'everything', tools: TOOLS.filter((t) => t.hostOnly !== true).map((t) => t.id) },
    ...TOOLS.filter((t) => t.hostOnly !== true).map((t) => ({
      id: `only-${t.id.replace(/[^a-z0-9]+/g, '-')}`,
      pure: true,
      tools: [t.id],
    })),
  ]

  for (const mode of modes) {
    const plugins = buildPlugins(mode)
    assert.equal(entryListProblem(plugins), undefined, `${mode.id} is not a valid entry list`)

    const ids = rowIds(plugins)
    assert.deepEqual(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      [],
      `${mode.id} mounts a row id twice`,
    )
  }
})

test('definitions carry the fields the registry reads', () => {
  const definition = buildDefinition({ id: 'flash', name: 'Flash', description: 'x' }, 0)
  assert.equal(definition.id, 'flash')
  assert.equal(definition.name, 'Flash')
  assert.equal(typeof definition.order, 'number')
  assert.ok(Array.isArray(definition.plugins) && definition.plugins.length > 0)
})

// ── host half ───────────────────────────────────────────────────────────────

const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? ''

/**
 * Build a fake Cordis context that records every route and preset.
 *
 * `agents` and the per-agent Loader tree model what a save can reach at
 * runtime: live agents bound to a preset, each with a Loader that can mount and
 * remove hot tool rows.
 */
function harness(modes, options = {}) {
  const registeredPresets = []
  const routes = new Map()
  const effects = []
  const warnings = []
  const writes = []
  const hotMounts = []

  const agentPresets = {
    register: (definition) => {
      registeredPresets.push(definition)
      return async () => {}
    },
    list: async () => registeredPresets.map((d) => ({ id: d.id, name: d.name })),
    composedPreset: (agentCtx) => agentCtx?.boundPreset,
  }
  const connection = {
    fetch: {
      register: (spec) => {
        routes.set(spec.path, spec.fetch)
        return () => {}
      },
    },
  }
  const configEditor = { edit: async (_entry, fn) => { writes.push(fn({ modes })) } }
  const loader = {
    entries: () => [
      { options: { name: '@deepseek-ai/dsh-tool-fs' } },
      { options: { name: 'dsh-ops' } },
      { options: { name: 'cordis:group', group: true } },
    ],
  }

  /** One live agent with its own Loader tree, recording what it mounts. */
  const makeAgent = (id, boundPreset) => {
    const entries = new Map()
    const tree = {
      create: async (row) => {
        if (entries.has(row.id)) throw new Error(`duplicate ${row.id}`)
        entries.set(row.id, row)
        hotMounts.push({ agent: id, mounted: row.id, name: row.name })
        return { id: row.id }
      },
      remove: (rowId) => {
        if (!entries.has(rowId)) throw new Error(`cannot resolve entry ${rowId}`)
        entries.delete(rowId)
        hotMounts.push({ agent: id, removed: rowId })
      },
      resolve: (rowId) => {
        if (!entries.has(rowId)) throw new Error(`cannot resolve entry ${rowId}`)
        return entries.get(rowId)
      },
      mounted: () => [...entries.keys()],
    }
    // The session log is the only channel the model reads, so a hot apply has
    // to say so in band; record every append the way Session.append would.
    // Enforce the host's own contract: a surface event without `surfaceOp` is
    // rejected, exactly as the real session rejects it. A lenient fake would
    // hide the very failure this notice exists to avoid.
    const appended = []
    const session = {
      id,
      appended,
      append: (type, data, opts) => {
        const surface = ['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']
        if (surface.includes(type) && typeof opts?.surfaceOp !== 'string') {
          throw new Error(`session event "${type}" requires a surfaceOp`)
        }
        appended.push({ type, data, opts })
      },
    }
    return { id, ctx: { loader: tree, boundPreset }, session }
  }

  const agents = {
    list: () => agents.live,
    live: options.liveAgents ?? [],
  }

  const services = {
    agentPresets,
    connection,
    configEditor,
    loader,
    agents,
    ...(options.sessionQuery === undefined ? {} : { sessionQuery: options.sessionQuery }),
    ...(PROFILE_DIR === '' ? {} : { profileContext: { dir: PROFILE_DIR, name: 'test' } }),
  }
  const ctx = {
    ...services,
    get: (name) => services[name],
    inject: (_deps, run) => run(ctx),
    effect: (fn, label) => {
      effects.push(label)
      const dispose = fn()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    fiber: { entry: { id: 'agent-modes' } },
    logger: { warn: (message) => warnings.push(message) },
  }
  return { ctx, registeredPresets, routes, effects, warnings, writes, hotMounts, makeAgent, agents }
}


const MODES = [
  { id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'] },
  { id: 'flash-pure', name: 'Flash Pure', pure: true, tools: [], plugins: [] },
]

test('the host half registers one preset per mode', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(h.warnings, [])
  assert.equal(h.registeredPresets.length, 2)
  const pure = h.registeredPresets.find((d) => d.id === 'flash-pure')
  assert.deepEqual(
    pure.plugins.map((row) => row.id),
    ['persona', 'agent-instructions', 'time-context', 'compaction'],
  )
  assert.ok(h.effects.length >= 2)
})

test('the roster route reports modes, catalog, categories, and plugins', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })

  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(body.ok, true)
  assert.equal(body.value.configured.length, 2)
  assert.ok(body.value.catalog.length > 10)
  assert.ok(body.value.categories.length > 0)
  assert.ok(body.value.defaults.length > 0)

  for (const row of body.value.catalog) {
    assert.ok(typeof row.zh === 'string' && typeof row.en === 'string')
    assert.ok(Array.isArray(row.tools))
    assert.ok(Object.hasOwn(TOOL_BY_ID, row.id))
  }

  if (PROFILE_DIR !== '') {
    const plugins = body.value.plugins
    assert.ok(plugins.length > 0, 'no installed plugins discovered')
    assert.deepEqual(
      plugins.filter((p) => ['zod', 'js-yaml', 'semver', 'ws'].includes(p.name)),
      [],
      'a non-plugin dependency leaked into the inventory',
    )
    assert.deepEqual(
      plugins.filter((p) => p.name === 'dsh-agents-modes'),
      [],
      'the mode editor must not offer to mount itself inside a preset',
    )
    assert.ok(plugins.some((p) => p.name === '@opdsh/unity-plugin'))
    assert.ok(plugins.some((p) => p.enabled === true) && plugins.some((p) => p.enabled === false))
    assert.equal(plugins.find((p) => p.name === '@opdsh/unity-plugin').hasClient, true)
  }
})

test('the save route rejects payloads that would break a mount', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const save = h.routes.get('/api/agent-modes/save')
  const post = (body) => save({ json: async () => body }).then((r) => r.json())

  assert.equal((await save({ json: async () => { throw new Error('bad') } }).then((r) => r.json())).ok, false)
  assert.equal((await post({ modes: 'x' })).ok, false)
  assert.match((await post({ modes: [{ id: 'Has Space', tools: [] }] })).error, /lowercase/)
  assert.match((await post({ modes: [{ id: 'a', tools: [] }, { id: 'a', tools: [] }] })).error, /duplicate/)
  assert.match((await post({ modes: [{ id: 'a', tools: ['tool-nope'] }] })).error, /unknown/)
  assert.match((await post({ modes: [{ id: 'a', tools: ['tool-fs', 'tool-fs'] }] })).error, /twice/)
  assert.match((await post({ modes: [{ id: 'a', tools: ['tool-plugin-manager'] }] })).error, /宿主平面/)
  assert.match(
    (await post({ modes: [{ id: 'a', tools: ['tool-pwsh', 'tool-pwsh-persistent'] }] })).error,
    /二选一/,
  )
})

test('a valid roster is written through the config editor', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash-pure', name: 'Pure', pure: true, tools: ['tool-fs'], plugins: ['@opdsh/unity-plugin'] }],
    }),
  }).then((r) => r.json())

  assert.equal(body.ok, true)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].modes[0].pure, true)
  assert.equal(h.writes[0].modes[0].plugins[0], '@opdsh/unity-plugin')
})

// ── hot apply: a saved tool change reaches running sessions ─────────────────
//
// The registry refuses to re-select a preset once a session has produced a turn
// (`agent-preset/locked`), so a running session keeps its persona and plugin
// rows. Tool rows are different: `dsh-tools` resolves the visible set on every
// step, so mounting a row into the Agent's Loader makes it usable next turn.

test('saving a newly checked tool mounts it into the live session of that mode', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-1', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  }).then((r) => r.json())

  assert.equal(body.ok, true)
  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.ok(report, 'the save reports the hot apply')
  assert.equal(report.sessions, 1, 'the live session was reached')
  assert.deepEqual(report.added, ['tool-web'])
  assert.ok(agent.ctx.loader.mounted().includes('hot-tool-web'), 'the row is mounted in the session')
})

test('unchecking a tool releases it from the live session', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-2', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  // Mount it first, the way a previous save would have.
  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  })
  assert.ok(agent.ctx.loader.mounted().includes('hot-tool-web'))

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({ modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'] }] }),
  }).then((r) => r.json())

  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.deepEqual(report.removed, ['tool-web'])
  assert.equal(agent.ctx.loader.mounted().includes('hot-tool-web'), false, 'the row is released')
})

test('a session on another mode is left alone', async () => {
  const h = harness(MODES)
  const mine = h.makeAgent('session-3', 'flash')
  const other = h.makeAgent('session-4', 'flash-pure')
  h.agents.live = [mine, other]
  await apply(h.ctx, { modes: MODES })

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-web'] }],
    }),
  })

  assert.ok(mine.ctx.loader.mounted().includes('hot-tool-web'))
  assert.deepEqual(other.ctx.loader.mounted(), [], 'a session on the other mode is untouched')
})

test('a save with no live session reports that only new tasks pick it up', async () => {  const h = harness(MODES)
  h.agents.live = []
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({ modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-web'] }] }),
  }).then((r) => r.json())

  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.equal(report.sessions, 0)
  assert.deepEqual(report.added, ['tool-web'])
})

test('host-plane and locked rows are never hot-applied', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-5', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'compaction'] }],
    }),
  }).then((r) => r.json())

  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.equal(report, undefined, 'a locked-row-only change needs no hot apply')
  assert.deepEqual(agent.ctx.loader.mounted(), [])
})

test('a save that changes no tool is not hot-applied', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-6', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'] }],
    }),
  }).then((r) => r.json())

  assert.deepEqual(body.value.hot, [])
  assert.deepEqual(agent.ctx.loader.mounted(), [])
})

// ── statistics route ────────────────────────────────────────────────────────
//
// The preset a session ran on is not in the cheap listing: a session starts on
// its header preset and `agent-preset/selected` events can re-bind it, so the
// route folds each candidate log and filters afterwards.

const STAT_HEADERS = new Map([
  ['s-1', { version: 4, id: 's-1', createdAt: 1_000, isSeeded: false, cwd: 'D:\\x', agentPreset: 'cordis' }],
  ['s-2', { version: 4, id: 's-2', createdAt: 2_000, isSeeded: false, cwd: 'D:\\x', agentPreset: 'flash' }],
])

const STAT_EVENTS = new Map([
  ['s-1', [
    { type: 'agent-preset/selected', seq: 1, time: 1_010, data: { agentPreset: 'flash' } },
    { type: 'step/start', seq: 2, time: 1_100, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 3, time: 1_600, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } } },
    { type: 'tool/call', seq: 4, time: 1_700, data: { turn: 1, step: 1, callId: 'c1', name: 'pwsh' } },
    { type: 'tool/result', seq: 5, time: 2_200, data: { turn: 1, step: 1, message: { toolCallId: 'c1' } } },
    { type: 'step/end', seq: 6, time: 2_300, data: { turn: 1, step: 1 } },
  ]],
  ['s-2', [
    { type: 'agent-preset/selected', seq: 1, time: 2_010, data: { agentPreset: 'flash-pure' } },
    { type: 'step/end', seq: 2, time: 2_100, data: { turn: 1, step: 1 } },
  ]],
])

function statQuery() {
  return {
    listSessions: async () => [...STAT_HEADERS.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((header) => ({ header, live: false, persisted: true })),
    readSession: async (id) => ({ session: STAT_HEADERS.get(id), events: STAT_EVENTS.get(id) ?? [] }),
  }
}

test('the stats route folds the sessions of one mode and ranks its tools', async () => {
  const h = harness(MODES, { sessionQuery: statQuery() })
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/stats')({
    json: async () => ({ mode: 'flash' }),
  }).then((r) => r.json())

  assert.equal(body.ok, true)
  assert.equal(body.value.scanned, 2)
  assert.equal(body.value.sessions.length, 1, 'the pure-mode session is filtered out')
  assert.equal(body.value.sessions[0].id, 's-1')
  assert.equal(body.value.totals.toolMs, 500)
  assert.equal(body.value.totals.tools[0].name, 'pwsh')
  assert.equal(body.value.totals.tokens.input, 100)
})

test('the stats route refuses a call without a mode or without history', async () => {
  const withQuery = harness(MODES, { sessionQuery: statQuery() })
  await apply(withQuery.ctx, { modes: MODES })
  const rejected = await withQuery.routes.get('/api/agent-modes/stats')({
    json: async () => ({}),
  }).then((r) => r.json())
  assert.equal(rejected.ok, false)

  const noQuery = harness(MODES)
  await apply(noQuery.ctx, { modes: MODES })
  const missing = await noQuery.routes.get('/api/agent-modes/stats')({
    json: async () => ({ mode: 'flash' }),
  }).then((r) => r.json())
  assert.equal(missing.ok, false)
  assert.match(missing.error, /session history/)
})

// ── the in-band notice: a mounted row is not the same as a tool the model
// believes in ─────────────────────────────────────────────────────────────
//
// A conversation that already asked "can you fetch this URL?" and answered
// "no" keeps that answer even after the row appears in the next request: the
// model read its tool list once per step and nothing told it the list grew.
// The hot apply therefore records the change in the session log.

test('a hot apply tells the live session which tools appeared', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-notice', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  }).then((r) => r.json())

  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.deepEqual(report.announced, ['session-notice'], 'the save reports the notice')

  assert.equal(agent.session.appended.length, 1, 'exactly one notice is recorded')
  const notice = agent.session.appended[0]
  assert.equal(notice.type, 'user/message')
  assert.equal(notice.opts?.surfaceOp, 'append', 'a surface event without surfaceOp is rejected by the host')
  assert.equal(notice.data.source.kind, 'runtime-context')
  assert.equal(notice.data.source.form, 'notice')

  // The names the model must now believe in, taken from the catalog row.
  const text = notice.data.content.map((block) => block.text).join(' ')
  assert.match(text, /web_search/)
  assert.match(text, /web_fetch/)
  assert.match(text, /now available/)
  assert.match(text, /supersedes/, 'it must override the earlier "I cannot" answer')
})

test('a session on another mode gets no notice for a change it did not receive', async () => {
  const h = harness(MODES)
  const mine = h.makeAgent('session-mine', 'flash')
  const other = h.makeAgent('session-other', 'flash-pure')
  h.agents.live = [mine, other]
  await apply(h.ctx, { modes: MODES })

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  })

  assert.equal(mine.session.appended.length, 1)
  assert.deepEqual(other.session.appended, [], 'the untouched session is not told anything')
})

test('removing a tool is announced too, and an empty change says nothing', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-remove', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  // Mount first, exactly the way a previous save would have.
  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  })
  assert.equal(agent.session.appended.length, 1)

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({ modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'] }] }),
  })

  assert.equal(agent.session.appended.length, 2)
  const removal = agent.session.appended[1].data.content.map((block) => block.text).join(' ')
  assert.match(removal, /web_search/)
  assert.match(removal, /no longer available/)
})

test('a save that changes no tool records no notice', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-quiet', 'flash')
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'] }],
    }),
  })

  assert.deepEqual(agent.session.appended, [])
})

test('a session that cannot record the notice is reported, not silently claimed as notified', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('session-mute', 'flash')
  // A read-only or disposed session rejects the append. The mount still stands,
  // but the report must not claim the model was told.
  agent.session.append = () => { throw new Error('read-only session') }
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })

  const body = await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }],
    }),
  }).then((r) => r.json())

  const report = body.value.hot.find((r) => r.presetId === 'flash')
  assert.equal(report.sessions, 1, 'the row was still mounted')
  assert.deepEqual(report.announced, [], 'the host must not claim a notice it failed to write')
  assert.ok(agent.ctx.loader.mounted().includes('hot-tool-web'))
})

