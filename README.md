# Leiting · Agent Modes

A DeepSeek Harness plugin that makes an agent **mode** a real agent preset: its own
persona, its own tool set, its own plugin mounts. Pick a mode for a new task and the
session is composed exactly that way — nothing inherited, nothing accidental.

Ships four modes out of the box:

| Mode | Mounts by default |
|---|---|
| **Flash** | persona + file read/write + read-before-write policy + code search + persistent PowerShell + background jobs + web + todo + ask-user + skills + present + compaction |
| **WorkBuddy Flash** | persona + file read/write + read-before-write policy + code search + persistent PowerShell + background jobs + ask-user + todo + present + compaction + the strict WorkBuddy guard; no web/skills |
| **Unity** | persona + the two-tool Unity Editor bridge + file read/write + read-before-write policy + code search + PowerShell + jobs + todo + ask-user + present + compaction |
| **Flash Pure** | persona + compaction. **No tools. No plugins.** |

Flash also mounts `workbuddy-guard`, a transparent tool-call guard described
below. WorkBuddy Flash mounts the strict variant instead. Neither adds a
model-facing tool.

## WorkBuddy command guard

Flash mounts `workbuddy-guard`, a transparent tool-call guard rather than a
model-facing tool. WorkBuddy Flash mounts `workbuddy-guard-strict`, which adds a
repeated-command denial and a per-session tool-call budget. The guard only acts
when the session's provider is WorkBuddy and denies the failure modes that have
actually hung a session:

- a `pwsh` command that streams a large binary (for example `app.asar`) through
  PowerShell instead of using `grep`, `read`, or a Node script;
- a `job_output(wait: true)` call that would block the turn for minutes.

It also denies recursive `Get-ChildItem` over a drive root and `Get-Content` on
a file above `maxReadBytes`. The row adds no tool to the model's catalog; the
guard runs before dispatch and returns a short reason the model can act on.
Official DeepSeek routes are left untouched — they already choose bounded
commands.

The defaults live in the `catalog.js` entry. Every field below is also exposed in
the mode's **Parameters** tab, so a single mode can be loosened or tightened
without editing the package — the stored value is a diff against the shipped
default, and the tab is the supported route. (A mode's `plugins` list takes
package names; a subpath export such as `dsh-work-fish/core/persona` is allowed,
and `pluginConfig` carries the settings that row needs — for example
`{ complete: true }` on a persona row.)

| Field | Default | Meaning |
|---|---|---|
| `provider` | `workbuddy` | only guard sessions routed through this provider; not tunable from the page |
| `maxReadBytes` | `10 MiB` | deny a literal file read above this size |
| `maxJobWaitMs` | `30_000` | deny `job_output(wait:true)` above this timeout |
| `denyRepeats` | `true` | deny an exact repeated `pwsh` command |
| `repeatWindowMs` | `120_000` | only a repeat inside this window is denied; a later repeat is allowed |
| `maxToolSteps` | `0` | per-session tool-call budget; only a call that runs counts, and `present` / `ask_user_question` / job reads are exempt; the strict entry sets `120` |
| `repeatLimit` | `1` | how many times one exact command may run inside the window; `3` (strict) leaves room for re-rendering after each fix |
| `requirePlanBeforeWrite` | `false` | deny a `write` of `planThresholdChars` or more until a `todo_write` plan exists; the strict entry turns this on, and a mode may turn it back off in its Parameters tab |
| `planThresholdChars` | `4000` | how long a write may be before the plan gate applies |
| `requireReadBeforePresent` | `false` | deny `present` for a file that was written or edited after the last read of it; the strict entry turns this on |
| `requireRenderBeforePresent` | `false` | deny `present` for an `.html` / `.htm` / `.svg` deliverable unless an image was opened with `read_image` *after* its last write; the strict entry turns this on |
| `requireMotionBeforePresent` | `false` | deny `present` for a page unless two frames were looked at after its last write **and their bytes differ**; identical frames mean the picture is static |

### Why the render gate exists

`requireReadBeforePresent` compares two facts about the same file, so reading a
page's own markup satisfies it. That check passes on a page whose script never
ran: valid SVG can be a still frame with a plausible `<path>` for every limb. A
session wrote 16 KB of animation, read its own source back, called that a review,
and delivered a picture of a bird that never pedals.

`requireRenderBeforePresent` closes that hole by requiring a *different* artifact:
an image, opened after the last write. Reading the source no longer counts,
because the source cannot answer the only question that matters — does anything
in the frame move.

### Why the motion gate exists

One frame cannot answer it either. A screenshot of a still picture and a
screenshot of an animation look equally finished, so a session optimising against
its own screenshots will happily polish a frozen image — which is exactly what
happened: nine render-look-edit rounds, 60 calls spent, and the delivered file
contained no `@keyframes`, no `requestAnimationFrame`, no SMIL at all.

