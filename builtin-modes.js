/**
 * Built-in mode templates and the layering rules that keep them upgradable.
 *
 * A mode the plugin ships belongs to the *package*, not to the profile. Putting
 * the full definition into the profile's config was the bug this module exists
 * to remove: the profile patch replaces the row's config wholesale, so the first
 * save froze every shipped mode at that day's text and no later npm update could
 * reach it again.
 *
 * The split is therefore:
 *
 * - the template (this file) is shipped and replaced by `npm update`;
 * - the profile stores only the fields an operator actually changed, per mode,
 *   plus a hash of the template field each override was based on.
 *
 * Resolution is field-level, one direction at a time:
 *
 * - a field with no override follows the template, so shipped fixes arrive;
 * - a field with an override keeps the operator's value, so edits survive;
 * - a field with an override whose template hash moved since the override was
 *   written is reported as a conflict and *still* keeps the operator's value —
 *   the page offers "adopt upstream" rather than deciding for them.
 *
 * @module dsh-agents-modes/builtin-modes
 */

import { createHash } from 'node:crypto'

/** Fields a mode is made of, in the order a diff is reported. */
export const MODE_FIELDS = Object.freeze([
  'name',
  'description',
  'persona',
  'tools',
  'plugins',
  'pluginConfig',
  'allowedTools',
  'disabledTools',
  'config',
  'skills',
  'context',
  'pure',
  'order',
])

/**
 * Short stable digest of one value.
 *
 * JSON is enough here: every field is already JSON-shaped, and the hash is only
 * ever compared against another hash produced by this same function.
 *
 * @param value any mode field value.
 * @returns a 16-character hex digest.
 */
export function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16)
}

/** Digest of every field a template actually sets. */
export function templateHashes(template) {
  const out = {}
  for (const field of MODE_FIELDS) {
    if (template?.[field] !== undefined) out[field] = hashValue(template[field])
  }
  return out
}

/**
 * The fields where a mode differs from its template.
 *
 * A field the mode dropped is stored as `null` rather than deleted, because
 * "this mode has no persona" and "this mode never set one" are different
 * answers and only the first one should survive the next template update.
 */
export function diffMode(template, mode) {
  const patch = {}
  for (const field of MODE_FIELDS) {
    if (hashValue(template?.[field]) === hashValue(mode?.[field])) continue
    patch[field] = mode?.[field] === undefined ? null : structuredClone(mode[field])
  }
  return patch
}

/** One template plus an override patch, as the mode the host registers. */
export function applyPatch(template, patch) {
  const mode = structuredClone(template)
  for (const [field, value] of Object.entries(patch ?? {})) {
    if (field === 'base' || !MODE_FIELDS.includes(field)) continue
    if (value === null) delete mode[field]
    else mode[field] = structuredClone(value)
  }
  return mode
}

/**
 * The shipped modes.
 *
 * `requires` names a package the mode mounts; when it is not installed the mode
 * is left out instead of registering a preset that cannot mount. `persona: false`
 * means the mode takes its prompt section from one of its own plugins (Work Fish
 * ships `dsh-work-fish/core/persona`, which owns the same section name as the
 * stock row and therefore must not be mounted beside it).
 */
