// Page rendering checks: the browser bundle is loaded into a VM, handed a
// minimal React with a working hook runtime, and rendered against a fake roster.
// This proves the wiring (roster -> rail -> detail -> grouped catalog -> plugin
// inventory -> save round-trip), not the pixels.
//
// Run with: node test/page.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, '..', 'client.js'), 'utf8')

// ── minimal React with a real hook runtime ─────────────────────────────────
function createReact() {
  const hooks = []
  let cursor = 0
  let dirty = false

  const react = {
    createElement(type, props, ...children) {
      const flat = children.length === 1 && Array.isArray(children[0]) ? children[0] : children
      return { type, props: props ?? {}, children: flat.flat(Infinity).filter((c) => c != null) }
    },
    useState(initial) {
      const i = cursor++
      if (i >= hooks.length) {
        hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = hooks[i]
      const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (value !== slot.value) {
          slot.value = value
          dirty = true
        }
      }
      return [slot.value, set]
    },
    useEffect(fn, deps) {
      const i = cursor++
      const slot = hooks[i] ?? (hooks[i] = { ran: false })
      const changed = !slot.ran
        || deps === undefined
        || !Array.isArray(slot.deps)
        || deps.length !== slot.deps.length
        || deps.some((d, k) => d !== slot.deps[k])
      if (!changed) return
      slot.ran = true
      slot.deps = Array.isArray(deps) ? [...deps] : undefined
      slot.cleanup = fn()
    },
    useCallback(fn) { cursor++; return fn },
    useMemo(fn) { cursor++; return fn() },
  }
  return {
    react,
    begin() { cursor = 0; dirty = false },
    get dirty() { return dirty },
  }
}