`requireMotionBeforePresent` therefore wants **two** frames of the same build,
and compares their bytes. Two byte-identical renders are one picture, and the
delivery is refused with a message that says so. It is not a motion detector — a
page whose only movement is drifting clouds passes — but it does catch the two
failures that actually occur: never rendering a second frame, and rendering the
same still twice.

It is scoped to pages that declare animation (`@keyframes`, `animation:`,
`requestAnimationFrame`, `<animate`). A landing page, a report, or a dashboard is
*supposed* to be still, and two renders of it are always byte-identical — asking
for a second, differing frame there would deadlock every static deliverable
instead of checking anything. No declaration, no gate.

## WorkBuddy Flash mode

`workbuddy-flash` is a WorkBuddy-specific preset, not a replacement for Flash:

- **Lean tool set** — file read/write, the read-before-write policy, code
  search, persistent PowerShell, jobs, ask-user, todo, present, compaction, and
  the strict guard. Web and skills are left out so the model has fewer ways to
  wander. `todo` stays because the plan gate is unenforceable without it.
- **Mechanical protocol** — a one-line state header, one conclusion stated once,
  a single `corrected: <new evidence> → <new conclusion>` line for the only legal
  reversal, "unverified" for anything not seen in tool output, a 2-failure
  circuit breaker per tool, and a pre-send self-check. No per-turn call cap and
  no task classification: both were model-owned judgments, a weak model reads
  "answer" into any build task to save effort. The only binding limits are the
  guard's session budget and its repeat limit, which the model cannot talk its
  way out of.
- **Strict guard** — the basic dangerous-command rules, plus an exact repeated
  `pwsh` denial (one re-run allowed), a 120-tool-call session budget that only
  charges calls which actually run, four delivery gates that do not depend on
  the model's discipline — a `write` of 4000+ characters needs a `todo_write`
  plan first, `present` is denied for a file written after its last read, a page
  additionally needs an image looked at after its last write, and two frames of
  that page have to differ in bytes — plus `present` / `ask_user_question` / job
  reads staying available past the budget.
- **Bounded polish** — the persona caps appearance work at two render-look-edit
  rounds and says so: past that, only defects get fixed (no motion, wrong
  position, missing elements), not colours and spacing. The mode exists to be
  fast; rounds go into "does it work", not "does it look nice".
- **Recommended pairing** — choose WorkBuddy / DeepSeek-V4.1-Flash / Low in the
  composer, and turn off the account pool for consistency. A preset cannot set
  the model route; the composer selection wins.

The call ceiling is a safety net, not a target. 30 bought one blind write, 60
bought nine honest cycles and then ran out before the animation was added, so a
session delivered a completely static picture. The lever that actually buys speed
is the two-round cap, because a round costs a model turn — the thing to cut is
iterations, not headroom.



The mode is intentionally small. If a task needs web search or a deliverable
card, check those rows in the mode's detail page; if it needs a long
investigation, use Standard or OPS (PTC) instead.

## Claude-like file feedback

DSH's file tools already provide most of what Claude Code's tools do:

- `read` returns line numbers, offset/limit paging, a byte cap, and streams
  files above 10 MiB;
- `write` and `edit` are atomic, require a unique literal match, and emit
  replayable diff metadata for the UI;
- `grep`/`glob` use a bundled ripgrep, keep modification-time order, and spill
  complete results when the inline page is capped.

The gap was composition: `dsh-base` ships `fs-observation-policy` disabled, so a
write/edit did not require a prior read and could overwrite a stale file. Flash
and WorkBuddy Flash now mount the policy, which enforces read-before-edit and
rejects a stale version with a recovery instruction. WorkBuddy Flash also mounts
`present` and its persona asks for a one-line diff summary and a `path:line`
link after each edit.

The remaining difference is client-side rendering: if the UI does not show diff
or file cards the way Claude Code does, that is a `tool.call.toolview` client
plugin, not a new model tool. The tool already emits `meta.diffs`; re-adding a
second `edit`/`write` tool would add schema and decision space without new
capability.

Shell startup is a separate layer: both Flash modes mount a persistent shell
group (an isolated PTY plus `dsh-tool-pwsh-persistent`), so startup is paid once
per agent instead of on every call. The group caps one command at 60 s. Install
PowerShell 7 if you also want the one-time start to drop from 0.6–0.8 s to
0.15–0.25 s.

## Why a "pure" mode

`flash-pure` starts with no capability at all: the model can only talk. Every tool and
every plugin is opt-in from the mode's detail page. That makes it a clean baseline for
measuring how much a given tool set actually helps, and a safe mode for conversations
where an agent with a shell would be a liability.

Long-session compaction stays on in every mode. It is not a model-facing tool — it only
keeps a long session from failing at the context ceiling — so it is locked rather than
offered as a checkbox.

## The page

