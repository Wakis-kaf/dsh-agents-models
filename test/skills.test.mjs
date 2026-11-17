// Skill categories and skill packs: the storage half plus the four routes that
// expose it. Everything here runs against a throwaway DSH_HOME, so a test run
// never touches the operator's real `~/.dsh`.
//
// Run with: node test/skills.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-agents-models-skills-'))

const {
  DEFAULT_CATEGORY,
  PACK_FORMAT,
  assignCategories,
  autoCategory,
  buildPack,
  editCategory,
  normalizeStore,
  parsePack,
  parseSkillFile,
  readStore,
  renderSkillFile,
  skillsRoot,
  storePath,
  writeStore,
  yamlScalar,
} = await import('../skill-store.js')
const { apply } = await import('../index.js')

const HOMES = []
test.after(async () => {
  for (const home of HOMES) await rm(home, { recursive: true, force: true })
})

/**
 * Point the plugin at a home nobody else is using.
 *
 * The routes resolve `DSH_HOME` per call, so switching it between tests is the
 * only way to keep one test's written files out of another's.
 */
async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-agents-models-case-'))
  HOMES.push(home)
  process.env.DSH_HOME = home
  return home
}

// ── a fake host context: routes plus a skill registry ───────────────────────
function harness(catalog = []) {
  const routes = new Map()
  const connection = {
    fetch: {
      register: (spec) => {
        routes.set(spec.path, spec.fetch)
        return () => {}
      },
    },
  }
  const byName = new Map(catalog.map((skill) => [skill.name, skill]))
  const skills = {
    snapshot: async () => ({ skills: catalog.map((s) => ({ ...s })), complete: true }),
    get: async (name) => byName.get(name),
  }
  const services = { connection, skills }
  const ctx = {
    ...services,
    get: (name) => services[name],
    inject: (_deps, run) => run(ctx),
    effect: (fn) => fn(),
    fiber: { entry: { id: 'agent-modes' } },
    logger: { warn: () => {} },
  }
  return { ctx, routes }
}

/** Catalog rows whose user skill path follows the current DSH_HOME. */
function catalog() {
  return [
    { name: 'unity-verify-workflow', description: 'Unity 验证闭环', provider: 'filesystem', path: join(skillsRoot(), 'unity-verify-workflow', 'SKILL.md'), invocation: {}, content: '# Unity verify\n' },
    { name: 'office-docx', description: 'Word docs', provider: 'bundled', path: 'C:/bundled/office-docx/SKILL.md', invocation: {}, content: '# Office docx\nWord document helper.\n' },
    { name: 'ui-ugui', description: 'uGUI', provider: 'bundled', path: 'C:/bundled/ui-ugui/SKILL.md', invocation: {}, content: '# uGUI\n' },
  ]
}

/** Boot the routes against a fresh home and return them with that home. */
async function boot() {
  // The catalog's user path is derived from DSH_HOME, so it has to be built
  // after the home is switched or the row would point at the previous test's.
  const home = await freshHome()
  const h = harness(catalog())
  await apply(h.ctx, { modes: [] })
  return { home, routes: h.routes }
}

const post = (route, payload) => route({ json: async () => payload }).then((r) => r.json())
const readRoute = (route) => route({ json: async () => ({}) }).then((r) => r.json())

// ── category storage ───────────────────────────────────────────────────────

test('the shipped categories always include the fallback bucket', () => {
  const store = normalizeStore(null)
  assert.ok(store.categories.length >= 3)
  assert.ok(store.categories.some((c) => c.id === DEFAULT_CATEGORY))
  assert.deepEqual(store.assignments, {})
})

test('a stored category with an unknown assignment drops the assignment, not the category', () => {
  const store = normalizeStore({
    categories: [{ id: 'mine', zh: '我的', en: 'Mine', order: 5 }],
    assignments: { 'skill-a': 'gone', 'skill-b': 'mine' },
  })
  assert.equal(store.assignments['skill-a'], undefined)
  assert.equal(store.assignments['skill-b'], 'mine')
  assert.ok(store.categories.some((c) => c.id === 'mine'))
  assert.ok(store.categories.some((c) => c.id === DEFAULT_CATEGORY), 'the fallback is re-added')
})