// ── load the bundle ────────────────────────────────────────────────────────
let captured
const styleEls = []
const sandbox = {
  window: { __ModuleLoader__: { load: (def) => { captured = def } } },
  document: {
    head: { append: (el) => styleEls.push(el) },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
  },
  console,
  structuredClone,
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const CATALOG = [
  { id: 'tool-fs', category: 'file', zh: '文件读写与看图', en: 'Files & images', descZh: '读文件与写文件', descEn: 'Read and write', tools: ['read', 'write'], defaultOn: true, locked: false, hostOnly: false, risky: false, exclusiveWith: [] },
  { id: 'tool-fs-search', category: 'file', zh: '代码搜索', en: 'Code search', descZh: 'glob 与 grep', descEn: 'glob and grep', tools: ['glob', 'grep'], defaultOn: true, locked: false, hostOnly: false, risky: false, exclusiveWith: [] },
  { id: 'tool-pwsh', category: 'shell', zh: 'PowerShell 命令', en: 'PowerShell', descZh: '执行命令', descEn: 'Run commands', tools: ['pwsh'], defaultOn: true, locked: false, hostOnly: false, risky: false, exclusiveWith: ['tool-pwsh-persistent'] },
  { id: 'tool-plugin-manager', category: 'infra', zh: '插件管理工具', en: 'Plugin manager', descZh: '仅宿主', descEn: 'Host only', tools: [], defaultOn: false, locked: false, hostOnly: true, risky: false, exclusiveWith: [] },
  { id: 'compaction', category: 'infra', zh: '长会话压缩', en: 'Compaction', descZh: '压缩', descEn: 'Compaction', tools: [], defaultOn: true, locked: true, hostOnly: false, risky: false, exclusiveWith: [] },
]
const CATEGORIES = [
  { id: 'file', zh: '文件与图像', en: 'Files & images', hintZh: '读写与搜索' },
  { id: 'shell', zh: '命令行与后台', en: 'Shell & background', hintZh: '执行命令' },
  { id: 'infra', zh: '基础设施', en: 'Infrastructure', hintZh: '运行保障' },
]
const PLUGINS = [
  { name: '@opdsh/unity-plugin', version: '0.1.7', title: '@opdsh/unity-plugin', description: 'Unity control', hasClient: true, isBundle: true, enabled: true, tools: ['unity_cli', 'unity_command'] },
  { name: 'dsh-pet', version: '0.4.1', title: 'Pet', hasClient: true, isBundle: true, enabled: false, tools: [] },
]

const STATS = {
  ok: true,
  value: {
    mode: 'flash',
    scanned: 4,
    skipped: 0,
    totals: {
      sessions: 1,
      turns: 4,
      steps: 9,
      durationMs: 240_000,
      llmMs: 90_000,
      toolMs: 12_000,
      calls: 7,
      errors: 1,
      pending: 0,
      tokens: { input: 1_500, output: 300, cacheRead: 9_000, cacheWrite: 0, total: 10_800 },
      cacheHitRate: 0.857,
      tools: [
        { name: 'pwsh', calls: 5, ms: 9_000, avgMs: 1_800, maxMs: 4_000, errors: 0, pending: 0, share: 0.75 },
        { name: 'read', calls: 2, ms: 3_000, avgMs: 1_500, maxMs: 2_000, errors: 1, pending: 0, share: 0.25 },
      ],
    },
    sessions: [
      {
        id: 'session-abc',
        title: 'Fix the preset editor',
        cwd: 'D:\\learn\\dsh-agents-models',
        createdAt: 1_792_000_000_000,
        endedAt: 1_792_000_240_000,
        durationMs: 240_000,
        live: false,
        preset: 'flash',
        model: 'deepseek-flash',
        contextWindow: 1_048_576,
        turns: 4,
        steps: 9,
        llmMs: 90_000,
        toolMs: 12_000,
        calls: 7,
        errors: 1,
        pending: 0,
        contextTokens: 5_600,
        cacheHitRate: 0.857,
        tokens: { input: 1_500, output: 300, cacheRead: 9_000, cacheWrite: 0, total: 10_800 },
        tools: [
          { name: 'pwsh', calls: 5, ms: 9_000, avgMs: 1_800, maxMs: 4_000, errors: 0, pending: 0, share: 0.75 },
          { name: 'read', calls: 2, ms: 3_000, avgMs: 1_500, maxMs: 2_000, errors: 1, pending: 0, share: 0.25 },
        ],
      },
    ],
  },
}

const ROSTER = {
  ok: true,
  value: {
    configured: [
      { id: 'flash', name: 'Flash', description: 'fast', tools: ['tool-fs', 'tool-pwsh'], plugins: [] },
      { id: 'flash-pure', name: 'Flash Pure', pure: true, tools: ['compaction'], plugins: [] },
    ],
    live: [
      { id: 'flash', name: 'Flash' },
      { id: 'flash-pure', name: 'Flash Pure', broken: 'row fs: waiting for systemPrompt' },
    ],
    catalog: CATALOG,
    categories: CATEGORIES,
    plugins: PLUGINS,
    defaults: ['tool-fs', 'tool-fs-search', 'tool-pwsh', 'compaction'],
  },
}

/** Boot the bundle against a recording fetch, returning a render helper. */
function boot() {
  const requests = []
  sandbox.fetch = (path, init) => {
    requests.push({ path, body: init?.body })
    const payload = path === '/api/agent-modes/save'
      ? { ok: true, value: { restartRequired: true } }
      : path === '/api/agent-modes/stats'
        ? STATS
        : ROSTER
    return Promise.resolve({ json: () => Promise.resolve(payload) })
  }

  const hookRuntime = createReact()
  const module = captured.factory((specifier) => {
    if (specifier === 'react') return hookRuntime.react
    throw new Error(`unexpected require: ${specifier}`)
  })

  const dictionaries = []
  const registrations = []
  module.apply({
    effect: (fn) => { fn() },
    locale: {
      register: (ns, dict) => { dictionaries.push({ ns, dict }); return () => {} },
      bind: () => (key) => (dictionaries[0]?.dict?.zh ?? {})[key] ?? key,
    },
    get: () => undefined,
    slots: {
      inject: (_name, fn) => fn(),
      register: (spec, component) => { registrations.push({ spec, component }); return () => {} },
    },
  })

  const pageSpec = registrations.find((r) => r.spec.name === 'main')
  const render = () => {
    hookRuntime.begin()
    return pageSpec.component(pageSpec.spec.inject())
  }

  /**
   * Render with one detail tab selected.
   *
   * The detail page is tabbed, so a pane only exists while its tab is active.
   * This finds the tab by its stable `data-tab` attribute, clicks it the way a
   * user would, and re-renders.
   *
   * @param tabId one of `basics`, `priority`, `tools`, `plugins`.
   * @returns the rendered tree with that pane visible.
   */
  const renderTab = (tabId) => {
    const tree = render()
    const tabs = findByClass(tree, 'lt-tab')
    const wanted = tabs.find((b) => b.props?.['data-tab'] === tabId)
    if (wanted === undefined) return tree
    wanted.props.onClick()
    hookRuntime.begin()
    return pageSpec.component(pageSpec.spec.inject())
  }

  return { module, requests, dictionaries, registrations, pageSpec, render, renderTab, hookRuntime }
}

/** Flatten a tree, expanding local function components and reading props. */
function flatten(node, out = { classes: [], text: [], inputs: [] }) {
  const walk = (value) => {
    if (value == null) return
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (typeof value === 'string' || typeof value === 'number') { out.text.push(String(value)); return }
    if (typeof value !== 'object') return
    const cls = value.props?.className
    if (typeof cls === 'string') out.classes.push(cls)
    if (value.type === 'input' || value.type === 'textarea') out.inputs.push(value.props)
    if (typeof value.type === 'function') {
      walk(value.type({ ...value.props, children: value.children }))
      return
    }
    walk(value.children)
  }
  walk(node)
  return out
}

/** Collect every element whose className contains `cls`. */
function findByClass(node, cls, found = []) {
  if (node == null) return found
  if (Array.isArray(node)) {
    for (const item of node) findByClass(item, cls, found)
    return found
  }
  if (typeof node !== 'object') return found
  const value = node.props?.className
  if (typeof value === 'string' && value.split(/\s+/).includes(cls)) found.push(node)
  if (typeof node.type === 'function') {
    findByClass(node.type({ ...node.props, children: node.children }), cls, found)
    return found
  }
  findByClass(node.children, cls, found)
  return found
}

async function settle(render) {
  let tree = render()
  for (let pass = 0; pass < 8; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    tree = render()
    if (!flatten(tree).text.includes('…')) break
  }
  return tree
}

test('the bundle registers a page and a sidebar row under one panel id', () => {
  const b = boot()
  assert.equal(captured.id, 'dsh-agents-modes')
  assert.equal(typeof b.module.apply, 'function')
  assert.equal(b.pageSpec.spec.key, 'agent-modes')
  const rail = b.registrations.find((r) => r.spec.name === 'sidebar.panellist')
  assert.equal(rail.spec.id, 'agent-modes')
  assert.equal(styleEls.length, 1)
  assert.ok(String(styleEls[0].textContent).includes('.lt-root'))
})

test('both dictionaries cover the same keys', () => {
  const b = boot()
  const zh = b.dictionaries[0].dict.zh
  const en = b.dictionaries[0].dict.en
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('the page renders the rail and a tabbed detail', async () => {
  const b = boot()
  const tree = await settle(b.render)
  const view = flatten(tree)
  const joined = view.text.join('\n')

  assert.ok(b.requests.some((r) => r.path === '/api/agent-modes/roster'))
  assert.ok(view.classes.includes('lt-rail'))
  assert.ok(joined.includes('Flash') && joined.includes('Flash Pure'))
  // The detail is split into tabs; every one of them is offered.
  const tabs = findByClass(tree, 'lt-tab')
  assert.equal(tabs.length, 4, 'four detail tabs render')
  assert.deepEqual(
    tabs.map((tab) => tab.props['data-tab']),
    ['basics', 'priority', 'tools', 'plugins'],
  )
  // Only the active pane is mounted, so the page is not one long scroll.
  assert.ok(view.classes.includes('lt-pane'), 'one pane is visible')
  assert.equal(view.classes.filter((c) => c === 'lt-pane').length, 1, 'exactly one pane at a time')
})

test('the tools tab groups the catalog and marks disabled rows', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('tools')
  const view = flatten(tree)

  assert.equal(view.classes.filter((c) => c === 'lt-section').length, 3, 'three tool categories')
  assert.ok(view.classes.filter((c) => c === 'lt-tool').length >= 5, 'tool rows render')
  assert.ok(view.text.includes('read') && view.text.includes('grep'), 'tool names render as chips')
  assert.ok(view.text.includes('锁定'), 'the locked row is marked')
  assert.ok(view.inputs.some((p) => p.disabled === true), 'the host-only row is disabled')
})

test('the priority tab renders the ordered rows with descriptions', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('priority')
  const view = flatten(tree)

  assert.ok(view.classes.includes('lt-order'), 'priority list renders')
  const rows = findByClass(tree, 'lt-order-row')
  assert.ok(rows.length >= 2, 'checked tools appear in priority order')
  assert.ok(view.classes.includes('lt-order-desc'), 'each row carries a description')
})

test('the plugins tab renders the inventory and the live roster', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('plugins')
  const view = flatten(tree)
  const joined = view.text.join('\n')

  assert.ok(view.classes.includes('lt-plugin'), 'plugin inventory renders')
  assert.ok(joined.includes('@opdsh/unity-plugin@0.1.7'), 'plugins show a version')
  assert.ok(view.text.includes('已启用'), 'live enablement is shown')
  assert.ok(view.classes.includes('lt-addrow'), 'the package add row renders')
})

