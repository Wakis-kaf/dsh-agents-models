// Preset construction checks: catalog integrity, the registry's own row
// validator, and the host half driven through a fake Cordis context.
//
// Run with: node --test test/   (or: node test/presets.test.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root, for the checks that read a shipped file rather than a module. */
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')

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
import { BUILTIN_TEMPLATES } from '../builtin-modes.js'

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
  // The capability policy guard is mounted on every mode including pure, but it
  // registers no model-facing tool: it only denies calls the allowlist rejects.
  // That is why it is excluded here rather than treated as a capability.
  assert.deepEqual(
    ids.filter((id) => !['persona', 'agent-instructions', 'time-context', 'compaction', 'mode-capability-policy'].includes(id)),
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
  assert.deepEqual(ids, [
    'persona', 'agent-instructions', 'time-context', 'mode-capability-policy',
    'fs-search', 'compaction',
  ])
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
    'fs-observation-policy',
    'tool-fs',
    'tool-fs-search',
    'tool-pwsh-persistent',
    'workbuddy-guard-strict',
    'tool-jobs',
    'tool-ask-user',
    'tool-todo',
    'present',
    'compaction',
  ]
  const rows = buildPlugins({ id: 'workbuddy-flash', tools })
  const ids = rows.map((row) => row.id)
  assert.ok(ids.includes('workbuddy-guard-strict'))
  assert.ok(ids.includes('fs-observation-policy'))
  assert.ok(ids.includes('present'))
  assert.equal(ids.includes('web'), false)
  assert.equal(ids.includes('skills'), false)
  // The plan gate is unenforceable without a way to write the plan.
  assert.ok(ids.includes('todo'), 'the plan gate needs todo_write mounted')
  const policy = rows.find((row) => row.id === 'fs-observation-policy')
  assert.equal(policy.name, '@deepseek-ai/dsh-fs-observation-policy')
  const persistent = rows.find((row) => row.id === 'persistent-shell')
  assert.equal(persistent.group, true)
  assert.deepEqual(
    persistent.config.map((row) => row.id),
    ['pty', 'terminal-pwsh', 'persistent-pwsh'],
  )
  assert.equal(persistent.config[2].name, '@deepseek-ai/dsh-tool-pwsh-persistent')
  const guard = rows.find((row) => row.id === 'workbuddy-guard-strict')
  assert.equal(guard.name, 'dsh-agents-modes/guard')
  // Bounded, not tight: 30 bought one blind write, 60 bought nine honest cycles
  // and no room to finish. The speed lever is the persona's round cap, not this.
  assert.equal(guard.config.maxToolSteps, 120)
  assert.equal(guard.config.denyRepeats, true)
  assert.equal(guard.config.requireReadBeforePresent, true)
  assert.equal(guard.config.requireRenderBeforePresent, true)
  assert.equal(guard.config.requireMotionBeforePresent, true)
  assert.equal(guard.config.requirePlanBeforeWrite, true)
  assert.equal(entryListProblem(rows), undefined)
})

test('the shipped WorkBuddy Flash mode can satisfy its own plan gate', () => {
  // A plan gate without todo_write is a deadlock: every large write is denied
  // and there is no call that would clear the denial.
  // The shipped modes live in `builtin-modes.js` (the package-owned templates);
  // `cordis.patch.yml` only seeds `templates: builtin`.
  const mode = BUILTIN_TEMPLATES.find((template) => template.id === 'workbuddy-flash')
  assert.ok(mode.tools.includes('workbuddy-guard-strict'), 'the strict guard is mounted')
  assert.ok(mode.tools.includes('tool-todo'), 'todo_write is mounted alongside it')
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
  // persona + instructions + time + the always-on capability policy + fs
  assert.equal(rows.length, 5, rows.map((row) => row.id).join(','))
})

test('a mode can tune a parameter its row declares', () => {
  const rows = buildPlugins({
    id: 'x',
    tools: ['workbuddy-guard-strict'],
    config: { 'workbuddy-guard-strict': { maxToolSteps: 120 } },
  })
  const guard = rows.find((row) => row.id === 'workbuddy-guard-strict')
  assert.equal(guard.config.maxToolSteps, 120)
  assert.equal(guard.config.repeatLimit, 3, 'untouched fields keep the shipped value')
  assert.equal(entryListProblem(rows), undefined)
})

