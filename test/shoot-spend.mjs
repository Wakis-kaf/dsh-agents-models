// Render the two new surfaces to a real PNG with a real browser.
//
// Reading the JSX is not "having looked at it": this loads the shipped bundle,
// renders it against a fake host, serializes the resulting tree with the bundle's
// OWN stylesheet, and lets headless Chrome paint it. The image is the evidence.
//
// Run with: node test/shoot-spend.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const shots = join(here, 'shots')
await mkdir(shots, { recursive: true })

const source = await readFile(join(root, 'client.js'), 'utf8')

// ── a hook runtime good enough to render one tree ──────────────────────────
function createReact() {
  const hooks = []
  let cursor = 0
  const react = {
    createElement(type, props, ...children) {
      const flat = children.length === 1 && Array.isArray(children[0]) ? children[0] : children
      return { type, props: props ?? {}, children: flat.flat(Infinity).filter((c) => c != null) }
    },
    useState(initial) {
      const i = cursor++
      if (i >= hooks.length) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = hooks[i]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
      }]
    },
    useEffect(fn) {
      const i = cursor++
      const slot = hooks[i] ?? (hooks[i] = { ran: false })
      if (slot.ran) return
      slot.ran = true
      fn()
    },
    useCallback(fn) { cursor += 1; return fn },
    useMemo(fn) { cursor += 1; return fn() },
  }
  return { react, begin() { cursor = 0 } }
}

let captured
const styleEls = []
const sandbox = {
  window: { __ModuleLoader__: { load: (def) => { captured = def } }, setInterval: () => 0, clearInterval: () => {} },
  document: { head: { append: (el) => styleEls.push(el) }, querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }) },
  console,
  structuredClone,
  setTimeout,
  clearTimeout,
  AbortController,
  URL,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

// NOTE: the stylesheet is captured AFTER `apply()` runs, further down — the
// bundle installs it from inside `apply`, so reading it here would yield "".

// ── the fake host ──────────────────────────────────────────────────────────
const EXTENSIONS = {
  ok: true,
  value: {
    extensions: [{
      id: 'conversation-spend',
      nameZh: '对话消耗展示',
      nameEn: 'Conversation spend',
      version: '1.0.0',
      descZh: '在会话里显示这次对话花了多少：WorkBuddy 按积分，官方通道按元（≈）。读数来自会话日志与本机台账，重启与切换会话都不会丢。',
      descEn: 'Shows what this conversation cost.',
      defaultOn: true,
      enabled: true,
      featuresZh: [
        '积分台账落盘：重启后仍显示，不再归零',
        '官方通道按公开单价折算成元，标注「≈」',
        '缓存命中按 hit 价、未命中按 miss 价分档',
        '只读本地数据，不额外消耗任何积分',
      ],
      featuresEn: ['a', 'b', 'c', 'd'],
    }],
    stateBroken: false,
    ledger: {
      path: 'C:\\Users\\EDY\\.dsh\\plugins-data\\dsh-agents-modes\\session-spend.json',
      exists: true,
      sessions: [
        { sessionId: 'session-d45e8969-cc0a-49c4-9933-9e98b96937a2', credit: 18.46, updatedAt: 1794909543583 },
        { sessionId: 'session-4f38c9ae-2e47-4873-8c8c-6883ea1053c4', credit: 14.05, updatedAt: 1794909521876 },
      ],
      total: 2,
    },
    priceVersion: '2026-08-17',
    connector: { mounted: true, base: 'http://127.0.0.1:50000' },
  },
}

const SPEND = {
  ok: true,
  value: {
    sessionId: 'session-x',
    spend: { credit: 18.46, cny: 3.42, requests: 615, creditBilled: true, priceVersion: '2026-08-17' },
    priceVersion: '2026-08-17',
  },
}

