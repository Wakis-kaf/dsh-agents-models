/**
 * Tool catalog for the Leiting mode editor.
 *
 * One entry here is one *preset row*: the plugin package that an agent mode
 * mounts to gain a capability, plus the model-facing tool names that row
 * registers. Every external package name below was verified against the
 * installed harness — guessing `<id>` → `dsh-<id>` produces a preset that never
 * activates. The one local entry, `workbuddy-guard`, mounts this package's
 * `./guard` subpath, which must stay exported from package.json.
 *
 * `tools` lists the actual registered tool names. It drives two things: the
 * capability chips the editor shows, and the preference sentence written into
 * the persona suffix, which is the only supported way to bias tool choice —
 * `systemPrompt.toolOrder` is host-plane config and a preset cannot set it.
 *
 * @module dsh-agents-modes/catalog
 */

/** Tool categories, in editor display order. */
export const CATEGORIES = Object.freeze([
  { id: 'file', zh: '文件与图像', en: 'Files & images', hintZh: '读写、编辑、搜索代码与看图' },
  { id: 'shell', zh: '命令行与后台', en: 'Shell & background', hintZh: '执行命令、后台任务、终端会话' },
  { id: 'web', zh: '网络', en: 'Network', hintZh: '联网搜索与网页抓取' },
  { id: 'session', zh: '会话与任务', en: 'Session & tasks', hintZh: '待办、提问、目标、定时、历史、工作目录' },
  { id: 'agent', zh: '智能体协作', en: 'Collaboration', hintZh: '子智能体、编排工作流、插件运行时探查' },
  { id: 'skill', zh: '技能', en: 'Skills', hintZh: '按需加载仓库技能文档' },
  { id: 'deliver', zh: '交付', en: 'Delivery', hintZh: '把文件作为成品显式交付给用户' },
  { id: 'infra', zh: '基础设施', en: 'Infrastructure', hintZh: '长会话压缩等运行保障' },
])

