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
    useCallback(fn, deps) {
      const i = cursor++
      const slot = hooks[i]
      if (slot && deps && slot.deps && deps.length === slot.deps.length && deps.every((value, index) => value === slot.deps[index])) return slot.value
      hooks[i] = { value: fn, deps }
      return fn
    },
    useMemo(fn, deps) {
      const i = cursor++
      const slot = hooks[i]
      if (slot && deps && slot.deps && deps.length === slot.deps.length && deps.every((value, index) => value === slot.deps[index])) return slot.value
      const value = fn()
      hooks[i] = { value, deps }
      return value
    },
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
  { id: 'tool-pwsh', category: 'shell', zh: 'PowerShell 命令', en: 'PowerShell', descZh: '执行命令', descEn: 'Run commands', tools: ['pwsh'], defaultOn: true, locked: false, hostOnly: false, risky: false, exclusiveWith: ['tool-pwsh-persistent'],
    // A row with a schema is what the parameters tab renders; the shape here
    // mirrors what /roster sends, including a scaled field so the display-side
    // unit conversion is exercised.
    params: [
      { key: 'maxToolSteps', type: 'number', default: 60, min: 0, max: 500, step: 10, zh: '会话工具调用上限', en: 'Tool-call budget', hintZh: '0 表示不限制。', hintEn: '0 means unlimited.' },
      { key: 'requireRenderBeforePresent', type: 'bool', default: true, zh: '交付网页前必须看过渲染图', en: 'Look at a render', hintZh: '读源码不算。', hintEn: 'Markup does not count.' },
      { key: 'maxReadBytes', type: 'number', default: 10 * 1024 * 1024, min: 1, max: 512, step: 1, scale: 1024 * 1024, unit: 'MB', zh: '单文件读取上限', en: 'Largest readable file', hintZh: '整读上限。', hintEn: 'Whole-file limit.' },
    ] },
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
    defaultMode: 'flash',
  },
}

/**
 * The 扩展管理 payload the tools module reads.
 *
 * Mirrors `/api/agent-modes/extensions`: one row per extension plus the two
 * read-back facts the card shows (the ledger on disk and whether the connector's
 * process is reachable). Kept next to ROSTER/STATS so a fixture change is one
 * edit, not a hunt through the tests.
 */
const EXTENSIONS = {
  ok: true,
  value: {
    extensions: [{
      id: 'conversation-spend',
      nameZh: '对话消耗展示',
      nameEn: 'Conversation spend',
      version: '1.0.0',
      descZh: '在会话里显示这次对话花了多少。',
      descEn: 'Shows what this conversation cost.',
      defaultOn: true,
      enabled: true,
      featuresZh: ['积分台账落盘：重启后仍显示'],
      featuresEn: ['Credit ledger on disk'],
    }],
    stateBroken: false,
    ledger: { path: 'C:\\Users\\x\\.dsh\\plugins-data\\dsh-agents-modes\\session-spend.json', exists: true, sessions: [], total: 3 },
    priceVersion: '2026-08-17',
    connector: { mounted: true, base: 'http://127.0.0.1:50000' },
  },
}