test('a mode cannot smuggle config its row does not declare', () => {
  const row = toolRow('workbuddy-guard-strict', {
    'workbuddy-guard-strict': { provider: 'deepseek-account', nope: 1, maxToolSteps: 90 },
  })
  assert.equal(row.config.provider, 'workbuddy', 'the provider scopes the guard and is not a knob')
  assert.equal(row.config.nope, undefined, 'an undeclared key never reaches the package')
  assert.equal(row.config.maxToolSteps, 90)

  // An override for a row the mode does not mount lands nowhere.
  const rows = buildPlugins({
    id: 'x',
    tools: ['tool-fs'],
    config: { 'workbuddy-guard-strict': { maxToolSteps: 90 } },
  })
  assert.equal(rows.some((entry) => entry.id === 'workbuddy-guard-strict'), false)
})

test('the Unity row mounts the bridge, not the 48-tool MCP client', () => {
  const rows = buildPlugins({ id: 'unity', tools: ['tool-unity'] })
  const row = rows.find((entry) => entry.id === 'unity-bridge')
  assert.ok(row, 'the unity bridge row is missing')
  assert.equal(row.name, 'dsh-agents-modes/unity')
  assert.equal(row.config.url, 'http://127.0.0.1:8080/mcp')
  assert.equal(entryListProblem(rows), undefined)
})

test('the shipped Unity mode mounts the bridge and keeps its tools lean', () => {
  const mode = BUILTIN_TEMPLATES.find((template) => template.id === 'unity')
  assert.ok(mode.tools.includes('tool-unity'), 'the bridge row is mounted')
  assert.match(mode.persona, /unity_verify/, 'the persona names the verification gate')
  // Mounting the MCP client directly would put 48 tools / 109 078 bytes on the
  // wire every step; the bridge exists to avoid that.
  assert.equal(/dsh-mcp-client/.test(JSON.stringify(mode)), false, 'the raw MCP client is mounted')
})

test('a string parameter is accepted as text and rejected when empty', () => {
  const row = toolRow('tool-unity', { 'tool-unity': { url: 'http://127.0.0.1:9090/mcp' } })
  assert.equal(row.config.url, 'http://127.0.0.1:9090/mcp')
  assert.equal(row.config.timeoutMs, 60_000, 'untouched fields keep the shipped value')
})