test('a hand-mangled store entry cannot smuggle a non-category id through', () => {
  const store = normalizeStore({
    categories: [{ id: '../etc', zh: 'x' }, { id: 'ok', zh: 'ok' }],
    assignments: {},
  })
  assert.equal(store.categories.some((c) => c.id === '../etc'), false)
  assert.ok(store.categories.some((c) => c.id === 'ok'))
})

test('adding a category twice updates it instead of duplicating it', () => {
  let store = editCategory(normalizeStore(null), 'add', { id: 'mine', zh: '我的' })
  store = editCategory(store, 'add', { id: 'mine', zh: '我的二次' })
  const mine = store.categories.filter((c) => c.id === 'mine')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].zh, '我的二次')
})

test('removing a category files its skills back under the fallback', () => {
  let store = editCategory(normalizeStore(null), 'add', { id: 'mine', zh: '我的' })
  store = normalizeStore({ categories: store.categories, assignments: { a: 'mine', b: DEFAULT_CATEGORY } })
  store = editCategory(store, 'remove', { id: 'mine' })
  assert.equal(store.assignments.a, undefined)
  assert.equal(store.assignments.b, DEFAULT_CATEGORY)
  assert.equal(store.categories.some((c) => c.id === 'mine'), false)
})

test('the fallback category cannot be removed', () => {
  assert.throws(
    () => editCategory(normalizeStore(null), 'remove', { id: DEFAULT_CATEGORY }),
    /cannot be removed/,
  )
})

test('an explicit assignment beats the auto-derived bucket', () => {
  // The assignment must name a category the store actually holds, or
  // normalizeStore drops it and the row falls back to the derived bucket.
  const categories = editCategory(normalizeStore(null), 'add', { id: 'mine', zh: '我的' }).categories
  const rows = assignCategories(
    [{ name: 'office', provider: 'bundled' }, { name: 'ui-ugui', provider: 'bundled' }],
    { categories, assignments: { 'ui-ugui': 'mine' } },
  )
  assert.equal(rows[0].category, 'office')
  assert.equal(rows[0].categoryExplicit, false)
  assert.equal(rows[1].category, 'mine')
  assert.equal(rows[1].categoryExplicit, true)
})

test('auto-derived categories cover the shipped catalog without an assignment', () => {
  assert.equal(autoCategory({ name: 'ui-ugui' }), 'ui')
  assert.equal(autoCategory({ name: 'office-docx' }), 'office')
  assert.equal(autoCategory({ name: 'unity-verify-workflow' }), 'unity')
  assert.equal(autoCategory({ name: 'verify-delivery' }), 'workflow')
  assert.equal(autoCategory({ name: 'something-else' }), DEFAULT_CATEGORY)
})

test('one big provider does not collapse the whole catalog into one bucket', () => {
  // The real catalog is dominated by a single Unity package. Keying on provider
  // first put 25 of these 31 skills in one head -- the flat list this feature
  // exists to break up -- so name must win.
  const real = [
    ['build-live-game', 'unity-plugin-upstream'],
    ['diagnose-windows-sandbox-acl', 'dsh-windows-acl'],
    ['implement-in-app-purchases', 'unity-plugin-upstream'],
    ['initialize-ai-navigation', 'unity-plugin-upstream'],
    ['levelplay-unity-integration', 'unity-plugin-upstream'],
    ['localization', 'unity-plugin-upstream'],
    ['new-unity-project', 'unity-plugin-upstream'],
    ['office', 'bundled'],
    ['office-docx', 'bundled'],
    ['office-pptx', 'bundled'],
    ['office-xlsx', 'bundled'],
    ['optimize-audio', 'unity-plugin-upstream'],
    ['optimize-text-mesh-pro', 'unity-plugin-upstream'],
    ['optimize-web', 'unity-plugin-upstream'],
    ['physics-3d-collision', 'unity-plugin-upstream'],
    ['setup-multiplayer-services', 'unity-plugin-upstream'],
    ['setup-vivox-voice-chat', 'unity-plugin-upstream'],
    ['shader-graph-create-custom-node', 'unity-plugin-upstream'],
    ['sprite-editor', 'unity-plugin-upstream'],
    ['ui', 'unity-plugin-upstream'],
    ['ui-imgui', 'unity-plugin-upstream'],
    ['ui-ugui', 'unity-plugin-upstream'],
    ['ui-uitk', 'unity-plugin-upstream'],
    ['unity-asset-store', 'unity-plugin-upstream'],
    ['unity-cli', 'unity-plugin-upstream'],
    ['unity-package-management', 'unity-plugin-upstream'],
    ['unity-verify-workflow', 'filesystem'],
    ['unity-workflow', 'unity-plugin-upstream'],
    ['urp-postprocessing', 'unity-plugin-upstream'],
    ['validate-urp-render-graph-renderer-feature', 'unity-plugin-upstream'],
    ['verify-delivery', 'filesystem'],
  ]
  const counts = {}
  for (const [name, provider] of real) {
    const category = autoCategory({ name, provider })
    counts[category] = (counts[category] ?? 0) + 1
  }
  const known = new Set(normalizeStore(null).categories.map((c) => c.id))
  for (const category of Object.keys(counts)) {
    assert.ok(known.has(category), `${category} is not a shipped category`)
  }
  assert.ok(Object.keys(counts).length >= 6, `only ${Object.keys(counts).length} buckets are used`)
  const biggest = Math.max(...Object.values(counts))
  assert.ok(biggest <= 8, `the biggest bucket holds ${biggest} of ${real.length} skills`)
})

