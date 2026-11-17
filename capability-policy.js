/**
 * Per-mode tool allowlist guard.
 *
 * The guard is mounted by the `mode-capability-policy` row inside every preset.
 * It runs before dispatch and may deny a call by returning a reason string.
 *
 * ## Two failure modes this module exists to avoid
 *
 * An earlier revision derived the policy scope from `randomUUID()` and treated a
 * missing policy as "deny everything". Together those two choices bricked live
 * sessions: re-applying the plugin (config save, HMR, restart) created a new
 * scope while running sessions still held the old one, so every guard lookup
 * returned `undefined` and every tool call was denied — including `read`, and
 * including the operator's own ability to fix it from inside the session.
 *
 * So: scopes are keyed by a **stable name**, and the guard **fails open**. A
 * guard that cannot find its policy is a guard whose plugin is not currently
 * loaded; the honest behaviour is to stop policing, not to take the session
 * hostage. Real denial is always an explicit, configured decision below.
 *
 * ## What actually denies
 *
 * 1. the tool name appears in `mode.disabledTools`, or
 * 2. the tool is not on the compiled allowlist (including an empty one).
 *
 * An empty compiled allowlist grants no tools. Missing policy and configured
 * empty policy are different: only the former releases a stale guard on unload.
 *
 * @module dsh-agents-models/capability-policy
 */

// Policies live for the life of this host process. Separate plugin instances in
// separate processes never share them, and that is intentional: the policy is
// derived from the preset the session actually mounted.
const policies = new Map()
const owners = new Map()

/** Stable default scope. Re-applying the plugin reuses it instead of forking. */
const DEFAULT_SCOPE = 'agent-modes'

export const name = 'agent-mode-capability-policy'
export const inject = ['tools']

/**
 * Open (or re-open) the policy scope for this plugin instance.
 *
 * The id is stable on purpose: a running session's guard captured it when the
 * preset was built, so it must keep resolving after the plugin is re-applied.
 * Re-opening an existing scope keeps the map — and therefore the live policies —
 * rather than replacing it with an empty one.
 *
 * @param key stable scope name; defaults to {@link DEFAULT_SCOPE}.
 * @returns `{ id, modes, dispose }` where `modes` is the live policy map.
 */
export function createPolicyScope(key) {
  const id = typeof key === 'string' && key.trim() !== '' ? key.trim() : DEFAULT_SCOPE
  if (!policies.has(id)) policies.set(id, new Map())
  const modes = policies.get(id)
  owners.set(id, (owners.get(id) ?? 0) + 1)
  let disposed = false
  return {
    id,
    modes,
    dispose: () => {
      if (disposed) return
      disposed = true
      const remaining = (owners.get(id) ?? 1) - 1
      if (remaining > 0) owners.set(id, remaining)
      else { owners.delete(id); policies.delete(id) }
    },
  }
}

/**
 * Derive the allow/deny sets for one mode.
 *
 * @param mode the configured mode row (`tools`, `plugins`, `allowedTools`,
 *   `disabledTools`).
 * @param catalog the tool catalog, so a mounted row expands to its real tool names.
 * @param plugins installed packages, so a mounted package expands the same way.
 * @returns `{ allowed, denied, events }` — `events` is filled in by the guard.
 */
export function compilePolicy(mode, catalog, plugins = []) {
  const selected = new Set(mode?.tools ?? [])
  const packages = new Set(mode?.plugins ?? [])
  const allowed = new Set(mode?.allowedTools ?? [])
  for (const row of catalog ?? []) {
    if (!selected.has(row.id)) continue
    for (const tool of row.tools ?? []) allowed.add(tool)
  }
  for (const row of plugins ?? []) {
    if (!packages.has(row.name)) continue
    for (const tool of row.tools ?? []) allowed.add(tool)
  }
  return { allowed, denied: new Set(mode?.disabledTools ?? []), skills: Array.isArray(mode?.skills) ? new Set(mode.skills) : null, events: [] }
}

/**
 * Decide one call and record the decision.
 *
 * Explicit denials win, then every call must be on the configured allowlist.
 * Only a missing policy (plugin unload) leaves the call unpoliced.
 *
 * @param readPolicy a thunk returning the current policy, or `undefined` when the
 *   plugin is not loaded right now.
 * @param now clock, injectable so a test can assert the event timestamps.
 * @returns the guard the host calls before dispatch.
 */
export function createCapabilityGuard(readPolicy, now = Date.now) {
  return (exec) => {
    const policy = readPolicy()
    const tool = exec?.name
    // No policy means this plugin is not currently policing that mode. Failing
    // open keeps a stale mount harmless instead of freezing every tool call.
    if (policy === undefined || policy === null) return undefined

    const explicitlyDenied = policy.denied.has(tool)
    // A configured empty mode grants nothing, even if another scope exposes tools.
    const offList = !policy.allowed.has(tool)
    const skill = tool === 'skill' ? exec?.arguments?.name : undefined
    const resourceDenied = tool === 'skill' && policy.skills !== null && !policy.skills.has(skill)
    const denied = explicitlyDenied || offList || resourceDenied

    policy.events.push({ at: now(), tool, denied, session: exec?.agent?.id ?? null, ...(typeof skill === 'string' ? { skill } : {}) })
    if (policy.events.length > 100) policy.events.shift()

    if (resourceDenied) return `Mode policy denied skill "${String(skill ?? 'unknown')}". Select this skill in mode management and save before retrying.`
    return denied
      ? `Mode policy denied tool "${String(tool)}". Enable this tool in mode management and save before retrying.`
      : undefined
  }
}

/**
 * Mount the guard for one preset row.
 *
 * @param ctx host context exposing `tools.guard`.
 * @param config `{ scope, mode }` from the preset row.
 * @returns the effect disposer that removes the guard.
 */
export function apply(ctx, config = {}) {
  if (typeof ctx.tools?.guard !== 'function') throw new Error('This host cannot enforce mode tool policy')
  const scope = typeof config.scope === 'string' && config.scope !== '' ? config.scope : DEFAULT_SCOPE
  return ctx.tools.guard(createCapabilityGuard(() => policies.get(scope)?.get(config.mode)))
}
