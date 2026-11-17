/**
 * Skill categories and skill packs — the storage half.
 *
 * The skill *catalog* belongs to the host: `@deepseek-ai/dsh-skill` merges every
 * provider and this plugin never writes into a bundled or project skill. What
 * this module owns is the one thing the host has no opinion about — which
 * category an operator files a skill under — plus the portable wrapper that
 * carries a skill to another machine.
 *
 * Two records, both plain JSON:
 *
 * - the category store at `~/.dsh/plugins-data/dsh-agents-modes/skill-categories.json`,
 *   holding the category list and the per-skill assignment;
 * - a skill pack, `{ format, version, skills: [...] }`, which the page downloads
 *   and uploads. A pack carries the body only: frontmatter is regenerated on
 *   import by the same writer `/skill-save` uses, so the file the loader parses
 *   and the file this plugin wrote cannot drift.
 *
 * Categories are keyed by id and resolved against the live catalog on every
 * read, so a skill that vanished keeps its assignment (harmless) and a skill
 * that appeared lands in an auto-derived category instead of an undefined one.
 *
 * @module dsh-agents-modes/skill-store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Marker a pack must carry, so an unrelated JSON file is rejected loudly. */
export const PACK_FORMAT = 'dsh-skill-pack'

/** Bumped only when an older reader would misread a newer pack. */
export const PACK_VERSION = 1

/** Category every skill falls into when nothing else matches. */
export const DEFAULT_CATEGORY = 'other'

/**
 * The categories a fresh install starts with.
 *
 * These are *buckets a skill plausibly belongs to*, not a taxonomy of the
 * catalog: an operator can rename, reorder, add, or delete any of them, and the
 * assignment is what actually decides the grouping. The split follows what this
 * machine's real catalog actually contains -- one huge Unity package plus a
 * handful of small areas -- so no bucket opens with twenty rows in it.
 */
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'unity', zh: 'Unity 开发', en: 'Unity', order: 10 },
  { id: 'ui', zh: '界面', en: 'UI', order: 20 },
  { id: 'graphics', zh: '渲染与美术', en: 'Graphics & art', order: 30 },
  { id: 'performance', zh: '性能优化', en: 'Performance', order: 40 },
  { id: 'multiplayer', zh: '联机与语音', en: 'Multiplayer & voice', order: 50 },
  { id: 'game', zh: '游戏与运营', en: 'Game & live-ops', order: 60 },
  { id: 'office', zh: 'Office 文档', en: 'Office', order: 70 },
  { id: 'workflow', zh: '流程与验证', en: 'Workflow', order: 80 },
  { id: DEFAULT_CATEGORY, zh: '未分类', en: 'Uncategorised', order: 90 },
])

/** Category ids are the same lowercase-dash grammar as skill names. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Name prefixes that decide a bucket on their own, checked in order. */
const NAME_RULES = Object.freeze([
  ['ui', ['ui', 'ui-']],
  ['office', ['office']],
  ['performance', ['optimize-']],
  ['multiplayer', ['setup-multiplayer', 'setup-vivox']],
  ['graphics', ['urp-', 'shader-', 'sprite-', 'physics-', 'validate-urp']],
  ['game', ['build-live-game', 'levelplay', 'implement-in-app']],
  ['workflow', ['verify-', 'diagnose-']],
])

/**
 * Best-effort category for a skill nobody has filed yet.
 *
 * Deliberately crude and easily overridden: the operator's assignment always
 * wins, and this only exists so the first render is grouped rather than one
 * undifferentiated list.
 *
 * Name beats provider. A package that ships a hundred Unity skills names them by
 * area while its provider is one string, so keying on provider first puts the UI,
 * Office, and performance skills into the same Unity bucket -- which is the flat
 * list this feature exists to break up.
 *
 * @param skill a catalog summary (`name`, `provider`, `description`).
 * @returns a category id from {@link DEFAULT_CATEGORIES}.
 */