/** Boot the bundle against a recording fetch, returning a render helper. */
function boot() {
  const requests = []
  sandbox.fetch = (path, init) => {
    requests.push({ path, body: init?.body })
    const payload = path === '/api/agent-modes/save'
      ? { ok: true, value: { restartRequired: true } }
      : path === '/api/agent-modes/default'
        ? { ok: true, value: { defaultMode: JSON.parse(init?.body ?? '{}').mode } }
        : path === '/api/agent-modes/stats'
          ? STATS
          : path === '/api/agent-modes/extensions'
            ? EXTENSIONS
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
  assert.equal(tabs.length, 7, 'seven detail tabs render')
  assert.deepEqual(
    tabs.map((tab) => tab.props['data-tab']),
    ['capabilities', 'basics', 'priority', 'tools', 'params', 'plugins', 'skills'],
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

test('the parameters tab renders a control per tunable field', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('params')
  const view = flatten(tree)

  assert.equal(findByClass(tree, 'lt-param').length, 3, 'one row per declared parameter')
  assert.ok(view.text.join('\n').includes('会话工具调用上限'), 'the zh label renders')

  const numbers = view.inputs.filter((input) => input.type === 'number')
  // Bytes are stored raw and shown in MB: 10485760 must read as 10.
  assert.ok(numbers.some((input) => input.value === '10'), 'a scaled field shows its display unit')
  assert.ok(numbers.some((input) => input.value === '60'), 'an unscaled field shows its raw value')

  // A boolean field is a switch, not a text box.
  assert.equal(view.inputs.filter((input) => input.type === 'checkbox').length, 1)
})

test('editing a parameter posts only the value that changed', async () => {
  const b = boot()
  await settle(b.render)

  let tree = b.renderTab('params')
  const budget = flatten(tree).inputs
    .filter((input) => input.type === 'number')
    .find((input) => input.value === '60')
  assert.ok(budget, 'the tool-call budget renders its default')
  budget.onChange({ target: { value: '120' } })

  tree = b.renderTab('params')
  // The override is now marked, and only that field carries one.
  assert.ok(flatten(tree).text.includes('已改动'), 'the changed field is marked')
  const save = findByClass(tree, 'lt-btn-primary')[0]
  assert.ok(save, 'the save button renders')
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  const request = b.requests.find((r) => r.path === '/api/agent-modes/save')
  assert.ok(request, 'saving posts the draft')
  const body = JSON.parse(request.body)
  assert.deepEqual(
    body.modes[0].config,
    { 'tool-pwsh': { maxToolSteps: 120 } },
    'only the touched field is stored, and it is stored raw',
  )
})

test('a parameter reset drops the override instead of pinning the default', async () => {
  const b = boot()
  await settle(b.render)

  let tree = b.renderTab('params')
  const budget = flatten(tree).inputs
    .filter((input) => input.type === 'number')
    .find((input) => input.value === '60')
  budget.onChange({ target: { value: '120' } })

  tree = b.renderTab('params')
  const reset = findByClass(tree, 'lt-param-reset').find((btn) => btn.props.disabled !== true)
  assert.ok(reset, 'a changed field can be reset')
  reset.props.onClick()

  tree = b.renderTab('params')
  const save = findByClass(tree, 'lt-btn-primary')[0]
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.equal(body.modes[0].config, undefined, 'the override is gone, not set to the default')
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

test('the default button writes the registry default and reports it', async () => {
  const b = boot()
  await settle(b.render)

  // flash is already the default, so its topbar carries the badge instead of
  // the button; the second mode is the one that can be promoted.
  let tree = b.renderTab('basics')
  assert.ok(flatten(tree).text.includes('新任务默认'), 'the current default is marked')

  tree = b.render()
  findByClass(tree, 'lt-mode-item')[1].props.onClick()
  b.hookRuntime.begin()
  tree = b.pageSpec.component(b.pageSpec.spec.inject())

  const button = findByClass(tree, 'lt-btn').find((node) =>
    flatten(node).text.join('').includes('设为默认模式'))
  assert.ok(button, 'the non-default mode offers the button')
  await button.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 5))
  b.hookRuntime.begin()
  tree = b.pageSpec.component(b.pageSpec.spec.inject())

  const request = b.requests.find((r) => r.path === '/api/agent-modes/default')
  assert.ok(request, 'the default route is called')
  assert.deepEqual(JSON.parse(request.body), { mode: 'flash-pure' })
  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('已设为新任务的默认模式'), 'the confirmation renders')
  assert.ok(text.includes('新任务默认'), 'the badge moved to the promoted mode')
  assert.ok(
    findByClass(tree, 'lt-btn').every((node) => !flatten(node).text.join('').includes('设为默认模式')),
    'the promoted mode no longer offers the button',
  )
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

test('a declared tool chip toggles that tool, and the package row mounts it', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('plugins')

  // A chip is now a per-tool grant, not a way to mount the package: the package
  // row carries its own control. Both paths still exist and both must reach the
  // save payload, so each is exercised here.
  const chip = findByClass(tree, 'lt-chip-btn')
    .find((item) => item.props['data-tool'] === 'unity_cli')
  assert.ok(chip, 'declared tools render as chips')
  chip.props.onClick()

  // A save would re-run `load` and reset the draft, so the chip's effect is only
  // observed on the final payload: both edits have to land in one draft.
  const afterChip = b.render()
  const row = findByClass(afterChip, 'lt-plugin')
    .find((item) => flatten(item).text.join('').includes('@opdsh/unity-plugin'))
  assert.ok(row, 'the package row renders')
  const mount = row.children
    .flatMap((child) => findByClass(child, 'lt-check'))
    .find((input) => input.props?.type === 'checkbox')
  assert.ok(mount, 'the package row carries a mount checkbox')
  mount.props.onChange({ target: { checked: true } })

  const afterMount = b.render()
  const save = findByClass(afterMount, 'lt-btn-primary')
    .find((btn) => flatten(btn).text.join('').includes('保存模式'))
  assert.ok(save, 'the save button renders')
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.deepEqual(body.modes[0].plugins, ['@opdsh/unity-plugin'], 'the package was mounted')
  assert.deepEqual(body.modes[0].disabledTools, ['unity_cli'], 'the chip denied that one tool')
})

// ── capabilities: the per-tool allowlist pane ──────────────────────────────

test('the capabilities pane lists one row per declared tool with its source', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')

  const rows = findByClass(tree, 'lt-plugin').filter((row) => row.props['data-on'] !== undefined)
  assert.ok(rows.length >= 5, `every declared tool gets a row, got ${rows.length}`)
  // The row names the tool and where the grant came from, or the pane is a list
  // of bare checkboxes with no way to tell why a name is there.
  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('read') && text.includes('grep'), 'tool names render')
  assert.ok(text.includes('pwsh'), 'a row from another package renders')
})

test('a mounted row reads as allowed and an unmounted one as not mounted', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')

  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('允许'), 'a granted tool says so')
  // `tool-plugin-manager` is host-only and not selected, so its tools must not
  // claim to be allowed.
  assert.ok(text.includes('未挂载') || text.includes('已禁用'), 'an ungranted tool is not shown as allowed')
})

test('switching a tool off in the capabilities pane lands in disabledTools', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')

  const row = findByClass(tree, 'lt-plugin')
    .find((item) => flatten(item).text.join(' ').includes('read') && item.props['data-on'] === 'true')
  assert.ok(row, 'the allowed row for `read` renders')
  const toggle = findByClass(row, 'lt-check')[0]
  assert.equal(toggle.props.checked, true, 'it starts allowed')
  toggle.props.onChange({ target: { checked: false } })

  const after = b.render()
  const save = findByClass(after, 'lt-btn-primary')
    .find((btn) => flatten(btn).text.join('').includes('保存模式'))
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.ok(body.modes[0].disabledTools.includes('read'), 'the denial reached the payload')
})

test('a tool granted by hand is listed and can be revoked', async () => {
  const b = boot()
  await settle(b.render)

  // Grant a dynamic tool name that no package declares.
  const before = b.renderTab('capabilities')
  const input = findByClass(before, 'lt-input')
    .find((el) => typeof el.props.placeholder === 'string' && el.props.placeholder.includes('动态工具'))
  assert.ok(input, 'the explicit-grant field renders')
  input.props.onChange({ target: { value: 'my_dynamic_tool' } })

  const granted = b.render()
  const button = findByClass(granted, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('明确授权') && btn.props.disabled !== true)
  assert.ok(button, 'the grant button enables for a valid name')
  button.props.onClick()

  const after = b.render()
  const text = flatten(after).text.join('\n')
  assert.ok(text.includes('my_dynamic_tool'), 'the granted tool appears in the list')
  const revoke = findByClass(after, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('撤销授权'))
  assert.ok(revoke, 'a hand grant carries a revoke action')
  revoke.props.onClick()

  const revoked = b.render()
  const save = findByClass(revoked, 'lt-btn-primary')
    .find((btn) => flatten(btn).text.join('').includes('保存模式'))
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.deepEqual(body.modes[0].allowedTools ?? [], [], 'the grant was revoked before saving')
})

