// Portable mode packs: the format, the validator, and the merge rules.
//
// The merge is where a wrong default costs the operator their work, so the cases
// that matter are pinned here: copy must never silently overwrite an existing
// mode, replace must be opt-in, and a partial pack must land on a real target.
//
// Run with: node test/mode-pack.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergePackModes, validateModePack } from '../mode-pack.js'

const FORMAT = 'dsh-mode-pack'

/** A minimal valid pack; each test overrides one field. */
function pack(over = {}) {
  return {
    format: FORMAT,
    version: 1,
    scope: 'mode',
    exportedAt: '2026-11-17T00:00:00.000Z',
    compatibility: { platform: process.platform, arch: process.arch, node: process.versions.node },
    modes: [{ id: 'flash', name: 'Flash', tools: ['tool-fs'], plugins: [] }],
    dependencies: [],
    ...over,
  }
}

// ── validation ────────────────────────────────────────────────────────────

test('a well-formed pack validates', () => {
  assert.doesNotThrow(() => validateModePack(pack()))
})

test('a foreign or future pack is refused by format and version', () => {
  assert.throws(() => validateModePack(pack({ format: 'something-else' })), /Unsupported pack format/)
  assert.throws(() => validateModePack(pack({ version: 2 })), /Unsupported pack format/)
  assert.throws(() => validateModePack(pack({ scope: 'everything' })), /Unknown pack scope/)
})

test('an empty or oversized mode list is refused', () => {
  assert.throws(() => validateModePack(pack({ modes: [] })), /Invalid pack contents/)
  const many = Array.from({ length: 101 }, (_, i) => ({ id: `m${i}`, tools: [] }))
  assert.throws(() => validateModePack(pack({ modes: many })), /Invalid pack contents/)
})

test('a mode id that is not kebab-case, or repeats, is refused', () => {
  assert.throws(
    () => validateModePack(pack({ modes: [{ id: 'Bad Id', tools: [] }] })),
    /Invalid or duplicate mode id/,
  )
  assert.throws(
    () => validateModePack(pack({ modes: [{ id: 'a', tools: [] }, { id: 'a', tools: [] }] })),
    /Invalid or duplicate mode id/,
  )
})

test('a non-string entry in a tool list is refused', () => {
  assert.throws(() => validateModePack(pack({ modes: [{ id: 'a', tools: [1] }] })), /Invalid tools/)
  assert.throws(() => validateModePack(pack({ modes: [{ id: 'a', plugins: [null] }] })), /Invalid plugins/)
})

test('parameters must be an object, not a list or a string', () => {
  assert.throws(() => validateModePack(pack({ modes: [{ id: 'a', config: [] }] })), /Invalid mode parameters/)
  assert.throws(() => validateModePack(pack({ modes: [{ id: 'a', config: 'x' }] })), /Invalid mode parameters/)
})

test('an embedded file with a bad hash is refused before anything is written', () => {
  const bad = pack({
    dependencies: [{
      name: '@scope/pkg', version: '1.0.0', source: 'embedded',
      files: [{ path: 'package.json', data: Buffer.from('{"name":"@scope/pkg"}').toString('base64'), sha256: 'deadbeef' }],
    }],
  })
  assert.throws(() => validateModePack(bad), /integrity or size check failed/)
})

test('an embedded path that escapes the package is refused', () => {
  const data = Buffer.from('{}').toString('base64')
  const evil = pack({
    dependencies: [{
      name: '@scope/pkg', version: '1.0.0', source: 'embedded',
      files: [{ path: '../../etc/passwd', data, sha256: 'x' }],
    }],
  })
  assert.throws(() => validateModePack(evil), /Unsafe or duplicate package file/)
})

test('a dependency that is neither embedded nor from the registry is refused', () => {
  const dep = pack({
    dependencies: [{ name: '@scope/pkg', version: '1.0.0', source: 'sideload' }],
  })
  assert.throws(() => validateModePack(dep), /Invalid package dependency/)
})