export function autoCategory(skill) {
  const name = typeof skill?.name === 'string' ? skill.name.toLowerCase() : ''
  for (const [category, prefixes] of NAME_RULES) {
    if (prefixes.some((prefix) => name === prefix || name.startsWith(prefix))) return category
  }
  const provider = typeof skill?.provider === 'string' ? skill.provider.toLowerCase() : ''
  if (provider.includes('unity')) return 'unity'
  if (name.startsWith('unity') || name.startsWith('localization') || name.startsWith('new-unity')
    || name.startsWith('initialize-')) return 'unity'
  if (provider.includes('acl')) return 'workflow'
  return DEFAULT_CATEGORY
}

/** Absolute path of the category store for the current host home. */
export function storePath(home) {
  const root = home ?? process.env.DSH_HOME?.trim() ?? join(homedir(), '.dsh')
  return join(root, 'plugins-data', 'dsh-agents-modes', 'skill-categories.json')
}

/** Absolute path of the writable skill root (`~/.dsh/skills`). */
export function skillsRoot(home) {
  const root = home ?? process.env.DSH_HOME?.trim() ?? join(homedir(), '.dsh')
  return join(root, 'skills')
}

/**
 * Coerce a stored record into the shape the rest of the module assumes.
 *
 * A hand-edited or half-written store must not take the page down, so every
 * field is repaired rather than trusted: an unknown category id is dropped, a
 * non-string assignment is dropped, and the default category is always present
 * so no skill can resolve to nothing.
 *
 * @param raw parsed JSON, or anything at all.
 * @returns `{ categories, assignments }`.
 */
export function normalizeStore(raw) {
  const categories = []
  const seen = new Set()
  const input = Array.isArray(raw?.categories) ? raw.categories : []
  for (const entry of input) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    categories.push({
      id,
      zh: typeof entry?.zh === 'string' && entry.zh !== '' ? entry.zh : id,
      en: typeof entry?.en === 'string' && entry.en !== '' ? entry.en : id,
      order: Number.isFinite(entry?.order) ? entry.order : 100,
    })
  }
  if (categories.length === 0) {
    for (const entry of DEFAULT_CATEGORIES) categories.push({ ...entry })
  }
  if (!seen.has(DEFAULT_CATEGORY)) {
    categories.push({ ...(DEFAULT_CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY)) })
  }
  categories.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const assignments = {}
  const known = new Set(categories.map((c) => c.id))
  const rawAssign = raw?.assignments
  if (rawAssign !== null && typeof rawAssign === 'object' && !Array.isArray(rawAssign)) {
    for (const [name, category] of Object.entries(rawAssign)) {
      if (typeof name !== 'string' || typeof category !== 'string') continue
      if (!known.has(category)) continue
      assignments[name] = category
    }
  }
  return { categories, assignments }
}

/**
 * Read the store, degrading to the defaults.
 *
 * A missing file is the normal first-run state, not an error: the page must
 * render grouped skills before anyone has filed anything.
 *
 * @param path the store path.
 * @returns `{ categories, assignments }` plus `foreign` when the file exists
 *   but could not be parsed, so the caller can warn instead of overwriting.
 */
export async function readStore(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ...normalizeStore(null), exists: false, broken: false }
  }
  try {
    return { ...normalizeStore(JSON.parse(text)), exists: true, broken: false }
  } catch {
    return { ...normalizeStore(null), exists: true, broken: true }
  }
}

/** Write the store atomically enough for a config file (write then flush). */
export async function writeStore(path, record) {
  const clean = normalizeStore(record)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return clean
}

/**
 * Fold the catalog and the store into the assignment the page renders.
 *
 * @param skills catalog summaries.
 * @param record a normalized store.
 * @returns one row per skill: the summary plus `category`.
 */
export function assignCategories(skills, record) {
  const store = normalizeStore(record)
  return (Array.isArray(skills) ? skills : []).map((skill) => {
    const explicit = store.assignments[skill.name]
    const category = explicit !== undefined && explicit !== null
      ? explicit
      : autoCategory(skill)
    return { ...skill, category, categoryExplicit: explicit !== undefined }
  })
}

/**
 * Reject anything that is not a usable category id.
 *
 * @param value the candidate id.
 * @returns true when {@link writeStore} would keep it.
 */
