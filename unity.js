/**
 * Unity Editor bridge — two model-facing tools over the Unity MCP server.
 *
 * Why this exists instead of mounting `@deepseek-ai/dsh-mcp-client` directly:
 * the Unity MCP server (mcp-for-unity) lists 48 tools whose JSON schemas add up
 * to ~109 KB, and it re-sends them on every step. Measured against the running
 * server on this machine: 48 tools / 109 078 bytes, and `manage_tools` group
 * activation does not change that byte count (48 / 109 078 before and after).
 * So a direct mount costs ~27k tokens of tool table per request, plus a 48-way
 * choice where `manage_gameobject`, `manage_components`, `manage_prefabs`, and
 * `manage_scene` are near-synonyms — exactly where a fast model wanders, and
 * every wrong pick is a whole round trip.
 *
 * This bridge keeps the capability and drops the surface: one dispatcher and
 * one composite check, ~2 KB of schema. It also pays the MCP handshake once per
 * project instead of once per call (measured: 179 ms handshake + 179–214 ms per
 * warm call, versus 179 ms on every call when each call re-handshakes).
 *
 * The quality lever is `unity_verify`: a compile error and a silent console
 * exception are the two things that make a "finished" Unity task wrong, and
 * both are answerable in one call. Verification is not left to the model's
 * discipline — it is one cheap tool with a fixed procedure behind it.
 *
 * @module dsh-agents-models/unity
 */

export const name = 'unity-bridge'

/** The tool registry is the seam both tools register into. */
export const inject = ['tools']

/** MCP protocol revision this bridge speaks. */
const PROTOCOL = '2025-06-18'

/** Default endpoint the Unity MCP server listens on. */
const DEFAULT_URL = 'http://127.0.0.1:8080/mcp'

/**
 * The op table the dispatcher accepts.
 *
 * `required` is the part that makes this safe to hand a fast model: a call that
 * omits one is rejected here, with the exact shape, instead of spending a round
 * trip on the server's pydantic error. `hint` is the one line that decides
 * between two ops that look alike.
 */
const OPS = Object.freeze({
  scene: { required: [], hint: 'action=get_active|get_hierarchy|load|save|get_loaded_scenes|validate|close_scene; page_size+cursor for hierarchies' },
  gameobject: { required: [], hint: 'action=create|modify|delete|duplicate|move_relative|look_at; target names the object' },
  components: { required: ['action', 'target', 'component_type'], hint: 'action=add|remove|set_property on one target' },
  asset: { required: ['action', 'path'], hint: 'action=search|get_info|create|modify|move|delete; generate_preview stays false' },
  script: { required: ['action', 'name'], hint: 'action=create|read|delete; contents is the full file body, path is project-relative' },
  apply_edits: { required: ['uri', 'edits'], hint: 'literal edits to one file; precondition_sha256 optional' },
  menu: { required: ['menu_path'], hint: 'run one Unity menu item, e.g. "Assets/Refresh"' },
  prefab: { required: ['action'], hint: 'action=get_info|get_hierarchy|create_from_gameobject|modify_contents|open_prefab_stage|save_prefab_stage' },
  build: { required: ['action'], hint: 'action=build|status; target is a BuildTarget name' },
  packages: { required: ['action'], hint: 'action=add|remove|list|search' },
  play: { required: ['action'], hint: 'action=play|pause|stop the Editor' },
  console: { required: [], hint: 'action=get|clear; types is an ARRAY like ["error","warning"], not a bare string; count caps entries' },
  tests: { required: [], hint: 'mode=EditMode|PlayMode; returns a job id, poll with op=tests_job' },
  tests_job: { required: ['job_id'], hint: 'poll run_tests' },
  refresh: { required: [], hint: 'reimport and recompile; wait_for_ready=true to block until idle' },
  eval: { required: ['code'], defaults: { action: 'execute' }, hint: 'run C# in the Editor; action defaults to execute. Return a value with `return`; requires the scripting_ext tool group' },
  docs: { required: ['action'], hint: 'action=search|get_type|get_member on the Unity API; requires the docs group' },
})