test('a broken store file degrades to defaults instead of throwing', async () => {
  await freshHome()
  const path = storePath()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '{ not json', 'utf8')
  const store = await readStore(path)
  assert.equal(store.broken, true)
  assert.ok(store.categories.length > 0)
})

test('the store survives a write and read round trip', async () => {
  await freshHome()
  const path = storePath()
  await writeStore(path, { categories: normalizeStore(null).categories, assignments: { a: 'unity' } })
  const back = await readStore(path)
  assert.equal(back.exists, true)
  assert.equal(back.assignments.a, 'unity')
})

// ── SKILL.md rendering ─────────────────────────────────────────────────────

test('a description containing a colon is quoted so the frontmatter still parses', () => {
  const text = renderSkillFile({
    name: 'demo',
    description: 'Use this: when the operator asks',
    content: '# Demo\n',
  })
  assert.match(text, /^---\nname: demo\n/)
  assert.match(text, /description: "Use this: when the operator asks"/)
  assert.match(text, /\n---\n\n# Demo\n$/)
})

test('only the values YAML would misread get quoted', () => {
  assert.equal(yamlScalar('交付前验证'), '交付前验证')
  assert.equal(yamlScalar('Unity 开发'), 'Unity 开发')
  // A plain scalar may contain an inner quote; it only needs quoting when the
  // character would change how the line is read.
  assert.equal(yamlScalar('say "hi"'), 'say "hi"')
  assert.equal(yamlScalar('- looks like a list'), '"- looks like a list"')
  assert.equal(yamlScalar('says: this'), '"says: this"')
  assert.equal(yamlScalar('#1 priority'), '"#1 priority"')
})

test('whenToUse is omitted from the file when it is empty', () => {
  const text = renderSkillFile({ name: 'demo', description: 'd', content: 'body' })
  assert.equal(text.includes('whenToUse:'), false)
})

// ── packs ──────────────────────────────────────────────────────────────────

const PACK = {
  format: PACK_FORMAT,
  version: 1,
  title: 'demo',
  exportedAt: '2026-11-17T00:00:00.000Z',
  skills: [
    { name: 'alpha', description: 'A', whenToUse: 'always', category: 'workflow', content: '# Alpha\n' },
    { name: 'beta', description: 'B', content: '# Beta\n' },
  ],
}

test('a built pack carries the marker and the version a reader checks', () => {
  const pack = buildPack([{ name: 'alpha', description: 'A', content: 'x', category: 'workflow' }], {})
  assert.equal(pack.format, PACK_FORMAT)
  assert.equal(pack.version, 1)
  assert.equal(pack.skills[0].category, 'workflow')
  assert.ok(typeof pack.exportedAt === 'string' && pack.exportedAt.length > 0)
})

test('a foreign JSON file is rejected by its marker, not by its fields', () => {
  const { skills, errors } = parsePack({ format: 'something-else', skills: [] })
  assert.deepEqual(skills, [])
  assert.match(errors[0], /not a skill pack/)
})

test('a newer pack version is refused rather than half-read', () => {
  const { errors } = parsePack({ ...PACK, version: 99 })
  assert.match(errors[0], /newer than this plugin supports/)
})

test('one bad skill does not reject the whole pack', () => {
  const { skills, errors } = parsePack({
    ...PACK,
    skills: [
      { name: 'good', description: 'G', content: 'body' },
      { name: 'Bad Name', description: 'B', content: 'body' },
      { name: 'no-desc', content: 'body' },
      { name: 'no-body', description: 'D', content: '   ' },
      { name: 'good', description: 'dup', content: 'body' },
    ],
  })
  assert.deepEqual(skills.map((s) => s.name), ['good'])
  assert.equal(errors.length, 4)
})

// ── routes ────────────────────────────────────────────────────────────────

test('the skills route reports a category for every row and the category list', async () => {
  const { routes } = await boot()
  const res = await readRoute(routes.get('/api/agent-modes/skills'))
  assert.equal(res.ok, true)
  assert.equal(res.value.skills.length, 3)
  for (const row of res.value.skills) {
    assert.ok(typeof row.category === 'string' && row.category !== '', `${row.name} has no category`)
  }
  assert.ok(res.value.categories.some((c) => c.id === DEFAULT_CATEGORY))
  assert.equal(res.value.skills.find((s) => s.name === 'unity-verify-workflow').origin, 'user')
  assert.equal(res.value.skills.find((s) => s.name === 'office-docx').origin, 'bundled')
})

test('assigning a skill through the route is visible on the next read', async () => {
  const { routes } = await boot()
  const assign = routes.get('/api/agent-modes/skill-category')

  const bad = await post(assign, { name: 'office-docx', category: 'nope' })
  assert.equal(bad.ok, false, 'an unknown category is refused')

  await post(assign, { action: 'add', id: 'docs', zh: '文档' })
  const ok = await post(assign, { name: 'office-docx', category: 'docs' })
  assert.equal(ok.ok, true)

  const rows = (await readRoute(routes.get('/api/agent-modes/skills'))).value.skills
  const row = rows.find((s) => s.name === 'office-docx')
  assert.equal(row.category, 'docs')
  assert.equal(row.categoryExplicit, true)
})

test('unfiling a skill puts it back under the derived bucket', async () => {
  const { routes } = await boot()
  const assign = routes.get('/api/agent-modes/skill-category')
  await post(assign, { action: 'add', id: 'docs', zh: '文档' })
  await post(assign, { name: 'office-docx', category: 'docs' })
  await post(assign, { name: 'office-docx', category: '' })

  const rows = (await readRoute(routes.get('/api/agent-modes/skills'))).value.skills
  const row = rows.find((s) => s.name === 'office-docx')
  assert.equal(row.category, 'office')
  assert.equal(row.categoryExplicit, false)
})

test('the category list round-trips through add, rename, and remove', async () => {
  const { routes } = await boot()
  const assign = routes.get('/api/agent-modes/skill-category')

  await post(assign, { action: 'add', id: 'mine', zh: '我的', en: 'Mine' })
  let list = (await readRoute(routes.get('/api/agent-modes/skills'))).value.categories
  assert.equal(list.find((c) => c.id === 'mine').zh, '我的')

  await post(assign, { action: 'rename', id: 'mine', zh: '我的技能' })
  list = (await readRoute(routes.get('/api/agent-modes/skills'))).value.categories
  assert.equal(list.find((c) => c.id === 'mine').zh, '我的技能')

  await post(assign, { action: 'remove', id: 'mine' })
  list = (await readRoute(routes.get('/api/agent-modes/skills'))).value.categories
  assert.equal(list.some((c) => c.id === 'mine'), false)
})

test('a bad category id is refused instead of written', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-category'), { action: 'add', id: '../etc' })
  assert.equal(out.ok, false)
  const list = (await readRoute(routes.get('/api/agent-modes/skills'))).value.categories
  assert.equal(list.some((c) => c.id === '../etc'), false)
})