export function isCategoryId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value.trim())
}

/**
 * Rewrite one category in the store.
 *
 * `add` is idempotent: adding an id that already exists updates its label
 * instead of inserting a duplicate, which is what a double-clicked button does.
 *
 * @param record a normalized store.
 * @param action `add` | `rename` | `remove`.
 * @param payload `{ id, zh, en, order }` for add/rename, `{ id }` for remove.
 * @returns the next store.
 */
export function editCategory(record, action, payload) {
  const store = normalizeStore(record)
  const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
  if (!isCategoryId(id)) throw new Error('category id must be kebab-case')

  if (action === 'add') {
    const zh = typeof payload?.zh === 'string' && payload.zh.trim() !== '' ? payload.zh.trim() : id
    const en = typeof payload?.en === 'string' && payload.en.trim() !== '' ? payload.en.trim() : zh
    const order = Number.isFinite(payload?.order) ? payload.order : 60
    const existing = store.categories.find((c) => c.id === id)
    if (existing === undefined) {
      store.categories.push({ id, zh, en, order })
    } else {
      existing.zh = zh
      existing.en = en
      if (Number.isFinite(payload?.order)) existing.order = order
    }
    return normalizeStore(store)
  }

  if (action === 'rename') {
    const existing = store.categories.find((c) => c.id === id)
    if (existing === undefined) throw new Error(`no category named "${id}"`)
    if (typeof payload?.zh === 'string' && payload.zh.trim() !== '') existing.zh = payload.zh.trim()
    if (typeof payload?.en === 'string' && payload.en.trim() !== '') existing.en = payload.en.trim()
    return normalizeStore(store)
  }

  if (action === 'remove') {
    if (id === DEFAULT_CATEGORY) throw new Error('the fallback category cannot be removed')
    const next = store.categories.filter((c) => c.id !== id)
    // Every skill filed under it falls back rather than pointing at a missing id.
    const assignments = {}
    for (const [name, category] of Object.entries(store.assignments)) {
      if (category !== id) assignments[name] = category
    }
    return normalizeStore({ categories: next, assignments })
  }

  throw new Error(`unknown category action "${String(action)}"`)
}

/**
 * Quote a YAML scalar so a value containing `:` or a leading `-` still parses.
 *
 * The frontmatter is read by the host's YAML parser, and an unquoted
 * description that contains `: ` turns the whole file into a parse error the
 * loader silently skips. Plain values stay plain so the file still reads well
 * in an editor.
 *
 * @param value the scalar text.
 * @returns a YAML-safe single-line scalar.
 */