/** Which MCP tool one op calls. */
const OP_TOOL = Object.freeze({
  scene: 'manage_scene',
  gameobject: 'manage_gameobject',
  components: 'manage_components',
  asset: 'manage_asset',
  script: 'manage_script',
  apply_edits: 'apply_text_edits',
  menu: 'execute_menu_item',
  prefab: 'manage_prefabs',
  build: 'manage_build',
  packages: 'manage_packages',
  play: 'manage_editor',
  console: 'read_console',
  tests: 'run_tests',
  tests_job: 'get_test_job',
  refresh: 'refresh_unity',
  eval: 'execute_code',
  docs: 'unity_reflect',
})

/** The op list, formatted once for the tool description. */
const OP_SUMMARY = Object.entries(OPS)
  .map(([op, spec]) => (spec.required.length === 0 ? op : `${op}(${spec.required.join(',')})`))
  .join(' ')

/** Argument names that belong to the bridge rather than to the MCP tool. */
const BRIDGE_ARGS = new Set(['op', 'args'])

/**
 * One MCP connection per endpoint, reused across calls.
 *
 * A session is `initialize` + `notifications/initialized`, after which the
 * server addresses every request by the `mcp-session-id` header. The server
 * answers `404 Session not found` when it has dropped that id (a Unity restart
 * or a server restart), which is the one case worth a fresh handshake.
 */
export class UnitySession {
  #url
  #timeoutMs
  #sessionId
  #ready
  #nextId = 1
  #closed = false

  /**
   * @param options endpoint and per-request timeout.
   */
  constructor({ url = DEFAULT_URL, timeoutMs = 60_000 } = {}) {
    this.#url = url
    this.#timeoutMs = timeoutMs
  }

  /** True once a handshake has produced a session id. */
  get connected() {
    return this.#sessionId !== undefined
  }

  /** Drop the current session; the next call handshakes again. */
  reset() {
    this.#sessionId = undefined
    this.#ready = undefined
  }

  /** Release the session. A closed session refuses further work. */
  close() {
    this.#closed = true
    this.reset()
  }

  /**
   * One JSON-RPC request against the session, handshaking on demand.
   *
   * @param method the JSON-RPC method.
   * @param params its params object.
   * @returns the `result` member of the response.
   */
  async request(method, params) {
    if (this.#closed) throw new Error('the Unity bridge session is closed')
    if (this.#sessionId === undefined) {
      return unwrap(await this.#post(method, params, await this.#handshake()))
    }
    const first = await this.#post(method, params, this.#sessionId)
    if (!isStaleSession(first)) return unwrap(first)
    // The server forgot the session (or never had it): handshake, then retry once.
    this.reset()
    return unwrap(await this.#post(method, params, await this.#handshake()))
  }

  /** Establish a session and keep its id. */
  async #handshake() {
    this.#ready ??= (async () => {
      const init = await this.#post('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'dsh-unity-bridge', version: '1' },
      }, undefined)
      if (init.status !== 200) throw new Error(`Unity MCP initialize failed: HTTP ${String(init.status)}`)
      const sessionId = init.sessionId
      if (sessionId === undefined) throw new Error('Unity MCP initialize returned no mcp-session-id header')
      // The notification is a courtesy the protocol asks for; a server that
      // ignores it still answers requests, so its failure is not fatal.
      await this.#post('notifications/initialized', undefined, sessionId).catch(() => undefined)
      this.#sessionId = sessionId
      return sessionId
    })().catch((error) => {
      this.#ready = undefined
      throw error
    })
    return await this.#ready
  }

  /** POST one JSON-RPC message and read the SSE-framed reply. */
  async #post(method, params, sessionId) {
    const id = this.#nextId++
    const body = params === undefined
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', id, method, params }
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL,
    }
    if (sessionId !== undefined) headers['mcp-session-id'] = sessionId
    const response = await fetch(this.#url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    })
    const text = await response.text()
    return {
      status: response.status,
      sessionId: response.headers.get('mcp-session-id') ?? sessionId,
      id,
      text,
    }
  }
}

/** Pull the JSON-RPC payload out of one SSE or plain-JSON response body. */
function parseBody(text, id) {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }
  // SSE: several `data:` lines may arrive; the reply is the one carrying our id.
  let last
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (data === '') continue
    let message
    try {
      message = JSON.parse(data)
    } catch {
      continue
    }
    if (message.id === id) return message
    last = message
  }
  return last
}

/** True when the server rejects the request because it does not know the session. */
function isStaleSession(outcome) {
  if (outcome.status === 404) return true
  if (outcome.status !== 400) return false
  return /session/i.test(outcome.text.slice(0, 300))
}