test('exporting reads bodies from the registry, so a bundled skill exports too', async () => {
  const home = await freshHome()
  const h = harness(catalog().map((s) => ({ ...s, content: `# ${s.name}\n` })))
  await apply(h.ctx, { modes: [] })
  const out = await post(h.routes.get('/api/agent-modes/skill-pack-export'), {
    names: ['office-docx', 'missing-one'],
    title: 'demo',
  })
  assert.ok(home.length > 0)
  assert.equal(out.ok, true)
  assert.equal(out.value.pack.format, PACK_FORMAT)
  assert.deepEqual(out.value.pack.skills.map((s) => s.name), ['office-docx'])
  assert.deepEqual(out.value.missing, ['missing-one'])
  assert.match(out.value.file, /\.json$/)
  // The derived bucket travels with the skill, not just a hand-filed one: the
  // recipient should see the same grouping the sender did.
  assert.equal(out.value.pack.skills[0].category, 'office')
})

test('exporting nothing is refused instead of producing an empty pack', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-pack-export'), { names: [] })
  assert.equal(out.ok, false)
})

test('importing writes the renderer output byte for byte, and carries the category', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-pack-import'), { pack: PACK })
  assert.equal(out.ok, true)
  assert.deepEqual(out.value.written.sort(), ['alpha', 'beta'])

  const text = await readFile(join(skillsRoot(), 'alpha', 'SKILL.md'), 'utf8')
  assert.equal(text, renderSkillFile(PACK.skills[0]), 'the written file is the renderer output')
  assert.match(text, /^---\nname: alpha\n/)

  const store = await readStore(storePath())
  assert.equal(store.assignments.alpha, 'workflow')
})