test('an invalid dynamic tool name cannot be granted', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')
  const input = findByClass(tree, 'lt-input')
    .find((el) => typeof el.props.placeholder === 'string' && el.props.placeholder.includes('动态工具'))
  input.props.onChange({ target: { value: '9bad name!' } })
  const after = b.render()
  const button = findByClass(after, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('明确授权'))
  assert.equal(button.props.disabled, true, 'a name the host would reject stays disabled')
})

test('the audit card shows the policy the host reports', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')
  const text = flatten(tree).text.join('\n')
  // No calls have run in this fresh boot, so it must say so rather than render
  // an empty list that looks like "nothing is enforced".
  assert.ok(text.includes('暂无调用记录') || text.includes('当前已保存授权'), 'the audit card renders')
})

test('an unmounted tool can be turned on from the capability pane', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')

  // `tool-fs-search` is in this build's catalog but not in the fixture mode's
  // tool list, so `grep` is shown but not mounted. The pane promises per-tool
  // control, so turning it on has to work here instead of sending the operator
  // to another tab to tick a whole row.
  const row = findByClass(tree, 'lt-plugin')
    .find((item) => flatten(item).text.join(' ').includes('grep'))
  assert.ok(row, 'an unmounted tool still gets a row')
  assert.equal(row.props['data-on'], 'false', 'it starts off')

  const toggle = findByClass(row, 'lt-check')[0]
  assert.equal(toggle.props.disabled, false, 'the toggle is usable, not disabled')
  toggle.props.onChange({ target: { checked: true } })

  const after = b.render()
  const save = findByClass(after, 'lt-btn-primary')
    .find((btn) => flatten(btn).text.join('').includes('保存模式'))
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  // Granting a tool whose package row is unmounted has to mount that row, or the
  // tool never reaches the model's catalog and the switch would be a lie.
  assert.ok(body.modes[0].tools.includes('tool-fs-search'), 'the owning row was mounted')
})

test('a host-only tool says why it cannot be switched', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')
  const rows = findByClass(tree, 'lt-plugin').filter((item) => item.props['data-on'] !== undefined)
  // Every rendered row must carry a usable control: either a live switch, or the
  // 仅宿主 badge explaining why there is none. A dead checkbox with no reason is
  // the failure this asserts against.
  for (const row of rows) {
    const toggle = findByClass(row, 'lt-check')[0]
    const on = row.props['data-on'] === 'true'
    const text = flatten(row).text.join(' ')
    assert.ok(toggle, `row "${text.trim()}" renders a control`)
    if (toggle.props.disabled === true) {
      assert.ok(text.includes('仅宿主') || text.includes('未挂载'),
        `a disabled switch must say why: "${text.trim()}"`)
    } else {
      assert.equal(toggle.props.checked, on, 'a live switch reflects the row state')
    }
  }
})

test('a tool shipped by an installed package is mountable, not labelled host-only', async () => {
  const b = boot()
  await settle(b.render)
  const tree = b.renderTab('capabilities')

  // `unity_cli` comes from @opdsh/unity-plugin, which is installed but not
  // mounted. It is switchable (mounting the package grants it), so calling it
  // 仅宿主 would be a lie that hides a working control.
  const row = findByClass(tree, 'lt-plugin')
    .find((item) => flatten(item).text.join(' ').includes('unity_cli'))
  assert.ok(row, 'the package-declared tool renders')
  const text = flatten(row).text.join(' ')
  assert.equal(text.includes('仅宿主'), false, 'an installed package tool is not host-only')
  const toggle = findByClass(row, 'lt-check')[0]
  assert.equal(toggle.props.disabled, false, 'its switch works')

  toggle.props.onChange({ target: { checked: true } })
  const after = b.render()
  const save = findByClass(after, 'lt-btn-primary')
    .find((btn) => flatten(btn).text.join('').includes('保存模式'))
  await save.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const body = JSON.parse(b.requests.find((r) => r.path === '/api/agent-modes/save').body)
  assert.ok(body.modes[0].plugins.includes('@opdsh/unity-plugin'), 'turning it on mounted the package')
})

// ── skills: categories, grouping, packs ───────────────────────────────────

/**
 * A skill catalog with enough rows that a flat list is the complaint.
 *
 * Two buckets, one filed by hand and the rest derived, so the grouping path is
 * exercised rather than every row landing in one head.
 */
const SKILL_PAYLOAD = {
  ok: true,
  value: {
    complete: true,
    storeBroken: false,
    categories: [
      { id: 'unity', zh: 'Unity 开发', en: 'Unity', order: 10 },
      { id: 'office', zh: 'Office 文档', en: 'Office', order: 40 },
      { id: 'other', zh: '未分类', en: 'Uncategorised', order: 90 },
    ],
    skills: [
      { name: 'unity-a', description: 'A', category: 'unity', categoryExplicit: true, origin: 'user', switchable: true, shadowed: true, provider: 'filesystem' },
      { name: 'unity-b', description: 'B', category: 'unity', categoryExplicit: false, origin: 'bundled', switchable: true, shadowed: false, provider: 'bundled' },
      { name: 'unity-c', description: 'C', category: 'unity', categoryExplicit: false, origin: 'bundled', switchable: true, shadowed: false, provider: 'bundled' },
      { name: 'unity-d', description: 'D', category: 'unity', categoryExplicit: false, origin: 'bundled', switchable: true, shadowed: false, provider: 'bundled' },
      { name: 'office-docx', description: 'Word', category: 'office', categoryExplicit: false, origin: 'bundled', switchable: true, shadowed: false, provider: 'bundled' },
      { name: 'loose-end', description: 'Loose', category: 'other', categoryExplicit: false, origin: 'other', switchable: true, shadowed: false, provider: 'filesystem' },
    ],
  },
}

