/**
 * Declared-tool discovery for installed plugin packages.
 *
 * The tool registry attributes a registration to the *scope* that made it, not
 * to the package that shipped it, so there is no runtime lookup for "which
 * tools does this package add". The declarations are readable in the package's
 * own JavaScript, though: a plugin gains a model-facing tool by calling
 * `defineTool({ name, … })` and registering the result, and the name is a
 * literal in every shipped bundle. This module extracts those literals.
 *
 * The scan is deliberately conservative: only object literals that are the
 * argument of `defineTool(…)` or a `register(…)` call are inspected, so an
 * unrelated `name:` in the same file cannot leak in. A package that builds its
 * tool names dynamically is reported as having no declared tools — the editor
 * still lets the operator mount the package.
 *
 * @module dsh-agents-modes/plugin-tools
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Files scanned per package; a bundle ships one or two entry files. */
const MAX_FILES = 80

/** Bytes scanned per package; keeps a market-sized dependency from stalling. */
const MAX_BYTES = 6_000_000

/** Tool names reported per package. */
const MAX_NAMES = 40

/** Directories never worth scanning for tool declarations. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'coverage', 'docs'])

/** A model-facing tool name: lowercase, digits, underscore, dash. */
const TOOL_NAME = /^[a-z][a-z0-9_-]{1,63}$/

/** Entry files declared by a manifest, in declaration order. */
function entryPoints(manifest) {
  const out = []
  const push = (value) => {
    if (typeof value === 'string' && value !== '') out.push(value)
  }
  push(manifest?.main)
  push(manifest?.module)
  const walk = (value) => {
    if (typeof value === 'string') push(value)
    else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item)
    }
  }
  walk(manifest?.exports)
  return out
}

/** Collect candidate JavaScript files, entry points first. */
async function candidateFiles(packageDir, manifest) {
  const seen = new Set()
  const files = []
  const add = (path) => {
    if (files.length >= MAX_FILES) return
    if (seen.has(path)) return
    seen.add(path)
    files.push(path)
  }

  for (const entry of entryPoints(manifest)) {
    if (/\.(?:mjs|cjs|js)$/.test(entry)) add(join(packageDir, entry))
  }

  const walk = async (dir, depth) => {
    if (depth > 4 || files.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.(?:mjs|cjs|js)$/.test(entry.name)) continue
      if (/\.(?:d\.ts|map|min\.js)$/.test(entry.name)) continue
      add(path)
    }
  }
  await walk(packageDir, 0)
  return files
}

/**
 * Index of the `}` that closes the `{` at `start`, skipping strings and
 * comments so a brace inside a description cannot end the object early.
 */
function objectEnd(source, start) {
  let depth = 0
  let quote = ''
  let line = false
  let block = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (line) {
      if (ch === '\n') line = false
      continue
    }
    if (block) {
      if (ch === '*' && next === '/') { block = false; i += 1 }
      continue
    }
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue }
    if (ch === '/' && next === '*') { block = true; i += 1; continue }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{') { depth += 1; continue }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Extract the literal tool names a source file declares. */
export function extractToolNames(source) {
  const names = []
  // Only a tool declaration counts: `defineTool({…})`, or an object handed to
  // `tools.register({…})`. A plain `register({ name: 'main' })` is a slot or a
  // service, and matching it would invent tools that never existed.
  const call = /(?:defineTool|\btools\s*\.\s*register)\s*\(\s*\{/g
  let match
  while ((match = call.exec(source)) !== null) {
    const brace = source.indexOf('{', match.index)
    if (brace < 0) continue
    const end = objectEnd(source, brace)
    if (end < 0) continue
    const body = source.slice(brace, end + 1)
    const name = /\bname\s*:\s*(['"])([^'"]{1,64})\1/.exec(body)
    if (name !== null && TOOL_NAME.test(name[2]) && !names.includes(name[2])) {
      names.push(name[2])
      if (names.length >= MAX_NAMES) break
    }
    call.lastIndex = end + 1
  }
  return names
}

/** Cache of package directory → declared tool names. */
const cache = new Map()

/**
 * Read the tool names one installed plugin package declares.
 *
 * @param packageDir absolute package directory.
 * @param manifest its parsed `package.json`.
 * @returns the declared names, in file order, deduplicated.
 */
export async function scanPluginTools(packageDir, manifest) {
  if (typeof packageDir !== 'string' || packageDir === '') return []
  const cached = cache.get(packageDir)
  if (cached !== undefined) return cached

  const names = []
  let budget = MAX_BYTES
  for (const file of await candidateFiles(packageDir, manifest)) {
    if (budget <= 0) break
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    budget -= text.length
    for (const name of extractToolNames(text)) {
      if (!names.includes(name)) names.push(name)
    }
    if (names.length >= MAX_NAMES) break
  }

  const result = Object.freeze(names.slice(0, MAX_NAMES))
  cache.set(packageDir, result)
  return result
}

/** Drop the scan cache; exported for tests and a config reload. */
export function resetPluginToolCache() {
  cache.clear()
}