test('an existing user skill is skipped, not overwritten, unless overwrite is asked for', async () => {
  const { routes } = await boot()
  const dir = join(skillsRoot(), 'alpha')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), renderSkillFile({ name: 'alpha', description: 'mine', content: 'MINE' }), 'utf8')

  const first = await post(routes.get('/api/agent-modes/skill-pack-import'), { pack: PACK })
  assert.deepEqual(first.value.skipped, ['alpha'])
  assert.deepEqual(first.value.written, ['beta'])
  assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /MINE/)

  const second = await post(routes.get('/api/agent-modes/skill-pack-import'), { pack: PACK, overwrite: true })
  assert.deepEqual(second.value.written.sort(), ['alpha', 'beta'])
  assert.doesNotMatch(await readFile(join(dir, 'SKILL.md'), 'utf8'), /MINE/)
})

test('an import with nothing usable fails loudly and touches no file', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-pack-import'), {
    pack: { format: PACK_FORMAT, version: 1, skills: [{ name: 'Bad', description: 'x', content: 'y' }] },
  })
  assert.equal(out.ok, false)
  assert.match(out.error, /kebab-case/)
})

test('a save with a category files the skill in the same round trip', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-save'), {
    name: 'brand-new',
    description: 'Brand new skill',
    content: '# Body\n',
    category: 'workflow',
  })
  assert.equal(out.ok, true)
  assert.equal(out.value.filed, true)
  const store = await readStore(storePath())
  assert.equal(store.assignments['brand-new'], 'workflow')
})

test('a saved SKILL.md with a colon in its description still parses as YAML', async () => {
  const { routes } = await boot()
  await post(routes.get('/api/agent-modes/skill-save'), {
    name: 'colon-demo',
    description: 'Trigger: when the operator says so',
    content: '# Body\n',
  })
  const text = await readFile(join(skillsRoot(), 'colon-demo', 'SKILL.md'), 'utf8')
  assert.match(text, /description: "Trigger: when the operator says so"/)
})

// ── the on/off switch ─────────────────────────────────────────────────────

