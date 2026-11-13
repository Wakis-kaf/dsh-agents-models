// Statistics fold: the page's numbers come from these pure functions, so the
// arithmetic is checked against a hand-written log rather than a live session.
//
// Run with: node test/stats.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { aggregateSessions, summarizeSession } from '../stats.js'

const HEADER = {
  version: 4,
  id: 'session-1',
  createdAt: 1_000,
  cwd: 'D:\\learn\\demo',
  isSeeded: false,
  agentPreset: 'cordis',
}

/** One log with two turns, three tool calls, one failure, and a cancelled call. */
const EVENTS = [
  { type: 'agent-preset/selected', seq: 1, time: 1_010, data: { agentPreset: 'flash' } },
  { type: 'model/selection', seq: 2, time: 1_020, data: { provider: 'deepseek-account', model: 'deepseek-flash' } },
  { type: 'session/title', seq: 3, time: 1_030, data: { title: 'Demo session' } },
  { type: 'request/context', seq: 4, time: 1_040, data: { provider: 'deepseek-account', model: 'deepseek-flash', contextWindow: 1_048_576 } },

  { type: 'turn/start', seq: 5, time: 1_100, data: { turn: 1 } },
  { type: 'step/start', seq: 6, time: 1_100, data: { turn: 1, step: 1 } },
  {
    type: 'assistant/message',
    seq: 7,
    time: 3_100,
    data: {
      turn: 1,
      step: 1,
      usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 4_000, cacheWriteTokens: 0, totalTokens: 5_200 },
    },
  },
  { type: 'tool/call', seq: 8, time: 3_200, data: { turn: 1, step: 1, callId: 'call-a', name: 'pwsh' } },
  {
    type: 'tool/result',
    seq: 9,
    time: 4_200,
    data: { turn: 1, step: 1, message: { toolCallId: 'call-a', isError: false } },
  },
  { type: 'tool/call', seq: 10, time: 4_300, data: { turn: 1, step: 1, callId: 'call-b', name: 'read' } },
  {
    type: 'tool/result',
    seq: 11,
    time: 4_400,
    data: { turn: 1, step: 1, message: { toolCallId: 'call-b', isError: true } },
  },
  { type: 'step/end', seq: 12, time: 4_500, data: { turn: 1, step: 1 } },

  { type: 'turn/start', seq: 13, time: 5_000, data: { turn: 2 } },
  { type: 'step/start', seq: 14, time: 5_000, data: { turn: 2, step: 2 } },
  {
    type: 'assistant/message',
    seq: 15,
    time: 6_000,
    data: {
      turn: 2,
      step: 2,
      usage: { inputTokens: 500, outputTokens: 100, cacheReadTokens: 5_000, cacheWriteTokens: 0, totalTokens: 5_600 },
    },
  },
  { type: 'tool/call', seq: 16, time: 6_100, data: { turn: 2, step: 2, callId: 'call-c', name: 'pwsh' } },
  {
    type: 'tool/result',
    seq: 17,
    time: 8_100,
    data: { turn: 2, step: 2, message: { toolCallId: 'call-c', isError: false } },
  },
  // Dispatched, never resolved: the turn ends while it is still in flight.
  { type: 'tool/call', seq: 18, time: 8_200, data: { turn: 2, step: 2, callId: 'call-d', name: 'web_fetch' } },
  { type: 'step/end', seq: 19, time: 8_300, data: { turn: 2, step: 2 } },
  { type: 'turn/end', seq: 20, time: 8_400, data: { turn: 2 } },
]

test('turns and steps count closed steps, not started ones', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.equal(summary.turns, 2)
  assert.equal(summary.steps, 2)
})

test('model time is step start to assembled message', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.equal(summary.llmMs, 2_000 + 1_000)
})

test('tool time pairs each call with its result and ignores unresolved calls', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.equal(summary.toolMs, 1_000 + 100 + 2_000)
  assert.equal(summary.calls, 4)
  assert.equal(summary.pending, 1)
  assert.equal(summary.errors, 1)
})

test('per-tool rows are ranked by total time, with failures attached', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.deepEqual(summary.tools.map((tool) => tool.name), ['pwsh', 'read', 'web_fetch'])
  const [pwsh, read, fetch] = summary.tools
  assert.equal(pwsh.calls, 2)
  assert.equal(pwsh.ms, 3_000)
  assert.equal(pwsh.maxMs, 2_000)
  assert.equal(pwsh.avgMs, 1_500)
  assert.equal(read.errors, 1)
  assert.equal(fetch.pending, 1)
  assert.equal(fetch.ms, 0)
  assert.ok(Math.abs(pwsh.share - 3_000 / 3_100) < 1e-9)
})

test('tokens add up, context is the last step, cache hit is read over billed', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.deepEqual(summary.tokens, {
    input: 1_500,
    output: 300,
    cacheRead: 9_000,
    cacheWrite: 0,
    total: 10_800,
  })
  assert.equal(summary.contextTokens, 5_600)
  assert.equal(summary.contextWindow, 1_048_576)
  assert.ok(Math.abs(summary.cacheHitRate - 9_000 / 10_500) < 1e-9)
  assert.equal(summary.model, 'deepseek-flash')
})

test('the effective preset comes from the last selection event', () => {
  const summary = summarizeSession(HEADER, EVENTS)
  assert.equal(summary.preset, 'flash', 'the header preset is overridden by the log')
  assert.equal(summary.title, 'Demo session')
  assert.equal(summary.durationMs, 8_400 - 1_000)
})

test('a log without usage or tools folds to zeroes instead of NaN', () => {
  const summary = summarizeSession({ id: 's', createdAt: 10 }, [])
  assert.equal(summary.tokens.total, 0)
  assert.equal(summary.cacheHitRate, 0)
  assert.equal(summary.toolMs, 0)
  assert.deepEqual(summary.tools, [])
})

test('the aggregate merges tool rows and totals across sessions', () => {
  const a = summarizeSession(HEADER, EVENTS)
  const b = summarizeSession({ ...HEADER, id: 'session-2' }, [
    { type: 'step/start', seq: 1, time: 100, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: 2,
      time: 200,
      data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
    },
    { type: 'tool/call', seq: 3, time: 300, data: { turn: 1, step: 1, callId: 'x', name: 'pwsh' } },
    { type: 'tool/result', seq: 4, time: 800, data: { turn: 1, step: 1, message: { toolCallId: 'x' } } },
    { type: 'step/end', seq: 5, time: 900, data: { turn: 1, step: 1 } },
  ])

  const totals = aggregateSessions([a, b])
  assert.equal(totals.sessions, 2)
  assert.equal(totals.turns, 3)
  assert.equal(totals.steps, 3)
  assert.equal(totals.calls, 5)
  assert.equal(totals.toolMs, 3_100 + 500)
  assert.equal(totals.tokens.input, 1_600)
  const pwsh = totals.tools.find((tool) => tool.name === 'pwsh')
  assert.equal(pwsh.calls, 3)
  assert.equal(pwsh.ms, 3_500)
  assert.equal(totals.tools[0].name, 'pwsh', 'the ranking is by total time')
})