test('every tunable field has a value the page can show as its default', () => {
  for (const id of ['workbuddy-guard', 'workbuddy-guard-strict', 'tool-unity']) {
    const entry = TOOL_BY_ID[id]
    assert.ok(Array.isArray(entry.params) && entry.params.length > 0, `${id} exposes no schema`)
    for (const param of entry.params) {
      assert.ok(['number', 'bool', 'string'].includes(param.type), `${id}.${param.key} has no known type`)
      assert.ok(param.zh && param.en, `${id}.${param.key} is missing a label`)
      assert.ok(param.hintZh && param.hintEn, `${id}.${param.key} is missing a hint`)
      assert.notEqual(param.default, undefined, `${id}.${param.key} needs a default`)
    }
  }
  // The gates this release turns on are on in the strict row, not just in prose.
  const strict = TOOL_BY_ID['workbuddy-guard-strict'].config
  assert.equal(strict.requireRenderBeforePresent, true)
  assert.equal(strict.requireMotionBeforePresent, true)
  assert.equal(strict.requirePlanBeforeWrite, true)
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

  const updates = []

  const agentPresets = {
    register: (definition) => {
      registeredPresets.push(definition)
      return async () => {}
    },
    list: async () => registeredPresets.map((d) => ({ id: d.id, name: d.name })),
    composedPreset: (agentCtx) => agentCtx?.boundPreset,
    // The registry resolves `selectedDefault ?? default` at creation, so the
    // fake carries the same getter the default route reads.
    defaultId: 'flash',
  }
  // Only the volatile field the page writes matters here; record the patch so a
  // test can prove the route went through the settings service rather than
  // rewriting the registry row's static config.
  const settings = {
    update: async (ns, patch) => { updates.push({ ns, patch }) },
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
    settings,
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
  return { ctx, registeredPresets, routes, effects, warnings, writes, hotMounts, makeAgent, agents, updates }
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
    ['persona', 'agent-instructions', 'time-context', 'mode-capability-policy', 'compaction'],
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

test('the default route writes the registry volatile field, not the mode list', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const route = h.routes.get('/api/agent-modes/default')
  const post = (body) => route({ json: async () => body }).then((r) => r.json())

  const body = await post({ mode: 'flash-pure' })
  assert.equal(body.ok, true)
  assert.equal(body.value.defaultMode, 'flash-pure')
  assert.deepEqual(h.updates, [{ ns: 'agent-preset-registry', patch: { selectedDefault: 'flash-pure' } }])
  assert.equal(h.writes.length, 0, 'the mode list itself is untouched')

  assert.equal((await route({ json: async () => { throw new Error('bad') } }).then((r) => r.json())).ok, false)
  assert.equal((await post({})).ok, false)
  assert.match((await post({ mode: 'nope' })).error, /unknown mode/)
})

test('the roster route reports which mode a new task starts on', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(body.value.defaultMode, 'flash')
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

test('re-applying the plugin does not lock a running session out of its tools', async () => {
  // The regression that cost a session: `apply` used to mint a random scope UUID,
  // so a second apply (config save, HMR, restart) left every guard built by the
  // first one resolving to no policy — and the guard then denied every call.
  // Both applies must publish the same scope id, and that id must keep working.
  const first = harness(MODES)
  await apply(first.ctx, { modes: MODES })
  const firstRoster = await (await first.routes.get('/api/agent-modes/roster')({})).json()
  assert.ok(firstRoster.value.capabilities.flash, 'the first apply compiles a policy')

  // A second plugin instance in the same process, exactly what a re-apply does.
  const second = harness(MODES)
  await apply(second.ctx, { modes: MODES })
  const secondRoster = await (await second.routes.get('/api/agent-modes/roster')({})).json()

  assert.ok(secondRoster.value.capabilities.flash, 'the re-applied plugin still has a policy')
  assert.deepEqual(
    secondRoster.value.capabilities.flash.allowed.slice().sort(),
    firstRoster.value.capabilities.flash.allowed.slice().sort(),
    'the same grants survive the re-apply',
  )
})

test('the compiled scope id is stable rather than random', async () => {
  // A stable id is what makes an earlier mount keep resolving; a random one is
  // the whole bug. Assert on the public surface: the preset row carries it.
  const a = buildPlugins({ id: 'flash', tools: ['tool-fs'] }, 'agent-modes')
  const b = buildPlugins({ id: 'flash', tools: ['tool-fs'] }, 'agent-modes')
  const rowOf = (rows) => rows.find((row) => row.id === 'mode-capability-policy')
  assert.equal(rowOf(a).config.scope, 'agent-modes')
  assert.equal(rowOf(b).config.scope, rowOf(a).config.scope)
})

test('saving a denial changes the live policy the running session already holds', async () => {
  // The promise the pane makes in its own copy: "enforced on subsequent calls,
  // including running sessions". A running session's guard resolved its policy
  // once at mount; only an in-place refresh of the same scope makes the save
  // reach it. A fresh scope would leave that session enforcing the old rules.
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })

  const before = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  const flashBefore = before.value.capabilities.flash
  assert.ok(flashBefore.allowed.includes('read'), 'read is granted before the save')
  assert.deepEqual(flashBefore.disabled, [], 'nothing is denied before the save')

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs', 'tool-pwsh'], disabledTools: ['write'] }],
    }),
  })

  const after = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  const flashAfter = after.value.capabilities.flash
  assert.deepEqual(flashAfter.disabled, ['write'], 'the denial is live without a reload')
  assert.equal(flashAfter.allowed.includes('write'), false, 'a denied tool is not also reported as allowed')
  assert.ok(flashAfter.allowed.includes('read'), 'the other grants survive')
})

