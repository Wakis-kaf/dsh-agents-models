// Template layering: shipped modes stay upgradable while operator edits survive.
//
// The bug these checks lock down: saving a mode used to write the whole mode
// list into the profile patch, whose config replaces the package row's config
// wholesale. After that first save no later npm update could reach the modes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILTIN_IDS,
  BUILTIN_TEMPLATES,
  MODE_FIELDS,
  applyPatch,
  diffMode,
  hashValue,
  resolveModeConfig,
  splitModeConfig,
  templateById,
  templateHashes,
} from '../builtin-modes.js'
import { TOOL_BY_ID } from '../catalog.js'
import { apply, buildPlugins, validateModes } from '../index.js'

const ALL = new Set(BUILTIN_IDS)

/** A fake Cordis root: only the services `apply` actually touches. */
function harness(options = {}) {
  const registered = []
  const routes = new Map()
  const writes = []
  const warnings = []
  const services = {
    agentPresets: {
      register: (definition) => { registered.push(definition); return async () => {} },
      defaultId: 'flash',
    },
    connection: { fetch: { register: (spec) => { routes.set(spec.path, spec.fetch); return () => {} } } },
    configEditor: { edit: async (_entry, fn) => { writes.push(fn(options.config ?? {})) } },
    loader: { entries: () => options.rows ?? [] },
    agents: { list: () => [] },
  }
  const ctx = {
    ...services,
    get: (name) => services[name],
    inject: (_deps, run) => run(ctx),
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
    fiber: { entry: { id: 'agent-modes' } },
    logger: { warn: (message) => warnings.push(message) },
  }
  return { ctx, registered, routes, writes, warnings }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('a template whose preset id another mounted row owns steps aside', async () => {
  // The collision this locks down: dsh-work-fish's own cordis.patch.yml inserts
  // `preset-work-fish` with `config.id: work-fish`, and this plugin used to ship a
  // template with that exact id. The registry throws `Duplicate agent preset` on
  // the second registration and the earlier plugin keeps the id, so one of the two
  // presets disappeared with nothing but a warning in the log.
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'agent-modes-collide-'))
  await mkdir(join(dir, 'node_modules', 'dsh-work-fish'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'dsh-work-fish', 'package.json'),
    JSON.stringify({ name: 'dsh-work-fish', version: '0.2.1' }))

  const rows = [{
    options: { id: 'preset-work-fish', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'work-fish', name: '大肥鱼' } },
  }]
  const h = harness({ config: { templates: 'builtin' }, rows })
  h.ctx.get = (name) => (name === 'profileContext' ? { dir } : h.ctx[name])
  await apply(h.ctx, { templates: 'builtin' })
  await settle()

  const ids = h.registered.map((definition) => definition.id)
  assert.equal(ids.includes('work-fish'), false, 'the template must yield the id to the bundle')
  assert.ok(ids.includes('workfish'), 'the mode that does not collide still registers')
  assert.ok(ids.includes('flash'))

  // And it survives the registry check the host actually runs.
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no duplicate preset id was registered')

  // The id is only reserved while *that* row is on the tree: a profile where the
  // bundle is disabled keeps this plugin's own mode.
  const free = harness({ config: { templates: 'builtin' }, rows: [] })
  free.ctx.get = (name) => (name === 'profileContext' ? { dir } : free.ctx[name])
  await apply(free.ctx, { templates: 'builtin' })
  await settle()
  assert.ok(free.registered.map((definition) => definition.id).includes('work-fish'),
    'with no bundle row the template must register normally')
})

test('declaredPresetIds reads preset rows off the live tree', async () => {
  const { declaredPresetIds } = await import('../index.js')
  const ids = declaredPresetIds({ entries: () => [
    { options: { id: 'preset-work-fish', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'work-fish' } } },
    { options: { id: 'other', name: 'some-other-plugin', config: { id: 'not-a-preset' } } },
    { options: { id: 'grp', group: true, config: { id: 'ignored' } } },
    { options: { id: 'blank', name: '@deepseek-ai/dsh-agent-preset', config: {} } },
  ] })
  assert.deepEqual([...ids], ['work-fish'])
  assert.equal(declaredPresetIds(undefined).size, 0)
})

