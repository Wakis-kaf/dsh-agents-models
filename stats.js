/**
 * Session statistics for the mode editor.
 *
 * A pure fold over one durable session log: turns and steps, model and tool
 * wall time, provider token usage, context size, and the per-tool breakdown the
 * editor uses to point at the expensive tool. Nothing here touches the host —
 * the caller supplies the events `ctx.sessionQuery.readSession()` returned, so
 * the fold is testable without a running harness.
 *
 * The event shapes are the durable ones: `step/start` → `assistant/message`
 * bounds model time, `tool/call` → `tool/result` bounds one tool call by
 * callId, `step/end` is the counted step, and `assistant/message` carries the
 * provider usage record.
 *
 * @module dsh-agents-models/stats
 */

/** Coerce anything to a non-negative finite number. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Read one usage record into the flat token totals. */
function readUsage(usage) {
  if (typeof usage !== 'object' || usage === null) return null
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const total = count(usage.totalTokens) || input + output + cacheRead + cacheWrite
  if (input + output + cacheRead + cacheWrite + total === 0) return null
  return { input, output, cacheRead, cacheWrite, total }
}

/** Tool accumulator for one tool name. */
function bucketFor(map, name) {
  let bucket = map.get(name)
  if (bucket === undefined) {
    bucket = { name, calls: 0, ms: 0, maxMs: 0, errors: 0, pending: 0 }
    map.set(name, bucket)
  }
  return bucket
}

/** One session's totals, plus the per-tool rows sorted by total time. */
export function summarizeSession(header, events) {
  const createdAt = count(header?.createdAt)
  const summary = {
    id: typeof header?.id === 'string' ? header.id : '',
    title: '',
    cwd: typeof header?.cwd === 'string' ? header.cwd : '',
    preset: typeof header?.agentPreset === 'string' ? header.agentPreset : '',
    createdAt,
    endedAt: createdAt,
    live: false,
    model: '',
    provider: '',
    contextWindow: 0,
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    contextTokens: 0,
    calls: 0,
    errors: 0,
    pending: 0,
    tools: [],
  }

  const pendingCalls = new Map()
  const byName = new Map()
  let openStep = null
  let lastTurn = null
  let lastTime = createdAt

  for (const event of Array.isArray(events) ? events : []) {
    if (typeof event?.time === 'number' && event.time > lastTime) lastTime = event.time
    const data = event?.data
    switch (event?.type) {
      case 'step/start':
        openStep = { turn: data?.turn, step: data?.step, startTime: count(event.time) }
        break
      case 'assistant/message': {
        if (openStep !== null && openStep.turn === data?.turn && openStep.step === data?.step) {
          summary.llmMs += Math.max(0, count(event.time) - openStep.startTime)
        }
        const usage = readUsage(data?.usage)
        if (usage !== null) {
          summary.tokens.input += usage.input
          summary.tokens.output += usage.output
          summary.tokens.cacheRead += usage.cacheRead
          summary.tokens.cacheWrite += usage.cacheWrite
          summary.tokens.total += usage.total
          summary.contextTokens = usage.total
        }
        openStep = null
        break
      }
      case 'step/end': {
        const turn = data?.turn
        if (lastTurn !== turn) {
          summary.turns += 1
          lastTurn = turn
        }
        summary.steps += 1
        openStep = null
        break
      }
      case 'tool/call': {
        const callId = typeof data?.callId === 'string' ? data.callId : ''
        const name = typeof data?.name === 'string' && data.name !== '' ? data.name : 'unknown'
        summary.calls += 1
        bucketFor(byName, name).calls += 1
        if (callId !== '') pendingCalls.set(callId, { name, time: count(event.time) })
        break
      }
      case 'tool/result': {
        const message = data?.message
        const callId =
          typeof message?.toolCallId === 'string'
            ? message.toolCallId
            : typeof message?.source?.callId === 'string'
              ? message.source.callId
              : ''
        const dispatched = callId === '' ? undefined : pendingCalls.get(callId)
        if (dispatched === undefined) break
        pendingCalls.delete(callId)
        const elapsed = Math.max(0, count(event.time) - dispatched.time)
        const bucket = bucketFor(byName, dispatched.name)
        bucket.ms += elapsed
        bucket.maxMs = Math.max(bucket.maxMs, elapsed)
        if (message?.isError === true) {
          bucket.errors += 1
          summary.errors += 1
        }
        summary.toolMs += elapsed
        break
      }
      case 'agent-preset/selected':
        if (typeof data?.agentPreset === 'string' && data.agentPreset !== '') {
          summary.preset = data.agentPreset
        }
        break
      case 'model/selection':
        if (typeof data?.model === 'string') summary.model = data.model
        if (typeof data?.provider === 'string') summary.provider = data.provider
        break
      case 'request/context':
        if (typeof data?.model === 'string' && data.model !== '') summary.model = data.model
        if (typeof data?.provider === 'string' && data.provider !== '') summary.provider = data.provider
        if (typeof data?.contextWindow === 'number') summary.contextWindow = data.contextWindow
        break
      case 'session/title':
        if (typeof data?.title === 'string' && data.title.trim() !== '') {
          summary.title = data.title.trim()
        }
        break
      default:
        break
    }
  }

  // A call that never got its result was interrupted: counted as a call, but
  // contributing no wall time to the totals.
  for (const { name } of pendingCalls.values()) {
    bucketFor(byName, name).pending += 1
    summary.pending += 1
  }

  summary.endedAt = lastTime
  summary.durationMs = Math.max(0, lastTime - createdAt)

  const total = summary.toolMs
  summary.tools = [...byName.values()]
    .map((bucket) => ({
      ...bucket,
      avgMs: bucket.calls === 0 ? 0 : Math.round(bucket.ms / bucket.calls),
      share: total === 0 ? 0 : bucket.ms / total,
    }))
    .sort((a, b) => b.ms - a.ms || b.calls - a.calls || a.name.localeCompare(b.name))

  const billed = summary.tokens.input + summary.tokens.cacheRead + summary.tokens.cacheWrite
  summary.cacheHitRate = billed === 0 ? 0 : summary.tokens.cacheRead / billed

  return summary
}