/** Boot with the skill payload served in place of the plain roster answer. */
function bootSkills() {
  const b = boot()
  const inner = sandbox.fetch
  sandbox.fetch = (path, init) => {
    if (path === '/api/agent-modes/skills') {
      b.requests.push({ path, body: init?.body })
      return Promise.resolve({ json: () => Promise.resolve(SKILL_PAYLOAD) })
    }
    if (path === '/api/agent-modes/skill-category'
      || path === '/api/agent-modes/skill-pack-export'
      || path === '/api/agent-modes/skill-pack-import') {
      b.requests.push({ path, body: init?.body })
      const answer = path === '/api/agent-modes/skill-pack-export'
        ? { ok: true, value: { pack: { format: 'dsh-skill-pack' }, file: 'x.json' } }
        : path === '/api/agent-modes/skill-pack-import'
          ? { ok: true, value: { written: ['a'], skipped: [], failed: [] } }
          : { ok: true, value: { categories: SKILL_PAYLOAD.value.categories, assignments: {} } }
      return Promise.resolve({ json: () => Promise.resolve(answer) })
    }
    return inner(path, init)
  }
  return b
}

test('the skills pane folds a long catalog into category sections', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  const heads = findByClass(tree, 'lt-skill-group-btn')
  assert.equal(heads.length, 3, 'one head per populated category')
  assert.deepEqual(
    heads.map((h) => h.props['data-cat']),
    ['unity', 'office', 'other'],
    'heads follow the stored order',
  )
  // Unity holds four rows, so it starts folded; office holds one, so it is open.
  assert.ok(heads[0].props['aria-expanded'] === 'false', 'a big bucket starts folded')
  assert.ok(heads[1].props['aria-expanded'] === 'true', 'a small bucket starts open')

  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('Unity 开发'), 'the category label renders')
  assert.ok(text.includes('按分类') || text.includes('一个列表'), 'the grouping switch renders')
})

test('unfolding a category head reveals its rows without a reload', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  // Folded: only the two single-row buckets render their cards.
  assert.equal(findByClass(tree, 'lt-skill-card').length, 2, 'folded rows are not rendered')
  const head = findByClass(tree, 'lt-skill-group-btn').find((h) => h.props['data-cat'] === 'unity')
  head.props.onClick()
  const opened = b.render()
  assert.equal(findByClass(opened, 'lt-skill-card').length, 6, 'every row is rendered once open')
})

test('filing a skill posts the assignment the operator picked', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  const selects = findByClass(tree, 'lt-skill-cat')
  assert.ok(selects.length > 0, 'each card carries a category select')
  // Unity is folded at this point, so the first visible card is the office one:
  // a derived filing shows the empty "auto" value rather than a stored id.
  assert.equal(selects[0].props.value, '', 'a derived filing reads as auto')
  selects[0].props.onChange({ target: { value: 'unity' } })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const call = b.requests.find((r) => r.path === '/api/agent-modes/skill-category')
  assert.ok(call, 'the assignment route is called')
  const payload = JSON.parse(call.body)
  assert.equal(payload.name, 'office-docx')
  assert.equal(payload.category, 'unity')
})

test('picking only exists in export mode, and leaving it clears the selection', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  let tree = await settle(b.render)

  // No pick boxes at rest: an empty box per card is what read as "disabled".
  assert.equal(findByClass(tree, 'lt-skill-pick').length, 0, 'no checkboxes until exporting')

  const exportBtn = () => findByClass(tree, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('导出技能包'))
  exportBtn().props.onClick()
  tree = b.render()

  const picks = findByClass(tree, 'lt-skill-pick')
  assert.ok(picks.length > 0, 'the pick boxes appear with the export bar')
  assert.ok(flatten(tree).text.join('').includes('已选 0 个'), 'the counter appears with them')

  picks[0].props.onChange({ target: { checked: true } })
  tree = b.render()
  const go = () => findByClass(tree, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('导出技能包'))
  assert.equal(go().props.disabled, false, 'one pick enables export')

  // Cancelling drops the selection so a later export starts clean.
  const cancel = findByClass(tree, 'lt-btn-quiet')
    .find((btn) => flatten(btn).text.join('').includes('取消'))
  cancel.props.onClick()
  tree = b.render()
  assert.equal(findByClass(tree, 'lt-skill-pick').length, 0, 'cancelling hides the boxes again')
  assert.equal(flatten(tree).text.join('').includes('已选'), false, 'the counter is gone too')
})

test('exporting posts the names that were ticked', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  let tree = await settle(b.render)

  findByClass(tree, 'lt-btn').find((btn) => flatten(btn).text.join('').includes('导出技能包'))
    .props.onClick()
  tree = b.render()
  findByClass(tree, 'lt-skill-pick')[0].props.onChange({ target: { checked: true } })
  tree = b.render()
  findByClass(tree, 'lt-btn').find((btn) => flatten(btn).text.join('').includes('导出技能包'))
    .props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const call = b.requests.find((r) => r.path === '/api/agent-modes/skill-pack-export')
  assert.ok(call, 'the export route is called')
  // Unity is folded, so the first rendered card is office-docx.
  assert.deepEqual(JSON.parse(call.body).names, ['office-docx'])
})