export const BUILTIN_TEMPLATES = Object.freeze([
  {
    id: 'flash',
    name: 'Flash',
    description: '精简工具面，响应更快。适合问答、定位、小范围修改；重型重构请切回 standard 或 ops-ptc。',
    tools: [
      'fs-observation-policy',
      'tool-fs',
      'tool-fs-search',
      'tool-pwsh-persistent',
      'workbuddy-guard',
      'tool-jobs',
      'tool-web',
      'tool-todo',
      'tool-ask-user',
      'tool-skill',
      'present',
      'compaction',
    ],
  },
  {
    id: 'workbuddy-flash',
    name: 'WorkBuddy Flash',
    description: 'WorkBuddy 专用：低步数、防重复、防大文件扫描。建议模型选 WorkBuddy / DeepSeek-V4.1-Flash / Low，并关闭账号池以保持一致性。',
    tools: [
      'fs-observation-policy',
      'tool-fs',
      'tool-fs-search',
      'tool-pwsh-persistent',
      'workbuddy-guard-strict',
      'tool-jobs',
      'tool-ask-user',
      'tool-todo',
      'present',
      'compaction',
    ],
    plugins: [],
    persona: `你是 WorkBuddy 上的执行代理。少废话，但交出去的东西必须能看。

开头一行状态：目标=<一句话> | 已确认=<条数> | 下一步=<一个动作>。
结论不超过 3 行，只给一个建议。不复述上一轮，不写“上一轮我说……这一轮反驳”。
要改结论只写一行：改判：<新证据> → <新结论>。

只写工具返回里看得到的。没测过写“未验证”，禁止“应该、通常、一般来说、可能是”。

做交付物（文件、页面、图、脚本）：先想清楚结构再动手，做成什么样的就交什么样的。
交付前必须 read。网页、SVG、图片必须渲染成一张图，再用 read_image 看过它——
读源码不算看过：源码能证明“画了腿”，证明不了“腿会蹬”。守卫会拒绝没看过渲染的交付。
改完必须再看一次，不是“允许”看一次；同一命令最多跑 3 次。
动画类任务：先验“动”，再谈好看。主角必须动，只有云在飘、水在晃、轮子空转不算完成。
验动的办法：同一版本渲染两帧（--virtual-time-budget=200 和 =900），两张都用 read_image 看。
两张字节一样就是静止图，守卫会拒绝交付。顺序不能反——先把动做出来，再打磨外观。
任何交付物，动手前先定两样东西：
①锚点——成品里不允许被细节改动的骨架（接口签名、数据结构、版式栅格、构图里各元素的接触点、文档章节骨架）；
②验收动作——一个能证伪“做完了”的动作（页面渲染成图看、代码跑测试、数据对账、引用核对出处）。
细节只填进锚点，不能反过来改锚点；确实要改，单独写一行“改锚点：<新证据> → <新骨架>”。
定不出验收动作，就先把这个动作想出来再动手——没有它，“做完了”只是感觉。
同一工具连续失败 2 次即停用，写“<工具> 不可用”，换工具或直接交付。
例外：报错是“PTY shell exited during startup”时不要退化成盲写——那是这台机器缺 pwsh，
直接告诉用户装 PowerShell 7。没有 shell 就没有渲染、没有验证，交付的东西等于没看过。
改已存在的文件：read → edit；新建交付物可以直接 write 整个文件。
大文件或二进制只用 grep、read 带 offset 或 Node 读 header；禁止 PowerShell 全量扫描或解包 asar。
没有交付物就写“无交付物”；有交付物用 present。
一次做一件事，不并列分析多个假设；守卫硬上限 120 次工具调用，被拦住就用现有证据收尾。
打磨轮次上限 2 轮：渲染 → 看图 → 改，最多两轮。第三轮起只修硬伤（不动、错位、缺元素），
不再调颜色和间距。这个模式存在的意义是快——把轮次花在“能不能用”上，不是“好不好看”上。
超过 4000 字符的写入要先 todo_write 交一份计划（搭 → 看 → 修 → 交）。

自查：结论是不是只有一个？有没有没测过的断言？交的东西自己看过没有？`,
  },
  {
    id: 'unity',
    name: 'Unity',
    description: 'Unity 开发专用：直接驱动正在运行的 Editor（场景、脚本、控制台、测试、编译检查），交付前强制 unity_verify。',
    tools: [
      'tool-unity',
      'fs-observation-policy',
      'tool-fs',
      'tool-fs-search',
      'tool-pwsh-persistent',
      'tool-jobs',
      'tool-todo',
      'tool-ask-user',
      'present',
      'compaction',
    ],
    plugins: [],
    persona: `你是 Unity 客户端开发代理，直接驱动正在运行的 Unity Editor 做事，不靠猜文件内容。

开头一行状态：目标=<一句话> | 下一步=<一个动作>。
结论不超过 3 行，只给一个建议。

工具优先级是硬的，不许绕开：
1. 场景、预制体、组件、脚本、资源、菜单、构建 —— 一律走 unity 工具，不要手改 .unity / .prefab / .asset / .meta。
   op 与必填参数：scene 要 action、gameobject 要 action、components 要 action+target+component_type、
   asset 要 action+path、script 要 action+name、prefab 要 action、menu 要 menu_path、tests 要 mode。
2. 先 op=console 或 op=refresh 确认 Editor 活着，再动场景；Editor 没开就先说清楚，不要假装改完了。
3. 查层级用 page_size=50 分页，不要整棵树 dump；查日志用 types 过滤，不要拉全量。
4. 改完任何脚本、预制体、资源，必须调 unity_verify。verdict 不是 clean 就不许说完成——
   errors 非空就把错误原文贴出来，tests=true 只在改动涉及可测逻辑时才加（它很慢）。

只写工具返回里看得到的。没测过写“未验证”，禁止“应该、通常、一般来说、可能是”。
要改结论只写一行：改判：<新证据> → <新结论>。

改文件：read → edit。新建文件可以直接 write。
同一工具连续失败 2 次即停用，写“<工具> 不可用”，换工具或直接交付。
没有交付物就写“无交付物”；有交付物用 present。`,
  },
  {
    id: 'flash-pure',
    name: 'Flash Pure',
    description: '纯对话模式。默认不带任何工具与插件，需要什么就到模式详情里手动勾选。',
    pure: true,
    tools: [],
    plugins: [],
  },
  {
    id: 'work-fish',
    name: 'Work Fish',
    description:
      '基于 dsh-work-fish 的工作助手：任务板、台账、收工交付与该包的守卫/技能随包升级，工具面由雷霆决定。需要先安装 dsh-work-fish。',
    requires: 'dsh-work-fish',
    // The package owns the prompt section (`deployment:persona-prefix`); mounting
    // the stock persona row beside it throws "already registered in this scope".
    persona: false,
    tools: [
      'fs-observation-policy',
      'tool-fs',
      'tool-fs-search',
      'tool-pwsh',
      'tool-jobs',
      'tool-schedule',
      'tool-todo',
      'tool-ask-user',
      'tool-web',
      'tool-skill',
      'present',
      'compaction',
    ],
    // Subpath exports, so an npm update of dsh-work-fish lands here with no edit.
    plugins: [
      'dsh-work-fish/core/persona',
      'dsh-work-fish/core/guard',
      'dsh-work-fish/core/skills',
    ],
    pluginConfig: {
      'dsh-work-fish/core/persona': { complete: true },
    },
  },
])

