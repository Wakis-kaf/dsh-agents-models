// 对话消耗展示 — the two host routes, end to end.
//
// What this file exists to prove, in the user's own terms:
//
// 1. the readout keeps its number after the host restarts (the reported bug);
// 2. switching sessions shows each session its own number, not the newest one;
// 3. an official-channel session reports YUAN, not credits;
// 4. the extension switch actually stops the work, not just the pixels.
//
// The connector is stubbed over `fetch`, so a test can say exactly what the
// upstream charged without a real WorkBuddy account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { apply } from '../index.js'

/** A throwaway DSH home, so the ledger never touches the real one. */
async function fixture(t, { heartbeat = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-spend-route-'))
  t.after(async () => {
    assert.ok(root.includes('dsh-spend-route-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}

/**
 * Mount the plugin against fake host services and return the two routes.
 *
 * `sessions` maps a session id to the events its durable log would carry, and
 * `connector` maps a session id to what the connector's route answers. Mutating
 * either between calls is how a test simulates "a new request happened" or "the
 * connector restarted".
 */
async function mount({ home, sessions = {}, connector = null, webServer = { port: 50000 } }) {
  const routes = new Map()
  const cleanup = []
  const services = {
    profileContext: { dir: home },
    agentPresets: { register: async () => () => {}, list: async () => [] },
    connection: { fetch: { register: (route) => { routes.set(route.path, route.fetch); return () => {} } } },
    configEditor: { edit: async () => {} },
    // The connector's routes live on the SAME web server as this plugin's, so its
    // port is how the host finds them — and `null` here is "no web server yet",
    // which must read as "connector not reachable", never as "spent nothing".
    ...(webServer === null ? {} : { webServer }),
    sessionQuery: {
      listSessions: async () => Object.keys(sessions).map((id) => ({ header: { id }, live: false })),
      readSession: async (id) => {
        if (sessions[id] === undefined) throw new Error(`no session ${id}`)
        return { session: { id }, events: sessions[id] }
      },
    },
  }
  const ctx = {
    ...services,
    get: (key) => services[key],
    inject: (_deps, fn) => fn(ctx),
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    fiber: { entry: { id: 'modes' } },
    logger: { warn: () => {} },
  }
  await apply(ctx, { modes: [] })
  const call = async (name, body) => (await routes.get(`/api/agent-modes/${name}`)({ json: async () => body })).json()

  // The connector's own route, stubbed. `connector` is read at call time so a
  // test can change what it answers between two polls.
  const state = { connector }
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url))
    if (!parsed.pathname.startsWith('/plugins/dsh-connect-workbuddy/')) throw new Error(`unexpected fetch: ${url}`)
    const id = parsed.searchParams.get('sessionId')
    const answer = state.connector?.[id]
    if (answer === undefined) return { ok: true, json: async () => ({ sessionId: id }) }
    return { ok: true, json: async () => ({ sessionId: id, spent: answer }) }
  }

  return { call, cleanup, state }
}

/** One `assistant/message` event from the durable log. */
function message(provider, model, usage, time) {
  return { type: 'assistant/message', time, data: { message: { source: { provider, model } }, usage } }
}

/** Point the plugin at this fixture's home so no real ledger is touched. */
async function withHome(home, fn) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

test('a session keeps its credit total across a host restart', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const sessions = { 's-1': [] }
    const connector = { 's-1': { credit: 9.45, requests: 10 } }

    // ── first run: the connector still remembers 9.45 credits ──────────────
    const first = await mount({ home, sessions, connector })
    let answer = await first.call('spend', { sessionId: 's-1' })
    assert.equal(answer.ok, true, answer.error)
    assert.equal(answer.value.spend.credit, 9.45)
    first.cleanup.forEach((dispose) => dispose())

    // ── restart: the connector's in-memory Map is empty again ──────────────
    // Its route now answers for one fresh request only, which is what the
    // reported bug looks like: the readout would have shown 1.2 and lost 9.45.
    const second = await mount({ home, sessions, connector: { 's-1': { credit: 1.2, requests: 1 } } })
    answer = await second.call('spend', { sessionId: 's-1' })
    assert.equal(answer.ok, true, answer.error)
    assert.equal(answer.value.spend.credit, 10.65, '9.45 before the restart + 1.2 after it')
    assert.equal(answer.value.ledger.stored, true)
  })
})

test('switching sessions shows each one its own number', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const sessions = { 'a': [], 'b': [] }
    const connector = { a: { credit: 2, requests: 3 }, b: { credit: 7.79, requests: 12 } }
    const { call } = await mount({ home, sessions, connector })
    assert.equal((await call('spend', { sessionId: 'a' })).value.spend.credit, 2)
    assert.equal((await call('spend', { sessionId: 'b' })).value.spend.credit, 7.79)
    // ...and back again: reading one must not overwrite the other.
    assert.equal((await call('spend', { sessionId: 'a' })).value.spend.credit, 2)
  })
})