Sidebar → **Leiting** opens a top-level module tab bar: **Mode management** and
**Tool management**. The entire existing interface, including the left mode rail,
configuration/statistics sub-tabs, capability inspection and import/export, is
inside the Mode management tabpanel. Tool management is a separate placeholder
for future requirements; the mode rail and editor do not appear there. Switching
modules preserves unsaved mode drafts and the selected detail tab. Inactive
mode statistics/skill effects pause; global module tabs remain available even
when the roster cannot be loaded.

### Configuration

The detail is split into tabs, so nothing is a long
scroll:

- **Capabilities** — the per-mode tool allowlist: which tool names this mode may
  call, where each grant came from, and the last 100 dispatch decisions.

  Every declared tool gets one row with its own switch, and the switch works in
  both directions. Off writes the name into `mode.disabledTools`; that field
  **overrides** any grant, so denying `write` on a mode that mounts *Files &
  images* blocks `write` while `read` and `edit` keep working. On either clears
  the denial or — when the tool is not mounted at all — mounts whatever declares
  it (its catalog row, or the installed package that ships it), because a grant
  without a mounted row never reaches the model's catalog and the switch would
  show "on" while changing nothing.

  A tool that nothing can mount (a hand-typed name, or one only the host plane
  provides) keeps a disabled switch and says **仅宿主** next to it. A tool
  shipped by an installed-but-unmounted package is *not* in that group: turning
  it on mounts the package.

  Enforcement is live for sessions that mounted the capability-policy row; the policy is recompiled in place when you save, so a session that is
  already running picks up the change on its next tool call. In-flight work is
  never cancelled, and a newly *mounted package* still needs a restart — the
  allowlist can deny immediately, but it cannot make a new module load.

  Two rules keep the guard from becoming a lockout, and both were learned the hard
  way (a shipped revision denied every tool in every running session after a
  reload, `read` included):

  - the policy scope is a **stable name**, not a random id, so re-applying the
    plugin (config save, HMR, restart) keeps resolving the policy a running
    session captured when its preset was built;
  - the guard **fails open**. A missing policy means this plugin is not policing
    that mode right now, so calls proceed. This is different from a **configured
    empty policy**, which denies every tool, including unexpected inherited
    registrations. A configured policy denies explicit `disabledTools`, names
    absent from the mounted-row/manual-grant allowlist, and unselected skills
    when `mode.skills` is an explicit list. Deleted modes retain an empty policy
    for sessions that are still running. Scope ownership is reference-counted so
    disposing an older instance cannot erase a newer instance during reload.

- **Basics** — name, id, description, persona, and the pure-mode switch.
- **Priority order** — checked rows in order, reorderable with `↑ ↓`. When two
  tools can do the same job (say *file read/write* and the *line editor*), the
  earlier one wins. Each row carries its title, the tool names it registers, and
  a one-line description.
- **Tools** — grouped by capability (files & images, shell & background, network,
  session & tasks, collaboration, skills, delivery, infrastructure). Ticking a
  row mounts the whole row; each row also shows the actual registered tool names,
  e.g. `read`, `write`, `glob`, `pwsh`.
- **Parameters** — the tunable fields of every mounted row that declares a
  schema, one control per field. Only mounted rows appear, so an unchecked row
  shows no knobs. Values are stored as a diff: the panel shows the shipped
  default until you change something, and **Reset** deletes the override rather
  than pinning today's number. Scaled fields are shown in human units — the
  guard's `maxReadBytes` reads as `10 MB` and is stored in bytes. A preset is
  built at session start, so a parameter change reaches the next task, not a
  conversation already running.
- **Plugins** — the plugin packages installed in this profile, each marked
  `enabled` (already loaded) or `not loaded`, plus whether it ships a browser
  half. A package mounts through the checkbox on its own row, because a preset
  mounts packages, not individual tools. Each row also lists the tool names the
  package declares, read from its own bundle; clicking one of those names denies
  just that tool (the same `disabledTools` the Capabilities tab edits) rather
  than mounting the package. You can also type a package name.

  A mode can mount a package's **subpath export** (`dsh-work-fish/core/persona`
  and its siblings) — that is how one package ships several rows. Those rows are
  listed above the package list, the owning package is shown as checked with an
  `N subpath rows` badge, and the counter counts **packages**: three subpath rows
  of one package read `1 / 12`, matching the one checked box. Unchecking the
  package releases all of its subpath rows at once.
- **Skills** — the host's whole skill catalog, **grouped by category** (see
  below).

### Skills: categories and skill packs

Skill discovery and the Skills tab remain workspace-wide. Global visibility
switches there are separate from the optional per-mode `skills` call allowlist
in Capabilities. An omitted list permits the shared library; `skills: []` denies
all `skill(name)` calls. This does not hide skill descriptions from the prompt
or prevent indirect file/shell reads. Explicitly selected skills and available
local directory attachments travel with a full mode export.

