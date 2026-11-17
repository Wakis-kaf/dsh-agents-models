// The capability policy guard: the allowlist that decides whether a tool call
// reaches the model's request at all.
//
// This module was folded into the package alongside the skills work; the tests
// here pin what the guard actually promises, because a wrong allowlist either
// blocks everything or blocks nothing, and both look identical on screen.
//
// Run with: node test/capability-policy.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createCapabilityGuard,
  createPolicyScope,
  compilePolicy,
} from '../capability-policy.js'

const CATALOG = [
  { id: 'tool-fs', tools: ['read', 'write', 'edit'] },
  { id: 'tool-web', tools: ['web_search', 'web_fetch'] },
]
const PLUGINS = [{ name: '@opdsh/unity-plugin', tools: ['unity_cli'] }]

test('the allowlist is exactly what the selected rows declare', () => {
  const policy = compilePolicy({ tools: ['tool-fs'] }, CATALOG, PLUGINS)
  assert.deepEqual([...policy.allowed].sort(), ['edit', 'read', 'write'])
})

test('a row that is not selected grants nothing', () => {
  const policy = compilePolicy({ tools: [] }, CATALOG, PLUGINS)
  assert.equal(policy.allowed.size, 0)
})

test('a mounted plugin package grants the tools it declares', () => {
  const policy = compilePolicy(
    { tools: [], plugins: ['@opdsh/unity-plugin'] },
    CATALOG,
    PLUGINS,
  )
  assert.deepEqual([...policy.allowed], ['unity_cli'])
})

test('an installed-but-unmounted package grants nothing', () => {
  const policy = compilePolicy({ tools: [], plugins: [] }, CATALOG, PLUGINS)
  assert.equal(policy.allowed.has('unity_cli'), false)
})

test('a tool both granted and denied is denied', () => {
  const policy = compilePolicy({ tools: ['tool-fs'], disabledTools: ['write'] }, CATALOG, PLUGINS)
  const guard = createCapabilityGuard(() => policy)
  assert.match(guard({ name: 'write' }) ?? '', /denied/)
  assert.equal(guard({ name: 'read' }), undefined)
})

test('the guard denies anything the allowlist does not name', () => {
  const policy = compilePolicy({ tools: ['tool-fs'] }, CATALOG, PLUGINS)
  const guard = createCapabilityGuard(() => policy)
  assert.equal(guard({ name: 'read' }), undefined)
  assert.match(guard({ name: 'pwsh' }) ?? '', /denied/)
  assert.match(guard({ name: 'web_search' }) ?? '', /denied/)
})

test('a guard with no policy lets the call through', () => {
  // The old assertion here said the opposite. It was wrong in this architecture:
  // the policy is absent exactly when the plugin is not loaded, which happens on
  // every re-apply. Denying then locked every running session out of every tool.
  const guard = createCapabilityGuard(() => undefined)
  assert.equal(guard({ name: 'read' }), undefined)
})

test('every decision is recorded, and the log is capped at 100', () => {
  let clock = 0
  const policy = compilePolicy({ tools: ['tool-fs'] }, CATALOG, PLUGINS)
  const guard = createCapabilityGuard(() => policy, () => (clock += 1))
  for (let i = 0; i < 120; i++) guard({ name: 'read', agent: { id: 's1' } })
  assert.equal(policy.events.length, 100, 'the log does not grow without bound')
  assert.equal(policy.events.at(-1).tool, 'read')
  assert.equal(policy.events.at(-1).denied, false)
  assert.equal(policy.events.at(-1).session, 's1')
})

test('a denial is recorded as denied, not as a pass', () => {
  // Use a configured mode with an explicit denial: an empty allowlist is no
  // longer a denial, so it could not produce the event this test is about.
  const policy = compilePolicy({ tools: ['tool-fs'], disabledTools: ['write'] }, CATALOG, PLUGINS)
  const guard = createCapabilityGuard(() => policy)
  guard({ name: 'write' })
  assert.equal(policy.events[0].denied, true)
})

test('two named scopes do not share state', () => {
  const a = createPolicyScope('scope-a')
  const b = createPolicyScope('scope-b')
  assert.notEqual(a.id, b.id)
  a.modes.set('flash', { allowed: new Set(['read']) })
  assert.equal(b.modes.has('flash'), false)
  a.dispose()
  b.dispose()
})

test('the same name yields the same live map', () => {
  const first = createPolicyScope('shared-name')
  first.modes.set('flash', { allowed: new Set(['read']) })
  const again = createPolicyScope('shared-name')
  assert.equal(again.modes.get('flash'), first.modes.get('flash'), 'the map is reused')
  first.dispose()
})

test('applying without a guard-capable host fails loudly', () => {
  // A silent no-op here would look like an enforced policy that never ran.
  assert.throws(() => applyRef({ tools: {} }), /cannot enforce/)
})

/**
 * Boot one policy row exactly the way a preset mounts it.
 *
 * `apply` registers a guard whose closure resolves `policies.get(scope)?.get(mode)`
 * lazily, so the returned function is the guard the host would call on every tool
 * invocation. That is the only way to test the real lookup.
 *
 * @returns the guard the host would run, plus its disposer.
 */
function mountPolicy(scopeId, modeId) {
  let mounted
  const apply = applyRef
  const dispose = apply({
    tools: { guard: (fn) => { mounted = fn; return () => { mounted = undefined } } },
  }, { scope: scopeId, mode: modeId })
  return { guard: (exec) => mounted?.(exec), dispose }
}