test('a row the host cannot switch still says why', async () => {
  // Every real row is switchable now, so the read-only branch is exercised with a
  // payload that says otherwise. It must still render a reason, never a dead
  // control that looks identical to a working one.
  const b = boot()
  const inner = sandbox.fetch
  const locked = JSON.parse(JSON.stringify(SKILL_PAYLOAD))
  // Pick the office row: Unity holds four rows and starts folded, so a card there
  // would not be on screen to assert against.
  locked.value.skills.find((s) => s.name === 'office-docx').switchable = false
  sandbox.fetch = (path, init) => {
    if (path === '/api/agent-modes/skills') {
      b.requests.push({ path, body: init?.body })
      return Promise.resolve({ json: () => Promise.resolve(locked) })
    }
    return inner(path, init)
  }

  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  const rows = findByClass(tree, 'lt-skill-locked')
  assert.equal(rows.length, 1, 'the unswitchable row says so')
  assert.equal(flatten(rows[0]).text.join(''), '只读')
  // And the switchable ones still get a real control.
  assert.ok(findByClass(tree, 'lt-skill-switch-input').length > 0)
})

test('flipping a switch posts the new state and refetches the catalog', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  const before = b.requests.filter((r) => r.path === '/api/agent-modes/skills').length
  const sw = findByClass(tree, 'lt-skill-switch-input')[0]
  sw.props.onChange({ target: { checked: false } })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const call = b.requests.find((r) => r.path === '/api/agent-modes/skill-toggle')
  assert.ok(call, 'the toggle route is called')
  const payload = JSON.parse(call.body)
  assert.equal(payload.enabled, false)
  assert.ok(typeof payload.name === 'string' && payload.name !== '')

  // The row must show what the provider reports, not what was clicked. The
  // refetch happens on the pass after the state is invalidated, so render once.
  b.render()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const after = b.requests.filter((r) => r.path === '/api/agent-modes/skills').length
  assert.ok(after > before, 'the catalog is refetched after a switch')
})

test('every skill carries a switch, including the ones shipped by packages', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  let tree = await settle(b.render)

  // Unity holds four rows and starts folded; open it so every card is on screen.
  const head = findByClass(tree, 'lt-skill-group-btn').find((h) => h.props['data-cat'] === 'unity')
  head.props.onClick()
  tree = b.render()

  const cards = findByClass(tree, 'lt-skill-card')
  assert.equal(cards.length, 6, 'all six rows render')
  for (const card of cards) {
    const name = findByClass(card, 'lt-skill-name').map((n) => flatten(n).text.join(''))[0]
    assert.ok(findByClass(card, 'lt-skill-switch-input').length === 1,
      `${name} has no switch`)
    assert.equal(findByClass(card, 'lt-skill-locked').length, 0,
      `${name} is still labelled read-only`)
  }
})

test('a switched-off skill renders as off, not as a missing row', async () => {
  const b = bootSkills()
  const inner = sandbox.fetch
  sandbox.fetch = (path, init) => {
    if (path === '/api/agent-modes/skills') {
      b.requests.push({ path, body: init?.body })
      const off = JSON.parse(JSON.stringify(SKILL_PAYLOAD))
      off.value.skills[1].modelInvocable = false
      return Promise.resolve({ json: () => Promise.resolve(off) })
    }
    return inner(path, init)
  }
  await settle(b.render)
  b.renderTab('skills')
  let tree = await settle(b.render)

  // The switched-off row is the second Unity skill, and Unity holds four rows so
  // it starts folded. Open it, or the card is not on screen to be checked.
  const head = findByClass(tree, 'lt-skill-group-btn').find((h) => h.props['data-cat'] === 'unity')
  assert.ok(head, 'the Unity head renders')
  head.props.onClick()
  tree = b.render()

  const text = flatten(tree).text.join('\n')
  assert.ok(text.includes('已关闭'), 'the off tag renders on the card')
  const offCards = findByClass(tree, 'lt-skill-card')
    .filter((card) => card.props['data-enabled'] === 'false')
  assert.equal(offCards.length, 1, 'exactly the switched-off row is marked')
})

test('a host that predates categories still renders the skills, all in one head', async () => {
  // The plugin can be updated in the browser while an older host half keeps
  // answering: that payload has skills but no categories and no per-row bucket.
  // Rendering must degrade to one fallback head rather than dropping every row.
  const b = boot()
  const inner = sandbox.fetch
  sandbox.fetch = (path, init) => {
    if (path === '/api/agent-modes/skills') {
      b.requests.push({ path, body: init?.body })
      return Promise.resolve({
        json: () => Promise.resolve({
          ok: true,
          value: {
            complete: true,
            skills: [
              { name: 'legacy-a', description: 'A', provider: 'filesystem' },
              { name: 'legacy-b', description: 'B', provider: 'bundled' },
            ],
          },
        }),
      })
    }
    return inner(path, init)
  }

  await settle(b.render)
  b.renderTab('skills')
  const tree = await settle(b.render)

  assert.equal(findByClass(tree, 'lt-skill-card').length, 2, 'both rows render')
  assert.equal(findByClass(tree, 'lt-skill-group-btn').length, 1, 'one fallback head holds them')
  assert.equal(findByClass(tree, 'lt-skill-cat').length, 2, 'each row still offers the select')
})