/** Long-session compaction: not a model-facing tool, always worth keeping. */
const COMPACTION_GROUP = {
  id: 'compaction',
  name: 'cordis:group',
  group: true,
  isolate: { compaction: true, toolResultPruner: true },
  config: [
    { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
    { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    {
      id: 'tool-result-pruner',
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    },
  ],
}

/** Skill discovery plus the loader: the pair is what makes `skill` work. */
const SKILL_GROUP = {
  id: 'skills',
  name: 'cordis:group',
  group: true,
  config: [
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
  ],
}

/**
 * Catalog entries.
 *
 * `row` is the preset row id; `config` the row config; `pkg` the package to
 * mount. `locked` rows cannot be switched off (compaction). `hostOnly` rows are
 * listed for visibility but refuse to mount inside a preset because the
 * service they resolve lives on the host plane.
 */
export const TOOLS = Object.freeze([
  {
    id: 'tool-fs',
    pkg: '@deepseek-ai/dsh-tool-fs',
    row: 'fs',
    config: { applyPatch: false },
    category: 'file',
    zh: '文件读写与看图',
    en: 'Files & images',
    descZh: '读文件（支持行范围）、写文件、精确编辑、读取图片。智能体的基础手。',
    descEn: 'Read (with line ranges), write, edit precisely, and read images.',
    tools: ['read', 'write', 'edit', 'read_image'],
    defaultOn: true,
  },
  {
    id: 'tool-fs-search',
    pkg: '@deepseek-ai/dsh-tool-fs-search',
    row: 'fs-search',
    config: { sampleOverCapGlobResults: false },
    category: 'file',
    zh: '代码搜索',
    en: 'Code search',
    descZh: 'glob 按路径找文件、grep 按内容找代码，底层是自带 ripgrep 二进制。',
    descEn: 'glob for paths, grep for contents, over a bundled ripgrep binary.',
    tools: ['glob', 'grep'],
    defaultOn: true,
  },
  {
    id: 'tool-str-replace-editor',
    pkg: '@deepseek-ai/dsh-tool-str-replace-editor',
    row: 'str-replace-editor',
    category: 'file',
    zh: '行级替换编辑器',
    en: 'Line editor',
    descZh: 'view / create / 字面替换 / 按行插入。与「文件读写与看图」功能重叠，二选一即可。',
    descEn: 'view, create, literal replace, and line insert. Overlaps the fs row.',
    tools: ['str_replace_editor'],
    defaultOn: false,
    exclusiveWith: ['tool-fs'],
  },
  {
    id: 'tool-pwsh',
    pkg: '@deepseek-ai/dsh-tool-pwsh',
    row: 'pwsh',
    category: 'shell',
    zh: 'PowerShell 命令',
    en: 'PowerShell',
    descZh: 'Windows 上执行单次命令，可后台运行并受沙箱策略约束。',
    descEn: 'Run one command on Windows, optionally in the background, under sandbox policy.',
    tools: ['pwsh'],
    defaultOn: true,
    exclusiveWith: ['tool-pwsh-persistent'],
  },
  {
    id: 'tool-bash',
    pkg: '@deepseek-ai/dsh-tool-bash',
    row: 'bash',
    category: 'shell',
    zh: 'Bash 命令',
    en: 'Bash',
    descZh: 'POSIX 平台上执行单次命令。Windows 下无用，可留作跨平台配置。',
    descEn: 'Run one command on POSIX hosts.',
    tools: ['bash'],
    defaultOn: false,
    exclusiveWith: ['tool-bash-persistent'],
  },
  {
    id: 'tool-pwsh-persistent',
    pkg: '@deepseek-ai/dsh-tool-pwsh-persistent',
    row: 'pwsh-persistent',
    config: { timeoutMs: 300000 },
    category: 'shell',
    zh: 'PowerShell 常驻会话',
    en: 'Persistent PowerShell',
    descZh: '状态跨调用保留的 PowerShell，适合 cd、虚拟环境、长流程。与上一条同名，二选一。',
    descEn: 'PowerShell whose state survives across calls. Same tool name as the one-shot row.',
    tools: ['pwsh'],
    defaultOn: false,
    exclusiveWith: ['tool-pwsh'],
  },
  {
    id: 'tool-bash-persistent',
    pkg: '@deepseek-ai/dsh-tool-bash-persistent',
    row: 'bash-persistent',
    config: { timeoutMs: 300000 },
    category: 'shell',
    zh: 'Bash 常驻会话',
    en: 'Persistent Bash',
    descZh: '状态跨调用保留的 Bash。与单次 Bash 同名，二选一。',
    descEn: 'Bash whose state survives across calls.',
    tools: ['bash'],
    defaultOn: false,
    exclusiveWith: ['tool-bash'],
  },
  {
    id: 'tool-terminal',
    pkg: '@deepseek-ai/dsh-tool-terminal',
    row: 'terminal',
    category: 'shell',
    zh: 'PTY 终端组',
    en: 'PTY terminals',
    descZh: 'open / read / send / signal / list / close 六个终端工具，适合交互式进程。',
    descEn: 'Six terminal tools for interactive processes.',
    tools: ['terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_list', 'terminal_close'],
    defaultOn: false,
  },
  {
    id: 'tool-jobs',
    pkg: '@deepseek-ai/dsh-tool-jobs',
    row: 'jobs',
    category: 'shell',
    zh: '后台任务',
    en: 'Background jobs',
    descZh: '列出、读取、终止后台任务。没有它，后台启动的命令就取不回结果。',
    descEn: 'List, read, and kill background jobs.',
    tools: ['job_list', 'job_output', 'job_kill'],
    defaultOn: true,
  },
  {
    id: 'tool-web',
    pkg: '@deepseek-ai/dsh-tool-web',
    row: 'web',
    config: { fetch: true, searchTimeoutMs: 60000 },
    category: 'web',
    zh: '联网搜索与抓取',
    en: 'Web search & fetch',
    descZh: 'web_search 检索、web_fetch 抓取正文。需要联网凭证时才可用。',
    descEn: 'web_search and web_fetch.',
    tools: ['web_search', 'web_fetch'],
    defaultOn: true,
  },
  {
    id: 'tool-todo',
    pkg: '@deepseek-ai/dsh-tool-todo',
    row: 'todo',
    config: { allowParallelInProgress: true },
    category: 'session',
    zh: '任务清单',
    en: 'Todo list',
    descZh: 'todo_write 维护本次会话的任务清单，多步任务时非常有用。',
    descEn: 'todo_write keeps a task list for the session.',
    tools: ['todo_write'],
    defaultOn: true,
  },
  {
    id: 'tool-ask-user',
    pkg: '@deepseek-ai/dsh-tool-ask-user',
    row: 'ask-user',
    category: 'session',
    zh: '向用户提问',
    en: 'Ask the user',
    descZh: 'ask_user_question：需要用户拍板或补充信息时提问。',
    descEn: 'ask_user_question for user-owned decisions.',
    tools: ['ask_user_question'],
    defaultOn: true,
  },
  {
    id: 'tool-goal',
    pkg: '@deepseek-ai/dsh-tool-goal',
    row: 'goal',
    category: 'session',
    zh: '会话目标',
    en: 'Session goal',
    descZh: 'create_goal / get_goal / update_goal，把长目标写进会话状态。',
    descEn: 'create_goal, get_goal, update_goal.',
    tools: ['create_goal', 'get_goal', 'update_goal'],
    defaultOn: false,
  },
  {
    id: 'tool-schedule',
    pkg: '@deepseek-ai/dsh-tool-schedule',
    row: 'schedule',
    category: 'session',
    zh: '定时任务',
    en: 'Scheduled tasks',
    descZh: 'schedule_create / list / view / edit，创建可复发的定时任务。',
    descEn: 'schedule_create, schedule_list, schedule_view, schedule_edit.',
    tools: ['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'],
    defaultOn: false,
  },
  {
    id: 'tool-session-query',
    pkg: '@deepseek-ai/dsh-tool-session-query',
    row: 'session-query',
    category: 'session',
    zh: '历史会话检索',
    en: 'Session history',
    descZh: '在本工作区范围内搜索、追溯、读取历史会话事件。',
    descEn: 'Search and trace past sessions within the workspace.',
    tools: ['session_search', 'session_trace', 'session_event_search', 'session_event_read', 'session_event_trace'],
    defaultOn: false,
  },
  {
    id: 'tool-working-directory',
    pkg: '@deepseek-ai/dsh-tool-working-directory',
    row: 'working-directory',
    category: 'session',
    zh: '切换工作目录',
    en: 'Working directory',
    descZh: '读取并切换会话当前工作目录。',
    descEn: 'Read and change the session working directory.',
    tools: ['working_directory'],
    defaultOn: false,
  },
  {
    id: 'tool-subagent',
    pkg: '@deepseek-ai/dsh-tool-subagent',
    row: 'subagent',
    config: { provider: 'spawn', toolName: 'subagent' },
    category: 'agent',
    zh: '派发子智能体',
    en: 'Delegate to subagents',
    descZh: '把独立子任务交给新起的子智能体，含模型选择与发现。',
    descEn: 'Spawn child agents for isolated subtasks.',
    tools: ['subagent', 'list_subagent_models'],
    defaultOn: false,
  },
  {
    id: 'tool-subagent-fork',
    pkg: '@deepseek-ai/dsh-tool-subagent',
    row: 'subagent-fork',
    config: { provider: 'fork', toolName: 'subagent_fork' },
    category: 'agent',
    zh: '分叉子智能体',
    en: 'Forked subagents',
    descZh: '继承当前上下文的子智能体，省一次重述。',
    descEn: 'Child agent that inherits the current context.',
    tools: ['subagent_fork'],
    defaultOn: false,
  },
  {
    id: 'tool-subagent-control',
    pkg: '@deepseek-ai/dsh-tool-subagent-control',
    row: 'subagent-control',
    category: 'agent',
    zh: '子智能体管理',
    en: 'Child agent control',
    descZh: 'list_agents / send_message / interrupt_agent，管理可继续的子智能体。',
    descEn: 'list_agents, send_message, interrupt_agent.',
    tools: ['list_agents', 'send_message', 'interrupt_agent'],
    defaultOn: false,
  },
  {
    id: 'tool-workflow',
    pkg: '@deepseek-ai/dsh-tool-workflow',
    row: 'workflow',
    category: 'agent',
    zh: '编排工作流',
    en: 'Workflows',
    descZh: '用 JS 脚本编排多步子任务。需要宿主的 workflow 引擎，独立挂载容易失败。',
    descEn: 'Run a JS orchestration script. Needs the host workflow engine.',
    tools: ['workflow'],
    defaultOn: false,
    risky: true,
  },
  {
    id: 'tool-ralph',
    pkg: '@deepseek-ai/dsh-tool-ralph',
    row: 'ralph',
    category: 'agent',
    zh: 'Ralph 循环',
    en: 'Ralph loop',
    descZh: '反复重启全新智能体推进同一目标。依赖 workflow 与 subagent 接缝。',
    descEn: 'Loop a fresh agent toward one goal.',
    tools: ['ralph'],
    defaultOn: false,
    risky: true,
  },
  {
    id: 'tool-cordis',
    pkg: '@deepseek-ai/dsh-tool-cordis',
    row: 'cordis',
    category: 'agent',
    zh: '插件运行时探查',
    en: 'Plugin runtime introspection',
    descZh: '只读查看 Harness 的运行时 API，写插件、改组合时用。',
    descEn: 'Read-only runtime API inspection.',
    tools: ['cordis_inspect_list', 'cordis_inspect_query'],
    defaultOn: false,
  },
  {
    id: 'tool-skill',
    pkg: '@deepseek-ai/dsh-skill-filesystem',
    row: SKILL_GROUP,
    category: 'skill',
    zh: '技能库',
    en: 'Skills',
    descZh: '扫描仓库技能并让模型按需加载。挂载时自动带上 skill 发现，两者不拆开。',
    descEn: 'Discover repo skills and load them on demand.',
    tools: ['skill'],
    defaultOn: true,
  },
  {
    id: 'present',
    pkg: '@deepseek-ai/dsh-tool-present',
    row: 'present',
    category: 'deliver',
    zh: '交付文件',
    en: 'Present files',
    descZh: '把工作区文件声明为成品，界面上可预览与打开。',
    descEn: 'Declare workspace files as deliverables.',
    tools: ['present'],
    defaultOn: true,
  },
  {
    id: 'compaction',
    pkg: '@deepseek-ai/dsh-compaction-basic',
    row: COMPACTION_GROUP,
    category: 'infra',
    zh: '长会话压缩',
    en: 'Compaction',
    descZh: '上下文接近上限时自动压缩，并提供 /compact。不是模型工具，建议常开。',
    descEn: 'Automatic compaction plus /compact.',
    tools: [],
    defaultOn: true,
    locked: true,
  },
  {
    id: 'workbuddy-guard',
    pkg: 'dsh-agents-modes/guard',
    row: 'workbuddy-guard',
    config: {
      provider: 'workbuddy',
      maxReadBytes: 10 * 1024 * 1024,
      maxJobWaitMs: 30_000,
      denyRepeats: true,
    },
    category: 'infra',
    zh: 'WorkBuddy 命令守卫',
    en: 'WorkBuddy command guard',
    descZh:
      'WorkBuddy 会话里拦截会卡住的大文件扫描、盘符递归、长时间 job_output 等待和重复 pwsh 命令，提示模型改用 grep/Node。不是模型工具，不增加工具面。',
    descEn:
      'Blocks large-file scans, drive-wide recursion, long job_output waits, and repeated pwsh commands in WorkBuddy sessions; points the model at grep/Node. Not a model-facing tool.',
    tools: [],
    defaultOn: false,
  },
  {
    id: 'workbuddy-guard-strict',
    pkg: 'dsh-agents-modes/guard',
    row: 'workbuddy-guard-strict',
    config: {
      provider: 'workbuddy',
      maxReadBytes: 10 * 1024 * 1024,
      maxJobWaitMs: 30_000,
      maxToolSteps: 30,
      denyRepeats: true,
    },
    category: 'infra',
    zh: 'WorkBuddy 命令守卫（严格）',
    en: 'WorkBuddy command guard (strict)',
    descZh:
      '在基本守卫上增加重复 pwsh 命令拦截与每会话最多 30 个工具步，适合 WorkBuddy Flash；达到预算后强制模型基于已有信息回答。',
    descEn:
      'Adds repeated-pwsh denial and a 30-tool-call session budget to the base guard; used by WorkBuddy Flash. At the budget the model must answer from the evidence it has.',
    tools: [],
    defaultOn: false,
  },
  {
    id: 'tool-plugin-manager',
    pkg: '@deepseek-ai/dsh-plugin-manager/tools',
    row: 'tool-plugin-manager',
    category: 'infra',
    zh: '插件管理工具',
    en: 'Plugin manager tools',
    descZh: '让模型安装/卸载插件。依赖宿主 profile 上下文，只能在宿主平面使用。',
    descEn: 'Install/remove plugins. Host-plane only.',
    tools: [],
    defaultOn: false,
    hostOnly: true,
  },
  {
    id: 'tool-plugin-market',
    pkg: '@deepseek-ai/dsh-plugin-market/tools',
    row: 'tool-plugin-market',
    category: 'infra',
    zh: '插件市场工具',
    en: 'Plugin market tools',
    descZh: '检索插件市场。依赖宿主网络与 profile 上下文，只能在宿主平面使用。',
    descEn: 'Search the plugin market. Host-plane only.',
    tools: [],
    defaultOn: false,
    hostOnly: true,
  },
])

/** Catalog id → entry. */
export const TOOL_BY_ID = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.id, tool])),
)

/** Ids checked when a fresh mode is created outside the pure profile. */
export const DEFAULT_TOOL_IDS = Object.freeze(
  TOOLS.filter((tool) => tool.defaultOn === true).map((tool) => tool.id),
)

/** True when the id names a catalog entry an agent mode may mount. */
export function isKnownToolId(id) {
  return typeof id === 'string' && Object.hasOwn(TOOL_BY_ID, id)
}

/** One-line label for a catalog entry in the requested language. */
export function toolLabel(tool, lang) {
  if (lang === 'zh') return tool.zh
  return tool.en
}

/** Longer description for a catalog entry in the requested language. */
export function toolDescription(tool, lang) {
  if (lang === 'zh') return tool.descZh
  return tool.descEn
}