test('toggling a tool adds it to the priority list, and saving posts the draft', async () => {
  const b = boot()
  await settle(b.render)

  // The checkbox lives on the tools tab; the resulting order shows on priority.
  let tree = b.renderTab('tools')
  const boxes = findByClass(tree, 'lt-tool').flatMap((row) => findByClass(row, 'lt-check'))
  const unchecked = boxes.find((box) => box.props.checked !== true)
  assert.ok(unchecked, 'an unchecked tool exists to toggle')
  unchecked.props.onChange({ target: { checked: true } })

  tree = b.renderTab('priority')
  assert.equal(findByClass(tree, 'lt-order-row').length, 3, 'the toggled tool joined the order')

  const save = findByClass(tree, 'lt-btn-primary')[0]
  assert.ok(save, 'the save button renders')
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))
  tree = b.render()

  const request = b.requests.find((r) => r.path === '/api/agent-modes/save')
  assert.ok(request, 'saving posts the draft')
  const body = JSON.parse(request.body)
  assert.equal(body.modes.length, 2)
  assert.deepEqual(body.modes[0].tools, ['tool-fs', 'tool-pwsh', 'tool-fs-search'])
  assert.equal(body.modes[1].pure, true)
  assert.ok(flatten(tree).text.join('\n').includes('已保存'), 'the confirmation renders')
})