test('a new category cannot be saved until its id is kebab-case and it has a label', async () => {
  const b = bootSkills()
  await settle(b.render)
  b.renderTab('skills')
  let tree = await settle(b.render)

  const openBtn = findByClass(tree, 'lt-btn-quiet')
    .find((btn) => flatten(btn).text.join('').includes('新建分类'))
  openBtn.props.onClick()
  tree = b.render()

  const addBtn = () => findByClass(tree, 'lt-btn')
    .find((btn) => flatten(btn).text.join('').includes('添加分类'))
  assert.equal(addBtn().props.disabled, true, 'an empty draft cannot be added')

  // The composer's two fields are picked by placeholder, not by index: the
  // name filter is also an lt-input and sits before them.
  const idField = () => findByClass(tree, 'lt-input')
    .find((input) => input.props.placeholder === 'my-category')
  idField().props.onChange({ target: { value: 'Bad Id' } })
  tree = b.render()
  assert.equal(addBtn().props.disabled, true, 'a bad id cannot be added')

  idField().props.onChange({ target: { value: 'mine' } })
  tree = b.render()
  // The label field is the input between the id field and the add button.
  const labelField = () => findByClass(tree, 'lt-input')
    .filter((input) => input.props.placeholder !== 'my-category')[1]
  labelField().props.onChange({ target: { value: '我的分类' } })
  tree = b.render()
  assert.equal(addBtn().props.disabled, false, 'a valid draft can be added')

  addBtn().props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const call = b.requests.find((r) => r.path === '/api/agent-modes/skill-category')
  const payload = JSON.parse(call.body)
  assert.equal(payload.action, 'add')
  assert.equal(payload.id, 'mine')
  assert.equal(payload.zh, '我的分类')
})
function byAction(tree, action) {
  let found
  function visit(node) {
    if (!node || found) return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (typeof node !== 'object') return
    if (node.props?.['data-action'] === action) { found = node; return }
    visit(node.children)
  }
  visit(tree)
  return found
}
const sharedFixture = { format: 'dsh-mode-pack', version: 1, scope: 'mode', modes: [{ id: 'shared', tools: [] }], dependencies: [] }
async function sharingFixture(plan) {
  const b = boot()
  const inner = sandbox.fetch
  sandbox.fetch = (path, init) => {
    if (path === '/api/agent-modes/pack-analyze' || path === '/api/agent-modes/pack-import') {
      b.requests.push({ path, body: init?.body })
      const payload = path.endsWith('pack-analyze') ? plan : { modes: [...JSON.parse(init.body).currentModes, { id: 'shared', tools: [] }] }
      return Promise.resolve({ json: async () => ({ ok: true, value: payload }) })
    }
    return inner(path, init)
  }
  let tree = await settle(b.render)
  byAction(tree, 'sharing').props.onClick()
  tree = b.render()
  return { b, tree, async analyze(file = { size: 300, text: async () => JSON.stringify(sharedFixture) }) {
    await byAction(b.render(), 'analyze-pack').props.onChange({ target: { value: 'pack.json', files: [file] } })
    return b.render()
  } }
}

test('sharing preflight preserves unsaved changes and import stays a draft until save', async () => {
  const fixture = await sharingFixture({ scope: 'mode', modes: [{ id: 'shared' }], dependencies: [], resources: [], conflicts: [], errors: [], warnings: [] })
  const { b } = fixture
  let tree = b.renderTab('basics')
  const name = findByClass(tree, 'lt-input').find((node) => node.props.value === 'Flash')
  assert.ok(name)
  name.props.onChange({ target: { value: 'Unsaved name' } })
  tree = await fixture.analyze()
  const analyzed = JSON.parse(b.requests.find((request) => request.path.endsWith('pack-analyze')).body)
  assert.equal(analyzed.currentModes[0].name, 'Unsaved name')
  const confirm = byAction(tree, 'import-pack')
  assert.equal(!!confirm.props.disabled, false)
  await confirm.props.onClick()
  tree = b.render()
  const imported = JSON.parse(b.requests.find((request) => request.path.endsWith('pack-import')).body)
  assert.equal(imported.currentModes[0].name, 'Unsaved name')
  assert.equal(imported.conflict, 'copy')
  assert.ok(flatten(tree).text.includes('Unsaved name'))
  assert.equal(b.requests.some((request) => request.path.endsWith('/save')), false)
})

test('sharing requires explicit consent for both downloaded packages and bundled skills', async () => {
  const fixture = await sharingFixture({ scope: 'mode', modes: [{ id: 'shared' }], dependencies: [{ name: 'remote', version: '1.0.0', status: 'download' }], resources: [{ name: 'skill-a', files: 2, status: 'bundled' }], conflicts: [], errors: [], warnings: [] })
  let tree = await fixture.analyze()
  assert.equal(!!byAction(tree, 'import-pack').props.disabled, true)
  const panel = findByClass(tree, 'lt-share')[0]
  const consent = flatten(panel).inputs.find((props) => props.type === 'checkbox')
  assert.ok(consent)
  consent.onChange({ target: { checked: true } })
  tree = fixture.b.render()
  assert.equal(!!byAction(tree, 'import-pack').props.disabled, false)
  await byAction(tree, 'import-pack').props.onClick()
  assert.equal(JSON.parse(fixture.b.requests.find((request) => request.path.endsWith('pack-import')).body).install, true)
})

test('sharing blocks import when dependency analysis reports conflicts', async () => {
  const fixture = await sharingFixture({ scope: 'mode', modes: [{ id: 'shared' }], dependencies: [], conflicts: [], errors: ['Version conflict: remote'], warnings: [] })
  const tree = await fixture.analyze()
  assert.equal(!!byAction(tree, 'import-pack').props.disabled, true)
  assert.ok(flatten(tree).text.includes('Version conflict: remote'))
})

test('oversized and malformed shared files are rejected without a host request', async () => {
  const fixture = await sharingFixture({})
  let tree = await fixture.analyze({ size: 40 * 1024 * 1024, text: async () => '{}' })
  assert.ok(findByClass(tree, 'lt-err').length)
  tree = await fixture.analyze({ size: 4, text: async () => 'oops' })
  assert.ok(findByClass(tree, 'lt-err').length)
  assert.equal(fixture.b.requests.some((request) => request.path.endsWith('pack-analyze')), false)
})
test('roster HTTP errors show the host reason and can be retried without restarting the page', async () => {
  const b = boot()
  const healthyFetch = sandbox.fetch
  sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'cannot get property "agents" without inject' } }) })
  let tree = await settle(b.render)
  assert.ok(flatten(tree).text.join(' ').includes('HTTP 500'))
  assert.ok(flatten(tree).text.join(' ').includes('cannot get property "agents" without inject'))
  const retry = byAction(tree, 'retry-roster')
  assert.ok(retry)
  sandbox.fetch = healthyFetch
  retry.props.onClick()
  tree = await settle(b.render)
  assert.ok(findByClass(tree, 'lt-mode-item').length > 0)
  assert.equal(findByClass(tree, 'lt-err').some((node) => flatten(node).text.join(' ').includes('without inject')), false)
})