test('a mounted guard allows a granted tool and denies the rest', () => {
  const scope = createPolicyScope()
  scope.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG, []))
  const { guard, dispose } = mountPolicy(scope.id, 'flash')
  assert.equal(guard({ name: 'read' }), undefined)
  assert.match(guard({ name: 'web_search' }) ?? '', /denied/)
  dispose()
  scope.dispose()
})

test('a reloaded scope keeps enforcing, and the old mount is unregistered', () => {
  // Saving the mode list re-applies the plugin: a new scope is created for the
  // rebuild while the old instance is disposed. The new scope must enforce, and
  // the old guard must be gone rather than left denying everything.
  const first = createPolicyScope()
  first.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG, []))
  const old = mountPolicy(first.id, 'flash')
  assert.equal(old.guard({ name: 'read' }), undefined, 'the session starts allowed')

  old.dispose()
  first.dispose()

  const second = createPolicyScope()
  second.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG, []))
  const fresh = mountPolicy(second.id, 'flash')

  assert.equal(fresh.guard({ name: 'read' }), undefined, 'the rebuilt mount allows a granted tool')
  assert.match(fresh.guard({ name: 'web_search' }) ?? '', /denied/, 'and still denies the rest')
  assert.equal(old.guard({ name: 'read' }), undefined, 'a disposed mount is unregistered, not denying')

  fresh.dispose()
  second.dispose()
})

test('a guard whose policy is gone allows, instead of bricking the session', () => {
  // This replaced an earlier assertion that the opposite was correct. Fail-closed
  // sounds safe, but with a scope that used to be a random UUID it meant every
  // plugin reload denied *every* tool in already-running sessions — including
  // `read`. Losing the policy means this plugin is not policing that mode right
  // now; the honest outcome is to stop blocking calls.
  const scope = createPolicyScope('regression-dispose')
  scope.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG, []))
  const { guard, dispose } = mountPolicy(scope.id, 'flash')
  assert.equal(guard({ name: 'read' }), undefined, 'policed before disposal')
  scope.dispose()
  assert.equal(guard({ name: 'read' }), undefined, 'unpoliced after disposal, not denied')
  dispose()
})

test('re-applying the plugin keeps the scope id and the live policy', () => {
  // The exact failure: index.js used to call createPolicyScope() with no name and
  // got a fresh random UUID per re-apply. A session built earlier then held a
  // dead id, so the guard resolved no policy and denied everything.
  const first = createPolicyScope('agent-modes')
  first.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG, []))
  const mounted = mountPolicy(first.id, 'flash')
  assert.equal(mounted.guard({ name: 'read' }), undefined)

  // Re-apply: same stable name, and crucially the same underlying map.
  const second = createPolicyScope('agent-modes')
  assert.equal(second.id, first.id, 'the scope id does not change on re-apply')
  assert.equal(second.modes, first.modes, 'the live map is reused, not replaced')
  assert.equal(mounted.guard({ name: 'read' }), undefined, 'the earlier mount still resolves')
  assert.match(mounted.guard({ name: 'web_search' }) ?? '', /denied/, 'and still enforces')

  mounted.dispose()
  second.dispose()
})

test('a configured empty allowlist denies inherited and unexpected tools', () => {
  const policy = compilePolicy({ tools: [] }, CATALOG, [])
  const guard = createCapabilityGuard(() => policy)
  assert.match(guard({ name: 'read' }) ?? '', /denied/)
  assert.equal(policy.events[0].denied, true)
})

test('an explicit denial still wins over everything', () => {
  // Failing open must not weaken the one decision the operator actually made.
  const policy = compilePolicy({ tools: ['tool-fs'], disabledTools: ['write'] }, CATALOG, [])
  const guard = createCapabilityGuard(() => policy)
  assert.match(guard({ name: 'write' }) ?? '', /denied/)
  assert.equal(guard({ name: 'read' }), undefined)
})

test('a configured allowlist still denies an off-list tool', () => {
  // The other half: once a mode does configure its tools, the guard polices it.
  const policy = compilePolicy({ tools: ['tool-fs'] }, CATALOG, [])
  const guard = createCapabilityGuard(() => policy)
  assert.match(guard({ name: 'web_search' }) ?? '', /denied/)
})

const { apply: applyRef } = await import('../capability-policy.js')

test('disposing an older plugin instance does not erase the rebuilt policy', () => {
  const first = createPolicyScope('overlap')
  const second = createPolicyScope('overlap')
  second.modes.set('flash', compilePolicy({ tools: ['tool-fs'] }, CATALOG))
  const mounted = mountPolicy(second.id, 'flash')
  first.dispose()
  assert.match(mounted.guard({ name: 'web_search' }) ?? '', /denied/)
  first.dispose()
  assert.equal(mounted.guard({ name: 'read' }), undefined)
  mounted.dispose()
  second.dispose()
})
test('per-mode skill access is enforced independently of global visibility', () => {
  const policy = compilePolicy({ tools: ['skills'], skills: ['allowed-skill'] }, [{ id: 'skills', tools: ['skill'] }])
  const guard = createCapabilityGuard(() => policy)
  assert.equal(guard({ name: 'skill', arguments: { name: 'allowed-skill' } }), undefined)
  assert.match(guard({ name: 'skill', arguments: { name: 'different-skill' } }), /denied skill/)
  assert.match(guard({ name: 'skill', arguments: {} }), /denied skill/)
  assert.equal(policy.events[1].skill, 'different-skill')
})