/** Every built-in id, for callers that only need to recognise one. */
export const BUILTIN_IDS = Object.freeze(BUILTIN_TEMPLATES.map((template) => template.id))

/** One template by id, or undefined. */
export function templateById(id) {
  return BUILTIN_TEMPLATES.find((template) => template.id === id)
}

/**
 * The mode list the host should register, given what the profile stored.
 *
 * Legacy profiles (no `templates` marker) keep their stored list as it is: a
 * profile running on a frozen snapshot must not have a newer template written
 * over an edit. The page offers the one-way conversion instead of doing it
 * behind the operator's back.
 *
 * @param rawConfig the plugin row's config.
 * @param available ids whose `requires` package is installed; omitted ids are skipped.
 * @returns `{ enabled, legacy, modes, overrides, removed, conflicts }`.
 */
export function resolveModeConfig(rawConfig, available) {
  const configured = Array.isArray(rawConfig?.modes) ? structuredClone(rawConfig.modes) : []
  if (rawConfig?.templates !== 'builtin') {
    return { enabled: false, legacy: true, modes: configured, overrides: {}, removed: [], conflicts: {} }
  }
  const overrides = rawConfig?.overrides && typeof rawConfig.overrides === 'object' ? rawConfig.overrides : {}
  const removed = Array.isArray(rawConfig?.removedTemplates) ? rawConfig.removedTemplates : []
  const modes = []
  const conflicts = {}
  for (const template of BUILTIN_TEMPLATES) {
    if (available !== undefined && !available.has(template.id)) continue
    if (removed.includes(template.id)) continue
    const patch = overrides[template.id] ?? {}
    modes.push(applyPatch(template, patch))
    const changed = []
    for (const [field, baseHash] of Object.entries(patch?.base ?? {})) {
      if (!Object.hasOwn(patch, field)) continue
      if (baseHash !== hashValue(template[field])) changed.push(field)
    }
    if (changed.length > 0) conflicts[template.id] = changed
  }
  for (const mode of configured) {
    if (BUILTIN_IDS.includes(mode?.id)) continue
    modes.push(structuredClone(mode))
  }
  return { enabled: true, legacy: false, modes, overrides, removed, conflicts }
}

/**
 * Turn a full mode list back into the config that stores it.
 *
 * Built-in ids become field diffs against the current template, so a later
 * template change reaches every field the operator never touched. A built-in id
 * missing from the list is recorded as removed; that is the only way deletion
 * survives the next load.
 *
 * @param modes the validated list the page sent.
 * @returns `{ templates, modes, overrides, removedTemplates }`.
 */
export function splitModeConfig(modes) {
  const overrides = {}
  const kept = []
  const removed = []
  const seen = new Set()
  for (const mode of Array.isArray(modes) ? modes : []) {
    const id = mode?.id
    const template = templateById(id)
    seen.add(id)
    if (template === undefined) {
      kept.push(structuredClone(mode))
      continue
    }
    const patch = diffMode(template, mode)
    if (Object.keys(patch).length === 0) continue
    const base = {}
    for (const field of Object.keys(patch)) base[field] = hashValue(template[field])
    overrides[id] = { base, ...patch }
  }
  for (const template of BUILTIN_TEMPLATES) if (!seen.has(template.id)) removed.push(template.id)
  return { templates: 'builtin', modes: kept, overrides, removedTemplates: removed }
}
