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
 * The budget counts *executed* exploration only: a denied call does not spend
 * it, and the delivery/interaction tools (`present`, `ask_user_question`) plus
 * job reads are exempt, so a session that reaches the budget can still deliver
 * a file or ask the user instead of being told to start over.
 *
 * Three delivery gates sit on `present`. The narrowest asks whether the file was
 * read back after its last write. Reading a page's markup is not the same as
 * seeing it: valid SVG can be a still frame with a plausible-looking `<path>` for
 * every limb. So a page additionally needs an image looked at *after* its last
 * write — the render, not the source. The false-negative this closes is a
 * session that wrote 16 KB of animation and delivered it without ever checking
 * whether the subject moved.
 *
 * One frame cannot answer that last question either: a screenshot of a still
 * picture and a screenshot of an animation look equally fine. So the strictest
 * gate wants *two* frames of the same version, and compares their bytes. Two
 * byte-identical renders mean nothing in the frame changed, which for an
 * animation task is the whole failure.
 *
 * The guard only acts when the session's provider is WorkBuddy. The official
 * DeepSeek routes choose bounded commands (a 16-byte asar header, `grep`, a
 * small benchmark) and must stay untouched.
 *
 * @module dsh-agents-models/guard
 */

import { readFileSync, statSync } from 'node:fs'

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

/** Delivery, questions, and job reads are how a spent session closes out;
 * they never consume or hit the budget. */
const BUDGET_EXEMPT = new Set(['present', 'ask_user_question', 'job_list', 'job_output'])

/** Deliverables whose looks live in pixels, not in markup. */
const PAGE_FILE = /\.(?:html?|xhtml|svg)$/i

/** What `read_image` can actually return. A look at one of these is a look. */
const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i

/**
 * Declarations that mean the page itself claims to move.
 *
 * The motion gate is scoped by this on purpose: a landing page, a report, or a
 * dashboard is *supposed* to be still, and demanding two differing frames of it
 * would deadlock — two renders of a static page are always identical. So the
 * gate only applies to pages that declare animation; a static deliverable is not
 * asked to prove anything it never claimed.
 */