**Grouping.** A flat list of thirty skills is three screens of scrolling, so the
tab opens folded by category: each head carries a label and a count, a bucket of
three or more rows starts closed, and every head is a real disclosure button with
`aria-expanded`. **按分类 / 一个列表** switches between the grouped view and the
old single list; **全部展开 / 全部收起** folds or unfolds every head at once. The
name filter still narrows first, and a category that ends up empty is not drawn.

**Scope.** The tab shows the workspace catalog, which is not the same thing as
the mode's own skills. Two buttons above the list answer that: **全部 N** is the
whole catalog, **本模式 N** is only what this mode brings — skills shipped by a
package the mode mounts (a subpath row counts) plus the names in its `skills`
allowlist. Each row keeps its provenance tag next to the name, so a filtered
list still says whose package a skill belongs to.

**Categories** live in `~/.dsh/plugins-data/dsh-agents-modes/skill-categories.json`:

```json
{
  "categories": [
    { "id": "unity", "zh": "Unity 开发", "en": "Unity", "order": 10 }
  ],
  "assignments": { "verify-delivery": "workflow" }
}
```

Every skill falls into a bucket even without an assignment: `autoCategory()`
derives one from the **name first, provider second**. Name has to win — the
catalog on a real machine is dominated by a single Unity package, and keying on
provider first put 25 of 31 skills under one head. The derivation is deliberately
crude (a few prefixes), and the per-card **分类** select overrides it: choosing a
bucket writes `assignments[name]`, and choosing the empty "自动归入" option files
the skill back under the derived bucket. A category you delete drops its
assignments rather than leaving rows pointing at an id that no longer exists; the
fallback bucket cannot be deleted.

**Skill packs.** One skill row is a whole instruction set, so it has to travel as
a file, not as a URL:

- **导出技能包** turns the ticked skills into one `.json` file the browser
  downloads. The host reads each body from the registry, so a *bundled* skill
  exports as faithfully as one in your own root — that is how a skill moves to
  another machine at all.
- **导入技能包** reads that file back. Every skill is written through the same
  renderer `/skill-save` uses, so an imported `SKILL.md` is byte-identical to one
  typed here. A skill that already exists is **skipped** unless you tick
  **覆盖已存在的同名技能**: silently replacing your own instructions is the one
  thing this route must not do. Bad rows are reported by name and the rest are
  still written.