test('granting a tool by hand reaches the live policy too', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({
      modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs'], allowedTools: ['my_dynamic_tool'] }],
    }),
  })

  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.ok(body.value.capabilities.flash.allowed.includes('my_dynamic_tool'), 'the hand grant is live')
})

test('deleting a mode drops its policy instead of leaving a stale one', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })

  await h.routes.get('/api/agent-modes/save')({
    json: async () => ({ modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs'] }] }),
  })

  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.ok(body.value.capabilities.flash, 'the surviving mode keeps its policy')
  assert.equal(body.value.capabilities['flash-pure'], undefined, 'the deleted mode has no policy')
})

test('the save route refuses an allowlist entry that is not a tool name', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const save = h.routes.get('/api/agent-modes/save')
  const post = (body) => save({ json: async () => body }).then((r) => r.json())

  assert.match(
    (await post({ modes: [{ id: 'a', tools: [], allowedTools: [1] }] })).error,
    /invalid allowedTools/,
  )
  assert.match(
    (await post({ modes: [{ id: 'a', tools: [], disabledTools: ['has space'] }] })).error,
    /invalid disabledTools/,
  )
  assert.match(
    (await post({ modes: [{ id: 'a', tools: [], allowedTools: 'read' }] })).error,
    /invalid allowedTools/,
  )
})

test('the roster publishes a parameter schema with the shipped value as default', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()

  const guard = body.value.catalog.find((row) => row.id === 'workbuddy-guard-strict')
  assert.ok(guard, 'the strict guard is in the catalog')
  assert.ok(guard.params.length >= 8, 'its schema reaches the page')
  const steps = guard.params.find((param) => param.key === 'maxToolSteps')
  assert.equal(steps.type, 'number')
  assert.equal(steps.default, 120, 'the page shows the shipped value, not a guess')
  const render = guard.params.find((param) => param.key === 'requireRenderBeforePresent')
  assert.equal(render.type, 'bool')
  assert.equal(render.default, true)
  const size = guard.params.find((param) => param.key === 'maxReadBytes')
  assert.equal(size.scale, 1024 * 1024, 'bytes are shown in MB')
  assert.equal(size.default, 10 * 1024 * 1024)

  // A row with nothing to tune says so rather than omitting the field.
  const plain = body.value.catalog.find((row) => row.id === 'tool-fs')
  assert.deepEqual(plain.params, [])
})

test('the save route stores parameters as a diff against the shipped config', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const save = h.routes.get('/api/agent-modes/save')
  const post = (body) => save({ json: async () => body }).then((r) => r.json())

  const kept = await post({
    modes: [{
      id: 'flash',
      tools: ['workbuddy-guard-strict'],
      // repeatLimit already is 3 in the catalog, so only the budget survives.
      config: { 'workbuddy-guard-strict': { maxToolSteps: 90, repeatLimit: 3 } },
    }],
  })
  assert.equal(kept.ok, true, kept.error)
  assert.deepEqual(h.writes.at(-1).modes[0].config, { 'workbuddy-guard-strict': { maxToolSteps: 90 } })

  // Unticking the row drops its tuning instead of failing the save.
  const dropped = await post({
    modes: [{
      id: 'flash',
      tools: ['tool-fs'],
      config: { 'workbuddy-guard-strict': { maxToolSteps: 90 } },
    }],
  })
  assert.equal(dropped.ok, true, dropped.error)
  assert.equal(h.writes.at(-1).modes[0].config, undefined)
})