const ANIMATION_MARK = /@keyframes|animation\s*:|animation-name|requestAnimationFrame|<animate|setInterval\s*\(/i

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
  // How many times one exact command may run inside the window. 1 denies the
  // second call (the loop that hung a session); 2 allows one re-run, which is
  // what a verification step (render again, re-run the test) actually needs.
  const repeatLimit =
    Number.isFinite(config.repeatLimit) && config.repeatLimit >= 1
      ? Math.floor(config.repeatLimit)
      : 1
  // A delivered file that was never read back after its last write/ edit is
  // the failure the pelican session produced: seven edits, zero reads.
  const requireReadBeforePresent = config.requireReadBeforePresent === true
  // A page that was only ever read as text was never seen. Valid markup says
  // nothing about whether the thing it describes actually moves, so the look
  // has to be an image taken after the last write.
  const requireRenderBeforePresent = config.requireRenderBeforePresent === true
  // And a single still cannot show motion. Two frames of the same build, whose
  // bytes differ, are the cheapest evidence that something in the frame moves.
  const requireMotionBeforePresent = config.requireMotionBeforePresent === true
  // A big deliverable written straight out of one turn's imagination is the
  // same failure one step earlier; a todo list is the plan made durable.
  const requirePlanBeforeWrite = config.requirePlanBeforeWrite === true
  const planThresholdChars =
    Number.isFinite(config.planThresholdChars) && config.planThresholdChars >= 0
      ? config.planThresholdChars
      : 4000

  /** Per-agent state for the repeat check and the optional session budget. */
  const states = new WeakMap()

  /** Same file spelled differently (`.\a`, `a`, `A`) must be one key. */
  function keyOf(value) {
    if (typeof value !== 'string') return undefined
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
    const parts = normalized.split('/')
    return parts[parts.length - 1].toLowerCase()
  }

  /** Record what the session touched, so `present` can be gated on a look. */
  function record(exec, state) {
    if (state === undefined) return
    const args = exec?.arguments ?? {}
    if (exec.name === 'todo_write') {
      state.plan = true
      return
    }
    if (exec.name === 'write' || exec.name === 'edit') {
      const key = keyOf(args.file_path)
      if (key !== undefined) {
        state.seq += 1
        state.writes.set(key, state.seq)
      }
      return
    }
    if (exec.name === 'read' || exec.name === 'read_image') {
      const key = keyOf(args.file_path)
      if (key !== undefined) {
        state.seq += 1
        state.reads.set(key, state.seq)
        // Only an image read is a look at a rendering; a text read is not.
        if (exec.name === 'read_image' && IMAGE_FILE.test(key)) {
          state.imageSeq = state.seq
          // Keep the path, not just the name: the motion gate has to open the
          // file again to compare two frames byte for byte.
          state.images.push({ seq: state.seq, path: args.file_path })
          if (state.images.length > 64) state.images.shift()
        }
      }
    }
  }

  /**
   * Are two looks the same picture?
   *
   * `true` when the bytes match (nothing moved), `false` when they differ, and
   * `undefined` when the files cannot be read — an unreadable frame must not be
   * evidence of motion, nor a reason to block a delivery the guard cannot judge.
   */
  function sameFrame(a, b) {
    try {
      const left = readFileSync(a)
      const right = readFileSync(b)
      if (left.length !== right.length) return false
      return left.equals(right)
    } catch {
      return undefined
    }
  }

  /** The policy itself: everything except the step budget. */
  function policy(exec, state) {
    const args = exec?.arguments ?? {}

    if (
      requirePlanBeforeWrite &&
      exec.name === 'write' &&
      state !== undefined &&
      state.plan !== true &&
      typeof args.content === 'string' &&
      args.content.length >= planThresholdChars
    ) {
      return deny(
        `this write is ${args.content.length} characters and no plan exists yet. Call todo_write ` +
          'first with at most five steps (build, look, fix, deliver), then write the file. A long ' +
          'file written from one turn of imagination is what this guard exists to stop.',
      )
    }

    if (requireReadBeforePresent && exec.name === 'present' && state !== undefined) {
      for (const file of Array.isArray(args.files) ? args.files : []) {
        const key = keyOf(file?.path)
        if (key === undefined) continue
        const written = state.writes.get(key)
        if (written === undefined) continue
        if ((state.reads.get(key) ?? -1) >= written) continue
        return deny(
          `this session wrote "${file.path}" and never read it back, so what you are delivering ` +
            'has never been looked at. Read it (or screenshot it with read_image) and fix what you ' +
            'see, then present.',
        )
      }
    }

    if (requireRenderBeforePresent && exec.name === 'present' && state !== undefined) {
      for (const file of Array.isArray(args.files) ? args.files : []) {
        const key = keyOf(file?.path)
        if (key === undefined) continue
        if (!PAGE_FILE.test(key)) continue
        const written = state.writes.get(key)
        if (written === undefined) continue
        if ((state.imageSeq ?? -1) > written) continue
        return deny(
          `this session wrote the page "${file.path}" and never looked at how it renders. ` +
            'Reading the markup back does not count: markup that parses is not a picture that ' +
            'works. Render it — headless Chrome, a screenshot script, whatever this host has — ' +
            'then open the image with read_image, fix what you see, and present. A page whose ' +
            'only motion is the weather is a still frame with extra steps. If this host genuinely ' +
            'cannot render, say so in the reply and ask for the render gate to be turned off in ' +
            'the mode’s Parameters; do not present again and do not silently drop the file.',
        )
      }
    }

    if (requireMotionBeforePresent && exec.name === 'present' && state !== undefined) {
      for (const file of Array.isArray(args.files) ? args.files : []) {
        const key = keyOf(file?.path)
        if (key === undefined) continue
        if (!PAGE_FILE.test(key)) continue
        const written = state.writes.get(key)
        if (written === undefined) continue
        // A page that never declared animation is a still deliverable, and
        // asking it for two differing frames would be a deadlock, not a check.
        let source
        try {
          source = readFileSync(file.path, 'utf8')
        } catch {
          continue
        }
        if (!ANIMATION_MARK.test(source)) continue
        // Only looks taken against the version being delivered count.
        const frames = [...new Set(
          state.images.filter((image) => image.seq > written).map((image) => image.path),
        )]
        if (frames.length < 2) {
          return deny(
            `this session has ${frames.length} frame(s) of "${file.path}" and needs two. ` +
              'A still cannot show whether anything moves: render the same build twice at ' +
              'different times (for example chrome --headless --virtual-time-budget=200 and ' +
              '=900), open both with read_image, and confirm the frames differ. If they are ' +
              'identical the page is a picture, not an animation.',
          )
        }
        const [first, second] = frames.slice(-2)
        if (sameFrame(first, second) === true) {
          return deny(
            `the two frames of "${file.path}" are byte-identical, so nothing in the picture ` +
              `moved between them. "${first}" and "${second}" are the same image. Add the ` +
              'motion the task asked for — and remember that decor moving is not the subject ' +
              'moving — then render two fresh frames and look again.',
          )
        }
      }
    }

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
      const seen = state.seen.get(signature)
      const runs = seen !== undefined && now - seen.first < repeatWindowMs ? seen.count : 0
      if (runs >= repeatLimit) {
        return deny(
          `this exact pwsh command already ran ${runs} time(s) in this session. Use its result; ` +
            'do not re-run it. If you need a different result, change the command or use grep/read.',
        )
      }
      if (state.seen.size >= 500) state.seen.clear()
      state.seen.set(signature, { count: runs + 1, first: runs === 0 ? now : seen.first })
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
  }

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
      const hasAgent = agent !== null && typeof agent === 'object'
      const counted = !BUDGET_EXEMPT.has(exec?.name)
      let state
      if (hasAgent) {
        state = states.get(agent)
        if (state === undefined) {
          state = {
            count: 0,
            seen: new Map(),
            seq: 0,
            writes: new Map(),
            reads: new Map(),
            // Sequence number of the last image actually opened. -1 means the
            // session has never looked at a rendering of anything.
            imageSeq: -1,
            // Every image look, with its sequence number, for the motion gate.
            images: [],
          }
          states.set(agent, state)
        }
      }

      if (maxToolSteps > 0 && counted && state !== undefined && state.count >= maxToolSteps) {
        return deny(
          `this session has used its ${maxToolSteps}-call tool budget. Stop exploring and answer ` +
            'from the evidence you already have: state the conclusion, what is still unverified, and ' +
            'the next step. present and ask_user_question still work; do not ask for a new session.',
        )
      }

      const reason = policy(exec, state)
      if (reason !== undefined) return reason

      // A present is a statement about the file, not an action on it.
      if (exec?.name !== 'present') record(exec, state)

      // Only a call that actually runs spends budget; a denial costs nothing.
      if (counted && state !== undefined) state.count += 1
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
