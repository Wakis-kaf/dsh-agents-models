/**
 * WorkBuddy command guard — a transparent tool-call policy, not a model-facing
 * tool.
 *
 * Flash mounts this row through the "WorkBuddy 命令守卫" catalog entry. It
 * denies the two failure modes that have actually hung a WorkBuddy session:
 * a `pwsh` command that streams a large binary (for example `app.asar`) through
 * PowerShell, and a `job_output` call that blocks for minutes on a background
 * job. The strict entry adds two behavior controls: an exact repeated `pwsh`
 * command is denied, and an optional per-session tool-call budget stops an
 * exploratory loop before it burns the whole turn.
 *
 * The guard only acts when the session's provider is WorkBuddy. The official
 * DeepSeek routes choose bounded commands (a 16-byte asar header, `grep`, a
 * small benchmark) and must stay untouched.
 *
 * @module dsh-agents-modes/guard
 */

import { statSync } from 'node:fs'

/** Executables and archives that must not be read whole by PowerShell. */
const LARGE_BINARY = /\.(?:asar|zip|7z|gz|tgz|tar|exe|dll|so|dylib|pak|bin|iso|img|vhd|vmdk)\b/i

/** PowerShell APIs that pull a whole file (or a whole string) into memory. */
const FULL_READ = /(?:\[regex\]::Matches|Get-Content|Select-String|ReadAllText|ReadAllBytes|ReadAllLines|GetString|OpenRead|StreamReader)/i

/** Bounded header reads are the correct way to inspect an asar: a small
 * buffer plus an integer parse. Requiring both keeps a stray `BitConverter`
 * in a full-file scan from opening a hole. */
const HEADER_SIZE = /New-Object\s+byte\[\]\s*\(?\s*(?:16|32)\s*\)?/i
const HEADER_PARSE = /(?:ToUInt32|ToUInt64|ReadUInt32|ReadUInt64|BitConverter)/i

/** A recursive listing of a drive root, in either flag order. */
const RECURSIVE_ROOT = /(?:Get-ChildItem|gci|dir)\b[^\n]*(?:-Recurse[^\n]*[A-Za-z]:\\[\s'"]|[A-Za-z]:\\[\s'"][^\n]*-Recurse)/i

/** Windows absolute paths quoted in the command, for the size check. */
const LITERAL_PATH = /(['"])([A-Za-z]:\\[^'"]+)\1/g

export const name = 'workbuddy-guard'

/** The guard registers into the tool registry, so it must wait for it. */
export const inject = ['tools']

function deny(message) {
  return `Denied by workbuddy-guard: ${message}`
}

/** A stable signature for one tool call, independent of object key order. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`
}

/**
 * Build the synchronous guard. Exported so tests can exercise the policy
 * without a live tool registry.
 *
 * @param config optional provider, read-size, job-wait, repeat, and step-budget
 *   thresholds.
 * @returns a guard that returns a denial reason, or undefined to allow.
 */
export function createWorkbuddyGuard(config = {}) {
  const provider =
    typeof config.provider === 'string' && config.provider !== '' ? config.provider : 'workbuddy'
  const maxReadBytes =
    Number.isFinite(config.maxReadBytes) && config.maxReadBytes > 0
      ? config.maxReadBytes
      : 10 * 1024 * 1024
  const maxJobWaitMs =
    Number.isFinite(config.maxJobWaitMs) && config.maxJobWaitMs > 0
      ? config.maxJobWaitMs
      : 30_000
  const maxToolSteps =
    Number.isFinite(config.maxToolSteps) && config.maxToolSteps > 0 ? config.maxToolSteps : 0
  const denyRepeats = config.denyRepeats !== false
  const repeatWindowMs =
    Number.isFinite(config.repeatWindowMs) && config.repeatWindowMs >= 0
      ? config.repeatWindowMs
      : 120_000

  /** Per-agent state for the repeat check and the optional session budget. */
  const states = new WeakMap()

  return function guard(exec) {
    try {
      let selection
      try {
        selection = exec?.agent?.model?.current?.()
      } catch {
        selection = undefined
      }
      // Official DeepSeek routes are efficient here; only guard WorkBuddy.
      if (selection?.provider !== provider) return undefined

      const agent = exec?.agent
      let state
      if (agent !== null && typeof agent === 'object') {
        state = states.get(agent)
        if (state === undefined) {
          state = { count: 0, seen: new Map() }
          states.set(agent, state)
        }
        state.count += 1
        if (maxToolSteps > 0 && state.count > maxToolSteps) {
          return deny(
            `this session has used ${maxToolSteps} tool calls, the WorkBuddy Flash budget. ` +
              'Stop exploring and answer with the evidence you already have, or ask the user to start a new session.',
          )
        }
      }

      const args = exec?.arguments ?? {}

      if (exec.name === 'job_output' && args.wait === true) {
        const timeout = Number(args.timeout_ms)
        if (Number.isFinite(timeout) && timeout > maxJobWaitMs) {
          return deny(
            `job_output(wait:true) with timeout_ms=${timeout} would block this turn for minutes. ` +
              'Do other work first, check with wait:false, or job_kill the job.',
          )
        }
      }

      if (exec.name !== 'pwsh') return undefined
      const command = typeof args.command === 'string' ? args.command : ''
      if (command === '') return undefined

      if (denyRepeats && state !== undefined && repeatWindowMs > 0) {
        const signature = `${exec.name}\0${stable(args)}`
        const now = Date.now()
        const last = state.seen.get(signature)
        if (last !== undefined && now - last < repeatWindowMs) {
          return deny(
            'this exact pwsh command already ran in this session. Use its result; do not re-run it. ' +
              'If you need a different result, change the command or use grep/read.',
          )
        }
        if (state.seen.size >= 500) state.seen.clear()
        state.seen.set(signature, now)
      }

      // A bounded header read is the right answer, not the failure.
      if (HEADER_SIZE.test(command) && HEADER_PARSE.test(command)) return undefined

      if (LARGE_BINARY.test(command) && FULL_READ.test(command)) {
        return deny(
          'this pwsh command would stream a large binary (for example app.asar) through PowerShell. ' +
            'Use the grep/glob/read tools or a Node script; for asar, read the 16-byte header or run ' +
            '`npx @electron/asar`. Do not read the whole file with Get-Content or [regex]::Matches.',
        )
      }

      if (RECURSIVE_ROOT.test(command)) {
        return deny(
          'recursive Get-ChildItem over a drive root is too broad. Narrow the path or use the glob tool.',
        )
      }

      if (FULL_READ.test(command)) {
        for (const match of command.matchAll(LITERAL_PATH)) {
          const path = match[2]
          try {
            if (statSync(path).size > maxReadBytes) {
              return deny(
                `this pwsh command reads ${path}, which is larger than ` +
                  `${Math.round(maxReadBytes / 1024 / 1024)} MB. Use read with offset/limit, grep, ` +
                  'or a Node script; do not load the whole file into PowerShell.',
              )
            }
          } catch {
            /* a path that does not exist is not this guard's concern */
          }
        }
      }

      return undefined
    } catch {
      // A guard must never break a tool call it does not understand.
      return undefined
    }
  }
}

/** Mount the guard inside the agent scope the preset row runs in. */
export function apply(ctx, config = {}) {
  if (typeof ctx?.tools?.guard !== 'function') return
  ctx.tools.guard(createWorkbuddyGuard(config))
}
