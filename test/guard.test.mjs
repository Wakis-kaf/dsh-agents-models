// WorkBuddy guard policy checks: the exact failure that hung a session, the
// official-route bypass, the bounded header read, and the long job wait.
//
// Run with: node test/guard.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, createWorkbuddyGuard, inject } from '../guard.js'

function execFor(provider, name, args) {
  return execOn(agentFor(provider), name, args)
}

function agentFor(provider) {
  return {
    model: {
      current: () => ({ provider, model: provider === 'workbuddy' ? 'deepseek-v4.1-flash' : 'deepseek-flash' }),
    },
  }
}

function execOn(agent, name, args) {
  return { name, arguments: args, agent }
}

const workbuddy = (name, args) => execFor('workbuddy', name, args)
const official = (name, args) => execFor('deepseek-account', name, args)

test('denies the full asar scan that hung the session', () => {
  const guard = createWorkbuddyGuard()
  const command = [
    "$asar='D:\\softwares\\DeepSeek Harness\\resources\\app.asar'",
    '$fs=[System.IO.File]::OpenRead($asar); $buf=New-Object byte[] (8MB); $carry=""',
    'while(($n=$fs.Read($buf,0,$buf.Length)) -gt 0){',
    '  $s=$carry+[Text.Encoding]::UTF8.GetString($buf,0,$n)',
    "  $m=[regex]::Matches($s, '[ -~]{0,120}(NoProfile|noProfile)[ -~]{0,160}')",
    '}',
  ].join('\n')
  assert.match(guard(workbuddy('pwsh', { command })), /large binary/)
})

test('leaves the official DeepSeek route untouched', () => {
  const guard = createWorkbuddyGuard()
  assert.equal(guard(official('pwsh', { command: 'Get-Content D:\\x\\app.asar -Raw' })), undefined)
})

test('allows the bounded header read', () => {
  const guard = createWorkbuddyGuard()
  const command = [
    "$p='D:\\x\\app.asar'; $fs=[IO.File]::OpenRead($p)",
    '$hb=New-Object byte[] 16; [void]$fs.Read($hb,0,16)',
    '$len=[BitConverter]::ToUInt32($hb,12)',
  ].join('\n')
  assert.equal(guard(workbuddy('pwsh', { command })), undefined)
})

test('denies a long job_output wait and allows a short one', () => {
  const guard = createWorkbuddyGuard()
  assert.match(
    guard(workbuddy('job_output', { job_id: 'job-1', wait: true, timeout_ms: 120_000 })),
    /job_output/,
  )
  assert.equal(guard(workbuddy('job_output', { job_id: 'job-1', wait: true, timeout_ms: 10_000 })), undefined)
})

test('allows ordinary commands', () => {
  const guard = createWorkbuddyGuard()
  assert.equal(guard(workbuddy('pwsh', { command: 'git status --short' })), undefined)
})

test('denies a recursive drive-root listing', () => {
  const guard = createWorkbuddyGuard()
  assert.match(guard(workbuddy('pwsh', { command: 'Get-ChildItem C:\\ -Recurse' })), /recursive/)
})

