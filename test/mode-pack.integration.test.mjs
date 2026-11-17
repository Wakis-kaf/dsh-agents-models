import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { exportModePack, analyzeModePack, installPackDependencies, validateModePack, findPackageManager } from '../mode-pack.js'
import { exportSkillResources, analyzeSkillResources, installSkillResources } from '../skill-resources.js'
import { apply, validateModes } from '../index.js'
import { TOOLS } from '../catalog.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mode-pack-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.includes('dsh-mode-pack-test-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}
async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}
const basic = (over = {}) => ({ format: 'dsh-mode-pack', version: 1, scope: 'mode',
  compatibility: { platform: process.platform, arch: process.arch },
  modes: [{ id: 'imported', tools: [] }], dependencies: [], ...over })

for (const manager of ['npm', 'pnpm']) test(`a local plugin round-trips with ${manager} without lifecycle scripts`, async (t) => {
  const root = await fixture(t)
  const source = join(root, 'source'); const target = join(root, 'target'); const local = join(root, 'plugin')
  await json(join(source, 'package.json'), { name: 'source', dependencies: { 'local-mode-fixture': `file:${local}` } })
  await json(join(target, 'package.json'), { name: 'target', private: true })
  if (manager === 'pnpm') await writeFile(join(target, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\nimporters:\n  .: {}\n")
  // A missing package manager is a machine fact, not a regression in this
  // package. Skip with a reason instead of failing the suite, so `npm test`
  // stays green on a host that only has the manager it was launched with.
  try {
    await findPackageManager(target)
  } catch {
    t.skip(`${manager} CLI is not installed on this host`)
    return
  }
  await json(join(local, 'package.json'), { name: 'local-mode-fixture', version: '1.0.0', dsh: {},
    scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'SHOULD-NOT-EXIST\',\'unsafe\')"' } })
  await writeFile(join(local, 'index.js'), 'export const name = "fixture"\n')
  await writeFile(join(local, '.env'), 'SECRET=must-not-travel')
  await mkdir(join(source, 'node_modules'))
  await symlink(local, join(source, 'node_modules', 'local-mode-fixture'), process.platform === 'win32' ? 'junction' : 'dir')
  const pack = await exportModePack({ profileDir: source, modes: [{ id: 'portable', tools: [], plugins: ['local-mode-fixture'] }], packages: ['local-mode-fixture'] })
  assert.equal(pack.dependencies[0].source, 'embedded')
  assert.ok(!pack.dependencies[0].files.some((file) => file.path === '.env'))
  let plan = await analyzeModePack(pack, { profileDir: target, modes: [], catalog: [] })
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.dependencies[0].status, 'bundled')
  await assert.rejects(installPackDependencies(plan, target, false), /explicit confirmation/)
  await installPackDependencies(plan, target, true)
  const installed = join(target, 'node_modules', 'local-mode-fixture')
  assert.match(await readFile(join(installed, 'index.js'), 'utf8'), /fixture/)
  await assert.rejects(lstat(join(installed, 'SHOULD-NOT-EXIST')), { code: 'ENOENT' })
  plan = await analyzeModePack(pack, { profileDir: target, modes: [], catalog: [] })
  assert.equal(plan.dependencies[0].status, 'installed')
})

test('host-provided capabilities do not turn into npm downloads', async (t) => {
  const root = await fixture(t)
  await json(join(root, 'package.json'), { name: 'profile' })
  const pack = await exportModePack({ profileDir: root, modes: [{ id: 'a', tools: ['core'] }], packages: ['@deepseek-ai/dsh-core'], hostPackages: ['@deepseek-ai/dsh-core'] })
  const plan = await analyzeModePack(pack, { profileDir: root, modes: [], catalog: [{ id: 'core', pkg: '@deepseek-ai/dsh-core' }], hostPackages: ['@deepseek-ai/dsh-core'] })
  assert.equal(plan.dependencies[0].status, 'host')
  assert.deepEqual(plan.errors, [])
  const absent = await analyzeModePack(pack, { profileDir: root, modes: [], catalog: [{ id: 'core' }] })
  assert.match(absent.errors.join(' '), /Host capability unavailable/)
})

test('preflight detects unsupported configuration and package version conflicts', async (t) => {
  const root = await fixture(t)
  await json(join(root, 'node_modules', 'x', 'package.json'), { name: 'x', version: '2.0.0' })
  const pack = basic({ modes: [{ id: 'imported', tools: ['unknown'], allowedTools: ['read'] }], dependencies: [{ name: 'x', version: '1.0.0', source: 'registry' }] })
  const plan = await analyzeModePack(pack, { profileDir: root, modes: [], catalog: [], validateModes })
  assert.match(plan.errors.join(' '), /unknown tool|Unsupported tool/)
  assert.equal(plan.dependencies[0].status, 'version-conflict')
  assert.match(plan.errors.join(' '), /Version conflict/)
})