The pack format is `{ format: "dsh-skill-pack", version: 1, skills: [...] }`.
`format` is checked before anything else, so pointing the importer at an
unrelated JSON file fails loudly instead of half-importing it, and a pack from a
newer version is refused rather than misread. The category travels with each
skill; frontmatter is regenerated on import (descriptions containing a colon are
quoted, or the host's YAML parser would silently drop the whole file).

**Switching a skill on and off.** Every card carries an on/off pill. Off writes
`disable-model-invocation: true` into that skill's frontmatter — the field the
host's own provider already reads — so the model stops seeing the skill while you
can still invoke it by hand. Nothing is invented: the plugin writes one line and
regenerates the file through the same renderer `/skill-save` uses, so the body
survives byte for byte.

*Any* skill can be switched, not only the ones you wrote. A skill shipped by a
package or living in a project is not writable — its file belongs to that package
or repository and an upgrade would restore it — so the first switch writes a copy
into `~/.dsh/skills/<name>/` instead. That works because the host ranks roots:
`user-dsh` (400) outranks `bundled` (600), so the copy shadows the original
without touching it. Once a copy exists the row's tag reads **已接手副本** and
later switches edit that copy. Switching back on leaves a shadowing copy behind —
it is now a skill of yours, and deleting `~/.dsh/skills/<name>/` is the way to
hand it back to the package.

The switch is live. The host watches the skills root, invalidates its catalog
cache on the change, and `dsh-tool-skill` re-publishes the `<available_skills>`
list on the next model step because the digest changed — no restart, and no new
task.

Selection for export is deliberately not a permanent checkbox: it appears only
after **导出技能包**, with **全选** and **取消** beside it. A checkbox sitting on
every card at all times reads as "this skill is off", which is exactly what it
never meant.

**Registered presets** — live activation state, collapsed under a disclosure at
the bottom. A broken preset cannot be chosen for a new task, and its mount
diagnostic is shown verbatim.

### Statistics

**Statistics** folds the durable session log of every session that ran on the
selected mode and answers "where did this mode spend its time":

- a summary strip — sessions, wall time, model time, tool time, tokens, cache
  hit rate;
- **tool time ranking** across the mode's sessions: calls, total, average, worst
  case, failures, and each tool's share of all tool time — the number that says
  which tool is worth optimising;
- **sessions on this mode**, newest first; clicking one opens its detail:
  turns, steps, wall time, model vs tool time, context size, cache hit rate,
  model, the full token split (input / output / cache read / cache write), and
  that session's own per-tool table.

The preset of a session is not indexed: a session starts on its header preset
but `agent-preset/selected` events can re-bind it, so the host folds each
candidate log and filters afterwards. The newest 40 sessions are scanned, folds
are cached for 20 s, and the panel reports how many were scanned. Nothing is
recorded or uploaded — the figures come from the same `sessionQuery` service the
session tools use.

## 对话消耗展示 (conversation spend)

An extension of this plugin, listed under **工具管理 → 扩展管理**. It answers "what
did *this* conversation cost" in the conversation itself, and it keeps answering
after a restart.

### The bug it fixes

`dsh-connect-workbuddy` already prints `· 本会话已用 N 积分`. Its ledger is a `Map`
inside its host process, so:

- switching to a session it has not seen since the process started shows nothing;
- restarting the host blanks every session's figure until the next request.

Verified against the live connector: `GET
/plugins/dsh-connect-workbuddy/session-credits?sessionId=…` answers `{spent:undefined}`
for a session it has no record of, and its own `writeHostHeartbeat` records `pid`
and start time but **no port** — neither is a durable store.

### How this plugin stores it instead

| Figure | Source | Survives a restart |
|---|---|---|
| credits | the connector's `usage.credit`, committed to `~/.dsh/plugins-data/dsh-agents-modes/session-spend.json` | yes — the file |
| yuan (≈) | folded out of the durable session log on every read | yes — the log |

The credit merge is the part that needed care. Each entry keeps
`committedCredit` (everything seen before the connector's current epoch) plus the
current `{requests, credit}`. A poll whose `requests` did not go down is the same
epoch and replaces it (monotone, so an out-of-order answer cannot lower it); a
poll whose `requests` **dropped** is a connector restart, so the old epoch is
committed and a new one starts. The total is `committed + current`, which neither
resets on restart nor double-counts a repeated poll.

### Credits vs money are not interchangeable

- **WorkBuddy** bills in credits. `usage.credit` is the only truth about what was
  deducted and it is not money, so it is shown as `积分`. No yuan figure is
  invented for it.
- The **official channel** bills CNY per million tokens and the log carries the
  exact split per message, so money needs no stored state:
  `inputTokens × miss + cacheReadTokens × hit + outputTokens × out`.
  Cached input is billed at the **hit** rate — pricing it at miss would overstate a
  long conversation several times over.

The rate card is the published peak/valley table (2026-08-17, Pro = 3× Flash) with
weekend and statutory-holiday valley days, and the readout marks the number `≈`
because the invoice is the authority. An unknown model is priced as Flash and
flagged `按 Flash 价估算` rather than silently guessed.

### Where it renders

`conversation.composer.dock`, `order` 12 — beside the shell's own round/token
pills, not in `composer` where the connector already sits (two copies of one
number in one row is worse than none). The readout polls its own local route every
15 s; both that route and the ledger are free and never touch the upstream.

### The switch

`/api/agent-modes/extensions` serves the registry and flips one entry; the switch
is enforced **on the host**, so turning it off stops the work (no ledger write, no
connector read, no log fold), not just the pixels. State lives in
`~/.dsh/plugins-data/dsh-agents-modes/extensions.json`. An unknown id in the file
cannot resurrect, and a missing id falls back to the shipped default (on).

## Unity mode

`unity` drives the Unity Editor that is already open, through the local Unity
MCP server (`mcp-for-unity`, streamable-http on `http://127.0.0.1:8080/mcp`).

It does **not** mount `@deepseek-ai/dsh-mcp-client`. That bridge is correct but
publishes the server's whole tool list, and measured against the running server
that list is **48 tools / 109 078 bytes**, re-sent on every step. Its own
`manage_tools` group switch does not help: activating `docs` left `tools/list` at
48 tools and 109 078 bytes, byte for byte. The ops that matter also overlap
(`manage_gameobject` vs `manage_components` vs `manage_prefabs` vs
`manage_scene`), which is exactly the choice surface a fast model wanders in.

`dsh-agents-modes/unity` is a two-tool bridge over the same server:

| Tool | What it does | Schema |
|---|---|---|
| `unity` | one dispatcher, `op` + `args` forwarded verbatim to the mapped MCP tool | 17 ops |
| `unity_verify` | compile state, console errors/warnings, scene, play mode, optional EditMode test run | 1 flag |

Measured on this machine:

| | tools | schema bytes |
|---|---|---|
| raw MCP client | 48 | 109 078 |
| this bridge | 2 | 1 753 |

It also keeps one MCP session per endpoint instead of handshaking per call: cold
handshake + editor-state read took 896 ms, the warm read 28 ms, a warm tool call
179–214 ms. A stale session (Unity or server restart) is detected from the
server's `400 Missing session ID` / `404` and re-established once, then the call
is retried — so a restart costs one extra round trip, not a broken session.

`unity_verify` is the quality lever, not a convenience. The two ways a Unity
task is silently wrong are a compile error and a console exception, and both are
answered in one call. Its `verdict` is `clean` only when the console is quiet,
nothing is compiling, no domain reload is pending, and the asset database is
settled; otherwise it names the blocking state.

**Required arguments are checked locally.** `components` without `target` or
`component_type` is rejected with the exact shape before any HTTP request, so a
shape error costs zero round trips.

The mode's persona makes the order binding: Editor tools for scenes, prefabs,
components, scripts, assets, menus and builds — never hand-editing `.unity` /
`.prefab` / `.asset` / `.meta` — and `unity_verify` before claiming a task is
done.

Two parameters: `url` (string, the endpoint) and `timeoutMs` (default 60 s).
Both live in the mode's **Parameters** tab.

The bridge is `unity.js`, exported as `dsh-agents-modes/unity`. Its offline
tests run against a fake MCP server that reproduces the real server's session
handshake and nested `content[].text` payloads:

```powershell
node test/unity.test.mjs          # offline, no Editor needed
node test/unity-bridge.live.mjs   # needs an open Editor on port 8080
```

## What a save reaches

A mode is an agent preset, and the host binds a preset to a session at creation
and refuses to re-bind it once the session has produced a turn
(`agent-preset/locked`). So a save is not all-or-nothing:

| Changed | Running session | New task |
|---|---|---|
| Tool selection | **next turn** — rows are mounted/unmounted in the live session | ✅ |
| Persona | ❌ | ✅ |
| Plugin mounts | ❌ | ✅ |

Tools are the exception because `dsh-tools` resolves the visible set on every
step. Saving reports exactly what happened, e.g. *"Applied to 2 running
sessions: tool-web will be available from the next turn"*, or *"No running
session is on this mode, so only new tasks pick this up."*

## 内置模式的升级与你的改动

插件的四个内置模式**不再存在 profile 配置里**。原因是一个这个插件已经踩过的坑：

- 包里的 `cordis.patch.yml` 只在第一次加载时插入一条 `agent-modes` 行；
- 页面上点一次保存，`/api/agent-modes/save` 会把**整份模式列表**写进 profile 的 `cordis.patch.yml`；
- profile 的 patch 按 id 覆盖，而且 **config 是整段替换、不是合并**；

于是从第一次保存起，profile 里就是一份冻结的副本，之后任何 npm 更新都改不到它——
新装用户用的是新版文案和工具面，老用户永远停在安装那一天。

现在的分层：

| 层 | 存在哪里 | 谁改得动 |
|---|---|---|
| 内置模板（`flash` / `workbuddy-flash` / `unity` / `flash-pure` / `work-fish`） | 包内 `builtin-modes.js` | `npm update` |
| 你的改动 | profile 的 `overrides`，按**字段**存 | 你，在页面上 |
| 你自建的模式 | profile 的 `modes`，整份存 | 你 |

规则只有三条：

1. **没改过的字段跟着模板走**。你只改了 `flash` 的 persona，那么它的 `tools`、
   `description` 仍然会随包升级；
2. **改过的字段保留你的值**，升级不会覆盖；
3. **同一字段两边都改了会提示，不会静默选一边**。页面显示「上游也改了这些字段：
   persona」，并给一个「恢复内置版本」按钮；默认保留你的版本。

老 profile（安装在本版本之前）保持原样：`templates` 标记不存在时，插件把
`modes` 当作你的列表原样使用，行为与升级前一致。页面会显示一行提示并提供
**「转换并保留我的改动」**——点一次，当前列表就变成字段级差异，之后的升级才开始生效。
这个转换是单向的，转换前不会删任何字段值。转换本身**不记录任何删除**：旧快照里
没有的模式，可能只是「这个版本还没发它」，而不是「你删过它」——否则新版本才加进来的
内置模式（`work-fish` 就是第一个）会在转换那一刻被永久排除。

删除内置模式也会被记住（`removedTemplates`），下次加载不会把它复活；但只有
**上一次 roster 里出现过**的模式才算删除，所以一个没刷新过模式列表的旧标签页保存时，
不会顺手把没见过的模式删掉。

## 基于 dsh-work-fish 的 Work Fish 模式

`work-fish` 是一个**依赖式**内置模式：它不复制 `dsh-work-fish` 的任何代码，
只按包名挂载那个包自己的行：

```js
plugins: ['dsh-work-fish/core/persona', 'dsh-work-fish/core/guard', 'dsh-work-fish/core/skills'],
pluginConfig: { 'dsh-work-fish/core/persona': { complete: true } },
```

因此 `dsh-work-fish` 升级（persona 骨架、守卫、技能库）会直接作用到这个模式，
雷霆这边不需要跟着发版。雷霆只负责**组合**：工具面是本模式自己的列表。

两条边界要说清楚：

- 这个模式**要求已安装** `dsh-work-fish`。没装时它不出现，也不会注册一个挂不上的预设。
  装上后下次启动才出现。
- 它跟随的是包的**模块**，不是那个包的预设编排。上游哪天在「大肥鱼」预设里改了工具组合，
  这个模式不会自动跟——要跟就改这里的 `tools`。

`dsh-work-fish` 自带「大肥鱼」预设，两者可以并存：同一台机器上选哪个由你决定。

## Which mode a new task starts on

**Set as new-task default** on a mode's top bar is a separate write from Save,
because the default is not a property of the mode list. The preset registry
resolves a session's preset as `selectedDefault ?? default` at creation, so the
button writes `selectedDefault` into the `agent-preset-registry` namespace
through the settings service — the same field the built-in Agent presets page
writes, which keeps one home for it. The field is `volatile`, so the settings
service is the only writer that merges the volatile layer correctly; editing the
registry row directly would drop that layer.

The button is replaced by a **New-task default** badge on the mode that already
holds it, and the roster route reports `defaultMode` so the page learns it from
the registry rather than from the order of the mode list.

## Why a mounted row also needs a notice

Mounting the row changes what the *next request* offers. It does not change what
the conversation has already concluded.

A session that asked "can you open this link?" and answered "no, I have no web
tools" keeps that answer: the model read its tool list once per step, and the
answer it wrote is now history. Mounting `web_search` afterwards puts it in the
next request, but nothing in the log contradicts the earlier sentence, so the
same refusal comes back — correctly, given what the log says.

So a hot apply does two things: it mounts the rows, and it records one
`runtime-context` **notice** in each affected session naming the tools that
appeared or disappeared. The notice is what makes the next turn revise the
earlier answer. The save report distinguishes the two outcomes, because they
are not the same promise:

- *"the change is now in the session log, so the model no longer trusts its
  earlier answer"* — the notice was written;
- *"mounted but could not be written into the session log"* — a read-only or
  disposed session; the tool is available, but the conversation may keep
  refusing, so a new task is the reliable path.

The notice is a surface event and therefore carries `surfaceOp: 'append'`; the
host rejects a surface append without it. The test harness enforces the same
rule, because a lenient fake would hide exactly the failure this notice exists
to prevent.


## Portable sharing and compatibility

Open **Import / Export** in Mode management. The workbench has separate export
and analysis panels and collapses when not needed; it adapts to narrow screens.

- Export the current mode, all modes, or only tool permissions, parameters or
  plugin dependencies. Partial exports offer per-item selection. The current
  draft is used, so an export does not silently fall back to the last save.
- A versioned `dsh-mode-pack` JSON file records exact installed package versions,
  local package files with SHA-256 checksums, source platform/architecture and
  declared dependency/peer/engine requirements. DSH built-ins are marked as
  host-provided instead of being downloaded from npm. Built-in versions are not
  pinned; the receiver's catalog and host remain the compatibility boundary.
- Local/file/linked packages include their files and required local dependencies.
  Explicitly selected mode skills include `SKILL.md` and their resource directory
  when the host exposes one. Provider-only skills carry instructions and receive
  an instructions-only warning. Unrestricted workspace skill discovery cannot
  be reproduced automatically on another machine: select an explicit skill list.
- Analysis distinguishes ready, bundled, download and conflicting dependencies,
  checks unsupported rows, parameter schemas, OS/CPU constraints and missing
  skill resources. Different installed package versions and skill contents are
  blocked rather than overwritten. Existing local packages with the same version
  are retained with a warning; their bytes are not silently replaced.
- Conflicting mode IDs default to **keep both** with a new ID. Replace and skip
  are explicit choices; modes owned by other plugins cannot be replaced. Partial
  imports target the selected mode, and parameter imports require their rows to
  already be mounted. Unsaved edits in other fields and modes are retained.
- Installation requires explicit consent. The existing pnpm lockfile is honored;
  otherwise npm is used. Lifecycle scripts are disabled and Node engine checks
  are strict. Installations are bounded to two minutes and verified afterward.
  Native packages that depend on build scripts may need manual setup. Registry
  transitive dependencies are resolved by the package manager; peer requirements
  appear in analysis rather than being represented as a fully locked environment.
- Import merges into a **draft**, never silently saves it. Review and save to
  activate permissions; restart/create a new session to pick up newly mounted
  plugins or context changes. Dependency installation does change the profile
  manifest/lockfile before Save. Failed installations may leave staged files or
  package-manager changes; staging uses new directories so retries never delete
  or overwrite a previous attempt. This is not a transactional profile backup.

Packages and skill assets share a 24 MiB / 1200-file decoded limit; JSON is
limited to 36 MiB. Unsafe paths, symlinks in exports, duplicate paths and bad file
hashes are rejected. Credential-like files, `.env`, private-key files, dependency
folders and common private configuration directories are excluded by default.
This is not a secret scanner or a signature scheme: inspect the artifact before
sharing and only import code/instructions from sources you trust. Plugin code
may execute when the host later mounts it even though installation scripts are
disabled.

### Observation and enforcement boundaries

Capabilities separates static declarations, live registered definitions and the
last 100 dispatch checks in the current process. Live sessions expose their
Loader mounts when available. Registered does **not** mean admitted to the
current model step; a permission check passing does **not** mean execution
succeeded. Audit records omit arguments and tool outputs and are not durable.
Refreshing audit data does not overwrite the editing draft.

The guard checks DSH tool names before dispatch, including `skill(name)` access
when configured. It is not an OS sandbox and cannot isolate indirect actions
inside an allowed shell, file/network tool, Unity/MCP bridge or arbitrary plugin.
Context switches for project instructions and time control this mode’s mounts
in new sessions, not global injections from the host;
persona remains editable in Basics, and the policy guard is mandatory. Existing
sessions created before this feature must be recreated once to mount the guard.
Unloading this plugin removes its enforcement; a missing policy does not block
host dispatch. The live-session section reports whether a guard mount is found.

## How priority works

`systemPrompt.toolOrder` is host-plane configuration, and a preset cannot set it. So the
ordering is expressed two ways, which reinforce each other:

1. the preset rows are mounted in your order;
2. when that order differs from the catalog default, the persona gains a short paragraph
   naming the full tool list in priority order.

## Install

```powershell
dsh plugin --profile <your-profile> add link:<path-to-this-repo>
```

Then add `dsh-agents-modes` to `dsh.profile.bundles` in that profile's `package.json`.
Restart DeepSeek Harness so the host half loads.

> The browser half reloads on a page refresh, but the **host half only on a restart**.
> If the page shows a stale-host notice, the running process predates the code.

## Tests

```powershell
node test/locale.test.mjs     # dictionary parity and copy drift
node test/presets.test.mjs    # preset construction, registry row validation, host routes
node test/guard.test.mjs      # the WorkBuddy pwsh/job_output guard policy
node test/stats.test.mjs      # the session fold: turns, tokens, per-tool wall time
node test/spend.test.mjs      # prices, the CNY fold, the durable credit ledger, the extension registry
node test/spend-route.test.mjs # the two routes end to end: restart survival, per-session split, credits vs yuan
node test/skills.test.mjs     # skill categories, SKILL.md rendering, skill packs, pack routes
node test/capability-policy.test.mjs  # the per-mode tool allowlist guard
node test/mode-pack.test.mjs  # portable mode packs: validation and merge rules
node test/mode-pack.integration.test.mjs # temporary-profile local install and skill resource round trips
node test/page.test.mjs       # page rendering, toggling, ordering, saving, statistics
```

On Windows, `node --test test/` fails with `spawn EPERM` under a restricted sandbox
(child-process pipes are blocked). Run the files directly, as above.

## Files

| File | Role |
|---|---|
| `catalog.js` | the tool catalog: package, real tool names, category, defaults, exclusions |
| `guard.js` | the WorkBuddy `pwsh`/`job_output` guard mounted by the infra row |
| `unity.js` | the two-tool Unity Editor bridge (`unity`, `unity_verify`) over the local Unity MCP server |
| `plugin-tools.js` | declared-tool scan over an installed plugin package's bundle |
| `stats.js` | session log fold: turns, tokens, tool wall time, mode rollup |
| `spend.js` | conversation spend arithmetic: published peak/valley CNY table, the token fold, the credit epoch merge |
| `spend-store.js` | the durable credit ledger on disk (`session-spend.json`) |
| `extensions.js` | the 扩展管理 registry and its switch state (`extensions.json`) |
| `skill-store.js` | skill categories, derived buckets, SKILL.md rendering, skill-pack build/parse |
| `capability-policy.js` | per-mode tool allowlist guard: compiles a policy and denies calls outside it |
| `mode-pack.js` | portable mode packs: export, validate, analyze dependencies, safe staging and install, merge |
| `builtin-modes.js` | the shipped mode templates and the field-level layering (diff, apply, conflict, split) that keeps them upgradable |
| `skill-resources.js` | selected skill directories: capture, compare and consent-based import |
| `index.js` | host half: registers modes as presets, serves `/api/agent-modes/{roster,save,template,stats,skills,skill,skill-save,skill-toggle,skill-category,skill-pack-export,skill-pack-import,pack-export,pack-analyze,pack-import,spend,extensions}` |
| `client.js` | browser half: the sidebar row and the mode editor / statistics page |
| `cordis.patch.yml` | the seed row: `templates: builtin` — the mode list itself lives in `builtin-modes.js` |

## License

MIT