sandbox.fetch = (path) => {
  const payload = path === '/api/agent-modes/extensions'
    ? EXTENSIONS
    : path === '/api/agent-modes/spend'
      ? SPEND
      : { ok: false, error: 'unused' }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

const hooks = createReact()
const module = captured.factory((specifier) => {
  if (specifier === 'react') return hooks.react
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

const t = (key) => (dictionaries[0]?.dict?.zh ?? {})[key] ?? key

/** The bundle's own stylesheet, installed by `apply()` just above. */
const CSS = styleEls[0]?.textContent ?? ''
if (CSS === '') throw new Error('the bundle installed no stylesheet — the shot would be unstyled')

// ── serialize a rendered tree to HTML with the bundle's own class names ────
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
const ATTR_SKIP = /^(key|on[A-Z]|children|ref|dangerouslySetInnerHTML)$/

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function styleOf(style) {
  return Object.entries(style ?? {})
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(';')
}

function html(node) {
  if (node == null || node === false) return ''
  if (Array.isArray(node)) return node.map(html).join('')
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (typeof node !== 'object') return ''
  if (typeof node.type === 'function') {
    return html(node.type({ ...node.props, children: node.children }))
  }
  const attrs = []
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (ATTR_SKIP.test(key) || value == null || value === false) continue
    if (key === 'className') attrs.push(`class="${esc(value)}"`)
    else if (key === 'style' && typeof value === 'object') attrs.push(`style="${esc(styleOf(value))}"`)
    else if (key === 'data' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) attrs.push(`data-${dk}="${esc(dv)}"`)
    } else if (typeof value === 'boolean') attrs.push(key)
    else if (typeof value !== 'function' && typeof value !== 'object') attrs.push(`${key}="${esc(value)}"`)
  }
  const tag = node.type
  const open = `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`
  if (VOID.has(tag)) return open
  return `${open}${html(node.children)}</${tag}>`
}

// ── 1. 工具管理 → 扩展管理 ─────────────────────────────────────────────────
const pageSpec = registrations.find((r) => r.spec.name === 'main')
function renderPage() {
  hooks.begin()
  return pageSpec.component(pageSpec.spec.inject())
}

let tree = renderPage()
for (let pass = 0; pass < 30; pass += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  tree = renderPage()
  if (html(tree).includes('lt-ext-card')) break
}

const findTabs = (node, out = []) => {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => findTabs(n, out)); return out }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('lt-module-tab')) out.push(node)
  if (typeof node.type === 'function') findTabs(node.type({ ...node.props, children: node.children }), out)
  else findTabs(node.children, out)
  return out
}
hooks.begin()
const tab = findTabs(renderPage()).find((node) => node.props['data-module-tab'] === 'tools')
tab.props.onClick()
tree = renderPage()
for (let pass = 0; pass < 30; pass += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  tree = renderPage()
  if (html(tree).includes('lt-ext-card')) break
}
const toolsHtml = html(tree)

// ── 2. 会话内读数 ──────────────────────────────────────────────────────────
// The component's own effect fills this state from `/api/agent-modes/spend`, so
// the shot has to let that effect settle — otherwise the pill would be missing
// for exactly the reason it exists to fix.
const spendSpec = registrations.find((r) => r.spec.name === 'conversation.composer.dock')
function renderPill() {
  hooks.begin()
  return spendSpec.component({ t, sessionId: 'session-x' })
}
let pill = renderPill()
for (let pass = 0; pass < 30; pass += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  pill = renderPill()
  if (html(pill).includes('lt-spend-value')) break
}
const pillHtml = html(pill)
console.log('pill markup:', pillHtml)

const doc = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>extensions</title><style>
/* The host's dark-theme tokens. The bundle paints with var(--dsw-alias-*), which
   a standalone page has to define or every surface falls back to browser default
   (the reason the first shot was unstyled black-on-black). */
:root {
  --dsw-alias-bg-base:#1b1c1f; --dsw-alias-bg-layer-1:#212226; --dsw-alias-bg-layer-2:#26272b;
  --dsw-alias-label-primary:#e8e9ec; --dsw-alias-label-secondary:#a8adb6; --dsw-alias-label-tertiary:#7d838d;
  --dsw-alias-border-l1:#2c2d32; --dsw-alias-border-l2:#35363c; --dsw-alias-border-l3:#43454c;
  --dsw-alias-interactive-bg-hover:#2e3036; --dsw-focus-ring-color:#4c8bf5;
}
${CSS}
html,body { margin:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
  font-family:"Segoe UI","Microsoft YaHei",sans-serif; font-size:13px; }
.lt-control-center { min-height:0; }
.dock { display:flex; align-items:center; gap:10px; padding:10px 16px; border-top:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary); font-size:12px; }
.dock .hostpill { color:var(--dsw-alias-label-tertiary); }
</style></head><body>
<div class="shot">${toolsHtml}</div>
<div class="dock"><span class="hostpill">3 轮 · 615 步 · 165,981,353 token</span>${pillHtml}</div>
</body></html>`

await writeFile(join(shots, 'extensions.html'), doc, 'utf8')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const out = join(shots, 'extensions.png')
await run(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1180,1200',
  `--screenshot=${out}`,
  `file:///${join(shots, 'extensions.html').replace(/\\/g, '/')}`,
])
console.log('rendered', out)
