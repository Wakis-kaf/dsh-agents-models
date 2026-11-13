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

test('guard declares the tools injection', () => {
  assert.deepEqual(inject, ['tools'])
})

test('apply registers a guard function', () => {
  let registered
  const ctx = { tools: { guard: (guard) => { registered = guard } } }
  apply(ctx, { provider: 'workbuddy' })
  assert.equal(typeof registered, 'function')
})
