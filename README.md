# Leiting · Agent Modes

A DeepSeek Harness plugin that makes an agent **mode** a real agent preset: its own
persona, its own tool set, its own plugin mounts. Pick a mode for a new task and the
session is composed exactly that way — nothing inherited, nothing accidental.

Ships three modes out of the box:

| Mode | Mounts by default |
|---|---|
| **Flash** | persona + file read/write + code search + PowerShell + background jobs + web + todo + ask-user + skills + present + compaction |
| **WorkBuddy Flash** | persona + file read/write + code search + PowerShell + background jobs + ask-user + compaction + the strict WorkBuddy guard; no web/todo/skills/present |
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

The defaults live in the `catalog.js` entry. To change them, edit that entry,
or add a `dsh-agents-modes/guard` row with a different config to the mode's
`plugins` list in `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `provider` | `workbuddy` | only guard sessions routed through this provider |
| `maxReadBytes` | `10 MiB` | deny a literal file read above this size |
| `maxJobWaitMs` | `30_000` | deny `job_output(wait:true)` above this timeout |
| `denyRepeats` | `true` | deny an exact repeated `pwsh` command |
| `repeatWindowMs` | `120_000` | only a repeat inside this window is denied; a later repeat is allowed |
| `maxToolSteps` | `0` | per-session tool-call budget; the strict entry sets `30` |

## WorkBuddy Flash mode

`workbuddy-flash` is a WorkBuddy-specific preset, not a replacement for Flash:

- **Lean tool set** — file read/write, code search, PowerShell, jobs, ask-user,
  compaction, and the strict guard. Web, todo, skills, and present are left out
  so the model has fewer ways to wander.
- **Evidence-first persona** — every conclusion is labeled *measured fact* or
  *unverified hypothesis*; versions, paths, configs, and performance claims get
  one bounded measurement before they are asserted. The model states a plan
  once, verifies each hypothesis once, does not re-read the same file, and stops
  after two tool results that add nothing. If it is about to overturn an earlier
  conclusion, it must name the new measurement that conflicts with it.
- **Strict guard** — the basic dangerous-command rules, plus an exact repeated
  `pwsh` denial and a 30-tool-call session budget. At the budget the model must
  answer from the evidence it has instead of starting another extraction or
  benchmark.
- **Recommended pairing** — choose WorkBuddy / DeepSeek-V4.1-Flash / Low in the
  composer, and turn off the account pool for consistency. A preset cannot set
  the model route; the composer selection wins.

The mode is intentionally small. If a task needs web search or a deliverable
card, check those rows in the mode's detail page; if it needs a long
investigation, use Standard or OPS (PTC) instead.

## Why a "pure" mode

`flash-pure` starts with no capability at all: the model can only talk. Every tool and
every plugin is opt-in from the mode's detail page. That makes it a clean baseline for
measuring how much a given tool set actually helps, and a safe mode for conversations
where an agent with a shell would be a liability.

Long-session compaction stays on in every mode. It is not a model-facing tool — it only
keeps a long session from failing at the context ceiling — so it is locked rather than
offered as a checkbox.

## The page

Sidebar → **Leiting**. The page has two top-level views — **Models** and **Statistics**
— and the mode rail stays visible in both, so a statistic is always read for the
mode you are looking at.

### Models

The detail is split into four tabs, so nothing is a long
scroll:

- **Basics** — name, id, description, persona, and the pure-mode switch.
- **Priority order** — checked rows in order, reorderable with `↑ ↓`. When two
  tools can do the same job (say *file read/write* and the *line editor*), the
  earlier one wins. Each row carries its title, the tool names it registers, and
  a one-line description.
- **Tools** — grouped by capability (files & images, shell & background, network,
  session & tasks, collaboration, skills, delivery, infrastructure). Each row
  shows the actual registered tool names, e.g. `read`, `write`, `glob`, `pwsh`.
- **Plugins** — the plugin packages installed in this profile, each marked
  `enabled` (already loaded) or `not loaded`, plus whether it ships a browser
  half. Each row also lists the tool names the package declares, read from its
  own bundle: clicking one mounts that package into the mode, because a preset
  mounts packages, not individual tools. You can also type a package name.

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
node test/page.test.mjs       # page rendering, toggling, ordering, saving, statistics
```

On Windows, `node --test test/` fails with `spawn EPERM` under a restricted sandbox
(child-process pipes are blocked). Run the files directly, as above.

## Files

| File | Role |
|---|---|
| `catalog.js` | the tool catalog: package, real tool names, category, defaults, exclusions |
| `guard.js` | the WorkBuddy `pwsh`/`job_output` guard mounted by the infra row |
| `plugin-tools.js` | declared-tool scan over an installed plugin package's bundle |
| `stats.js` | session log fold: turns, tokens, tool wall time, mode rollup |
| `index.js` | host half: registers modes as presets, serves `/api/agent-modes/{roster,save,stats}` |
| `client.js` | browser half: the sidebar row and the mode editor / statistics page |
| `cordis.patch.yml` | the default mode list (`flash`, `flash-pure`) |

## License

MIT