// ── merge ─────────────────────────────────────────────────────────────────

test('a new mode is appended without touching the existing list', () => {
  const next = mergePackModes(pack(), [{ id: 'flash', name: 'Mine', tools: [] }])
  assert.equal(next.length, 2)
  assert.deepEqual(next.find((m) => m.id === 'flash').tools, [])
})

test('the default conflict decision copies instead of overwriting', () => {
  // The dangerous default is "replace": it silently destroys the operator's own
  // mode. Copy keeps both, with a distinct id, so nothing is lost.
  const next = mergePackModes(pack(), [{ id: 'flash', name: 'Mine', tools: ['tool-web'] }])
  assert.equal(next.length, 2)
  assert.deepEqual(next.find((m) => m.id === 'flash').tools, ['tool-web'], 'the original is untouched')
  const copy = next.find((m) => m.id !== 'flash')
  assert.equal(copy.id, 'flash-2')
  assert.match(copy.name, /flash-2/)
})

test('replace overwrites only when asked', () => {
  const next = mergePackModes(
    pack(),
    [{ id: 'flash', name: 'Mine', tools: ['tool-web'] }],
    { conflict: 'replace' },
  )
  assert.equal(next.length, 1)
  assert.deepEqual(next[0].tools, ['tool-fs'])
})

test('skip leaves the existing mode alone and adds nothing', () => {
  const next = mergePackModes(
    pack(),
    [{ id: 'flash', name: 'Mine', tools: ['tool-web'] }],
    { conflict: 'skip' },
  )
  assert.equal(next.length, 1)
  assert.deepEqual(next[0].tools, ['tool-web'])
})

test('an invalid conflict decision is refused', () => {
  assert.throws(() => mergePackModes(pack(), [], { conflict: 'keep' }), /Invalid conflict decision/)
})

test('a partial pack merges only its own field into the target', () => {
  const current = [{ id: 'flash', name: 'Flash', tools: ['tool-web'], config: { a: 1 }, plugins: ['x'] }]
  const partial = pack({
    scope: 'tools',
    modes: [{ id: 'flash', tools: ['tool-fs'], allowedTools: ['read'] }],
  })
  const next = mergePackModes(partial, current, { target: 'flash' })
  assert.deepEqual(next[0].tools, ['tool-fs'])
  assert.deepEqual(next[0].allowedTools, ['read'])
  assert.deepEqual(next[0].config, { a: 1 }, 'other fields survive')
  assert.deepEqual(next[0].plugins, ['x'], 'other fields survive')
})

test('a partial pack without a target is refused rather than guessing', () => {
  const partial = pack({ scope: 'tools', modes: [{ id: 'flash', tools: [] }] })
  assert.throws(() => mergePackModes(partial, [{ id: 'flash', tools: [] }]), /Select a target mode/)
})

test('merging does not mutate its inputs', () => {
  const current = [{ id: 'flash', name: 'Mine', tools: ['tool-web'] }]
  const incoming = pack()
  const snapshot = JSON.stringify({ current, incoming })
  mergePackModes(incoming, current, { conflict: 'replace' })
  assert.equal(JSON.stringify({ current, incoming }), snapshot)
})

test('an imported id cannot replace another plugin mode, and copies avoid reserved ids', () => {
  const source = pack({ modes: [{ id: 'standard' }] })
  const next = mergePackModes(source, [], { reserved: ['standard', 'standard-2'] })
  assert.equal(next[0].id, 'standard-3')
  assert.throws(() => mergePackModes(source, [], { conflict: 'replace', reserved: ['standard'] }), /another plugin/)
})

test('missing ids and dependency names are not coerced into valid strings', () => {
  assert.throws(() => validateModePack(pack({ modes: [{}] })), /mode id/)
  assert.throws(() => validateModePack(pack({ dependencies: [{ version: '1.0.0', source: 'registry' }] })), /Invalid package/)
})
