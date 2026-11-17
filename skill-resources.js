import { createHash } from 'node:crypto'
import { lstat, readFile, mkdir, writeFile, readdir, realpath, mkdtemp, rename, rmdir } from 'node:fs/promises'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { captureFiles, validateAssetFiles } from './mode-pack.js'
import { renderSkillFile } from './skill-store.js'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const validName = (name) => typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)

export async function exportSkillResources(names, registry) {
  const resources = []
  const budget = { bytes: 0, files: 0 }
  for (const name of new Set(names)) {
    if (!validName(name)) throw new Error(`Unsupported portable skill name: ${name}`)
    const skill = await registry?.get?.(name, {})
    if (!skill) throw new Error(`Missing skill: ${name}`)
    let root = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined
    if (!root && typeof skill.path === 'string') {
      const info = await lstat(skill.path)
      root = info.isDirectory() ? skill.path : dirname(skill.path)
    }
    let files
    if (root) files = await captureFiles(await realpath(root), budget)
    else {
      const bytes = Buffer.from(renderSkillFile(skill))
      budget.bytes += bytes.length; budget.files++
      files = [{ path: 'SKILL.md', data: bytes.toString('base64'), sha256: digest(bytes) }]
    }
    if (budget.bytes > 24 * 1024 * 1024 || budget.files > 1200) throw new Error('Skill resources exceed export limits')
    validateAssetFiles(files)
    if (!files.some((file) => file.path === 'SKILL.md')) throw new Error(`Skill directory lacks SKILL.md: ${name}`)
    resources.push({ name, files, ...(root ? {} : { instructionsOnly: true }) })
  }
  return resources
}

export async function analyzeSkillResources(resources, root, registry) {
  const results = []
  for (const resource of resources ?? []) {
    if (!validName(resource.name)) throw new Error('Invalid skill name')
    validateAssetFiles(resource.files)
    const dir = join(root, resource.name)
    let status = 'bundled'
    try {
      await lstat(dir)
      status = 'installed'
      for (const file of resource.files) {
        const bytes = await readFile(join(dir, ...file.path.split('/')))
        if (digest(bytes) !== file.sha256) { status = 'conflict'; break }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; if (status === 'installed') status = 'conflict' }
    const shadowed = status === 'bundled' && !!await registry?.get?.(resource.name, {})
    results.push({ name: resource.name, status, shadowed, instructionsOnly: resource.instructionsOnly === true, files: resource.files.length })
  }
  return results
}

export async function installSkillResources(resources, plan, root, consent) {
  const pending = plan.filter((item) => item.status === 'bundled')
  if (!pending.length) return
  if (!consent) throw new Error('Installing skill resources requires explicit confirmation')
  await mkdir(root, { recursive: true })
  const realRoot = await realpath(root)
  for (const item of pending) {
    const resource = resources.find((row) => row.name === item.name)
    if (!resource || !validName(resource.name)) throw new Error('Missing skill resource')
    validateAssetFiles(resource.files)
    const dir = join(realRoot, resource.name)
    // Never merge into or overwrite an existing skill, including a symlink.
    const names = await readdir(realRoot)
    if (names.some((name) => name.toLowerCase() === item.name.toLowerCase())) throw new Error(`Skill already exists: ${item.name}`)
    const stage = await mkdtemp(join(realRoot, '.mode-skill-import-'))
    const payload = join(stage, 'payload')
    await mkdir(payload)
    for (const file of resource.files) {
      const target = join(payload, ...file.path.split('/'))
      const rel = relative(payload, target)
      if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Skill path escapes target')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(file.data, 'base64'), { flag: 'wx' })
    }
    try { await lstat(dir); throw new Error(`Skill already exists: ${item.name}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await rename(payload, dir)
    await rmdir(stage)
  }
}
