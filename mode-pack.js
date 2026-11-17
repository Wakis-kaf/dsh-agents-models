import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, mkdir, writeFile, lstat, mkdtemp } from 'node:fs/promises'
import { resolve, join, dirname, isAbsolute, relative, sep, delimiter } from 'node:path'
import { spawn } from 'node:child_process'

const FORMAT = 'dsh-mode-pack'
const MAX_BYTES = 24 * 1024 * 1024
const PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/
const excluded = /^(?:node_modules|\.git|\.codex|\.workbuddy|\.dsh|\.ssh|\.aws|credentials\.json|auth\.json|\.netrc|\.pypirc|\.env(?:\..*)?|\.npmrc|\.yarnrc.*|.*\.(?:pem|key|pfx)|coverage|\.DS_Store)$/i
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
const safePath = (path) => typeof path === 'string' && path.length < 240 && !path.includes('\\') && !/[<>:"|?*\x00-\x1f]/.test(path) && !isAbsolute(path) && path.split('/').every((p) => p !== '' && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))

/**
 * The npm package a preset row names.
 *
 * A mode may mount a subpath export (`dsh-work-fish/core/persona`) because that
 * is how a plugin ships an extra row without a second package. Dependencies are
 * still declared per package, so every dependency lookup goes through here.
 */
export const pluginPackage = (name) => {
  if (typeof name !== 'string') return name
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
}

export async function installedPackage(profileDir, name) {
  if (typeof name !== 'string' || !PACKAGE.test(name)) return null
  try {
    const dir = await realpath(join(profileDir, 'node_modules', ...name.split('/')))
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    if (manifest.name !== name) return null
    return { dir, manifest }
  } catch { return null }
}

async function resolveInstalledPackage(fromDir, name) {
  let current = fromDir
  while (true) {
    const result = await installedPackage(current, name)
    if (result) return result
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export async function captureFiles(root, budget = { bytes: 0, files: 0 }) {
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.test(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Cannot export symbolic link: ${relative(root, path)}`)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const name = relative(root, path).split(sep).join('/')
        if (!safePath(name)) throw new Error(`Unsupported package path: ${name}`)
        const info = await lstat(path)
        if (budget.bytes + info.size > MAX_BYTES || budget.files >= 1200) throw new Error('Local package exceeds export limit (24 MiB / 1200 files)')
        const bytes = await readFile(path)
        budget.bytes += bytes.length; budget.files++
        if (budget.bytes > MAX_BYTES) throw new Error('Local package exceeds export limit')
        files.push({ path: name, data: bytes.toString('base64'), sha256: hash(bytes) })
      }
    }
  }
  await walk(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function exportModePack({ modes, profileDir, packages = [], scope = 'mode', hostPackages = [] }) {
  if (!['mode', 'tools', 'parameters', 'plugins'].includes(scope)) throw new Error('Unknown export scope')
  const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  const dependencies = new Map()
  const budget = { bytes: 0, files: 0 }
  async function add(rawName, spec, fromDir = profileDir) {
    if (typeof rawName !== 'string' || rawName.startsWith('cordis:') || rawName.startsWith('dsh-agents-modes/')) return
    const name = pluginPackage(rawName)
    if (!PACKAGE.test(name)) throw new Error(`Unsupported package: ${rawName}`)
    let installed = await resolveInstalledPackage(fromDir, name) ?? await installedPackage(profileDir, name)
    if (!installed && /^(?:file:|link:)/.test(spec ?? '')) {
      try {
        const dir = await realpath(resolve(fromDir, spec.replace(/^(?:file:|link:)/, '')))
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
        if (manifest.name === name) installed = { dir, manifest }
      } catch { /* reported as a missing dependency below */ }
    }
    if (dependencies.has(name)) {
      if (installed && dependencies.get(name).version !== installed.manifest.version) throw new Error(`Multiple incompatible versions of ${name} cannot be embedded in one pack`)
      return
    }
    if (!installed) {
      if (hostPackages.includes(name)) {
        dependencies.set(name, { name, version: 'runtime', source: 'host' })
        return
      }
      throw new Error(`Cannot export missing dependency: ${name}`)
    }
    const { manifest, dir } = installed
    // pnpm's virtual store is not evidence that a package is local. Conversely,
    // a Git/URL package must travel with its bytes, not be guessed on npm.
    const local = /^(?:file:|link:|workspace:|git|https?:|github:)/.test(spec ?? '')
      || (typeof spec === 'string' && spec.includes('/'))
      || !inside(join(profileDir, 'node_modules'), dir)
    const dep = { name, version: manifest.version, source: local ? 'embedded' : 'registry',
      engines: manifest.engines, os: manifest.os, cpu: manifest.cpu,
      dependencies: manifest.dependencies ?? {}, peerDependencies: manifest.peerDependencies ?? {},
      optionalDependencies: manifest.optionalDependencies ?? {}, hasScripts: Object.keys(manifest.scripts ?? {}).length > 0 }
    dependencies.set(name, dep)
    if (local) {
      dep.files = await captureFiles(dir, budget)
      for (const [child, range] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
        if (manifest.optionalDependencies?.[child] && !/^(?:file:|link:|workspace:)/.test(range)) continue
        await add(child, range, dir)
      }
    }
  }
  for (const name of new Set(packages)) await add(name, profile.dependencies?.[name] ?? profile.devDependencies?.[name])
  const selected = modes.map((mode) => scope === 'mode' ? mode : {
    id: mode.id, name: mode.name,
    ...(scope === 'tools' ? { tools: mode.tools, allowedTools: mode.allowedTools, disabledTools: mode.disabledTools } : {}),
    ...(scope === 'parameters' ? { config: mode.config } : {}),
    ...(scope === 'plugins' ? { plugins: mode.plugins } : {}),
  })
  return validateModePack({ format: FORMAT, version: 1, scope, exportedAt: new Date().toISOString(),
    compatibility: { platform: process.platform, arch: process.arch, node: process.versions.node },
    modes: selected, dependencies: [...dependencies.values()] })
}

export function validateModePack(raw) {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '') > MAX_BYTES * 1.5) throw new Error('Pack is too large')
  if (raw?.format !== FORMAT || raw.version !== 1) throw new Error('Unsupported pack format or version')
  if (!['mode', 'tools', 'parameters', 'plugins'].includes(raw.scope)) throw new Error('Unknown pack scope')
  if (!Array.isArray(raw.modes) || !raw.modes.length || raw.modes.length > 100 || !Array.isArray(raw.dependencies) || raw.dependencies.length > 200) throw new Error('Invalid pack contents')
  if (raw.resources !== undefined && !Array.isArray(raw.resources)) throw new Error('Invalid skill resources')
  if ((raw.resources?.length ?? 0) > 100) throw new Error('Too many skill resources')
  const fileBudget = { bytes: 0, files: 0 }
  const resourceNames = new Set()
  for (const resource of raw.resources ?? []) {
    if (typeof resource?.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resource.name) || resourceNames.has(resource.name) || !Array.isArray(resource.files) || !resource.files.some((file) => file.path === 'SKILL.md')) throw new Error('Invalid or duplicate skill resource')
    resourceNames.add(resource.name)
    validateAssetFiles(resource.files, fileBudget)
  }
  const ids = new Set()
  for (const mode of raw.modes) {
    if (typeof mode?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(mode.id) || ids.has(mode.id)) throw new Error('Invalid or duplicate mode id')
    ids.add(mode.id)
    for (const key of ['tools', 'plugins', 'allowedTools', 'disabledTools']) {
      if (mode[key] !== undefined && (!Array.isArray(mode[key]) || mode[key].length > 500 || mode[key].some((v) => typeof v !== 'string' || v.length > 200))) throw new Error(`Invalid ${key}`)
    }
    for (const key of ['allowedTools', 'disabledTools']) if (mode[key]?.some((name) => !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(name))) throw new Error(`Invalid ${key}`)
    if (mode.config !== undefined && (!mode.config || typeof mode.config !== 'object' || Array.isArray(mode.config))) throw new Error('Invalid mode parameters')
    if (mode.plugins?.some((name) => !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(name))) throw new Error('Invalid plugin name')
  }
  const seen = new Set()
  for (const dep of raw.dependencies) {
    if (typeof dep?.name !== 'string' || !PACKAGE.test(dep.name) || typeof dep.version !== 'string' || !(dep.source === 'host' ? dep.version === 'runtime' : VERSION.test(dep.version)) || seen.has(dep.name) || !['embedded', 'registry', 'host'].includes(dep.source)) throw new Error('Invalid package dependency')
    seen.add(dep.name)
    if (dep.source === 'embedded') {
      if (!Array.isArray(dep.files) || !dep.files.length) throw new Error('Embedded package has no files')
      validateAssetFiles(dep.files, fileBudget)
      const manifestFile = dep.files.find((file) => file.path === 'package.json')
      if (!manifestFile) throw new Error('Embedded package has no manifest')
      const manifest = JSON.parse(Buffer.from(manifestFile.data, 'base64').toString('utf8'))
      if (manifest.name !== dep.name || manifest.version !== dep.version) throw new Error('Package manifest does not match dependency')
      // Use verified bytes, not importer-supplied dependency metadata.
      dep.dependencies = manifest.dependencies ?? {}
      dep.optionalDependencies = manifest.optionalDependencies ?? {}
      dep.peerDependencies = manifest.peerDependencies ?? {}
      dep.engines = manifest.engines; dep.os = manifest.os; dep.cpu = manifest.cpu
      dep.hasScripts = Object.keys(manifest.scripts ?? {}).length > 0
    }
  }
  return raw
}

export async function analyzeModePack(raw, { profileDir, modes, catalog, hostPackages = [], validateModes, target, reserved = [] }) {
  const pack = validateModePack(structuredClone(raw))
  if (pack.scope !== 'mode' && pack.modes.length !== 1) throw new Error('Partial packs must contain exactly one source mode')
  const errors = []; const warnings = []
  if (validateModes) {
    const checked = validateModes(pack.scope === 'parameters' ? pack.modes.map((mode) => ({ ...mode, tools: Object.keys(mode.config ?? {}) })) : pack.modes)
    if (checked.error) errors.push(checked.error)
  }
  if (pack.scope !== 'mode' && target !== undefined) {
    const destination = modes.find((mode) => mode.id === target)
    if (!destination) errors.push('Select a valid target mode')
    else if (pack.scope === 'parameters') for (const id of Object.keys(pack.modes[0].config ?? {})) {
      if (!(destination.tools ?? []).includes(id)) errors.push(`Target mode must mount ${id} before importing its parameters`)
    }
  }
  const known = new Set(catalog.map((row) => row.id))
  for (const mode of pack.modes) {
    for (const id of mode.tools ?? []) {
      const row = catalog.find((r) => r.id === id)
      if (!known.has(id) || row?.hostOnly) errors.push(`Unsupported tool row: ${id}`)
      for (const other of row?.exclusiveWith ?? []) if (mode.tools.includes(other)) errors.push(`Conflicting tool rows: ${id}, ${other}`)
    }
    // A mode can mount a subpath export, but a dependency is always the package.
    const required = new Set((mode.plugins ?? []).map((name) => pluginPackage(name)))
    for (const id of mode.tools ?? []) {
      const row = catalog.find((item) => item.id === id)
      const visit = (value) => {
        if (value?.group) for (const child of value.config ?? []) visit(child)
        else if (typeof value?.name === 'string' && !value.name.startsWith('cordis:') && !value.name.startsWith('dsh-agents-modes/')) required.add(pluginPackage(value.name))
      }
      if (typeof row?.row === 'object') visit(row.row)
      else if (row?.pkg && !row.pkg.startsWith('dsh-agents-modes/') && !row.pkg.startsWith('cordis:')) required.add(pluginPackage(row.pkg))
    }
    for (const name of required) if (!pack.dependencies.some((dep) => dep.name === name)) {
      if (!hostPackages.includes(name) && !await installedPackage(profileDir, name)) errors.push(`Missing dependency declaration: ${name}`)
    }
  }
  const dependencies = []
  for (const dep of pack.dependencies) {
    const installed = await installedPackage(profileDir, dep.name)
    const status = dep.source === 'host' ? 'host' : installed ? installed.manifest.version === dep.version ? 'installed' : 'version-conflict' : dep.source === 'embedded' ? 'bundled' : 'download'
    if (dep.source === 'host' && !hostPackages.includes(dep.name)) errors.push(`Host capability unavailable: ${dep.name}`)
    if (dep.source === 'host') warnings.push(`${dep.name} is provided by DSH; its version is not pinned in this pack`)
    if (dep.source === 'embedded' && status === 'installed') warnings.push(`${dep.name}: same version is already installed; embedded bytes will not overwrite it`)
    if (status === 'version-conflict') errors.push(`Version conflict: ${dep.name} (installed ${installed.manifest.version}, requested ${dep.version})`)
    for (const [key, current] of [['os', process.platform], ['cpu', process.arch]]) {
      const values = dep[key]
      if (Array.isArray(values) && (values.includes(`!${current}`) || (values.some((v) => !v.startsWith('!')) && !values.includes(current) && !values.includes('any')))) errors.push(`Incompatible ${key}: ${dep.name}`)
    }
    if (dep.engines?.node) warnings.push(`${dep.name} requires Node ${dep.engines.node}; npm checks compatibility during install`)
    if (dep.hasScripts) warnings.push(`${dep.name}: install scripts are disabled; native builds may require manual setup`)
    for (const [child, range] of Object.entries({ ...dep.dependencies, ...dep.optionalDependencies })) {
      if (!PACKAGE.test(child) || typeof range !== 'string') { errors.push(`Invalid dependency in ${dep.name}`); continue }
      if (/^(?:file:|link:|workspace:)/.test(range) && !pack.dependencies.some((item) => item.name === child && item.source === 'embedded')) errors.push(`Missing local dependency: ${child}`)
      else if (!pack.dependencies.some((item) => item.name === child)) warnings.push(`${dep.name} needs ${child}@${range} (resolved by npm)`)
    }
    for (const [child, range] of Object.entries(dep.peerDependencies ?? {})) warnings.push(`Peer requirement: ${child}@${range}`)
    dependencies.push({ name: dep.name, version: dep.version, source: dep.source, status })
  }
  if (pack.compatibility?.platform !== process.platform || pack.compatibility?.arch !== process.arch) warnings.push('Different source platform/architecture; native binary compatibility is not guaranteed')
  warnings.push('Shared packs may contain executable plugin code, instructions, credentials or machine-specific paths. Review the source before importing.')
  return { pack, errors: [...new Set(errors)], warnings: [...new Set(warnings)], dependencies,
    conflicts: pack.modes.filter((mode) => (reserved.includes(mode.id) || modes.some((old) => old.id === mode.id))).map((mode) => mode.id) }
}

export function mergePackModes(pack, current, { target, conflict = 'copy', reserved = [] } = {}) {
  if (!['copy', 'replace', 'skip'].includes(conflict)) throw new Error('Invalid conflict decision')
  if (pack.scope !== 'mode' && pack.modes.length !== 1) throw new Error('Partial packs must contain exactly one source mode')
  const next = structuredClone(current)
  for (const incoming of pack.modes) {
    if (pack.scope !== 'mode') {
      const mode = next.find((item) => item.id === target)
      if (!mode) throw new Error('Select a target mode for partial import')
      const fields = pack.scope === 'tools' ? ['tools', 'allowedTools', 'disabledTools'] : pack.scope === 'parameters' ? ['config'] : ['plugins']
      for (const field of fields) {
        if (incoming[field] !== undefined) mode[field] = structuredClone(incoming[field])
        else delete mode[field]
      }
      continue
    }
    let value = structuredClone(incoming)
    const index = next.findIndex((mode) => mode.id === value.id)
    if (index >= 0 || reserved.includes(value.id)) {
      if (conflict === 'skip') continue
      if (conflict === 'replace') {
        if (index < 0) throw new Error(`Cannot replace a mode owned by another plugin: ${value.id}`)
        next[index] = value; continue
      }
      const base = value.id; let n = 2
      while (reserved.includes(value.id) || next.some((mode) => mode.id === value.id)) value.id = `${base}-${n++}`
      value.name = `${value.name ?? base} (${value.id})`
    }
    next.push(value)
  }
  return next
}

// No shell interpolation and no lifecycle scripts from untrusted packages.
export async function installPackDependencies(plan, profileDir, consent) {
  const pending = plan.dependencies.filter((dep) => dep.status === 'bundled' || dep.status === 'download')
  if (!pending.length) return
  if (!consent) throw new Error('Dependency installation requires explicit confirmation')
  const profileRoot = await realpath(profileDir)
  const base = join(profileRoot, '.agent-mode-imports')
  try {
    const info = await lstat(base)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Import directory must not contain symbolic links')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(base)
  }
  if (!inside(profileRoot, await realpath(base))) throw new Error('Import directory escapes profile')
  // A unique staging directory makes failed installations retryable without
  // deleting or overwriting user files from an earlier attempt.
  const root = await mkdtemp(join(base, 'pack-'))
  const locations = new Map(plan.pack.dependencies.filter((dep) => dep.source === 'embedded')
    .map((dep) => [dep.name, join(root, Buffer.from(dep.name).toString('hex'))]))
  for (const dep of plan.pack.dependencies.filter((item) => item.source === 'embedded')) {
    const dir = locations.get(dep.name)
    await mkdir(dir)
    for (const file of dep.files) {
      const path = join(dir, ...file.path.split('/'))
      if (!inside(dir, path)) throw new Error('Unsafe import path')
      await mkdir(dirname(path), { recursive: true })
      let bytes = Buffer.from(file.data, 'base64')
      if (file.path === 'package.json') {
        const manifest = JSON.parse(bytes.toString('utf8'))
        for (const field of ['dependencies', 'optionalDependencies']) {
          for (const [child, range] of Object.entries(manifest[field] ?? {})) {
            if (/^(?:file:|link:|workspace:)/.test(range)) {
              if (!locations.has(child)) throw new Error(`Missing embedded dependency: ${child}`)
              manifest[field][child] = `file:${locations.get(child).split(sep).join('/')}`
            }
          }
        }
        bytes = Buffer.from(JSON.stringify(manifest, null, 2))
      }
      await writeFile(path, bytes, { flag: 'wx' })
    }
  }
  const specs = pending.map((dep) => dep.source === 'embedded' ? locations.get(dep.name) : `${dep.name}@${dep.version}`)
  const { cli, manager } = await findPackageManager(profileRoot)
  const args = manager === 'pnpm'
    ? ['add', '--ignore-scripts', '--save-exact', '--config.engine-strict=true', '--', ...specs]
    : ['install', '--ignore-scripts', '--engine-strict', '--save-exact', '--no-audit', '--no-fund', '--', ...specs]
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: profileDir, windowsHide: true, env: { ...process.env, npm_config_update_notifier: 'false', PNPM_DISABLE_SELF_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Dependency installation timed out; inspect profile package.json before retrying')) }, 120_000)
    const collect = (data) => { output = (output + data).slice(-6000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? done() : reject(new Error(`${manager} failed (${code}): ${output}`)) })
  })
  for (const dep of pending) {
    const installed = await installedPackage(profileDir, dep.name)
    if (installed?.manifest.version !== dep.version) throw new Error(`Installation verification failed: ${dep.name}`)
  }
}

export async function findPackageManager(profileDir) {
  const exists = async (path) => { try { return (await lstat(path)).isFile() } catch { return false } }
  const manager = await exists(join(profileDir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
  const bins = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean)
  const candidates = []
  if (manager === 'npm' && process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath)) candidates.push(process.env.npm_execpath)
  for (const bin of bins) {
    for (const leaf of manager === 'pnpm' ? ['pnpm.cjs', 'pnpm.mjs'] : ['npm-cli.js']) {
      candidates.push(join(bin, 'node_modules', manager, 'bin', leaf))
      candidates.push(resolve(bin, '..', 'lib', 'node_modules', manager, 'bin', leaf))
      candidates.push(resolve(bin, '..', '..', 'node', 'node_modules', manager, 'bin', leaf))
    }
  }
  for (const cli of candidates) if (await exists(cli)) return { cli, manager }
  throw new Error(`${manager} CLI is unavailable; install dependencies manually, then analyze again`)
}

export function validateAssetFiles(files, budget = { bytes: 0, files: 0 }) {
  if (!Array.isArray(files) || !files.length) throw new Error('Asset files must be a non-empty list')
  const paths = new Set()
  for (const file of files) {
    if (!safePath(file?.path) || paths.has(file.path.toLowerCase()) || typeof file.data !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error('Unsafe or duplicate package file')
    paths.add(file.path.toLowerCase())
    const bytes = Buffer.from(file.data, 'base64')
    budget.bytes += bytes.length; budget.files++
    if (budget.bytes > MAX_BYTES || budget.files > 1200 || hash(bytes) !== file.sha256) throw new Error('Package integrity or size check failed')
  }
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) {
      parts.pop()
      if (paths.has(parts.join('/'))) throw new Error('Package file conflicts with directory')
    }
  }
  return files
}