/** Roll a list of summaries into one row: totals plus a per-tool ranking. */
export function aggregateSessions(sessions) {
  const totals = {
    sessions: 0,
    turns: 0,
    steps: 0,
    durationMs: 0,
    llmMs: 0,
    toolMs: 0,
    calls: 0,
    errors: 0,
    pending: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cacheHitRate: 0,
    tools: [],
  }
  const byName = new Map()

  for (const session of Array.isArray(sessions) ? sessions : []) {
    totals.sessions += 1
    totals.turns += count(session.turns)
    totals.steps += count(session.steps)
    totals.durationMs += count(session.durationMs)
    totals.llmMs += count(session.llmMs)
    totals.toolMs += count(session.toolMs)
    totals.calls += count(session.calls)
    totals.errors += count(session.errors)
    totals.pending += count(session.pending)
    totals.tokens.input += count(session.tokens?.input)
    totals.tokens.output += count(session.tokens?.output)
    totals.tokens.cacheRead += count(session.tokens?.cacheRead)
    totals.tokens.cacheWrite += count(session.tokens?.cacheWrite)
    totals.tokens.total += count(session.tokens?.total)
    for (const tool of Array.isArray(session.tools) ? session.tools : []) {
      const bucket = bucketFor(byName, tool.name)
      bucket.calls += count(tool.calls)
      bucket.ms += count(tool.ms)
      bucket.maxMs = Math.max(bucket.maxMs, count(tool.maxMs))
      bucket.errors += count(tool.errors)
      bucket.pending += count(tool.pending)
    }
  }

  const billed = totals.tokens.input + totals.tokens.cacheRead + totals.tokens.cacheWrite
  totals.cacheHitRate = billed === 0 ? 0 : totals.tokens.cacheRead / billed
  totals.tools = [...byName.values()]
    .map((bucket) => ({
      ...bucket,
      avgMs: bucket.calls === 0 ? 0 : Math.round(bucket.ms / bucket.calls),
      share: totals.toolMs === 0 ? 0 : bucket.ms / totals.toolMs,
    }))
    .sort((a, b) => b.ms - a.ms || b.calls - a.calls || a.name.localeCompare(b.name))

  return totals
}
