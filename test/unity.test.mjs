// Unity bridge checks against a fake MCP server.
//
// The fake speaks the same three things the real mcp-for-unity server does:
// `initialize` returns a session id header, every request is addressed by that
// header (a missing/unknown one is a 400 "Missing session ID"), and tool results
// carry their payload as a JSON string inside `content[].text`. That is where
// the bridge's bugs live, so that is what this drives.
//
// Run with: node test/unity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { UnityBridge, UnitySession, unityTools } from '../unity.js'

/** A fake MCP server that records how many handshakes it served. */
async function fakeServer() {
  const state = { handshakes: 0, calls: [], sessions: new Set(), console: [], state: undefined }

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const message = JSON.parse(body)
      const send = (payload, headers = {}) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers })
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
      }

      if (message.method === 'initialize') {
        state.handshakes += 1
        const sessionId = `session-${String(state.handshakes)}`
        state.sessions.add(sessionId)
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }, {
          'mcp-session-id': sessionId,
        })
        return
      }
      if (message.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }

      const sessionId = req.headers['mcp-session-id']
      if (sessionId === undefined || !state.sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end('{"detail":"Missing session ID"}')
        return
      }

      if (message.method === 'resources/read') {
        send({ jsonrpc: '2.0', id: message.id, result: { contents: [{ text: JSON.stringify(state.state) }] } })
        return
      }
      if (message.method === 'tools/call') {
        const name = message.params.name
        const args = message.params.arguments ?? {}
        state.calls.push({ name, args })
        if (name === 'read_console') {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ success: true, data: state.console }) }] },
          })
          return
        }
        if (name === 'manage_scene' && args.action === 'get_active') {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { name: 'Game' } }) }] },
          })
          return
        }
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { isError: true, content: [{ type: 'text', text: `bad action ${String(args.action)}` }] },
        })
      }
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    state,
    async close() {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('one handshake serves every later call', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    await bridge.callTool('read_console', { action: 'get' })
    await bridge.callTool('read_console', { action: 'get' })
    await bridge.callTool('read_console', { action: 'get' })
    assert.equal(fake.state.handshakes, 1, 'the bridge re-handshook on a warm call')
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('a dropped session is re-established once, then the call is retried', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    await bridge.callTool('read_console', { action: 'get' })
    // The server forgot the session — a Unity or server restart looks like this.
    fake.state.sessions.clear()
    const value = await bridge.callTool('read_console', { action: 'get' })
    assert.equal(fake.state.handshakes, 2, 'a stale session was not re-established')
    assert.equal(value.success, true, 'the retried call did not return the payload')
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('dispatch reaches the mapped MCP tool and decodes the nested payload', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    const result = await bridge.run('scene', { action: 'get_active' })
    assert.equal(result.tool, 'manage_scene')
    assert.deepEqual(result.value.data, { name: 'Game' })
    assert.deepEqual(fake.state.calls.at(-1), { name: 'manage_scene', args: { action: 'get_active' } })
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('a missing required argument fails locally, before any request', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    await assert.rejects(
      () => bridge.run('components', { action: 'add' }),
      /needs target, component_type/,
    )
    assert.equal(fake.state.calls.length, 0, 'the bridge spent a round trip on a shape error')
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('an unknown op lists the ops rather than guessing', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    await assert.rejects(() => bridge.run('nope', {}), /unknown op "nope"/)
    await assert.rejects(() => bridge.run('nope', {}), /scene/)
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('a server-side isError becomes a thrown error carrying its text', async () => {
  const fake = await fakeServer()
  try {
    const bridge = new UnityBridge({ url: fake.url })
    await assert.rejects(() => bridge.run('scene', { action: 'explode' }), /bad action explode/)
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('verify reports compile, console, scene, and play-mode facts', async () => {
  const fake = await fakeServer()
  fake.state.state = {
    data: {
      editor: { active_scene: { path: 'Assets/Scenes/Game.unity' }, play_mode: { is_playing: true } },
      compilation: { is_compiling: false, is_domain_reload_pending: false, last_domain_reload_after_unix_ms: 1 },
      assets: { is_updating: false, external_changes_dirty: false },
      tests: { is_running: false },
      advice: { ready_for_tools: true, blocking_reasons: [] },
      staleness: { is_stale: false },
    },
  }
  fake.state.console = [
    { type: 'warning', message: 'obsolete API' },
    { type: 'error', message: 'NullReferenceException at Foo.Update' },
  ]
  try {
    const bridge = new UnityBridge({ url: fake.url })
    const report = await bridge.verify()
    assert.equal(report.verdict, 'errors')
    assert.equal(report.errors.length, 1)
    assert.match(report.errors[0].message, /NullReference/)
    assert.equal(report.warnings, 1)
    assert.equal(report.scene, 'Assets/Scenes/Game.unity')
    assert.equal(report.playMode, true)
    assert.equal(report.editorReady, true)
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('verify says clean only when the console is quiet and no reload is pending', async () => {
  const fake = await fakeServer()
  fake.state.state = {
    data: {
      editor: { active_scene: { path: 'Assets/Scenes/Game.unity' }, play_mode: { is_playing: false } },
      compilation: { is_compiling: false, is_domain_reload_pending: false, last_domain_reload_after_unix_ms: 1 },
      assets: { is_updating: false, external_changes_dirty: false },
      tests: { is_running: false },
      advice: { ready_for_tools: true },
      staleness: { is_stale: false },
    },
  }
  try {
    const bridge = new UnityBridge({ url: fake.url })
    const report = await bridge.verify()
    assert.equal(report.verdict, 'clean')
    assert.deepEqual(report.errors, [])
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('verify reports a pending domain reload instead of claiming clean', async () => {
  const fake = await fakeServer()
  fake.state.state = {
    data: {
      compilation: { is_compiling: false, is_domain_reload_pending: true, last_domain_reload_after_unix_ms: 1 },
      assets: {},
      tests: {},
      advice: {},
      staleness: {},
    },
  }
  try {
    const bridge = new UnityBridge({ url: fake.url })
    const report = await bridge.verify()
    assert.equal(report.verdict, 'domain-reload-pending')
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('a stale editor snapshot is not reported as clean', async () => {
  const fake = await fakeServer()
  fake.state.state = {
    data: {
      compilation: { is_compiling: false, is_domain_reload_pending: false, last_domain_reload_after_unix_ms: 1 },
      assets: {},
      tests: {},
      advice: { ready_for_tools: false, blocking_reasons: ['stale_status'] },
      staleness: { is_stale: true },
    },
  }
  try {
    const bridge = new UnityBridge({ url: fake.url })
    const report = await bridge.verify()
    assert.equal(report.verdict, 'not-ready', 'a stale snapshot passed as clean')
    assert.deepEqual(report.blocking, ['stale_status'])
    bridge.session.close()
  } finally {
    await fake.close()
  }
})

test('an unreachable server becomes a verdict, not a crash', async () => {
  const bridge = new UnityBridge({ url: 'http://127.0.0.1:1/mcp', timeoutMs: 2000 })
  const report = await bridge.verify()
  assert.match(report.verdict, /^unreachable: /)
  bridge.session.close()
})

test('a closed session refuses further work', async () => {
  const session = new UnitySession({ url: 'http://127.0.0.1:1/mcp', timeoutMs: 2000 })
  session.close()
  await assert.rejects(() => session.request('tools/list'), /session is closed/)
})

test('the two tools declare a bounded schema and a full output contract', async () => {
  const bridge = new UnityBridge()
  const tools = unityTools(bridge)
  assert.deepEqual(tools.map((tool) => tool.name), ['unity', 'unity_verify'])
  const bytes = Buffer.byteLength(
    JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))),
  )
  // The whole point of this bridge: the tool table stays small enough to resend
  // every step. The direct MCP mount measured 109 078 bytes for 48 tools.
  assert.ok(bytes < 4000, `bridge schema is ${bytes} bytes`)
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(typeof tool.output.render, 'function')
    assert.ok(tool.output.schema !== undefined)
    assert.equal(typeof tool.execute, 'function')
  }
  const [unity] = tools
  assert.deepEqual(unity.parameters.required, ['op'])
  assert.ok(unity.parameters.properties.op.enum.includes('scene'))
  assert.ok(unity.parameters.properties.op.enum.includes('tests_job'))
})

test('the schemas are the ones the real registry accepts', async () => {
  // Pinned against the shipped dsh-tools, because a schema the loader rejects
  // does not fail loudly at call time — it fails the whole preset at activation,
  // which is exactly how the Unity mode shipped broken once: `type: 'json'` is
  // not a supported type and the registry refused both tools.
  //
  // Where that copy lives is a machine-local detail, so it is not committed:
  // point DSH_UNPACKED_HARNESS at the `dsh-tools` directory of an unpacked
  // harness (the one that contains `lib/index.js`). Without it the check has
  // nothing to measure against and says so instead of passing silently.
  const unpacked = process.env.DSH_UNPACKED_HARNESS
  let registry
  if (unpacked !== undefined && unpacked !== '') {
    try {
      registry = await import(pathToFileURL(join(unpacked, 'lib', 'index.js')).href)
    } catch (error) {
      assert.fail(`DSH_UNPACKED_HARNESS is set but could not be imported: ${error.message}`)
    }
  }
  if (registry === undefined) {
    console.log('skipped: set DSH_UNPACKED_HARNESS to an unpacked dsh-tools to run this check')
    return
  }
  for (const tool of unityTools(new UnityBridge())) {
    assert.doesNotThrow(() => registry.assertObjectJsonSchema(tool.parameters), `${tool.name} parameters`)
    assert.doesNotThrow(() => registry.assertSupportedJsonSchema(tool.output.schema), `${tool.name} output`)
  }
  // And the literal type that caused the outage is not reintroduced anywhere.
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'unity.js'), 'utf8')
  assert.equal(/schema: *\{ *type: *'json'/.test(text), false, "unity.js uses the unsupported type 'json'")
})

test('the renderer caps a huge payload instead of pasting it', async () => {
  const bridge = new UnityBridge()
  const [, verify] = unityTools(bridge)
  const huge = { data: 'x'.repeat(50_000) }
  const blocks = verify.output.render({}, huge)
  assert.equal(blocks.length, 1)
  assert.ok(blocks[0].text.length < 25_000, 'the cap did not apply')
  assert.match(blocks[0].text, /truncated/)
})