test('switching a mode to pure keeps only the locked row', async () => {
  const b = boot()
  await settle(b.render)

  // The pure switch lives on the basics tab; its effect shows on priority.
  let tree = b.renderTab('basics')
  const toggle = findByClass(tree, 'lt-toggle').flatMap((row) => findByClass(row, 'lt-check'))
  assert.equal(toggle.length, 1, 'the pure toggle renders')
  toggle[0].props.onChange({ target: { checked: true } })

  tree = b.renderTab('priority')
  const rows = findByClass(tree, 'lt-order-row')
  assert.equal(rows.length, 1, 'only the locked row survives')
  assert.ok(flatten(tree).text.includes('长会话压缩'))
})

test('a failed load says so instead of claiming there are no modes', async () => {
  const b = boot()
  sandbox.fetch = () => Promise.reject(new Error('offline'))
  let tree = await settle(b.render)
  await new Promise((resolve) => setTimeout(resolve, 5))
  tree = b.render()
  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('读取模式列表失败'), 'the load failure is named')
  assert.ok(!text.includes('还没有模式'), 'an empty roster is not claimed')
  assert.ok(flatten(tree).classes.includes('lt-rail'), 'the rail still renders')
})

// ── regressions from a real screenshot ─────────────────────────────────────
//
// The registry reports a healthy preset as `broken: false`, not `undefined`.
// Testing `!== undefined` painted every preset red with an empty reason, which
// is exactly what the screenshot showed: nine rows, all "激活失败", no detail.

test('a healthy preset is not flagged as broken', async () => {
  const b = boot()
  const healthy = {
    ok: true,
    value: {
      ...ROSTER.value,
      live: [
        { id: 'standard', name: 'standard', broken: false },
        { id: 'ptc', name: 'ptc', broken: null },
        { id: 'minimal', name: 'minimal' },
        { id: 'flash', name: 'Flash', broken: 'row fs: waiting for systemPrompt' },
      ],
    },
  }
  sandbox.fetch = () => Promise.resolve({ json: () => Promise.resolve(healthy) })
  await settle(b.render)

  // The live roster is collapsed behind its disclosure; open it to read states.
  const tree = b.renderTab('plugins')
  // The disclosure is the card head that carries a caret, which only the live
  // roster block has.
  const disclosure = findByClass(tree, 'lt-card-head')
    .find((head) => findByClass(head, 'lt-caret').length > 0)
  assert.ok(disclosure, 'the live roster disclosure renders')
  disclosure.props.onClick()
  b.hookRuntime.begin()
  const opened = b.pageSpec.component(b.pageSpec.spec.inject())
  const text = flatten(opened).text

  assert.equal(
    text.filter((s) => s === '激活失败').length,
    2,
    'the one broken preset is flagged in both the rail and the live list',
  )
  assert.equal(
    text.filter((s) => s === 'ok').length,
    3,
    'every healthy preset reads ok: standard, ptc, minimal',
  )
  assert.ok(text.join('\n').includes('row fs: waiting for systemPrompt'), 'the reason is shown')
})