/** Turn one POST outcome into a `result`, or throw with the server's reason. */
function unwrap(outcome) {
  if (outcome.status === 202) return undefined
  const message = parseBody(outcome.text, outcome.id)
  if (outcome.status !== 200) {
    const reason = message?.error?.message ?? outcome.text.slice(0, 300)
    throw new Error(`Unity MCP HTTP ${String(outcome.status)}: ${reason}`)
  }
  if (message === undefined) throw new Error('Unity MCP returned an unreadable body')
  if (message.error !== undefined) throw new Error(`Unity MCP error: ${String(message.error.message ?? '')}`)
  return message.result
}

/**
 * A session plus the two questions the bridge asks it.
 *
 * `callTool` unwraps the MCP `content[].text` envelope, because every Unity MCP
 * tool returns its payload as a JSON string inside a text block; leaving that
 * wrapping in place would make every result twice as long and unreadable.
 */
export class UnityBridge {
  #session
  #verbs

  /**
   * @param options endpoint and timeout for the underlying MCP session.
   */
  constructor(options = {}) {
    this.#session = new UnitySession(options)
  }

  /** The session, exposed so a caller can reset it after a Unity restart. */
  get session() {
    return this.#session
  }

  /**
   * Invoke one Unity MCP tool and return its decoded payload.
   *
   * @param toolName the MCP tool name.
   * @param args its arguments object.
   * @returns the parsed payload, or the raw text when it is not JSON.
   */
  async callTool(toolName, args) {
    const result = await this.#session.request('tools/call', { name: toolName, arguments: args })
    const blocks = Array.isArray(result?.content) ? result.content : []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    const decoded = decodePayload(text)
    if (result?.isError === true) {
      throw new Error(typeof decoded === 'string' ? decoded : JSON.stringify(decoded))
    }
    return decoded
  }

  /**
   * The op names this bridge accepts, for a correction message.
   *
   * @returns the sorted op list.
   */
  ops() {
    return Object.keys(OPS)
  }

  /**
   * Dispatch one op.
   *
   * @param op one key of {@link OPS}.
   * @param args its arguments; `required` names are enforced before the call.
   * @returns the decoded payload plus the tools actually invoked.
   */
  async run(op, args) {
    const spec = OPS[op]
    if (spec === undefined) {
      throw new Error(`unknown op "${String(op)}". Ops: ${OP_SUMMARY}`)
    }
    const payload = { ...(args ?? {}) }
    // Server-mandated arguments the model should not have to repeat. Applied
    // only when the caller left them out, so an explicit value still wins.
    for (const [key, value] of Object.entries(spec.defaults ?? {})) {
      if (!hasValue(payload[key])) payload[key] = value
    }
    for (const key of Object.keys(payload)) if (BRIDGE_ARGS.has(key)) delete payload[key]
    const missing = spec.required.filter((key) => !hasValue(payload[key]))
    if (missing.length > 0) {
      throw new Error(
        `op "${op}" needs ${missing.join(', ')}. Shape: ${spec.required.map((k) => `${k}=…`).join(' ')}` +
          ` — ${spec.hint}`,
      )
    }
    const tool = OP_TOOL[op]
    return { op, tool, value: await this.callTool(tool, payload) }
  }