test('partial packs cannot silently combine multiple sources into one target', async (t) => {
  const root = await fixture(t)
  await assert.rejects(analyzeModePack(basic({ scope: 'tools', modes: [{ id: 'a' }, { id: 'b' }] }), { profileDir: root, modes: [], catalog: [] }), /exactly one source/)
})

test('selected skills travel with scripts and import only after consent', async (t) => {
  const root = await fixture(t); const source = join(root, 'skill-source'); const target = join(root, 'skill-target')
  await mkdir(join(source, 'scripts'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: portable-skill\ndescription: test\n---\nUse scripts/check.js\n')
  await writeFile(join(source, 'scripts', 'check.js'), 'console.log("check")\n')
  const registry = { get: async () => ({ name: 'portable-skill', description: 'test', content: 'Use scripts/check.js', resourceBase: { kind: 'directory', path: source } }) }
  const resources = await exportSkillResources(['portable-skill'], registry)
  assert.equal(resources[0].files.length, 2)
  validateModePack(basic({ resources }))
  const plan = await analyzeSkillResources(resources, target)
  assert.equal(plan[0].status, 'bundled')
  await assert.rejects(installSkillResources(resources, plan, target, false), /explicit confirmation/)
  await installSkillResources(resources, plan, target, true)
  assert.match(await readFile(join(target, 'portable-skill', 'scripts', 'check.js'), 'utf8'), /check/)
  const ready = await analyzeSkillResources(resources, target)
  assert.equal(ready[0].status, 'installed')
  await writeFile(join(target, 'portable-skill', 'SKILL.md'), 'user changes')
  assert.equal((await analyzeSkillResources(resources, target))[0].status, 'conflict')
  await assert.rejects(installSkillResources(resources, plan, target, true), /already exists/)
})

test('a skill resource cannot escape its imported directory', () => {
  const bytes = Buffer.from('bad')
  const resource = { name: 'bad-skill', files: [{ path: 'SKILL.md', data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }, { path: '../outside', data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }] }
  assert.throws(() => validateModePack(basic({ resources: [resource] })), /Unsafe/)
})

test('parameter-only packs are checked against schemas and the target mount', async (t) => {
  const root = await fixture(t)
  const pack = basic({ scope: 'parameters', modes: [{ id: 'partial', config: { 'tool-unity': { timeoutMs: -1 } } }] })
  const plan = await analyzeModePack(pack, { profileDir: root, modes: [{ id: 'target', tools: [] }], target: 'target', catalog: TOOLS, validateModes })
  assert.ok(plan.errors.some((error) => error.includes('timeoutMs')))
  assert.ok(plan.errors.some((error) => error.includes('must mount')))
})

test('host routes round-trip a mode, retain an edited draft, and defer persistence', async (t) => {
  const root = await fixture(t)
  await json(join(root, 'package.json'), { name: 'profile', private: true })
  const routes = new Map(); const definitions = []; const writes = []; const cleanup = []
  const services = {
    profileContext: { dir: root },
    agentPresets: { register: async (row) => { definitions.push(row); return () => {} }, list: async () => definitions },
    connection: { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {} } } },
    configEditor: { edit: async (_entry, transform) => { writes.push(transform({ modes: [] })) } },
  }
  const ctx = { ...services, get: (key) => services[key], inject: (_deps, fn) => fn(ctx),
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    fiber: { entry: { id: 'modes' } }, logger: { warn: () => {} },
  }
  t.after(() => cleanup.reverse().forEach((dispose) => dispose()))
  await apply(ctx, { modes: [{ id: 'flash', name: 'Original', tools: ['tool-fs'] }] })
  const post = async (name, body) => (await routes.get(`/api/agent-modes/${name}`)({ json: async () => body })).json()
  const exported = await post('pack-export', { mode: 'flash' })
  assert.equal(exported.ok, true, exported.error)
  assert.ok(exported.value.pack.dependencies.every((dep) => dep.source === 'host'))
  const currentModes = [{ id: 'flash', name: 'Unsaved edit', tools: ['tool-fs'] }]
  const analysis = await post('pack-analyze', { pack: exported.value.pack, currentModes })
  assert.equal(analysis.ok, true, analysis.error)
  assert.deepEqual(analysis.value.errors, [])
  assert.deepEqual(analysis.value.conflicts, ['flash'])
  const imported = await post('pack-import', { pack: exported.value.pack, currentModes, conflict: 'copy' })
  assert.equal(imported.ok, true, imported.error)
  assert.equal(imported.value.modes[0].name, 'Unsaved edit')
  assert.equal(imported.value.modes[1].id, 'flash-2')
  assert.equal(writes.length, 0)
  const saved = await post('save', { modes: imported.value.modes })
  assert.equal(saved.ok, true, saved.error)
  assert.equal(writes[0].modes.length, 2)
})