test('shipped templates are internally consistent', () => {
  assert.equal(new Set(BUILTIN_IDS).size, BUILTIN_IDS.length, 'duplicate template id')
  for (const template of BUILTIN_TEMPLATES) {
    assert.match(template.id, /^[a-z0-9][a-z0-9-]*$/)
    assert.ok(typeof template.name === 'string' && template.name !== '', `${template.id} has no name`)
    assert.ok(Array.isArray(template.tools), `${template.id} tools is not a list`)
    for (const id of template.tools) {
      assert.ok(TOOL_BY_ID[id] !== undefined, `${template.id} lists unknown tool ${id}`)
      assert.notEqual(TOOL_BY_ID[id].hostOnly, true, `${template.id} lists host-plane row ${id}`)
    }
    for (const name of template.plugins ?? []) {
      assert.match(name, /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/)
    }
    for (const name of Object.keys(template.pluginConfig ?? {})) {
      assert.ok((template.plugins ?? []).includes(name), `${template.id} configures an unlisted plugin`)
    }
  }
  // Both Work Fish templates take their prompt section from their own plugin:
  // mounting the stock persona row beside `dsh-work-fish/core/persona` would
  // register `deployment:persona-prefix` twice in one scope.
  const noPersona = BUILTIN_TEMPLATES.filter((template) => template.persona === false).map((template) => template.id)
  assert.deepEqual(noPersona, ['work-fish', 'workfish'])
  assert.equal(templateById('work-fish').requires, 'dsh-work-fish')
  assert.equal(templateById('workfish').requires, 'dsh-work-fish')
})

test('the WorkFish mode composes what the bare Work Fish mode leaves out', () => {
  const lean = templateById('work-fish')
  const full = templateById('workfish')

  // The package's own bundle installs `work-fish-host` and `work-fish-approve`
  // as *global* rows. Mounting either inside a preset would register the same
  // `/wf/*` exact route (or the same approval listener) a second time, so the
  // preset must name neither.
  for (const template of [lean, full]) {
    for (const name of template.plugins) {
      assert.notEqual(name, 'dsh-work-fish', `${template.id} mounts the global board row inside a preset`)
      assert.notEqual(name, 'dsh-work-fish/core/approve', `${template.id} mounts the global approval row inside a preset`)
    }
  }

  // What actually differs is the tool surface, and it differs on purpose: the
  // full mode follows upstream's 「大肥鱼」 preset and adds delegation.
  for (const id of ['tool-subagent', 'tool-subagent-fork', 'tool-subagent-control']) {
    assert.ok(full.tools.includes(id), `workfish is missing the delegation row ${id}`)
    assert.equal(lean.tools.includes(id), false)
  }
  assert.ok(full.tools.includes('tool-web') && full.tools.includes('tool-skill'))

  // No `config` block: a per-row override is only accepted for a declared
  // parameter, and none of the rows this mode mounts declares one. A config here
  // would make the shipped mode unsavable in the editor.
  assert.equal(full.config, undefined)
  assert.equal(validateModes([{ ...full }]).error, undefined, 'the shipped mode is not savable')
})

test('exclusive tool rows are never paired by a shipped template', () => {
  for (const template of BUILTIN_TEMPLATES) {
    for (const id of template.tools) {
      for (const rival of TOOL_BY_ID[id].exclusiveWith ?? []) {
        assert.equal(template.tools.includes(rival), false, `${template.id} pairs ${id} with ${rival}`)
      }
    }
  }
})

test('a legacy profile is passed through untouched', () => {
  const modes = [{ id: 'mine', tools: ['tool-fs'] }]
  const resolved = resolveModeConfig({ modes }, ALL)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.legacy, true)
  assert.deepEqual(resolved.modes, modes)
  assert.deepEqual(resolved.conflicts, {})
})

test('templates enabled: shipped modes resolve, operator modes are kept', () => {
  const resolved = resolveModeConfig({ templates: 'builtin', modes: [{ id: 'mine', tools: [] }] }, ALL)
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.legacy, false)
  assert.deepEqual(resolved.modes.map((mode) => mode.id), [...BUILTIN_IDS, 'mine'])
})

test('a template whose package is missing is left out', () => {
  const available = new Set(BUILTIN_IDS.filter((id) => id !== 'work-fish'))
  const resolved = resolveModeConfig({ templates: 'builtin' }, available)
  assert.equal(resolved.modes.some((mode) => mode.id === 'work-fish'), false)
})

test('an override wins, and every untouched field follows the template', () => {
  const template = templateById('flash')
  const base = templateHashes(template)
  const stored = {
    templates: 'builtin',
    overrides: { flash: { base: { tools: base.tools }, tools: ['tool-fs'] } },
  }
  const [flash] = resolveModeConfig(stored, ALL).modes
  assert.deepEqual(flash.tools, ['tool-fs'], 'the operator tool list must survive')
  assert.equal(flash.description, template.description, 'an untouched field must follow the template')
  assert.deepEqual(resolveModeConfig(stored, ALL).conflicts, {}, 'no conflict when the hash still matches')
})

test('a field the operator overrode and the template later changed is a conflict, and the operator keeps it', () => {
  const template = templateById('unity')
  const resolved = resolveModeConfig({
    templates: 'builtin',
    overrides: { unity: { base: { persona: 'stale-hash' }, persona: '我的版本' } },
  }, ALL)
  const unity = resolved.modes.find((mode) => mode.id === 'unity')
  assert.equal(unity.persona, '我的版本')
  assert.deepEqual(resolved.conflicts, { unity: ['persona'] })
})