  /**
   * The composite check: is the project actually healthy after a change?
   *
   * Compilation state, cached console errors, and (optionally) a test run are
   * the three facts a Unity change is judged on, and they live behind three
   * different MCP surfaces. One call answers all of them, so "did this work" is
   * never a chain of guesses.
   *
   * @param options `tests` adds a synchronous test run when the project is clean.
   * @returns one report object.
   */
  async verify({ tests = false } = {}) {
    const report = { verdict: 'unknown', compiled: undefined, errors: [], warnings: 0, tests: undefined }
    let state
    try {
      const result = await this.#session.request('resources/read', { uri: 'mcpforunity://editor/state' })
      const text = result?.contents?.[0]?.text
      state = typeof text === 'string' ? decodePayload(text) : undefined
    } catch (error) {
      report.verdict = `unreachable: ${errorMessage(error)}`
      return report
    }
    // Every field below is read from the live server's editor-state payload;
    // `compilation.last_compile_ok` does not exist there, so compile health is
    // inferred from the two flags the server does publish.
    const data = state?.data ?? {}
    const compilation = data.compilation ?? {}
    const assets = data.assets ?? {}
    const testsState = data.tests ?? {}
    const advice = data.advice ?? {}
    const staleness = data.staleness ?? {}

    report.editorReady = advice.ready_for_tools
    report.blocking = Array.isArray(advice.blocking_reasons) ? advice.blocking_reasons : []
    report.scene = data.editor?.active_scene?.path
    report.playMode = data.editor?.play_mode?.is_playing === true
    report.compiling = compilation.is_compiling === true
    report.domainReloadPending = compilation.is_domain_reload_pending === true
    report.assetsUpdating = assets.is_updating === true
    report.externalChangesDirty = assets.external_changes_dirty === true
    report.testsRunning = testsState.is_running === true
    report.stateStale = staleness.is_stale === true
    // A finished domain reload is the only positive evidence the Editor compiled
    // this code; `undefined` means it has never reloaded since the Editor opened.
    report.compiled = compilation.is_compiling === true
      ? false
      : compilation.last_domain_reload_after_unix_ms !== null &&
        compilation.last_domain_reload_after_unix_ms !== undefined

    const console = await this.callTool('read_console', { action: 'get', types: ['error', 'warning'], count: 40 })
    const entries = collectConsole(console)
    report.errors = entries.filter((entry) => entry.type === 'error').slice(0, 20)
    report.warnings = entries.filter((entry) => entry.type === 'warning').length

    if (report.errors.length > 0) report.verdict = 'errors'
    else if (report.compiling) report.verdict = 'compiling'
    else if (report.domainReloadPending) report.verdict = 'domain-reload-pending'
    else if (report.assetsUpdating || report.externalChangesDirty) report.verdict = 'assets-dirty'
    // A stale snapshot or an Editor that is not ready for tools is not a clean
    // bill of health: the console read above may predate the change entirely.
    else if (report.stateStale || report.editorReady === false) report.verdict = 'not-ready'
    else if (tests) {
      report.tests = await this.#runTests()
      report.verdict = report.tests.passed === true
        ? 'clean'
        : report.tests.passed === false ? 'tests-failed' : 'tests-unknown'
    } else report.verdict = 'clean'
    return report
  }

  /** Start a test run and poll it to completion, bounded to five minutes. */
  async #runTests() {
    const started = await this.callTool('run_tests', { mode: 'EditMode' })
    const jobId = findJobId(started)
    if (jobId === undefined) return { passed: undefined, note: 'run_tests returned no job id', raw: started }
    const deadline = Date.now() + 300_000
    let last = started
    while (Date.now() < deadline) {
      const polled = await this.callTool('get_test_job', { job_id: jobId })
      last = polled
      const status = String(findField(polled, ['status', 'state']) ?? '').toLowerCase()
      if (/completed|passed|failed|done|finished/.test(status)) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const failed = Number(findField(last, ['failed', 'failed_count']) ?? 0)
    const ok = Number(findField(last, ['passed', 'passed_count']) ?? 0)
    // Three outcomes, not two: a job that never reported a count is unknown, and
    // calling that "passed" would be the exact false reassurance this guards against.
    const passed = failed > 0 ? false : ok > 0 ? true : undefined
    return { jobId, passed, failed, passedCount: ok }
  }
}