test('switching a skill off writes the field the provider actually reads', async () => {
  const { routes } = await boot()
  const toggle = routes.get('/api/agent-modes/skill-toggle')
  await post(routes.get('/api/agent-modes/skill-save'), {
    name: 'switch-demo',
    description: 'Demo',
    whenToUse: 'when testing',
    content: '# Body line one\nline two\n',
  })

  const off = await post(toggle, { name: 'switch-demo', enabled: false })
  assert.equal(off.ok, true)
  assert.equal(off.value.changed, true)

  const text = await readFile(join(skillsRoot(), 'switch-demo', 'SKILL.md'), 'utf8')
  assert.match(text, /^disable-model-invocation: true$/m)
  // The body has to survive byte for byte: a switch must not be a rewrite.
  assert.match(text, /# Body line one\nline two\n$/)
  assert.match(text, /whenToUse: when testing/)

  const on = await post(toggle, { name: 'switch-demo', enabled: true })
  assert.equal(on.ok, true)
  const back = await readFile(join(skillsRoot(), 'switch-demo', 'SKILL.md'), 'utf8')
  assert.doesNotMatch(back, /disable-model-invocation/)
  assert.match(back, /# Body line one\nline two\n$/)
})

test('switching to the state a skill is already in does not touch the file', async () => {
  const { routes } = await boot()
  const toggle = routes.get('/api/agent-modes/skill-toggle')
  await post(routes.get('/api/agent-modes/skill-save'), {
    name: 'steady', description: 'D', content: 'body\n',
  })
  const file = join(skillsRoot(), 'steady', 'SKILL.md')
  const before = await readFile(file, 'utf8')

  const out = await post(toggle, { name: 'steady', enabled: true })
  assert.equal(out.ok, true)
  assert.equal(out.value.changed, false)
  assert.equal(await readFile(file, 'utf8'), before, 'the file is untouched')
})

test('switching a bundled skill writes a shadowing copy, not the package file', async () => {
  // The host ranks `user-dsh` (400) above `bundled` (600), so a copy under the
  // user root shadows the original. That is the only way to switch a packaged
  // skill without editing a file the next upgrade would overwrite.
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-toggle'), {
    name: 'office-docx', enabled: false,
  })
  assert.equal(out.ok, true)
  assert.equal(out.value.shadowed, true, 'a copy was written')
  assert.equal(out.value.origin, 'bundled', 'it came from a package')

  const text = await readFile(join(skillsRoot(), 'office-docx', 'SKILL.md'), 'utf8')
  assert.match(text, /^disable-model-invocation: true$/m)
  assert.match(text, /name: office-docx/)
})

test('switching a bundled skill back on edits the copy it already made', async () => {
  const { routes } = await boot()
  const toggle = routes.get('/api/agent-modes/skill-toggle')
  await post(toggle, { name: 'office-docx', enabled: false })
  const on = await post(toggle, { name: 'office-docx', enabled: true })
  assert.equal(on.ok, true)
  const text = await readFile(join(skillsRoot(), 'office-docx', 'SKILL.md'), 'utf8')
  assert.doesNotMatch(text, /disable-model-invocation/)
})

test('an unknown skill name is refused rather than inventing a file', async () => {
  const { routes } = await boot()
  const out = await post(routes.get('/api/agent-modes/skill-toggle'), {
    name: 'no-such-skill', enabled: false,
  })
  assert.equal(out.ok, false)
})

test('a bad name or a non-boolean is refused before anything is written', async () => {
  const { routes } = await boot()
  const toggle = routes.get('/api/agent-modes/skill-toggle')
  assert.equal((await post(toggle, { name: 'Bad Name', enabled: false })).ok, false)
  assert.equal((await post(toggle, { name: 'office-docx' })).ok, false)
})

test('every row that has a body is offered a switch', async () => {
  const { routes } = await boot()
  const rows = (await readRoute(routes.get('/api/agent-modes/skills'))).value.skills
  for (const row of rows) {
    assert.equal(row.switchable, true, `${row.name} has no switch`)
  }
  assert.equal(rows.find((s) => s.name === 'unity-verify-workflow').shadowed, true,
    'a user-root skill is its own file')
  assert.equal(rows.find((s) => s.name === 'office-docx').shadowed, false,
    'a bundled skill is not shadowed until it is switched')
})

test('the switch round trip preserves the body and reads back as off', async () => {
  const { routes } = await boot()
  await post(routes.get('/api/agent-modes/skill-save'), {
    name: 'flip', description: 'F', content: 'keep me exactly\n',
  })
  await post(routes.get('/api/agent-modes/skill-toggle'), { name: 'flip', enabled: false })
  const text = await readFile(join(skillsRoot(), 'flip', 'SKILL.md'), 'utf8')
  const parsed = parseSkillFile(text)
  assert.equal(parsed.enabled, false)
  assert.equal(parsed.content, 'keep me exactly\n')
  assert.equal(parsed.description, 'F')
})