test('a missing or non-JSON roster endpoint reports the failing route and HTTP status', async () => {
  const b = boot()
  sandbox.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <') } })
  const tree = await settle(b.render)
  const text = flatten(tree).text.join(' ')
  assert.ok(text.includes('/api/agent-modes/roster'))
  assert.ok(text.includes('HTTP 404'))
  assert.ok(byAction(tree, 'retry-roster'))
})
function moduleTab(tree, id) {
  return findByClass(tree, 'lt-module-tab').find((node) => node.props['data-module-tab'] === id)
}
function modulePanel(tree, id) {
  return findByClass(tree, 'lt-module-panel').find((node) => node.props['data-module-panel'] === id)
}

test('top-level module tabs enclose the whole mode interface, including the rail and sharing', async () => {
  const b = boot()
  let tree = await settle(b.render)
  const tabs = findByClass(tree, 'lt-module-tab')
  assert.deepEqual(tabs.map((node) => node.props['data-module-tab']), ['modes', 'tools'])
  const modes = modulePanel(tree, 'modes')
  assert.equal(modes.props.hidden, false)
  assert.equal(modulePanel(tree, 'tools').props.hidden, true)
  assert.equal(findByClass(modes, 'lt-rail').length, 1)
  assert.equal(findByClass(modes, 'lt-viewtabs').length, 1)
  assert.equal(findByClass(modes, 'lt-module-tabs').length, 0)
  byAction(tree, 'sharing').props.onClick()
  tree = b.render()
  assert.equal(findByClass(modulePanel(tree, 'modes'), 'lt-share').length, 1)
})

test('tool management is a separate top-level panel with no mode rail or editor', async () => {
  const b = boot()
  let tree = await settle(b.render)
  moduleTab(tree, 'tools').props.onClick()
  tree = b.render()
  assert.equal(moduleTab(tree, 'tools').props['aria-selected'], true)
  assert.equal(modulePanel(tree, 'modes').props.hidden, true)
  const tools = modulePanel(tree, 'tools')
  assert.equal(tools.props.hidden, false)
  // 工具管理 is no longer a placeholder: it carries the 扩展管理 sub-tab, and the
  // card list under it is the tool module's own content.
  assert.equal(findByClass(tools, 'lt-tools-placeholder').length, 0)
  assert.equal(findByClass(tools, 'lt-viewtab').length, 1)
  assert.ok(flatten(tools).text.join(' ').includes('扩展管理'))
  assert.equal(findByClass(tools, 'lt-ext-card').length, 1)
  assert.equal(findByClass(tools, 'lt-rail').length, 0)
  assert.equal(findByClass(tools, 'lt-tabs').length, 0)
  assert.equal(byAction(tools, 'sharing'), undefined)
})

test('switching top-level modules preserves the mode draft and detail selection', async () => {
  const b = boot()
  await settle(b.render)
  let tree = b.renderTab('basics')
  findByClass(tree, 'lt-input').find((node) => node.props.value === 'Flash').props.onChange({ target: { value: 'Still unsaved' } })
  tree = b.renderTab('priority')
  const reads = b.requests.filter((row) => row.path.endsWith('/roster')).length
  moduleTab(tree, 'tools').props.onClick()
  tree = b.render()
  moduleTab(tree, 'modes').props.onClick()
  tree = b.render()
  assert.equal(modulePanel(tree, 'modes').props.hidden, false)
  assert.ok(flatten(modulePanel(tree, 'modes')).text.includes('Still unsaved'))
  assert.equal(findByClass(tree, 'lt-tab').find((node) => node.props['data-active'] === 'true').props['data-tab'], 'priority')
  assert.equal(b.requests.filter((row) => row.path.endsWith('/roster')).length, reads)
})