test('a removed built-in stays removed across loads', () => {
  const resolved = resolveModeConfig({ templates: 'builtin', removedTemplates: ['flash-pure'] }, ALL)
  assert.equal(resolved.modes.some((mode) => mode.id === 'flash-pure'), false)
})

test('equal fields produce no override, changed fields produce a diff plus a base hash', () => {
  const [flash] = resolveModeConfig({ templates: 'builtin' }, ALL).modes
  assert.deepEqual(splitModeConfig([flash]).overrides, {})

  const edited = { ...flash, name: '我的 Flash' }
  const split = splitModeConfig([edited])
  assert.deepEqual(split.overrides.flash.name, '我的 Flash')
  assert.equal(split.overrides.flash.base.name, hashValue(flash.name))
  assert.deepEqual(split.modes, [], 'a built-in id is never copied into the profile')
})

test('split records a deleted built-in instead of resurrecting it', () => {
  const split = splitModeConfig(resolveModeConfig({ templates: 'builtin' }, ALL).modes.filter((mode) => mode.id !== 'unity'))
  assert.ok(split.removedTemplates.includes('unity'))
})

test('split then resolve round-trips to the same modes', () => {
  const modes = resolveModeConfig({ templates: 'builtin' }, ALL).modes.map((mode) => ({ ...mode }))
  modes[0] = { ...modes[0], description: '改过的描述', tools: ['tool-fs', 'tool-todo'] }
  modes.push({ id: 'mine', name: 'Mine', tools: ['tool-fs-search'] })
  const split = splitModeConfig(modes)
  const back = resolveModeConfig({ ...split, modes: split.modes }, ALL)
  assert.deepEqual(back.modes, modes)
})

test('apply registers templates when the config asks for them', async () => {
  const h = harness()
  await apply(h.ctx, { templates: 'builtin' })
  await settle()
  assert.deepEqual(h.warnings, [])
  assert.ok(h.registered.length >= 4)
  const ids = h.registered.map((definition) => definition.id)
  assert.ok(ids.includes('flash') && ids.includes('unity') && ids.includes('flash-pure'))
  // No profile directory in this harness, so the package-gated mode is absent
  // rather than registered as a preset that cannot mount.
  assert.equal(ids.includes('work-fish'), false)
})