test('the save route rejects parameters outside their declared range', async () => {
  const h = harness(MODES)
  await apply(h.ctx, { modes: MODES })
  const save = h.routes.get('/api/agent-modes/save')
  const post = (body) => save({ json: async () => body }).then((r) => r.json())
  const one = (values) => post({
    modes: [{ id: 'flash', tools: ['workbuddy-guard-strict'], config: { 'workbuddy-guard-strict': values } }],
  })

  assert.match((await one({ maxToolSteps: 9000 })).error, /at most 500/)
  assert.match((await one({ maxToolSteps: -5 })).error, /at least 0/)
  assert.match((await one({ repeatLimit: 0 })).error, /at least 1/)
  assert.match((await one({ requirePlanBeforeWrite: 'yes' })).error, /true or false/)
  assert.match((await one({ maxReadBytes: 1024 ** 3 })).error, /at most 512MB/)
  assert.match((await one({ nope: 1 })).error, /没有参数 nope/)
  // A row that exposes no schema refuses tuning rather than storing dead config.
  assert.match(
    (await post({ modes: [{ id: 'flash', tools: ['tool-fs'], config: { 'tool-fs': { applyPatch: true } } }] })).error,
    /没有可调参数/,
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

test('context injection can be disabled independently without removing enforcement', () => {
  const rows = buildPlugins({ id: 'minimal', pure: true, tools: [], context: { projectInstructions: false, timeContext: false } })
  assert.equal(rows.some((row) => row.id === 'agent-instructions'), false)
  assert.equal(rows.some((row) => row.id === 'time-context'), false)
  assert.equal(rows.some((row) => row.id === 'mode-capability-policy'), true)
  assert.equal(rows.some((row) => row.id === 'compaction'), true)
})

test('live capability inspection reports actual registered names, not only declarations', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('observed-session', 'flash')
  agent.ctx.tools = { definitions: (scope) => {
    assert.equal(scope, agent)
    return [{ name: 'read' }, { name: 'unexpected_runtime_tool' }]
  } }
  h.agents.live = [agent]
  await apply(h.ctx, { modes: MODES })
  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.deepEqual(body.value.capabilities.flash.sessions[0].registered, ['read', 'unexpected_runtime_tool'])
  assert.equal(body.value.capabilities.flash.allowed.includes('unexpected_runtime_tool'), false)
})

test('a deleted mode with a running session retains a deny-all policy', async () => {
  const h = harness(MODES)
  h.agents.live = [h.makeAgent('retired-session', 'flash-pure')]
  await apply(h.ctx, { modes: MODES })
  await h.routes.get('/api/agent-modes/save')({ json: async () => ({ modes: [MODES[0]] }) })
  const body = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(body.value.capabilities['flash-pure'].retired, true)
  assert.deepEqual(body.value.capabilities['flash-pure'].allowed, [])
})
test('roster and hot apply respect Cordis service injection boundaries', async () => {
  const h = harness(MODES)
  const agent = h.makeAgent('strict-session', 'flash')
  const loader = agent.ctx.loader
  agent.ctx.get = (name) => name === 'loader' ? loader : undefined
  Object.defineProperty(agent.ctx, 'loader', { get: () => { throw new Error('cannot get property "loader" without inject') } })
  h.agents.live = [agent]
  const originalInject = h.ctx.inject
  h.ctx.inject = (dependencies, run) => originalInject(dependencies, (ctx) => {
    const scoped = Object.create(ctx)
    for (const name of ['agents', 'agentPresets']) if (!dependencies.includes(name)) {
      Object.defineProperty(scoped, name, { get: () => { throw new Error(`cannot get property "${name}" without inject`) } })
    }
    return run(scoped)
  })
  await apply(h.ctx, { modes: MODES })
  const roster = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(roster.ok, true)
  assert.equal(roster.value.configured.length, 2)
  const saved = await (await h.routes.get('/api/agent-modes/save')({ json: async () => ({ modes: [{ ...MODES[0], tools: ['tool-fs', 'tool-pwsh', 'tool-web'] }] }) })).json()
  assert.equal(saved.ok, true)
  assert.equal(saved.value.hot[0].sessions, 1)
})

test('a broken optional agent service never prevents reading the configured modes', async () => {
  const h = harness(MODES)
  h.agents.list = () => { throw new Error('agent registry restarting') }
  await apply(h.ctx, { modes: MODES })
  const roster = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(roster.ok, true)
  assert.equal(roster.value.configured.length, 2)
  assert.deepEqual(roster.value.capabilities.flash.sessions, [])
})