test('a host without a catalog is reported, not silently rendered as zero', async () => {
  const b = boot()
  const legacy = {
    ok: true,
    value: {
      configured: [{ id: 'flash', name: 'Flash', tools: ['tool-pwsh', 'tool-fs'] }],
      live: [{ id: 'flash', name: 'Flash', broken: false }],
      // no catalog, categories, plugins, or defaults
    },
  }
  sandbox.fetch = () => Promise.resolve({ json: () => Promise.resolve(legacy) })
  await settle(b.render)
  const tree = b.renderTab('priority')
  const view = flatten(tree)
  const text = view.text.join('\n')

  assert.ok(view.classes.includes('lt-stale'), 'the stale-host notice renders')
  assert.ok(text.includes('比这个页面旧'), 'the notice names the cause')
  // Raw ids are still labelled as unknown rather than passed off as tool names.
  assert.ok(text.includes('当前版本不认识'), 'unmapped ids are marked')
})

test('each priority row carries a description and its tool names', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('priority')
  const rows = findByClass(tree, 'lt-order-row')
  assert.ok(rows.length > 1)

  const first = rows[0]
  const desc = findByClass(first, 'lt-order-desc')
  assert.equal(desc.length, 1, 'the row has a description line')
  assert.ok(flatten(desc[0]).text.join('').length > 0, 'the description is not empty')
  const chips = flatten(findByClass(first, 'lt-order-name')[0]).text.join(' ')
  assert.ok(chips.includes('read'), 'the row lists the tool names it registers')
})

// ── statistics view and plugin-declared tools ──────────────────────────────

test('the statistics view asks the host for the mode and renders its totals', async () => {
  const b = boot()
  await settle(b.render)

  const statsTab = findByClass(b.render(), 'lt-viewtab')
    .find((tab) => tab.props['data-view'] === 'stats')
  assert.ok(statsTab, 'the statistics view tab renders')
  statsTab.props.onClick()

  const tree = await settle(b.render)
  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('工具耗时排行'), 'the tool ranking renders')
  assert.ok(text.includes('pwsh') && text.includes('read'), 'tool names render')
  assert.ok(text.includes('9.0s'), 'tool wall time renders')
  assert.ok(text.includes('86%'), 'the cache hit rate renders')

  const request = b.requests.find((r) => r.path === '/api/agent-modes/stats')
  assert.ok(request, 'the stats route is called')
  assert.equal(JSON.parse(request.body).mode, 'flash', 'the selected mode is the filter')

  // Opening one session shows its token and tool breakdown.
  const row = findByClass(tree, 'lt-session')[0]
  assert.ok(row, 'a session row renders')
  row.props.onClick()
  const opened = flatten(await settle(b.render)).text.join('\n')
  assert.ok(opened.includes('会话明细'), 'the session detail renders')
  assert.ok(opened.includes('5.6k'), 'the context size renders')
  assert.ok(opened.includes('缓存读'), 'the token split renders')
})

test('a declared tool mounts the plugin package that ships it', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('plugins')

  const chip = findByClass(tree, 'lt-chip-btn')
    .find((item) => item.props['data-tool'] === 'unity_cli')
  assert.ok(chip, 'declared tools render as chips')
  chip.props.onClick()

  // Render synchronously: the fake hook runtime re-runs `load` on every render,
  // so a tick would restore the roster value before the save reads the draft.
  const after = b.render()
  const save = findByClass(after, 'lt-btn-primary')[0]
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.deepEqual(body.modes[0].plugins, ['@opdsh/unity-plugin'], 'the package was mounted')
})