/** True when an argument carries a value the server will accept. */
function hasValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** Decode a payload that may be a JSON string, an fenced JSON string, or text. */
function decodePayload(text) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-zA-Z]*\r?\n/, '').replace(/\r?\n```$/, '')
    : trimmed
  if (!/^[[{]/.test(unfenced)) return trimmed
  try {
    return JSON.parse(unfenced)
  } catch {
    return trimmed
  }
}

/** Flatten the console payload shapes the server returns into `{type, message}`. */
function collectConsole(payload) {
  const raw = payload?.data ?? payload?.logs ?? payload?.entries ?? payload
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : []
  return list.map((entry) => {
    const type = String(entry?.type ?? entry?.level ?? entry?.logType ?? '').toLowerCase()
    const message = String(entry?.message ?? entry?.text ?? entry?.msg ?? '').slice(0, 500)
    return { type: type.includes('err') ? 'error' : type.includes('warn') ? 'warning' : 'log', message }
  })
}

/** Depth-first search for the first field with one of the given names. */
function findField(value, names, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 6) return undefined
  for (const key of names) if (value[key] !== undefined) return value[key]
  for (const child of Object.values(value)) {
    const found = findField(child, names, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** The job id of a test run, across the shapes the server has used. */
function findJobId(payload) {
  const direct = findField(payload, ['job_id', 'jobId', 'id'])
  if (typeof direct === 'string' && direct !== '') return direct
  if (typeof direct === 'number') return String(direct)
  return undefined
}

/** One-line error text. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the two tool definitions for one bridge.
 *
 * The definitions are plain objects rather than `defineTool(...)` output on
 * purpose: the registry only requires `{ name, description, parameters,
 * output: { schema, render }, execute }`, and importing the toolkit would add a
 * module-resolution dependency this package does not otherwise need.
 *
 * @param bridge the bridge the tools drive.
 * @returns the definitions, dispatcher first.
 */
export function unityTools(bridge) {
  return [
    {
      name: 'unity',
      description:
        'Run one operation against the live Unity Editor over MCP. Always check the Editor is ' +
        'reachable with op=refresh (or op=console) before a scene change, and call unity_verify ' +
        'after any script or asset edit. Ops: ' +
        OP_SUMMARY +
        '. Put every other MCP argument inside `args` verbatim (e.g. ' +
        '{op:"scene", args:{action:"get_hierarchy", page_size:50}}). Prefer one page_size-limited ' +
        'call over a full hierarchy dump.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: Object.keys(OPS), description: 'The operation to run.' },
          args: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments forwarded to the Unity MCP tool unchanged.',
          },
        },
        required: ['op'],
      },
      output: {
        // `type: 'json'` is not a supported schema type in dsh-tools: the
        // registry rejects the whole tool with "schema.type must be one of
        // object/array/string/number/integer/boolean/null", which is what made
        // the Unity mode fail to activate. An open object accepts any payload.
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: formatPayload(value) }],
      },
      timeoutMs: 180_000,
      isConcurrencySafe: () => false,
      async execute(args) {
        const { op, args: inner } = args ?? {}
        const result = await bridge.run(op, inner ?? {})
        return result
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `Unity: ${String(args?.op ?? 'op')}`,
        kind: 'execute',
        rawInput: args?.args,
      }),
    },
    {
      name: 'unity_verify',
      description:
        'Answer "did my Unity change actually work" in one call: compile state, the Editor console ' +
        'errors and warning count, the active scene, play mode, and — with tests=true — an EditMode ' +
        'test run. Call this after every script, prefab, or asset edit, before reporting the task ' +
        'done. verdict=clean is the only value that means the change is safe.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tests: {
            type: 'boolean',
            description: 'Also run the EditMode test suite synchronously. Slow (tens of seconds); use it when the change touches tested logic.',
          },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: formatPayload(value) }],
      },
      timeoutMs: 400_000,
      isConcurrencySafe: () => false,
      async execute(args) {
        return await bridge.verify({ tests: args?.tests === true })
      },
      presentCall: () => ({ card: 'generic', title: 'Verify Unity project health', kind: 'read' }),
    },
  ]
}

/** Render one payload as compact JSON, with a byte cap that keeps a console dump bounded. */
function formatPayload(value) {
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  const CAP = 24_000
  if (text.length <= CAP) return text
  return `${text.slice(0, CAP)}\n… truncated (${String(text.length - CAP)} characters dropped; narrow the query or use page_size)`
}

/**
 * Mount the bridge inside the agent scope the preset row runs in.
 *
 * A Unity Editor is not always open, and a preset that refused to activate
 * without one would be unusable half the time — so a failed connection is not
 * thrown here. The tools still register, and the first call reports the
 * transport error in-band, where the model can act on it.
 *
 * @param ctx the registrant context carrying the tool registry.
 * @param config endpoint and timeouts.
 */
export function apply(ctx, config = {}) {
  if (typeof ctx?.tools?.register !== 'function') return
  const settings = {
    url: typeof config.url === 'string' && config.url !== '' ? config.url : DEFAULT_URL,
    timeoutMs: Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 60_000,
  }
  const bridge = new UnityBridge(settings)
  const disposers = unityTools(bridge).map((tool) => ctx.tools.register(tool))
  ctx.effect?.(
    () => () => {
      for (const dispose of disposers) dispose()
      bridge.session.close()
    },
    'unity bridge',
  )
}
