// Measure the REAL layout of the rendered shot with headless Chrome.
//
// "It looks cramped" is not evidence. This asks the browser for the boxes it
// actually laid out and prints the gaps in CSS pixels, so a spacing fix can be
// proven rather than eyeballed.
//
// Run with: node test/measure-shot.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const shots = join(here, 'shots')

const probe = `
<script>
window.addEventListener('load', () => {
  const out = []
  const box = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null }
  const gap = (a, b) => (a && b ? (b.left - a.right).toFixed(1) : '?')
  const name = box('.lt-ext-name'), ver = box('.lt-ext-ver'), badge = box('.lt-badge')
  out.push('name.right=' + (name && name.right.toFixed(1)) + ' ver.left=' + (ver && ver.left.toFixed(1)) + ' GAP=' + gap(name, ver))
  out.push('ver.right=' + (ver && ver.right.toFixed(1)) + ' badge.left=' + (badge && badge.left.toFixed(1)) + ' GAP=' + gap(ver, badge))
  const label = box('.lt-spend-label'), val = box('.lt-spend-value')
  out.push('label.right=' + (label && label.right.toFixed(1)) + ' value.left=' + (val && val.left.toFixed(1)) + ' GAP=' + gap(label, val))
  const pill = box('.lt-spend')
  out.push('pill.w=' + (pill && pill.width.toFixed(1)) + ' pill.h=' + (pill && pill.height.toFixed(1)))
  out.push('moduleTabs=' + document.querySelectorAll('.lt-module-tab').length + ' subTabs=' + document.querySelectorAll('.lt-viewtab').length)
  out.push('cards=' + document.querySelectorAll('.lt-ext-card').length)
  out.push('viewport=' + window.innerWidth + 'x' + window.innerHeight + ' body=' + document.body.getBoundingClientRect().width.toFixed(0))
  const chain = ['.lt-control-center', '.lt-module-panel', '.lt-tools-module', '.lt-tools-body', '.lt-ext-list', '.lt-ext-card']
  out.push(chain.map(function (sel) {
    const b = box(sel)
    return sel + '=' + (b ? (b.width.toFixed(0) + 'x' + b.height.toFixed(0) + '@' + b.left.toFixed(0)) : 'n/a')
  }).join('\\n'))
  document.getElementById('probe-out').textContent = out.join('\\n')
})
</script>
`

const html = await readFile(join(shots, 'extensions.html'), 'utf8')
const withProbe = html
  .replace('</body>', '<pre id="probe-out">pending</pre>' + probe + '</body>')
await writeFile(join(shots, 'extensions-probe.html'), withProbe, 'utf8')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const { stdout } = await run(chrome, [
  '--headless=new',
  '--disable-gpu',
  // Same window as the screenshot, or the probe measures a different layout
  // (the default 764px viewport made a full-width card look 697px narrow).
  '--window-size=1180,1200',
  '--virtual-time-budget=4000',
  '--dump-dom',
  `file:///${join(shots, 'extensions-probe.html').replace(/\\/g, '/')}`,
], { maxBuffer: 32 * 1024 * 1024 })

const match = /<pre id="probe-out">([\s\S]*?)<\/pre>/.exec(stdout)
console.log(match === null ? 'probe did not run' : match[1])