test('an official-channel session reports yuan, and a WorkBuddy one reports credits', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const valley = Date.UTC(2026, 10, 17, 0, 0, 0) // 08:00 Beijing, valley
    const sessions = {
      official: [message('deepseek-official', 'deepseek-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, totalTokens: 1e6 }, valley)],
      workbuddy: [message('workbuddy', 'deepseek-v4.1-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, totalTokens: 1e6 }, valley)],
    }
    const connector = { workbuddy: { credit: 4.5, requests: 2 } }
    const { call } = await mount({ home, sessions, connector })

    const official = await call('spend', { sessionId: 'official' })
    assert.equal(official.value.spend.cny, 1, '1M uncached Flash input at the valley rate')
    assert.equal(Object.hasOwn(official.value.spend, 'credit'), false, 'no credit was reported here')
    assert.equal(official.value.spend.creditBilled, false)

    const wb = await call('spend', { sessionId: 'workbuddy' })
    assert.equal(wb.value.spend.cny, 0, 'a credit-billed request is not converted to money')
    assert.equal(wb.value.spend.credit, 4.5)
    assert.equal(wb.value.spend.creditBilled, true)
  })
})

test('the connector being absent costs credits but never the money figure', async (t) => {
  // No web server: the plugin cannot know which port to ask the connector on.
  const home = await fixture(t, { heartbeat: false })
  await withHome(home, async () => {
    const sessions = {
      s: [message('deepseek-official', 'deepseek-flash', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, Date.UTC(2026, 10, 17, 0, 0, 0))],
    }
    const { call } = await mount({ home, sessions, connector: null, webServer: null })
    const answer = await call('spend', { sessionId: 's' })
    assert.equal(answer.ok, true)
    assert.equal(answer.value.spend.cny, 1)
    assert.equal(answer.value.connector.mounted, false)
  })
})

test('the extension switch stops the route from doing the work', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const sessions = { s: [] }
    const connector = { s: { credit: 3, requests: 1 } }
    const { call } = await mount({ home, sessions, connector })

    const before = await call('spend', { sessionId: 's' })
    assert.equal(before.value.spend.credit, 3)

    const off = await call('extensions', { toggle: 'conversation-spend', enabled: false })
    assert.equal(off.ok, true, off.error)
    assert.equal(off.value.extensions.find((row) => row.id === 'conversation-spend').enabled, false)

    const whileOff = await call('spend', { sessionId: 's' })
    assert.equal(whileOff.value.disabled, true, 'the route must not even fold the log while off')

    const on = await call('extensions', { toggle: 'conversation-spend', enabled: true })
    assert.equal(on.ok, true, on.error)
    const after = await call('spend', { sessionId: 's' })
    assert.equal(after.value.spend.credit, 3, 'the ledger kept what it had while the feature was off')
  })
})

test('the extension route reports the ledger it has actually written', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const sessions = { s: [] }
    const connector = { s: { credit: 5.5, requests: 4 } }
    const { call } = await mount({ home, sessions, connector })
    await call('spend', { sessionId: 's' })
    const listed = await call('extensions', {})
    assert.equal(listed.ok, true, listed.error)
    assert.equal(listed.value.ledger.exists, true)
    assert.equal(listed.value.ledger.total, 1)
    assert.equal(listed.value.ledger.sessions[0].sessionId, 's')
    assert.equal(listed.value.ledger.sessions[0].credit, 5.5)
    assert.match(listed.value.ledger.path, /session-spend\.json$/)
  })
})

test('a session id is required, and an unknown one reports the host error rather than zero', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const { call } = await mount({ home, sessions: {} })
    const empty = await call('spend', {})
    assert.equal(empty.ok, false)
    assert.match(empty.error, /sessionId/)

    const unknown = await call('spend', { sessionId: 'does-not-exist' })
    assert.equal(unknown.ok, false, 'a missing log must not be reported as "spent nothing"')
  })
})

test('a corrupt ledger file is reported, and the route still answers', async (t) => {
  const home = await fixture(t)
  await withHome(home, async () => {
    const path = join(home, 'plugins-data', 'dsh-agents-models', 'session-spend.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'not json at all', 'utf8')
    const sessions = { s: [] }
    const { call } = await mount({ home, sessions, connector: { s: { credit: 2, requests: 1 } } })
    const answer = await call('spend', { sessionId: 's' })
    assert.equal(answer.ok, true)
    assert.equal(answer.value.ledger.broken, true)
    assert.equal(answer.value.spend.credit, 2, 'a corrupt file costs history, not the live figure')
  })
})
