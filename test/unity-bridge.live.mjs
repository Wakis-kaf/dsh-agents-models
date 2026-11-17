// Live check of the Unity bridge against the running Unity MCP server.
//
// This is not a unit test with a fake transport: it talks to the real server on
// http://127.0.0.1:8080/mcp, so it only passes on a machine with a Unity Editor
// open. Run it directly:
//
//   node test/unity-bridge.live.mjs
//
// It is excluded from `npm test` for that reason — the offline suite must pass
// with no Editor running.
import assert from 'node:assert/strict'
import { UnityBridge, unityTools } from '../unity.js'

const bridge = new UnityBridge({ timeoutMs: 120_000 })

// 1. The session survives across calls instead of handshaking each time.
const state = await bridge.callTool('read_console', { action: 'get', types: ['error'], count: 1 })
assert.ok(state !== undefined, 'read_console returned nothing')
assert.equal(bridge.session.connected, true, 'the session id was not retained')

const second = await bridge.callTool('read_console', { action: 'get', types: ['error'], count: 1 })
assert.ok(second !== undefined, 'the reused session stopped answering')

// 2. Dispatch reaches the right MCP tool and decodes the nested JSON envelope.
const info = await bridge.run('scene', { action: 'get_active' })
assert.equal(info.tool, 'manage_scene')
assert.equal(typeof info.value, 'object', 'the payload stayed a JSON string')

// 3. A missing required argument is rejected locally, with the shape.
await assert.rejects(
  () => bridge.run('components', { action: 'add' }),
  /needs target, component_type/,
)

// 4. An unknown op lists the ops instead of guessing.
await assert.rejects(() => bridge.run('nope', {}), /unknown op "nope"/)

// 5. The composite verify reports each of its fields.
const report = await bridge.verify()
assert.ok(typeof report.verdict === 'string' && report.verdict !== '', 'no verdict')
assert.ok(Array.isArray(report.errors), 'errors is not an array')
console.log('verify report:', JSON.stringify(report).slice(0, 400))

// 6. The tool surface is two tools, not forty-eight.
const tools = unityTools(bridge)
assert.deepEqual(tools.map((tool) => tool.name), ['unity', 'unity_verify'])
const schemaBytes = Buffer.byteLength(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))))
console.log('bridge tool schema bytes:', schemaBytes)
assert.ok(schemaBytes < 8000, `schema grew to ${schemaBytes} bytes`)

bridge.session.close()
console.log('unity bridge live checks passed')