export function yamlScalar(value) {
  const text = String(value)
  const plain = /^[A-Za-z0-9\u4e00-\u9fa5][^\n:#]*$/.test(text)
    && !/^[-?&*!|>%@`"']/.test(text)
    && !/\s$/.test(text)
  if (plain) return text
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Assemble a SKILL.md from the fields the page holds.
 *
 * @param skill `{ name, description, whenToUse, content, enabled }`.
 * @returns the full file text.
 */
export function renderSkillFile(skill) {
  const when = typeof skill?.whenToUse === 'string' ? skill.whenToUse.trim() : ''
  const body = typeof skill?.content === 'string' ? skill.content : ''
  // `enabled: false` writes the field the provider actually reads. Anything else
  // leaves the line out entirely, so a file this plugin never toggled stays
  // byte-identical to the one that was there before.
  const off = skill?.enabled === false
  const front = [
    '---',
    `name: ${yamlScalar(skill?.name ?? '')}`,
    `description: ${yamlScalar(skill?.description ?? '')}`,
    ...(when === '' ? [] : [`whenToUse: ${yamlScalar(when)}`]),
    ...(off ? ['disable-model-invocation: true'] : []),
    '---',
    '',
    '',
  ].join('\n')
  return `${front}${body.replace(/^\s*\n/, '')}`
}

/**
 * Read a SKILL.md back into the fields {@link renderSkillFile} takes.
 *
 * The catalog reports the *effective* invocation policy, which is what the page
 * shows; this exists for the round trip that flips a switch, where the plugin
 * must rewrite the file without dropping the body it did not author.
 *
 * @param text the full file.
 * @returns `{ description, whenToUse, content, enabled }`, or null when the file
 *   carries no frontmatter this plugin can reason about.
 */
export function parseSkillFile(text) {
  if (typeof text !== 'string') return null
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return null
  const [, head, body] = match
  const field = (key) => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head)
    if (line === null) return undefined
    let value = line[1].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return value
  }
  return {
    description: field('description') ?? '',
    whenToUse: field('whenToUse') ?? '',
    content: body.replace(/^\s*\n/, ''),
    enabled: !/^disable-model-invocation:\s*(true|yes|on|1)\s*$/im.test(head),
  }
}

/**
 * Build a pack from exported skills.
 *
 * @param skills rows carrying `{ name, description, whenToUse, content, category }`.
 * @param meta `{ title, exportedAt }` — cosmetic provenance for the recipient.
 * @returns the pack object handed to the client.
 */
export function buildPack(skills, meta) {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    title: typeof meta?.title === 'string' && meta.title.trim() !== '' ? meta.title.trim() : 'skills',
    exportedAt: typeof meta?.exportedAt === 'string' ? meta.exportedAt : new Date().toISOString(),
    skills: (Array.isArray(skills) ? skills : []).map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(typeof skill.whenToUse === 'string' && skill.whenToUse !== ''
        ? { whenToUse: skill.whenToUse }
        : {}),
      ...(typeof skill.category === 'string' && skill.category !== ''
        ? { category: skill.category }
        : {}),
      content: typeof skill.content === 'string' ? skill.content : '',
    })),
  }
}

/**
 * Validate a pack and normalize each skill it carries.
 *
 * Collects every problem instead of throwing on the first one, because an
 * operator importing ten skills needs to know which three were rejected and
 * still get the other seven. A pack with a bad marker is a hard failure: that
 * is a wrong file, not a wrong field.
 *
 * @param raw the parsed JSON from the page or from disk.
 * @returns `{ pack, skills, errors }` — `skills` is what can be written.
 */
export function parsePack(raw) {
  const errors = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { pack: null, skills: [], errors: ['the pack is not a JSON object'] }
  }
  if (raw.format !== PACK_FORMAT) {
    return {
      pack: null,
      skills: [],
      errors: [`not a skill pack: expected format "${PACK_FORMAT}", got ${JSON.stringify(raw.format ?? null)}`],
    }
  }
  if (Number.isFinite(raw.version) && raw.version > PACK_VERSION) {
    return {
      pack: null,
      skills: [],
      errors: [`pack version ${String(raw.version)} is newer than this plugin supports (${PACK_VERSION})`],
    }
  }

  const skills = []
  const seen = new Set()
  const list = Array.isArray(raw.skills) ? raw.skills : []
  if (list.length === 0) errors.push('the pack carries no skills')
  for (const [index, entry] of list.entries()) {
    const at = `skill #${String(index + 1)}`
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const description = typeof entry?.description === 'string' ? entry.description.trim() : ''
    const content = typeof entry?.content === 'string' ? entry.content : ''
    if (!ID_PATTERN.test(name)) {
      errors.push(`${at}: name must be kebab-case, got ${JSON.stringify(entry?.name ?? null)}`)
      continue
    }
    if (description === '') {
      errors.push(`${at} (${name}): description is required`)
      continue
    }
    if (content.trim() === '') {
      errors.push(`${at} (${name}): body is empty`)
      continue
    }
    if (seen.has(name)) {
      errors.push(`${at}: ${name} appears twice in this pack`)
      continue
    }
    seen.add(name)
    skills.push({
      name,
      description,
      ...(typeof entry?.whenToUse === 'string' && entry.whenToUse.trim() !== ''
        ? { whenToUse: entry.whenToUse.trim() }
        : {}),
      ...(typeof entry?.category === 'string' && ID_PATTERN.test(entry.category)
        ? { category: entry.category }
        : {}),
      content,
    })
  }
  return { pack: raw, skills, errors }
}