test('denies Get-Content on a file above the read budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-guard-'))
  try {
    const file = join(dir, 'big.txt')
    writeFileSync(file, 'x'.repeat(64))
    const guard = createWorkbuddyGuard({ maxReadBytes: 16 })
    assert.match(guard(workbuddy('pwsh', { command: `Get-Content '${file}'` })), /larger than/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('denies an exact repeated pwsh command', () => {
  const guard = createWorkbuddyGuard()
  const agent = agentFor('workbuddy')
  const call = () => guard(execOn(agent, 'pwsh', { command: 'git status --short' }))
  assert.equal(call(), undefined)
  assert.match(call(), /already ran/)
})

test('stops after the configured tool budget', () => {
  const guard = createWorkbuddyGuard({ maxToolSteps: 2 })
  const agent = agentFor('workbuddy')
  assert.equal(guard(execOn(agent, 'pwsh', { command: 'git status --short' })), undefined)
  assert.equal(guard(execOn(agent, 'read', { file_path: 'a' })), undefined)
  assert.match(guard(execOn(agent, 'grep', { pattern: 'x' })), /budget/)
})

test('the tool budget is per agent', () => {
  const guard = createWorkbuddyGuard({ maxToolSteps: 1 })
  const first = agentFor('workbuddy')
  const second = agentFor('workbuddy')
  assert.equal(guard(execOn(first, 'pwsh', { command: 'git status' })), undefined)
  assert.equal(guard(execOn(second, 'pwsh', { command: 'git status' })), undefined)
  assert.match(guard(execOn(first, 'pwsh', { command: 'git diff' })), /budget/)
})

test('a denied call does not spend budget', () => {
  const guard = createWorkbuddyGuard({ maxToolSteps: 2 })
  const agent = agentFor('workbuddy')
  assert.equal(guard(execOn(agent, 'pwsh', { command: 'git status --short' })), undefined)
  assert.match(
    guard(execOn(agent, 'pwsh', { command: 'git status --short' })),
    /already ran/,
    'the repeat is denied',
  )
  assert.equal(
    guard(execOn(agent, 'read', { file_path: 'a' })),
    undefined,
    'the repeat denial did not consume the second step',
  )
  assert.match(guard(execOn(agent, 'grep', { pattern: 'x' })), /budget/)
})

test('the budget still allows delivery and questions once spent', () => {
  const guard = createWorkbuddyGuard({ maxToolSteps: 1 })
  const agent = agentFor('workbuddy')
  assert.equal(guard(execOn(agent, 'read', { file_path: 'a' })), undefined)
  assert.match(guard(execOn(agent, 'read', { file_path: 'b' })), /budget/)
  assert.equal(guard(execOn(agent, 'present', { files: [{ path: 'a' }] })), undefined)
  assert.equal(guard(execOn(agent, 'ask_user_question', { questions: [{ id: 'q', question: '?' }] })), undefined)
  assert.equal(guard(execOn(agent, 'job_list', {})), undefined)
  assert.equal(guard(execOn(agent, 'job_output', { job_id: 'job-1', wait: false })), undefined)
})

test('repeatLimit 2 allows one verification re-run and denies the third', () => {
  const guard = createWorkbuddyGuard({ repeatLimit: 2 })
  const agent = agentFor('workbuddy')
  const call = () => guard(execOn(agent, 'pwsh', { command: 'node render.mjs' }))
  assert.equal(call(), undefined)
  assert.equal(call(), undefined, 'a second identical run is the verification pass')
  assert.match(call(), /already ran 2 time/)
})

test('requires a read after the last write before present', () => {
  const guard = createWorkbuddyGuard({ requireReadBeforePresent: true })
  const agent = agentFor('workbuddy')
  const present = (path) => guard(execOn(agent, 'present', { files: [{ path }] }))
  assert.equal(guard(execOn(agent, 'write', { file_path: 'D:\\w\\out.html', content: 'x' })), undefined)
  assert.match(present('D:\\w\\out.html'), /never read it back/)
  assert.equal(guard(execOn(agent, 'read', { file_path: 'D:/w/out.html' })), undefined, 'same file, another spelling')
  assert.equal(present('out.html'), undefined, 'a look at it unlocks delivery')
  assert.equal(guard(execOn(agent, 'edit', { file_path: 'D:\\w\\out.html', old_string: 'x', new_string: 'y' })), undefined)
  assert.match(present('D:\\w\\out.html'), /never read it back/, 'editing again re-locks it')
})

test('a file the session never wrote is presented without a read', () => {
  const guard = createWorkbuddyGuard({ requireReadBeforePresent: true })
  assert.equal(guard(execOn(agentFor('workbuddy'), 'present', { files: [{ path: 'C:\\x\\report.pdf' }] })), undefined)
})

test('the base guard does not gate present', () => {
  const guard = createWorkbuddyGuard()
  const agent = agentFor('workbuddy')
  guard(execOn(agent, 'write', { file_path: 'a.html', content: 'x' }))
  assert.equal(guard(execOn(agent, 'present', { files: [{ path: 'a.html' }] })), undefined)
})

test('reading a page back is not the same as looking at it', () => {
  const guard = createWorkbuddyGuard({ requireReadBeforePresent: true, requireRenderBeforePresent: true })
  const agent = agentFor('workbuddy')
  const call = (name, args) => guard(execOn(agent, name, args))
  const present = (path) => call('present', { files: [{ path }] })

  assert.equal(call('write', { file_path: 'D:\\w\\pelican.html', content: '<svg/>' }), undefined)
  assert.equal(call('read', { file_path: 'D:\\w\\pelican.html' }), undefined, 'the markup can be read')
  // The failure this gate exists for: valid markup, delivered unseen.
  assert.match(present('D:\\w\\pelican.html'), /never looked at how it renders/)

  assert.equal(call('read_image', { file_path: 'D:\\w\\pelican.png' }), undefined)
  assert.equal(present('D:\\w\\pelican.html'), undefined, 'a look at the render unlocks delivery')

  assert.equal(call('edit', { file_path: 'D:\\w\\pelican.html', old_string: 'a', new_string: 'b' }), undefined)
  assert.equal(call('read', { file_path: 'D:\\w\\pelican.html' }), undefined)
  assert.match(present('D:\\w\\pelican.html'), /never looked at how it renders/, 'a fix needs a fresh look')
})

test('an image seen before the last write does not count as a render', () => {
  const guard = createWorkbuddyGuard({ requireRenderBeforePresent: true })
  const agent = agentFor('workbuddy')
  const call = (name, args) => guard(execOn(agent, name, args))

  assert.equal(call('write', { file_path: 'scene.svg', content: '<svg/>' }), undefined)
  assert.equal(call('read_image', { file_path: 'scene.png' }), undefined)
  assert.equal(call('edit', { file_path: 'scene.svg', old_string: 'a', new_string: 'b' }), undefined)
  assert.match(
    call('present', { files: [{ path: 'scene.svg' }] }),
    /never looked at how it renders/,
    'the look predates the edit, so it describes a version that no longer exists',
  )
})

test('a deliverable that is not a page is not gated on a render', () => {
  const guard = createWorkbuddyGuard({ requireReadBeforePresent: true, requireRenderBeforePresent: true })
  const agent = agentFor('workbuddy')
  const call = (name, args) => guard(execOn(agent, name, args))
  assert.equal(call('write', { file_path: 'notes.md', content: '# hi' }), undefined)
  assert.equal(call('read', { file_path: 'notes.md' }), undefined)
  assert.equal(call('present', { files: [{ path: 'notes.md' }] }), undefined)
})

test('proving motion needs two frames whose bytes differ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-motion-'))
  try {
    const page = join(dir, 'scene.html')
    const frameA = join(dir, 'frame-a.png')
    const frameB = join(dir, 'frame-b.png')
    // Two paths, one picture: the failure this gate exists for — a second
    // "look" at the same rendering is not a second frame.
    const copyOne = join(dir, 'copy-1.png')
    const copyTwo = join(dir, 'copy-2.png')
    writeFileSync(page, '<style>@keyframes spin{to{transform:rotate(360deg)}}</style><svg/>')
    writeFileSync(frameA, 'PNG-FRAME-A'.repeat(20))
    writeFileSync(frameB, 'PNG-FRAME-B'.repeat(20))
    writeFileSync(copyOne, 'PNG-SAME'.repeat(20))
    writeFileSync(copyTwo, 'PNG-SAME'.repeat(20))

    const agent = agentFor('workbuddy')
    const guard = createWorkbuddyGuard({
      requireReadBeforePresent: true,
      requireRenderBeforePresent: true,
      requireMotionBeforePresent: true,
    })
    const call = (name, args) => guard(execOn(agent, name, args))
    const present = () => call('present', { files: [{ path: page }] })

    call('write', { file_path: page, content: '<svg/>' })
    call('read', { file_path: page })

    // One frame: the render gate is satisfied, motion is not.
    call('read_image', { file_path: frameA })
    assert.match(present(), /needs two/, 'a single still cannot show motion')

    // Two different files holding the same pixels.
    call('read_image', { file_path: copyOne })
    call('read_image', { file_path: copyTwo })
    assert.match(present(), /byte-identical/, 'two copies of one picture prove nothing')

    // A genuinely different frame.
    call('read_image', { file_path: frameB })
    assert.equal(present(), undefined, 'a second distinct frame unlocks delivery')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a page that never declared animation is not asked to prove motion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-static-'))
  try {
    const page = join(dir, 'report.html')
    const frame = join(dir, 'shot.png')
    writeFileSync(page, '<h1>Quarterly numbers</h1><table></table>')
    writeFileSync(frame, 'PNG'.repeat(30))

    const guard = createWorkbuddyGuard({
      requireReadBeforePresent: true,
      requireRenderBeforePresent: true,
      requireMotionBeforePresent: true,
    })
    const agent = agentFor('workbuddy')
    const call = (name, args) => guard(execOn(agent, name, args))
    call('write', { file_path: page, content: '<h1>x</h1>' })
    call('read', { file_path: page })
    call('read_image', { file_path: frame })
    // One frame, and the page is supposed to be still: demanding a second,
    // differing frame would deadlock every static deliverable.
    assert.equal(call('present', { files: [{ path: page }] }), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the motion gate relaxes when a frame cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-motion3-'))
  try {
    const page = join(dir, 'anim.html')
    writeFileSync(page, '<style>@keyframes b{50%{opacity:.5}}</style><div></div>')
    const guard = createWorkbuddyGuard({ requireMotionBeforePresent: true })
    const agent = agentFor('workbuddy')
    const call = (name, args) => guard(execOn(agent, name, args))
    call('write', { file_path: page, content: '<div></div>' })
    call('read_image', { file_path: 'C:\\nope\\gone-a.png' })
    call('read_image', { file_path: 'C:\\nope\\gone-b.png' })
    // An unreadable pair is not evidence of motion, but neither is it grounds to
    // block: the guard only rejects what it can actually judge.
    assert.equal(call('present', { files: [{ path: page }] }), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('editing after the frames were taken re-locks the motion gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-motion2-'))
  try {
    const page = join(dir, 'p.html')
    const a = join(dir, 'a.png')
    const b = join(dir, 'b.png')
    writeFileSync(page, '<style>animation: spin 2s linear infinite</style>')
    writeFileSync(a, 'AAA'.repeat(40))
    writeFileSync(b, 'BBB'.repeat(40))
    const guard = createWorkbuddyGuard({ requireMotionBeforePresent: true })
    const agent = agentFor('workbuddy')
    const call = (name, args) => guard(execOn(agent, name, args))
    call('write', { file_path: page, content: '<svg/>' })
    call('read_image', { file_path: a })
    call('read_image', { file_path: b })
    assert.equal(call('present', { files: [{ path: page }] }), undefined)
    call('edit', { file_path: page, old_string: 'x', new_string: 'y' })
    assert.match(
      call('present', { files: [{ path: page }] }),
      /needs two/,
      'frames of the previous build describe a version that no longer exists',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a big write needs a plan first', () => {
  const guard = createWorkbuddyGuard({ requirePlanBeforeWrite: true, planThresholdChars: 10 })
  const agent = agentFor('workbuddy')
  assert.match(guard(execOn(agent, 'write', { file_path: 'a.html', content: 'x'.repeat(50) })), /todo_write/)
  assert.equal(guard(execOn(agent, 'write', { file_path: 'b.txt', content: 'small' })), undefined, 'a tiny write needs no plan')
  assert.equal(guard(execOn(agent, 'todo_write', { todos: [{ content: 'build', status: 'in_progress' }] })), undefined)
  assert.equal(guard(execOn(agent, 'write', { file_path: 'a.html', content: 'x'.repeat(50) })), undefined)
})

test('the base guard does not require a plan', () => {
  const guard = createWorkbuddyGuard()
  assert.equal(guard(execOn(agentFor('workbuddy'), 'write', { file_path: 'a.html', content: 'x'.repeat(50) })), undefined)
})

test('guard declares the tools injection', () => {
  assert.deepEqual(inject, ['tools'])
})

test('apply registers a guard function', () => {
  let registered
  const ctx = { tools: { guard: (guard) => { registered = guard } } }
  apply(ctx, { provider: 'workbuddy' })
  assert.equal(typeof registered, 'function')
})