test('save writes diffs, enable migrates a legacy list, reset drops overrides', async () => {
  const h = harness({ config: { modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs'] }] } })
  await apply(h.ctx, { modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs'] }] })
  const roster = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(roster.value.templates.legacy, true)

  const enable = await (await h.routes.get('/api/agent-modes/template')({ json: async () => ({ action: 'enable' }) })).json()
  assert.equal(enable.ok, true)
  assert.ok(enable.value.overridden.includes('flash'))
  assert.ok(h.writes.length > 0)
  const written = h.writes.at(-1)
  assert.equal(written.templates, 'builtin')
  assert.equal(written.modes.length, 0, 'built-ins are not copied into the profile')

  const reset = await (await h.routes.get('/api/agent-modes/template')({ json: async () => ({ action: 'reset', mode: 'flash' }) })).json()
  assert.equal(reset.ok, true)
  assert.deepEqual(reset.value.mode.tools, templateById('flash').tools)
})

test('save with templates on stores only the changed fields', async () => {
  const h = harness({ config: { templates: 'builtin' } })
  await apply(h.ctx, { templates: 'builtin' })
  const [flash] = resolveModeConfig({ templates: 'builtin' }, ALL).modes
  const save = h.routes.get('/api/agent-modes/save')
  const body = await (await save({ json: async () => ({ modes: [{ ...flash, description: '我的描述' }] }) })).json()
  assert.equal(body.ok, true)
  const written = h.writes.at(-1)
  assert.equal(written.templates, 'builtin')
  assert.deepEqual(Object.keys(written.overrides), ['flash'])
  assert.equal(written.overrides.flash.description, '我的描述')
  assert.ok(written.removedTemplates.includes('unity'), 'a mode missing from the payload is recorded as removed')
})

test('buildPlugins honours persona:false and per-plugin config', () => {
  const mode = {
    id: 'wf',
    persona: false,
    tools: ['tool-fs'],
    plugins: ['dsh-work-fish/core/persona', 'dsh-work-fish/core/guard'],
    pluginConfig: { 'dsh-work-fish/core/persona': { complete: true } },
  }
  const rows = buildPlugins(mode)
  assert.equal(rows.some((row) => row.id === 'persona'), false, 'a plugin owns the persona section')
  const persona = rows.find((row) => row.name === 'dsh-work-fish/core/persona')
  assert.deepEqual(persona.config, { complete: true })
  assert.equal(rows.find((row) => row.name === 'dsh-work-fish/core/guard').config, undefined)
})

test('validateModes accepts subpath plugins and their config, and rejects bad shapes', () => {
  const ok = validateModes([{
    id: 'wf',
    tools: ['tool-fs'],
    plugins: ['dsh-work-fish/core/persona'],
    pluginConfig: { 'dsh-work-fish/core/persona': { complete: true } },
  }])
  assert.equal(ok.error, undefined)

  assert.match(
    validateModes([{ id: 'wf', pluginConfig: { 'dsh-work-fish/core/persona': { complete: true } } }]).error,
    /unlisted plugin/,
  )
  assert.match(
    validateModes([{ id: 'wf', plugins: ['dsh-work-fish/core/persona'], pluginConfig: { 'dsh-work-fish/core/persona': {} } }]).error,
    /is empty/,
  )
  assert.match(validateModes([{ id: 'wf', plugins: ['../evil'] }]).error, /invalid plugin names/)
  assert.match(validateModes([{ id: 'wf', persona: 42 }]).error, /invalid persona/)
})

test('applyPatch can drop a field the template sets', () => {
  const template = { id: 'x', name: 'X', description: 'd', tools: [] }
  const patched = applyPatch(template, { base: {}, description: null })
  assert.equal(Object.hasOwn(patched, 'description'), false)
  assert.equal(patched.name, 'X')
  assert.deepEqual(MODE_FIELDS.includes('persona'), true)
  assert.deepEqual(diffMode(template, { ...template, description: undefined }), { description: null })
})
test('a subpath plugin resolves to its package for dependency declarations', async () => {
  const { pluginPackage, validateModePack } = await import('../mode-pack.js')
  assert.equal(pluginPackage('dsh-work-fish/core/persona'), 'dsh-work-fish')
  assert.equal(pluginPackage('@opdsh/unity-plugin'), '@opdsh/unity-plugin')
  assert.equal(pluginPackage('@opdsh/unity-plugin/sub/row'), '@opdsh/unity-plugin')
  const pack = {
    format: 'dsh-mode-pack', version: 1, scope: 'mode', modes: [{
      id: 'wf', name: 'WF', tools: ['tool-fs'], plugins: ['dsh-work-fish/core/persona'],
    }], dependencies: [],
  }
  assert.doesNotThrow(() => validateModePack(pack))
})
test('migration never records a mode as removed just because the snapshot predates it', async () => {
  // The bug that hid the Work Fish mode on a real profile: the legacy snapshot
  // had four modes, so enabling templates diffed it and wrote `removedTemplates:
  // [work-fish]` — the one template that was supposed to appear.
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'agent-modes-profile-'))
  await mkdir(join(dir, 'node_modules', 'dsh-work-fish'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'dsh-work-fish', 'package.json'), JSON.stringify({ name: 'dsh-work-fish', version: '0.2.1' }))

  const modes = [{ id: 'flash', name: 'Flash', tools: ['tool-fs'] }]
  const h = harness({ config: { modes } })
  h.ctx.profileContext = { dir }
  h.ctx.get = (name) => (name === 'profileContext' ? { dir } : h.ctx[name])
  await apply(h.ctx, { modes })
  const roster = await (await h.routes.get('/api/agent-modes/roster')({})).json()
  assert.equal(roster.value.templates.legacy, true)

  const enable = await (await h.routes.get('/api/agent-modes/template')({ json: async () => ({ action: 'enable' }) })).json()
  assert.equal(enable.ok, true)
  const written = h.writes.at(-1)
  assert.deepEqual(written.removedTemplates, [])
  assert.ok(enable.value.modes.some((mode) => mode.id === 'work-fish'), 'the new mode is available after migration')
})
test('a skill inside a plugin package reports that package', async () => {
  const { skillPackage } = await import('../index.js')
  const { join } = await import('node:path')
  const dir = process.platform === 'win32' ? 'C:\\profiles\\desktop' : '/profiles/desktop'
  assert.equal(skillPackage(join(dir, 'node_modules', 'dsh-work-fish', 'skills', 'x', 'SKILL.md'), dir), 'dsh-work-fish')
  assert.equal(skillPackage(join(dir, 'node_modules', '@opdsh', 'unity-plugin', 'skills', 'SKILL.md'), dir), '@opdsh/unity-plugin')
  assert.equal(skillPackage(join(dir, '..', 'skills', 'a', 'SKILL.md'), dir), undefined, 'outside node_modules')
  assert.equal(skillPackage(join(dir, 'node_modules'), dir), undefined, 'the directory itself')
  assert.equal(skillPackage(undefined, dir), undefined)
})