test('top-level tabs support keyboard selection and expose matching tabpanel labels', async () => {
  const b = boot()
  let tree = await settle(b.render)
  let focused
  moduleTab(tree, 'modes').props.onKeyDown({ key: 'End', preventDefault: () => {}, currentTarget: { parentElement: { querySelector: (selector) => ({ focus: () => { focused = selector } }) } } })
  tree = b.render()
  assert.equal(moduleTab(tree, 'tools').props.tabIndex, 0)
  assert.equal(modulePanel(tree, 'tools').props['aria-labelledby'], moduleTab(tree, 'tools').props.id)
  assert.equal(focused, '[data-module-tab="tools"]')
})
test('a frozen profile offers the template conversion, and a conflict names its fields', async () => {
  // The upgrade story lives or dies on this notice: a profile that stored whole
  // modes at install time never sees a package update, and the page has to say
  // so and offer the one-way conversion.
  ROSTER.value.templates = {
    enabled: false, legacy: true, conflicts: {}, overridden: [], removed: [], builtin: [],
  }
  try {
    const frozen = boot()
    const tree = await settle(frozen.render)
    const joined = flatten(tree).text.join('\n')
    assert.match(joined, /内置模式还停在/)
    const convert = findByClass(tree, 'lt-btn')
      .find((node) => flatten(node).text.join('') === '转换并保留我的改动')
    assert.ok(convert, 'the conversion button is offered')
    convert.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const call = frozen.requests.find((row) => row.path === '/api/agent-modes/template')
    assert.ok(call, 'the conversion reaches the host route')
    assert.deepEqual(JSON.parse(call.body), { action: 'enable' })
  } finally {
    delete ROSTER.value.templates
  }

  ROSTER.value.templates = {
    enabled: true, legacy: false, conflicts: { flash: ['persona'] }, overridden: ['flash'], removed: [], builtin: [],
  }
  try {
    const layered = boot()
    const tree = await settle(layered.render)
    const joined = flatten(tree).text.join('\n')
    assert.match(joined, /上游也改了这些字段/)
    assert.match(joined, /persona/)
    const reset = findByClass(tree, 'lt-btn')
      .find((node) => flatten(node).text.join('') === '恢复内置版本')
    assert.ok(reset, 'the reset button is offered for an overridden mode')
  } finally {
    delete ROSTER.value.templates
  }
})
test('the page names the package a tool or skill comes from', async () => {
  // With a plugin that ships its own tools and skills mounted, "bundled" is not
  // an answer: the operator has to see whose package the row belongs to.
  const skill = SKILL_PAYLOAD.value.skills.find((row) => row.name === 'office-docx')
  const entry = CATALOG.find((row) => row.id === 'tool-fs')
  skill.package = 'dsh-work-fish'
  entry.package = '@deepseek-ai/dsh-tool-fs'
  try {
    const b = bootSkills()
    await settle(b.render)
    let tree = b.renderTab('skills')
    tree = await settle(b.render)
    assert.ok(flatten(tree).text.includes('dsh-work-fish'), 'the skill row shows its package')

    tree = b.renderTab('tools')
    tree = await settle(b.render)
    assert.ok(flatten(tree).text.includes('@deepseek-ai/dsh-tool-fs'), 'the tool row shows its package')
  } finally {
    delete skill.package
    delete entry.package
  }
})
test('subpath rows a mode mounts are listed, not silently invisible', async () => {
  const flash = ROSTER.value.configured[0]
  flash.plugins = ['dsh-work-fish/core/persona', 'dsh-work-fish/core/guard']
  try {
    const b = boot()
    await settle(b.render)
    const tree = b.renderTab('plugins')
    const joined = flatten(tree).text.join('\n')
    assert.match(joined, /dsh-work-fish\/core\/persona/, 'the mounted subpath row is listed')
    assert.ok(findByClass(tree, 'lt-btn').some((node) => flatten(node).text.join('') === '移除'))
  } finally {
    flash.plugins = []
  }
})
test('a package mounted through subpath rows shows one checked box and a matching count', async () => {
  // Reported state: the tab read "插件 3" while no box was ticked, because the
  // mode mounts three subpath rows of dsh-work-fish and the count used the raw
  // list length. The count must describe what the boxes show.
  const flash = ROSTER.value.configured[0]
  const workfish = { name: 'dsh-work-fish', version: '0.2.1', title: 'Work Fish', description: 'task board', hasClient: true, isBundle: true, enabled: true, tools: [] }
  flash.plugins = ['dsh-work-fish/core/persona', 'dsh-work-fish/core/guard', 'dsh-work-fish/core/skills']
  PLUGINS.push(workfish)
  try {
    const b = boot()
    await settle(b.render)
    const tree = b.renderTab('plugins')

    const row = findByClass(tree, 'lt-plugin')
      .find((node) => flatten(node).text.join(' ').includes('3 子路径行'))
    assert.ok(row, 'the mounted package is listed')
    assert.equal(row.props['data-on'], 'true', 'the package row is marked mounted')
    assert.equal(findByClass(row, 'lt-check').length > 0 || flatten(row).inputs.some((input) => input.checked === true), true, 'its box is checked')
    assert.match(flatten(row).text.join(' '), /3 子路径行/, 'the three subpath rows are accounted for')

    const counts = findByClass(tree, 'lt-count').map((node) => flatten(node).text.join(''))
    assert.ok(counts.includes('1 / 3'), `card count follows the boxes, got ${counts.join(' | ')}`)
    const pluginsTab = findByClass(tree, 'lt-tab').find((node) => node.props['data-tab'] === 'plugins')
    assert.equal(flatten(pluginsTab).text.join(''), `插件1`, 'the tab count matches too')
  } finally {
    flash.plugins = []
    PLUGINS.pop()
  }
})
test('the skills pane can show only the skills this mode brings', async () => {
  // The workspace catalog is not the mode's skill set. One click must answer
  // "which of these does my mode actually bring".
  const flash = ROSTER.value.configured[0]
  const workfish = { name: 'dsh-work-fish', version: '0.2.1', title: 'Work Fish', description: 'board', hasClient: true, isBundle: true, enabled: true, tools: [] }
  flash.plugins = ['dsh-work-fish/core/skills']
  PLUGINS.push(workfish)
  const own = SKILL_PAYLOAD.value.skills.find((row) => row.name === 'office-docx')
  own.package = 'dsh-work-fish'
  try {
    const b = bootSkills()
    await settle(b.render)
    let tree = b.renderTab('skills')
    tree = await settle(b.render)
    const scopes = findByClass(tree, 'lt-btn')
      .filter((node) => /^(全部|本模式)/.test(flatten(node).text.join('')))
    const modeButton = scopes.find((node) => flatten(node).text.join('').startsWith('本模式'))
    assert.ok(modeButton, 'the scope switch is offered')
    assert.match(flatten(modeButton).text.join(''), /本模式 1/, 'it counts the mode-owned skill')

    modeButton.props.onClick()
    tree = await settle(b.render)
    const shown = findByClass(tree, 'lt-skill-name').map((node) => flatten(node).text.join(''))
    assert.deepEqual(shown, ['office-docx'], `only the mode skill is listed, got ${shown.join(',')}`)
    assert.ok(flatten(tree).text.includes('dsh-work-fish'), 'the row still says where it comes from')
  } finally {
    flash.plugins = []
    PLUGINS.pop()
    delete own.package
  }
})
