/**
 * Agent Modes — browser half.
 *
 * Registers a sidebar panel row plus the keyed `main` page it opens, mirroring
 * how the host's own Plugins row and WorkBuddy's panel work. The page edits the
 * mode list; every mode becomes a real agent preset.
 *
 * Layout: a mode rail on the left, the selected mode's detail on the right.
 * The detail carries the tool catalog grouped by capability, the priority list
 * that decides which tool the model reaches for first, and the installed plugin
 * inventory with each plugin's live enablement.
 */

const CSS = `
.lt-root {
  display: flex; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.lt-rail {
  width: 232px; flex: 0 0 232px; min-height: 0; display: flex; flex-direction: column;
  gap: 10px; padding: 14px 12px; overflow-y: auto;
  border-right: .5px solid var(--dsw-alias-border-l2);
}
.lt-rail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lt-rail-title { font-size: 13px; font-weight: 600; letter-spacing: .02em; }
.lt-mode-item {
  display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left;
  padding: 9px 11px; border-radius: var(--dsw-radius-md, 8px); cursor: pointer;
  border: 1px solid transparent; background: transparent; color: inherit; font: inherit;
}
.lt-mode-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-mode-item[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  border-color: var(--dsw-alias-border-l2);
}
.lt-mode-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.lt-mode-sub { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; }
.lt-main { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; }
.lt-page { padding: 20px 26px 64px; max-width: 980px; display: flex; flex-direction: column; gap: 18px; }
.lt-topbar { display: flex; align-items: center; gap: 10px; }
.lt-spacer { flex: 1 1 auto; }
.lt-h1 { font-size: 19px; font-weight: 600; margin: 0; }
.lt-lead { font-size: 12.5px; color: var(--dsw-alias-label-tertiary); margin: 0; line-height: 1.65; }
.lt-card {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg, 12px);
  padding: 16px; display: flex; flex-direction: column; gap: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.lt-card-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.lt-card-title { font-size: 13.5px; font-weight: 600; margin: 0; }
.lt-card-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); margin: 0; line-height: 1.6; }
.lt-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.lt-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.lt-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.lt-input, .lt-textarea, .lt-select {
  width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: 12.5px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px);
  font-family: inherit; line-height: 1.55;
}
.lt-input:focus, .lt-textarea:focus, .lt-select:focus {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5);
  outline-offset: 0; border-color: transparent;
}
.lt-textarea { min-height: 74px; resize: vertical; }
.lt-input:disabled, .lt-textarea:disabled { opacity: .55; }
.lt-btn {
  padding: 6px 12px; font-size: 12.5px; border-radius: var(--dsw-radius-md, 8px); cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: inherit;
  font-family: inherit; line-height: 1.5; white-space: nowrap;
}
.lt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.lt-btn:disabled { opacity: .45; cursor: default; }
.lt-btn-primary {
  background: var(--dsw-alias-button-primary-fill, #4176e6);
  /* The fill is brand-primary, which resolves to near-white in the dark theme:
     a hardcoded #fff makes the label invisible. Use the paired foreground. */
  color: var(--dsw-alias-label-primary-foreground, #fff);
  border-color: transparent; font-weight: 600;
}
.lt-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #3565c9);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.lt-btn-primary:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5);
  outline-offset: 2px;
}
.lt-btn-icon {
  width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center;
  justify-content: center; font-size: 12px; border-radius: 6px;
}
.lt-status { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.lt-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary, #d64545); }
.lt-status[data-kind="ok"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
.lt-section { display: flex; flex-direction: column; gap: 8px; }
.lt-section-head {
  display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
  padding: 6px 2px; border-radius: 6px;
}
.lt-section-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-caret { font-size: 10px; color: var(--dsw-alias-label-tertiary); width: 10px; }
.lt-cat-name { font-size: 12.5px; font-weight: 600; }
.lt-cat-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.lt-count {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
.lt-tool {
  display: flex; gap: 10px; padding: 9px 11px; border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l1); align-items: flex-start;
}
.lt-tool[data-on="true"] { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); }
.lt-tool[data-disabled="true"] { opacity: .55; }
.lt-tool-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.lt-tool-title { font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lt-tool-desc { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); line-height: 1.6; }
.lt-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.lt-chip {
  font-size: 10.5px; padding: 1px 6px; border-radius: 4px; font-family: var(--dsw-font-markdown-code-font-family, monospace);
  background: var(--dsw-alias-markdown-inline-code); color: var(--dsw-alias-label-secondary);
}
.lt-badge {
  font-size: 10.5px; padding: 1px 6px; border-radius: 4px; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary);
}
.lt-badge[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #b8860b); border-color: currentColor; }
.lt-badge[data-tone="on"] { color: var(--dsw-alias-state-success-primary, #2f9e44); border-color: currentColor; }
.lt-badge[data-tone="err"] { color: var(--dsw-alias-state-error-primary, #d64545); border-color: currentColor; }
.lt-check {
  width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--dsw-alias-button-primary-fill, #4176e6);
  cursor: pointer; flex: 0 0 auto;
}
.lt-order { display: flex; flex-direction: column; gap: 6px; }
.lt-order-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 9px;
  border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.lt-rank {
  width: 20px; height: 20px; flex: 0 0 auto; border-radius: 6px; font-size: 11px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary);
}
.lt-order-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lt-order-name {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px; font-weight: 600; min-width: 0;
}
.lt-order-desc { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); line-height: 1.55; }
.lt-empty {
  font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 14px;
  text-align: center; border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
}
.lt-plugin {
  display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
  border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--dsw-alias-border-l1);
}
.lt-plugin[data-on="true"] { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); }
.lt-mono { font-family: var(--dsw-font-markdown-code-font-family, monospace); font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lt-addrow { display: flex; gap: 8px; }
.lt-addrow > .lt-input { flex: 1 1 auto; }
.lt-live {
  display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l1);
}
.lt-live[data-broken="true"] { border-color: var(--dsw-alias-state-error-primary, #d64545); }
.lt-live-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; font-weight: 600; }
.lt-err { font-size: 11.5px; color: var(--dsw-alias-state-error-primary, #d64545); line-height: 1.6; white-space: pre-wrap; }
.lt-stale {
  display: flex; flex-direction: column; gap: 4px; padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 8px); font-size: 12px; line-height: 1.6;
  border: 1px solid var(--dsw-alias-state-warn-primary, #b8860b);
  background: var(--dsw-alias-state-warn-tertiary, rgba(184,134,11,.12));
  color: var(--dsw-alias-label-primary);
}
.lt-stale strong { font-weight: 600; }
.lt-toggle { display: flex; align-items: flex-start; gap: 10px; }
.lt-toggle-text { display: flex; flex-direction: column; gap: 3px; }
.lt-split { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lt-tabs {
  display: flex; align-items: center; gap: 2px; padding: 3px;
  border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); align-self: flex-start; max-width: 100%;
  overflow-x: auto; scrollbar-width: none;
}
.lt-tabs::-webkit-scrollbar { display: none; }
.lt-tab {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  padding: 6px 13px; font-size: 12.5px; font-family: inherit; cursor: pointer;
  border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary);
}
.lt-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.lt-tab[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary); font-weight: 600;
}
.lt-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5);
  outline-offset: -2px;
}
.lt-tab-count { font-size: 10.5px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.lt-tab[data-active="true"] .lt-tab-count { color: var(--dsw-alias-label-secondary); }
.lt-pane { display: flex; flex-direction: column; gap: 14px; }
.lt-viewtabs {
  display: inline-flex; align-items: center; gap: 2px; padding: 3px; align-self: flex-start;
  border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.lt-viewtab {
  padding: 7px 20px; font-size: 13px; font-family: inherit; cursor: pointer; border: 0;
  border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary);
}
.lt-viewtab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.lt-viewtab[data-active="true"] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
}
.lt-statgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)); gap: 10px; }
.lt-stat {
  display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
}
.lt-stat-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lt-stat-value { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.lt-stat-sub { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.lt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.lt-table th {
  text-align: left; font-weight: 500; color: var(--dsw-alias-label-secondary);
  padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); white-space: nowrap;
}
.lt-table td {
  padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  vertical-align: middle; font-variant-numeric: tabular-nums;
}
.lt-table tbody tr:last-child td { border-bottom: 0; }
.lt-num { text-align: right; }
.lt-bar {
  height: 6px; min-width: 56px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-3);
}
.lt-bar > i { display: block; height: 100%; background: var(--dsw-alias-button-primary-fill, #4176e6); }
.lt-sessions { display: flex; flex-direction: column; gap: 6px; }
.lt-session {
  display: flex; gap: 10px; align-items: center; padding: 8px 10px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: inherit; font: inherit; text-align: left; width: 100%;
}
.lt-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-session[data-active="true"] {
  border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2);
}
.lt-session-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.lt-session-title {
  font-size: 12.5px; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.lt-session-meta {
  display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.lt-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px 14px; }
.lt-kv-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lt-kv-k { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.lt-kv-v { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.lt-chip-btn {
  cursor: pointer; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-markdown-inline-code); color: var(--dsw-alias-label-secondary);
}
.lt-chip-btn:hover { border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); }
.lt-chip-btn[data-on="true"] {
  border-color: var(--dsw-alias-state-success-primary, #2f9e44);
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}

@media (max-width: 720px) {
  .lt-root { flex-direction: column; }
  .lt-rail { width: auto; flex: 0 0 auto; max-height: 168px; border-right: 0;
    border-bottom: .5px solid var(--dsw-alias-border-l2); }
  .lt-page { padding: 16px; }
  .lt-grid2 { grid-template-columns: 1fr; }
}
`

const STYLE_ID = 'agent-modes/pages.css'

/** Install the page stylesheet once; a hot reload reuses the same element. */
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'agent-modes'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
}

window.__ModuleLoader__.load({
  id: 'dsh-agents-modes',
  factory(require) {
    const DICT_EN = {
      'meta.title': 'Leiting',
      'meta.description': 'Manage agent modes: each mode is a preset with its own tool set.',
      'page.back': 'Back to chat',
      'page.title': 'Leiting · Agent modes',
      'page.intro': 'Each mode is a real agent preset: a persona, a tool set, and the plugins it mounts. Pick one for a new task.',
      'page.empty': 'No modes yet. Add one to get started.',
      'page.loadFailed': 'Could not read the mode roster. Reload the page to try again.',
      'page.addMode': 'New mode',
      'page.save': 'Save modes',
      'page.saving': 'Saving…',
      'page.saved': 'Saved. New tasks pick it up; running sessions keep their own mode.',
      'page.saveFailed': 'Could not save',
      'page.delete': 'Delete mode',
      'page.duplicate': 'Duplicate',
      'page.fieldId': 'Id',
      'page.fieldName': 'Name',
      'page.fieldDescription': 'Description',
      'page.fieldPersona': 'Persona',
      'page.basics': 'Basics',
      'page.personaHint': 'The system prompt this mode opens with. Leave blank for the default coding-agent persona.',
      'page.modeList': 'Modes',
      'page.detail': 'Mode detail',
      'page.pure': 'Pure mode',
      'page.pureHint': 'Starts with no tools and no plugins: the model can only talk. Everything below is opt-in.',
      'page.tools': 'Tools',
      'page.toolsHint': 'Checked rows are mounted for this mode. The order decides which tool the model reaches for first.',
      'page.plugins': 'Plugins',
      'page.pluginsHint': 'Installed plugin packages this mode may mount. Enabled means the profile already loads it.',
      'page.priority': 'Priority order',
      'page.priorityHint': 'Earlier rows win when two tools could do the same job.',
      'page.priorityEmpty': 'Nothing selected yet — this mode has no tools.',
      'page.liveTitle': 'Registered presets',
      'page.liveEmpty': 'None registered yet.',
      'page.liveHint': 'Live activation state. A broken preset cannot be chosen for a new task.',
      'page.addPlugin': 'Mount package',
      'page.addPluginPlaceholder': 'Package name, e.g. @opdsh/unity-plugin',
      'page.add': 'Add',
      'page.remove': 'Remove',
      'page.moveUp': 'Higher priority',
      'page.moveDown': 'Lower priority',
      'page.enabled': 'enabled',
      'page.disabled': 'not loaded',
      'page.client': 'has UI',
      'page.hostOnly': 'host only',
      'page.locked': 'locked',
      'page.risky': 'needs host service',
      'page.conflict': 'conflicts',
      'page.broken': 'activation failed',
      'page.toolCount': 'tools',
      'page.noSelection': 'none',
      'page.unknownId': 'Ids use lowercase letters, digits, and dashes.',
      'page.unknownTool': 'not in this build',
      'page.staleTitle': 'The running host is older than this page.',
      'page.staleBody': 'Restart DeepSeek Harness so the host half reloads. Until then the tool catalog and plugin inventory stay empty and the mode list shows raw ids.',
      'page.noCatalog': 'The tool catalog is unavailable from this host.',
      'page.noPlugins': 'No installed plugin packages were found.',
      'page.tabBasics': 'Basics',
      'page.tabPriority': 'Priority order',
      'page.tabTools': 'Tools',
      'page.tabPlugins': 'Plugins',
      'page.tabBasicsHint': 'Name, id, description, persona, and the pure-mode switch.',
      'page.tabPriorityHint': 'Which tool the model reaches for first when two could do the job.',
      'page.tabToolsHint': 'Every capability this build can mount, grouped by area.',
      'page.tabPluginsHint': 'Installed plugin packages this mode may mount.',
      'page.liveInTab': 'Live activation state of the registered presets.',
      'page.liveShow': 'Show registered presets',
      'page.liveHide': 'Hide registered presets',
      'page.hotApplied': 'Applied to {n} running session(s): {tools} will be available from the next turn.',
      'page.hotNotified': ' The session log now records the change, so the model no longer trusts its earlier answer.',
      'page.hotSilent': ' The change is mounted but could not be written into the session log; ask again in a new task if the model still says it cannot.',
      'page.hotNone': 'No running session is on this mode, so only new tasks pick this up.',
      'page.hotSkipped': 'Some sessions rejected the change',
      'page.viewModels': 'Models',
      'page.viewStats': 'Statistics',
      'page.statsHint': 'Session cost of this mode: wall time, tokens, cache hit rate, and which tool eats the clock.',
      'page.statsRefresh': 'Refresh',
      'page.statsLoading': 'Reading sessions…',
      'page.statsEmpty': 'No session has run on this mode yet.',
      'page.statsFailed': 'Could not read session statistics',
      'page.statsNoService': 'This host exposes no session history service.',
      'page.statsScope': 'Scanned the {n} newest sessions.',
      'page.statSessions': 'Sessions',
      'page.statDuration': 'Wall time',
      'page.statLlm': 'Model time',
      'page.statTool': 'Tool time',
      'page.statTokens': 'Tokens',
      'page.statCache': 'Cache hit',
      'page.statTurns': 'Turns',
      'page.statSteps': 'Steps',
      'page.statContext': 'Context',
      'page.statModel': 'Model',
      'page.statToolRank': 'Tool time ranking',
      'page.statToolName': 'Tool',
      'page.statCalls': 'Calls',
      'page.statTotal': 'Total',
      'page.statAvg': 'Avg',
      'page.statMax': 'Max',
      'page.statErrors': 'Failed',
      'page.statShare': 'Share',
      'page.statNoTools': 'No tool was called in this session.',
      'page.statSessionsTitle': 'Sessions on this mode',
      'page.statSessionsHint': 'Click a row for its token and tool breakdown.',
      'page.statDetail': 'Session detail',
      'page.statInput': 'Input',
      'page.statOutput': 'Output',
      'page.statCacheRead': 'Cache read',
      'page.statCacheWrite': 'Cache write',
      'page.statPick': 'Pick a session above to see its detail.',
      'page.statLive': 'running',
      'page.pluginToolsHint': 'Click a tool to mount the plugin package that ships it.',
      'page.pluginNoTools': 'no declared tools',
      'page.pluginTools': 'tools',
      'sidebar.title': 'Leiting',
    }
    const DICT_ZH = {
      'meta.title': '雷霆',
      'meta.description': '管理智能体模式：每个模式是一套独立的工具集与人设。',
      'page.back': '返回会话',
      'page.title': '雷霆 · 智能体模式',
      'page.intro': '每个模式都是一个真正的 agent preset：人设、工具集，以及它挂载的插件。为新任务挑一个即可。',
      'page.empty': '还没有模式，先新建一个。',
      'page.loadFailed': '读取模式列表失败，刷新页面重试。',
      'page.addMode': '新建模式',
      'page.save': '保存模式',
      'page.saving': '保存中…',
      'page.saved': '已保存。新任务会用它，已开始的会话保持原模式。',
      'page.saveFailed': '保存失败',
      'page.delete': '删除模式',
      'page.duplicate': '复制',
      'page.fieldId': '标识',
      'page.fieldName': '名称',
      'page.fieldDescription': '说明',
      'page.fieldPersona': '人设',
      'page.basics': '基础信息',
      'page.personaHint': '这个模式开场用的系统提示词。留空则用默认的编码智能体人设。',
      'page.modeList': '模式',
      'page.detail': '模式详情',
      'page.pure': '纯模式',
      'page.pureHint': '不带任何工具与插件：只能对话。下面全部靠手动勾选开启。',
      'page.tools': '工具',
      'page.toolsHint': '勾选的行会挂载进这个模式。顺序决定模型优先用哪一件。',
      'page.plugins': '插件',
      'page.pluginsHint': '本机已安装、可被这个模式挂载的插件包。已启用表示 profile 当前正在加载它。',
      'page.priority': '优先级顺序',
      'page.priorityHint': '两件工具都能做同一件事时，靠前的优先。',
      'page.priorityEmpty': '还没选任何工具 —— 这个模式没有工具。',
      'page.liveTitle': '已注册的预设',
      'page.liveEmpty': '还没有注册任何预设。',
      'page.liveHint': '实时激活状态。挂载失败的预设不能用于新任务。',
      'page.addPlugin': '挂载插件包',
      'page.addPluginPlaceholder': '包名，例如 @opdsh/unity-plugin',
      'page.add': '添加',
      'page.remove': '移除',
      'page.moveUp': '提高优先级',
      'page.moveDown': '降低优先级',
      'page.enabled': '已启用',
      'page.disabled': '未加载',
      'page.client': '带界面',
      'page.hostOnly': '仅宿主',
      'page.locked': '锁定',
      'page.risky': '需宿主服务',
      'page.conflict': '互斥',
      'page.broken': '激活失败',
      'page.toolCount': '件工具',
      'page.noSelection': '无',
      'page.unknownId': '标识只能用小写字母、数字和短横线。',
      'page.unknownTool': '当前版本不认识',
      'page.staleTitle': '运行中的宿主比这个页面旧。',
      'page.staleBody': '请重启 DeepSeek Harness，让宿主端重新加载。在那之前工具目录和插件清单会是空的，模式列表也只能显示原始标识。',
      'page.noCatalog': '这个宿主没有提供工具目录。',
      'page.noPlugins': '没有找到已安装的插件包。',
      'page.tabBasics': '基础信息',
      'page.tabPriority': '优先级顺序',
      'page.tabTools': '工具',
      'page.tabPlugins': '插件',
      'page.tabBasicsHint': '名称、标识、说明、人设，以及纯模式开关。',
      'page.tabPriorityHint': '两件工具都能做同一件事时，靠前的优先。',
      'page.tabToolsHint': '这个版本能挂载的全部能力，按领域分组。',
      'page.tabPluginsHint': '本机已安装、可被这个模式挂载的插件包。',
      'page.liveInTab': '已注册预设的实时激活状态。',
      'page.liveShow': '查看已注册的预设',
      'page.liveHide': '收起已注册的预设',
      'page.hotApplied': '已对 {n} 个正在运行的会话生效：{tools} 从下一轮开始可用。',
      'page.hotNotified': '变更已写入会话记录，模型不会再沿用之前「用不了」的结论。',
      'page.hotSilent': '工具已挂载，但没能写进会话记录；如果模型仍说用不了，请开新任务再问。',
      'page.hotNone': '当前没有会话在用这个模式，只有新任务会应用。',
      'page.hotSkipped': '有会话拒绝了这次变更',
      'page.viewModels': '模型',
      'page.viewStats': '统计',
      'page.statsHint': '这个模式的会话成本：总时长、token、缓存命中率，以及到底是哪个工具在吃时间。',
      'page.statsRefresh': '刷新',
      'page.statsLoading': '正在读取会话…',
      'page.statsEmpty': '这个模式还没有跑过会话。',
      'page.statsFailed': '读取会话统计失败',
      'page.statsNoService': '这个宿主没有提供会话历史服务。',
      'page.statsScope': '扫描了最近 {n} 个会话。',
      'page.statSessions': '会话',
      'page.statDuration': '总时长',
      'page.statLlm': '模型耗时',
      'page.statTool': '工具耗时',
      'page.statTokens': 'token',
      'page.statCache': '缓存命中',
      'page.statTurns': '轮次',
      'page.statSteps': '步数',
      'page.statContext': '上下文',
      'page.statModel': '模型',
      'page.statToolRank': '工具耗时排行',
      'page.statToolName': '工具',
      'page.statCalls': '调用',
      'page.statTotal': '总耗时',
      'page.statAvg': '平均',
      'page.statMax': '最长',
      'page.statErrors': '失败',
      'page.statShare': '占比',
      'page.statNoTools': '这次会话没有调用工具。',
      'page.statSessionsTitle': '这个模式的会话',
      'page.statSessionsHint': '点开一条看 token 与工具耗时明细。',
      'page.statDetail': '会话明细',
      'page.statInput': '输入',
      'page.statOutput': '输出',
      'page.statCacheRead': '缓存读',
      'page.statCacheWrite': '缓存写',
      'page.statPick': '上面选一条会话看明细。',
      'page.statLive': '进行中',
      'page.pluginToolsHint': '点一个工具即把它的插件包挂进这个模式。',
      'page.pluginNoTools': '没有发现声明的工具',
      'page.pluginTools': '件工具',
      'sidebar.title': '雷霆',
    }
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const PANEL_ID = 'agent-modes'
    const NS = 'agent-modes'

    /** Sidebar row glyph: monochrome so the host paints selection around it. */
    function PanelIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      }, [
        h('rect', { key: 'a', x: 3, y: 4, width: 18, height: 5, rx: 2 }),
        h('rect', { key: 'b', x: 3, y: 12, width: 12, height: 5, rx: 2, opacity: 0.62 }),
        h('rect', { key: 'c', x: 3, y: 20, width: 8, height: 2.5, rx: 1.2, opacity: 0.4 }),
      ])
    }

    const post = (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then((r) => r.json())

    /**
     * Normalize one live roster row.
     *
     * The registry reports the activation diagnostic as `entry.broken`, which is
     * `false` for a healthy preset in some host versions and `undefined` in
     * others. Treating `false` as a failure painted every preset red with an
     * empty reason, so only a non-empty string counts as broken here.
     */
    const brokenReason = (row) =>
      typeof row?.broken === 'string' && row.broken.trim() !== '' ? row.broken : null

    /** A fresh mode: a pure one starts with the locked rows only, an ordinary
     *  one with the catalog defaults. */
    const blankMode = (index, defaults, lockedIds, pure) => ({
      id: `mode-${index + 1}`,
      name: `Mode ${index + 1}`,
      description: '',
      persona: '',
      pure: pure === true,
      tools: pure === true ? [...lockedIds] : [...defaults],
      plugins: [],
    })

    /** Toggle one id in a list, preserving order and appending when added. */
    const toggleIn = (list, id) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

    /** Move one entry one slot in a list. */
    const move = (list, index, delta) => {
      const target = index + delta
      if (target < 0 || target >= list.length) return list
      const next = list.slice()
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    }

    const pad2 = (value) => String(value).padStart(2, '0')

    /** `1.4s` / `3m 04s` / `2h 11m`: one human-sized duration, never a raw ms. */
    const fmtMs = (value) => {
      const ms = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
      if (ms < 1000) return `${Math.round(ms)}ms`
      const seconds = ms / 1000
      if (seconds < 60) return `${seconds.toFixed(1)}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ${pad2(Math.round(seconds % 60))}s`
      return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`
    }

    /** `1.2k` / `3.4M`: token counts stay readable in a narrow card. */
    const fmtNum = (value) => {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (n < 1000) return String(Math.round(n))
      if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
      return `${(n / 1_000_000).toFixed(2)}M`
    }

    const fmtPct = (value) => `${Math.round((typeof value === 'number' && Number.isFinite(value) ? value : 0) * 100)}%`

    /** `11-13 17:48`: stable, locale-independent, sorts visually. */
    const fmtTime = (value) => {
      const time = typeof value === 'number' && value > 0 ? new Date(value) : null
      if (time === null) return ''
      return `${pad2(time.getMonth() + 1)}-${pad2(time.getDate())} ${pad2(time.getHours())}:${pad2(time.getMinutes())}`
    }

    /** Last path segment of a workspace path, for the session meta line. */
    const baseName = (value) =>
      typeof value === 'string' && value !== '' ? value.split(/[\\/]/).filter(Boolean).pop() ?? value : ''

    function Toggle({ checked, onChange, disabled }) {
      return h('input', {
        type: 'checkbox', className: 'lt-check', checked: checked === true,
        disabled: disabled === true,
        onChange: (e) => onChange(e.target.checked),
      })
    }

    /** One collapsible tool category. */
    function ToolCategory({ title, hint, count, open, onToggleOpen, children }) {
      return h('div', { className: 'lt-section' }, [
        h('div', {
          key: 'h', className: 'lt-section-head', onClick: onToggleOpen,
          role: 'button', tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen() }
          },
        }, [
          h('span', { key: 'c', className: 'lt-caret' }, open ? '▼' : '▶'),
          h('span', { key: 'n', className: 'lt-cat-name' }, title),
          h('span', { key: 's', className: 'lt-cat-hint' }, hint),
          h('span', { key: 'k', className: 'lt-count' }, String(count)),
        ]),
        open ? h('div', { key: 'b', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, children) : null,
      ])
    }

    /** One catalog row with its checkbox, copy, and tool-name chips. */
    function ToolRow({ entry, lang, checked, disabled, reason, onToggle }) {      const label = lang === 'zh' ? entry.zh : entry.en
      const desc = lang === 'zh' ? entry.descZh : entry.descEn
      return h('div', {
        className: 'lt-tool',
        'data-on': checked ? 'true' : 'false',
        'data-disabled': disabled ? 'true' : 'false',
      }, [
        h(Toggle, {
          key: 'c', checked, disabled,
          onChange: () => { if (!disabled) onToggle() },
        }),
        h('div', { key: 'm', className: 'lt-tool-main' }, [
          h('div', { key: 't', className: 'lt-tool-title' }, [
            h('span', { key: 'l' }, label),
            ...(entry.locked ? [h('span', { key: 'lk', className: 'lt-badge' }, reason.locked)] : []),
            ...(entry.hostOnly ? [h('span', { key: 'ho', className: 'lt-badge', 'data-tone': 'warn' }, reason.hostOnly)] : []),
            ...(entry.risky ? [h('span', { key: 'rk', className: 'lt-badge', 'data-tone': 'warn' }, reason.risky)] : []),
          ]),
          h('div', { key: 'd', className: 'lt-tool-desc' }, desc),
          entry.tools.length > 0
            ? h('div', { key: 'ch', className: 'lt-chips' },
                entry.tools.map((name) => h('span', { key: name, className: 'lt-chip' }, name)))
            : null,
        ]),
      ])
    }

    /** One headline figure: the label above, the number, an optional note. */
    function Metric({ label, value, sub }) {
      return h('div', { className: 'lt-stat' }, [
        h('span', { key: 'l', className: 'lt-stat-label' }, label),
        h('span', { key: 'v', className: 'lt-stat-value' }, value),
        sub ? h('span', { key: 's', className: 'lt-stat-sub' }, sub) : null,
      ])
    }

    /** The per-tool table: calls, wall time, average, worst, failures, share. */
    function ToolTable({ tools, t }) {
      if (!Array.isArray(tools) || tools.length === 0) {
        return h('div', { className: 'lt-empty' }, t('page.statNoTools'))
      }
      return h('table', { className: 'lt-table' }, [
        h('thead', { key: 'h' }, h('tr', {}, [
          h('th', { key: 'n' }, t('page.statToolName')),
          h('th', { key: 'c', className: 'lt-num' }, t('page.statCalls')),
          h('th', { key: 't', className: 'lt-num' }, t('page.statTotal')),
          h('th', { key: 'a', className: 'lt-num' }, t('page.statAvg')),
          h('th', { key: 'm', className: 'lt-num' }, t('page.statMax')),
          h('th', { key: 'e', className: 'lt-num' }, t('page.statErrors')),
          h('th', { key: 's' }, t('page.statShare')),
        ])),
        h('tbody', { key: 'b' }, tools.map((tool) => h('tr', { key: tool.name }, [
          h('td', { key: 'n' }, h('span', { className: 'lt-mono' }, tool.name)),
          h('td', { key: 'c', className: 'lt-num' }, String(tool.calls)),
          h('td', { key: 't', className: 'lt-num' }, fmtMs(tool.ms)),
          h('td', { key: 'a', className: 'lt-num' }, fmtMs(tool.avgMs)),
          h('td', { key: 'm', className: 'lt-num' }, fmtMs(tool.maxMs)),
          h('td', { key: 'e', className: 'lt-num' }, tool.errors > 0 ? String(tool.errors) : '—'),
          h('td', { key: 's' }, h('div', { className: 'lt-split' }, [
            h('div', { key: 'b', className: 'lt-bar' },
              h('i', { style: { width: `${Math.max(2, Math.round(tool.share * 100))}%` } })),
            h('span', { key: 'p', className: 'lt-stat-sub' }, fmtPct(tool.share)),
          ])),
        ]))),
      ])
    }

    /** One session's detail: the counts, the token split, and its tool table. */
    function SessionDetail({ session, t }) {
      const tokens = session.tokens ?? {}
      const kv = (label, value) => h('div', { key: label, className: 'lt-kv-item' }, [
        h('span', { key: 'k', className: 'lt-kv-k' }, label),
        h('span', { key: 'v', className: 'lt-kv-v' }, value),
      ])
      return h('div', { className: 'lt-card' }, [
        h('div', { key: 'h', className: 'lt-card-head' }, [
          h('h2', { key: 't', className: 'lt-card-title' }, t('page.statDetail')),
          h('span', { key: 'i', className: 'lt-mono' }, session.id),
        ]),
        h('div', { key: 'kv', className: 'lt-kv' }, [
          kv(t('page.statTurns'), String(session.turns)),
          kv(t('page.statSteps'), String(session.steps)),
          kv(t('page.statDuration'), fmtMs(session.durationMs)),
          kv(t('page.statLlm'), fmtMs(session.llmMs)),
          kv(t('page.statTool'), fmtMs(session.toolMs)),
          kv(t('page.statContext'), fmtNum(session.contextTokens)),
          kv(t('page.statCache'), fmtPct(session.cacheHitRate)),
          kv(t('page.statModel'), session.model || '—'),
        ]),
        h('div', { key: 'tokens', className: 'lt-kv' }, [
          kv(t('page.statInput'), fmtNum(tokens.input)),
          kv(t('page.statOutput'), fmtNum(tokens.output)),
          kv(t('page.statCacheRead'), fmtNum(tokens.cacheRead)),
          kv(t('page.statCacheWrite'), fmtNum(tokens.cacheWrite)),
          kv(t('page.statTokens'), fmtNum(tokens.total)),
          kv(t('page.statErrors'), String(session.errors)),
        ]),
        h('div', { key: 'tools' }, ToolTable({ tools: session.tools, t })),
      ])
    }

    /** The statistics half of the page: the mode's sessions, newest first. */
    function StatsView({ t, mode, stats, error, loading, selected, onSelect, onRefresh }) {
      const totals = stats?.totals ?? null
      const sessions = Array.isArray(stats?.sessions) ? stats.sessions : []
      const picked = sessions.find((session) => session.id === selected) ?? null

      const summary = totals === null ? null : h('div', { className: 'lt-statgrid' }, [
        h(Metric, {
          key: 's', label: t('page.statSessions'), value: String(totals.sessions),
          sub: `${totals.turns} ${t('page.statTurns')} · ${totals.steps} ${t('page.statSteps')}`,
        }),
        h(Metric, {
          key: 'd', label: t('page.statDuration'), value: fmtMs(totals.durationMs),
          sub: t('page.statLlm') + ' ' + fmtMs(totals.llmMs),
        }),
        h(Metric, {
          key: 't', label: t('page.statTool'), value: fmtMs(totals.toolMs),
          sub: `${totals.calls} ${t('page.statCalls')}`,
        }),
        h(Metric, {
          key: 'k', label: t('page.statTokens'), value: fmtNum(totals.tokens.total),
          sub: t('page.statCache') + ' ' + fmtPct(totals.cacheHitRate),
        }),
      ])

      return h('div', { className: 'lt-page' }, [
        h('div', { key: 'top', className: 'lt-topbar' }, [
          h('h1', { key: 'h', className: 'lt-h1' }, mode.name || mode.id),
          h('span', { key: 'id', className: 'lt-mono' }, `${mode.id} · ${t('page.viewStats')}`),
          h('span', { key: 'sp', className: 'lt-spacer' }),
          h('button', {
            key: 'r', type: 'button', className: 'lt-btn', onClick: onRefresh,
            disabled: loading === true,
          }, t('page.statsRefresh')),
        ]),
        h('p', { key: 'hint', className: 'lt-lead' }, t('page.statsHint')),

        loading === true && totals === null
          ? h('div', { key: 'loading', className: 'lt-empty' }, t('page.statsLoading'))
          : null,
        error !== ''
          ? h('p', { key: 'err', className: 'lt-status', 'data-kind': 'error' }, `${t('page.statsFailed')}: ${error}`)
          : null,
        error === '' && loading === false && totals !== null && sessions.length === 0
          ? h('div', { key: 'empty', className: 'lt-empty' }, t('page.statsEmpty'))
          : null,

        summary,

        totals !== null && totals.tools.length > 0
          ? h('div', { key: 'rank', className: 'lt-card' }, [
              h('div', { key: 'h', className: 'lt-card-head' }, [
                h('h2', { key: 't', className: 'lt-card-title' }, t('page.statToolRank')),
                h('span', { key: 'c', className: 'lt-count' }, String(totals.tools.length)),
              ]),
              ToolTable({ key: 'table', tools: totals.tools, t }),
            ])
          : null,

        sessions.length > 0
          ? h('div', { key: 'list', className: 'lt-card' }, [
              h('div', { key: 'h', className: 'lt-card-head' }, [
                h('h2', { key: 't', className: 'lt-card-title' }, t('page.statSessionsTitle')),
                h('span', { key: 'c', className: 'lt-count' }, String(sessions.length)),
              ]),
              h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.statSessionsHint')),
              h('div', { key: 'rows', className: 'lt-sessions' }, sessions.map((session) => {
                const title = session.title !== '' ? session.title : session.id
                return h('button', {
                  key: session.id, type: 'button', className: 'lt-session',
                  'data-session': session.id,
                  'data-active': session.id === selected ? 'true' : 'false',
                  onClick: () => onSelect(session.id),
                }, [
                  h('span', { key: 'm', className: 'lt-session-main' }, [
                    h('span', { key: 't', className: 'lt-session-title' }, title),
                    h('span', { key: 'x', className: 'lt-session-meta' }, [
                      h('span', { key: 'time' }, fmtTime(session.createdAt)),
                      baseName(session.cwd) === ''
                        ? null
                        : h('span', { key: 'cwd' }, baseName(session.cwd)),
                      h('span', { key: 'turn' }, `${session.turns} ${t('page.statTurns')}`),
                      h('span', { key: 'step' }, `${session.steps} ${t('page.statSteps')}`),
                      h('span', { key: 'dur' }, fmtMs(session.durationMs)),
                      h('span', { key: 'tok' }, `${fmtNum(session.tokens?.total)} ${t('page.statTokens')}`),
                      h('span', { key: 'tool' }, `${t('page.statTool')} ${fmtMs(session.toolMs)}`),
                      session.live === true
                        ? h('span', { key: 'live', className: 'lt-badge', 'data-tone': 'on' }, t('page.statLive'))
                        : null,
                    ]),
                  ]),
                ])
              })),
            ])
          : null,

        picked !== null
          ? SessionDetail({ key: 'detail', session: picked, t })
          : (sessions.length > 0
              ? h('p', { key: 'pick', className: 'lt-lead' }, t('page.statPick'))
              : null),

        stats?.scanned === undefined
          ? null
          : h('p', { key: 'scope', className: 'lt-stat-sub' },
              t('page.statsScope').replace('{n}', String(stats.scanned))),
      ])
    }

    /** The full panel page. */
    function ModesPage({ t, backToConversation }) {
      // The slot re-renders the bound translator on a language switch, so the
      // catalog's own zh/en copy follows by asking the dictionary itself.
      const lang = t('page.pure') === DICT_ZH['page.pure'] ? 'zh' : 'en'
      const [draft, setDraft] = useState(null)
      const [live, setLive] = useState([])
      const [catalog, setCatalog] = useState([])
      const [categories, setCategories] = useState([])
      const [plugins, setPlugins] = useState([])
      const [defaults, setDefaults] = useState([])
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const [stale, setStale] = useState(false)
      const [selected, setSelected] = useState(0)
      const [openCats, setOpenCats] = useState({})
      const [pluginDraft, setPluginDraft] = useState('')
      const [tab, setTab] = useState('basics')
      const [liveOpen, setLiveOpen] = useState(false)
      const [hot, setHot] = useState([])
      const [view, setView] = useState('models')
      const [stats, setStats] = useState(null)
      const [statsError, setStatsError] = useState('')
      const [statsLoading, setStatsLoading] = useState(false)
      const [statsTick, setStatsTick] = useState(0)
      const [pickedSession, setPickedSession] = useState('')

      const load = useCallback(() => {
        post('/api/agent-modes/roster', {})
          .then((b) => {
            if (!b?.ok) {
              setStatus((prev) => (prev === 'saved' ? prev : 'failed'))
              return
            }
            setDraft(b.value.configured ?? [])
            setLive(b.value.live ?? [])
            setCatalog(b.value.catalog ?? [])
            setCategories(b.value.categories ?? [])
            setPlugins(b.value.plugins ?? [])
            setDefaults(b.value.defaults ?? [])
            // A host that predates this page answers without a catalog. Say so
            // instead of rendering an empty tool list as if nothing were checked.
            setStale(b.value.catalog === undefined)
            // A reload after a successful save keeps the confirmation visible.
            setStatus((prev) => (prev === 'saved' ? prev : null))
          })
          .catch(() => setStatus((prev) => (prev === 'saved' ? prev : 'failed')))
      }, [])

      useEffect(() => { load() }, [load])

      const mode = draft !== null && draft.length > 0
        ? draft[Math.min(selected, draft.length - 1)]
        : null

      // Statistics are read on demand: the tab asks the host to fold the mode's
      // session logs, which is the expensive half, so nothing happens while the
      // operator stays on the model editor.
      const modeId = typeof mode?.id === 'string' ? mode.id : ''
      useEffect(() => {
        if (view !== 'stats' || modeId === '') return undefined
        let cancelled = false
        setStatsLoading(true)
        setStatsError('')
        post('/api/agent-modes/stats', { mode: modeId })
          .then((b) => {
            if (cancelled) return
            if (!b?.ok) {
              setStats(null)
              setStatsError(b?.error === 'this host exposes no session history service'
                ? t('page.statsNoService')
                : (b?.error || t('page.statsFailed')))
              return
            }
            setStats(b.value ?? null)
            setStatsError('')
          })
          .catch((e) => {
            if (cancelled) return
            setStats(null)
            setStatsError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => {
            if (!cancelled) setStatsLoading(false)
          })
        return () => { cancelled = true }
      }, [view, modeId, statsTick, t])

      const byId = useMemo(
        () => Object.fromEntries(catalog.map((entry) => [entry.id, entry])),
        [catalog],
      )

      /** Rows that stay mounted regardless of what the operator picks. */
      const lockedIds = useMemo(
        () => catalog.filter((entry) => entry.locked === true).map((entry) => entry.id),
        [catalog],
      )

      const update = useCallback((patch) => {
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          return prev.map((m, k) => (k === index ? { ...m, ...patch } : m))
        })
      }, [selected])

      const toggleTool = useCallback((id) => {
        const entry = byId[id]
        if (entry === undefined) return
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          return prev.map((m, k) => {
            if (k !== index) return m
            const current = Array.isArray(m.tools) ? m.tools : []
            let next = toggleIn(current, id)
            // A row that registers the same tool name cannot coexist with its twin.
            if (next.includes(id)) {
              for (const rival of entry.exclusiveWith ?? []) {
                next = next.filter((x) => x !== rival)
              }
            }
            return { ...m, tools: next }
          })
        })
      }, [byId, selected])

      const save = async () => {
        if (draft === null) return
        setStatus('saving')
        setError('')
        try {
          const b = await post('/api/agent-modes/save', { modes: draft })
          if (!b?.ok) throw new Error(b?.error || 'rejected')
          setHot(Array.isArray(b.value?.hot) ? b.value.hot : [])
          setStatus('saved')
          load()
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setStatus('failed')
        }
      }

      const addMode = () => {
        setDraft((prev) => {
          const list = prev ?? []
          setSelected(list.length)
          return [...list, blankMode(list.length, defaults, lockedIds, false)]
        })
      }

      const removeMode = () => {
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          const next = prev.filter((_, k) => k !== index)
          setSelected(Math.max(0, index - 1))
          return next
        })
      }

      const duplicateMode = () => {
        if (mode === null) return
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          const copy = {
            ...structuredClone(mode),
            id: `${mode.id}-copy`,
            name: `${mode.name ?? mode.id} copy`,
          }
          const next = [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)]
          setSelected(index + 1)
          return next
        })
      }

      const tools = Array.isArray(mode?.tools) ? mode.tools : []

      // Categories start expanded; the map only records the ones the operator closed.
      const toggleCat = (id) =>
        setOpenCats((prev) => ({ ...prev, [id]: prev[id] === false }))

      const isCatOpen = (id) => openCats[id] !== false

      const grouped = useMemo(() => {
        const map = new Map()
        for (const category of categories) map.set(category.id, [])
        for (const entry of catalog) {
          if (!map.has(entry.category)) map.set(entry.category, [])
          map.get(entry.category).push(entry)
        }
        return map
      }, [catalog, categories])

      const rail = h('div', { className: 'lt-rail' }, [
        h('div', { key: 'hd', className: 'lt-rail-head' }, [
          h('span', { key: 't', className: 'lt-rail-title' }, t('page.modeList')),
          h('button', {
            key: 'a', type: 'button', className: 'lt-btn lt-btn-icon',
            title: t('page.addMode'), onClick: addMode,
          }, '+'),
        ]),
        draft === null || draft.length === 0
          ? h('p', { key: 'e', className: 'lt-lead' },
              status === 'failed' ? t('page.loadFailed') : draft === null ? '…' : t('page.empty'))
          : draft.map((m, i) => {
              const count = Array.isArray(m.tools) ? m.tools.length : 0
              const liveRow = live.find((row) => row.id === m.id)
              return h('button', {
                key: `${m.id}-${i}`, type: 'button', className: 'lt-mode-item',
                'data-active': i === Math.min(selected, draft.length - 1) ? 'true' : 'false',
                onClick: () => setSelected(i),
              }, [
                h('span', { key: 'n', className: 'lt-mode-name' }, [
                  h('span', { key: 'l' }, m.name || m.id),
                  m.pure === true ? h('span', { key: 'p', className: 'lt-badge' }, 'pure') : null,
                  brokenReason(liveRow) !== null
                    ? h('span', { key: 'b', className: 'lt-badge', 'data-tone': 'err' }, t('page.broken'))
                    : null,
                ]),
                h('span', { key: 's', className: 'lt-mode-sub' },
                  m.pure === true && count === 0
                    ? 'pure · 0'
                    : `${count} ${t('page.toolCount')}`),
              ])
            }),
      ])

      // ── tab panes ───────────────────────────────────────────────────────
      // One pane per concern, so the page stops being a nine-screen scroll.
      // Every pane reads `mode`, which is null while the roster loads or after a
      // failed read, so the whole block is built only for a real mode.
      const panes = mode === null ? null : {
        basics: h('div', { key: 'basics', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'base', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' },
            h('h2', { className: 'lt-card-title' }, t('page.basics'))),
          h('div', { key: 'g', className: 'lt-grid2' }, [
            h('label', { key: 'n', className: 'lt-field' }, [
              h('span', { key: 'l', className: 'lt-label' }, t('page.fieldName')),
              h('input', {
                key: 'i', className: 'lt-input', value: mode.name ?? '',
                onChange: (e) => update({ name: e.target.value }),
              }),
            ]),
            h('label', { key: 'id', className: 'lt-field' }, [
              h('span', { key: 'l', className: 'lt-label' }, t('page.fieldId')),
              h('input', {
                key: 'i', className: 'lt-input', value: mode.id ?? '',
                onChange: (e) => update({ id: e.target.value }),
              }),
              h('span', { key: 'h', className: 'lt-label' }, t('page.unknownId')),
            ]),
          ]),
          h('label', { key: 'd', className: 'lt-field' }, [
            h('span', { key: 'l', className: 'lt-label' }, t('page.fieldDescription')),
            h('input', {
              key: 'i', className: 'lt-input', value: mode.description ?? '',
              onChange: (e) => update({ description: e.target.value }),
            }),
          ]),
          h('label', { key: 'p', className: 'lt-field' }, [
            h('span', { key: 'l', className: 'lt-label' }, t('page.fieldPersona')),
            h('textarea', {
              key: 'i', className: 'lt-textarea', value: mode.persona ?? '',
              onChange: (e) => update({ persona: e.target.value }),
            }),
            h('span', { key: 'h', className: 'lt-label' }, t('page.personaHint')),
          ]),
          h('div', { key: 'pure', className: 'lt-toggle' }, [
            h(Toggle, {
              key: 'c', checked: mode.pure === true,
              onChange: (on) => {
                // Entering pure mode drops the inherited tool set except the
                // locked rows and unmounts every plugin; leaving it restores
                // the defaults when the operator selected nothing.
                update(on
                  ? { pure: true, tools: [...lockedIds], plugins: [] }
                  : { pure: false, tools: tools.length > 0 ? tools : [...defaults] })
              },
            }),
            h('div', { key: 'x', className: 'lt-toggle-text' }, [
              h('span', { key: 'l', className: 'lt-card-title' }, t('page.pure')),
              h('span', { key: 'h', className: 'lt-card-hint' }, t('page.pureHint')),
            ]),
          ]),
        ]),
      ]),

        priority: h('div', { key: 'pri', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'card', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' }, [
            h('h2', { key: 't', className: 'lt-card-title' }, t('page.priority')),
            h('span', { key: 'c', className: 'lt-count' }, String(tools.length)),
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.priorityHint')),
          tools.length === 0
            ? h('div', { key: 'e', className: 'lt-empty' }, t('page.priorityEmpty'))
            : h('div', { key: 'l', className: 'lt-order' },
                tools.map((id, i) => {
                  const entry = byId[id]
                  const label = entry === undefined
                    ? id
                    : (lang === 'zh' ? entry.zh : entry.en)
                  const desc = entry === undefined
                    ? null
                    : (lang === 'zh' ? entry.descZh : entry.descEn)
                  return h('div', { key: id, className: 'lt-order-row' }, [
                    h('span', { key: 'r', className: 'lt-rank' }, String(i + 1)),
                    h('div', { key: 'n', className: 'lt-order-main' }, [
                      h('div', { key: 't', className: 'lt-order-name' }, [
                        h('span', { key: 'l' }, label),
                        entry === undefined
                          ? h('span', {
                              key: 'raw', className: 'lt-badge', 'data-tone': 'warn',
                            }, t('page.unknownTool'))
                          : (entry.tools ?? []).length > 0
                            ? h('span', { key: 'c', className: 'lt-mono' }, entry.tools.join(' · '))
                            : null,
                      ]),
                      desc === null
                        ? null
                        : h('div', { key: 'd', className: 'lt-order-desc' }, desc),
                    ]),
                    h('button', {
                      key: 'u', type: 'button', className: 'lt-btn lt-btn-icon',
                      title: t('page.moveUp'), disabled: i === 0,
                      onClick: () => update({ tools: move(tools, i, -1) }),
                    }, '↑'),
                    h('button', {
                      key: 'd', type: 'button', className: 'lt-btn lt-btn-icon',
                      title: t('page.moveDown'), disabled: i === tools.length - 1,
                      onClick: () => update({ tools: move(tools, i, 1) }),
                    }, '↓'),
                    h('button', {
                      key: 'x', type: 'button', className: 'lt-btn lt-btn-icon',
                      title: t('page.remove'),
                      onClick: () => update({ tools: tools.filter((x) => x !== id) }),
                    }, '✕'),
                  ])
                })),
        ]),
      ]),

        tools: h('div', { key: 'tools', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'card', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' }, [
            h('h2', { key: 't', className: 'lt-card-title' }, t('page.tools')),
            // With no catalog the right-hand number is unknowable; showing
            // "10 / 0" claims a total that contradicts the checked count.
            h('span', { key: 'c', className: 'lt-count' },
              catalog.length === 0
                ? String(tools.length)
                : `${tools.length} / ${catalog.length}`),
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.toolsHint')),
          catalog.length === 0
            ? h('div', { key: 'nocat', className: 'lt-empty' }, t('page.noCatalog'))
            : null,
          ...[...grouped.entries()].map(([catId, entries]) => {
            const category = categories.find((c) => c.id === catId)
            if (category === undefined || entries.length === 0) return null
            const chosen = entries.filter((e) => tools.includes(e.id)).length
            return h(ToolCategory, {
              key: catId,
              title: lang === 'zh' ? category.zh : category.en,
              hint: lang === 'zh' ? category.hintZh ?? '' : '',
              count: chosen,
              open: isCatOpen(catId),
              onToggleOpen: () => toggleCat(catId),
            }, entries.map((entry) => h(ToolRow, {
              key: entry.id,
              entry,
              lang,
              checked: tools.includes(entry.id) || entry.locked === true,
              // A locked row is re-added by the host, so offering the box
              // would be a lie; a host-plane row cannot mount inside a preset.
              disabled: entry.hostOnly === true || entry.locked === true,
              reason: {
                locked: t('page.locked'),
                hostOnly: t('page.hostOnly'),
                risky: t('page.risky'),
              },
              onToggle: () => toggleTool(entry.id),
            })))
          }).filter(Boolean),
        ]),
      ]),

        plugins: h('div', { key: 'plugins', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'card', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' }, [
            h('h2', { key: 't', className: 'lt-card-title' }, t('page.plugins')),
            h('span', { key: 'c', className: 'lt-count' },
              plugins.length === 0
                ? String((mode.plugins ?? []).length)
                : `${(mode.plugins ?? []).length} / ${plugins.length}`),
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.pluginsHint')),
          h('p', { key: 'thint', className: 'lt-card-hint' }, t('page.pluginToolsHint')),
          plugins.length === 0
            ? h('div', { key: 'e', className: 'lt-empty' }, t('page.noPlugins'))
            : plugins.map((plugin) => {
                const mounted = (mode.plugins ?? []).includes(plugin.name)
                const declared = Array.isArray(plugin.tools) ? plugin.tools : []
                return h('div', {
                  key: plugin.name, className: 'lt-plugin', 'data-on': mounted ? 'true' : 'false',
                }, [
                  h(Toggle, {
                    key: 'c', checked: mounted,
                    onChange: () => update({
                      plugins: toggleIn(mode.plugins ?? [], plugin.name),
                    }),
                  }),
                  h('div', { key: 'm', className: 'lt-tool-main' }, [
                    h('div', { key: 't', className: 'lt-tool-title' }, [
                      h('span', { key: 'l' }, plugin.title || plugin.name),
                      h('span', {
                        key: 'e', className: 'lt-badge',
                        'data-tone': plugin.enabled ? 'on' : undefined,
                      }, plugin.enabled ? t('page.enabled') : t('page.disabled')),
                      plugin.hasClient
                        ? h('span', { key: 'u', className: 'lt-badge' }, t('page.client'))
                        : null,
                      declared.length > 0
                        ? h('span', { key: 'tc', className: 'lt-badge' },
                            `${declared.length} ${t('page.pluginTools')}`)
                        : null,
                    ]),
                    h('div', { key: 'n', className: 'lt-mono' },
                      `${plugin.name}${plugin.version ? `@${plugin.version}` : ''}`),
                    plugin.description
                      ? h('div', { key: 'd', className: 'lt-tool-desc' }, plugin.description)
                      : null,
                    // A row that is checked mounts the whole package, so a tool
                    // chip toggles the package rather than a per-tool switch the
                    // preset has no way to express.
                    declared.length > 0
                      ? h('div', { key: 'tools', className: 'lt-chips' },
                          declared.map((tool) => h('button', {
                            key: tool,
                            type: 'button',
                            className: 'lt-chip lt-chip-btn',
                            'data-tool': tool,
                            'data-on': mounted ? 'true' : 'false',
                            title: t('page.pluginToolsHint'),
                            onClick: () => update({
                              plugins: toggleIn(mode.plugins ?? [], plugin.name),
                            }),
                          }, tool)))
                      : h('div', { key: 'notools', className: 'lt-stat-sub' }, t('page.pluginNoTools')),
                  ]),
                ])
              }),
          h('div', { key: 'add', className: 'lt-addrow' }, [
            h('input', {
              key: 'i', className: 'lt-input', value: pluginDraft,
              placeholder: t('page.addPluginPlaceholder'),
              onChange: (e) => setPluginDraft(e.target.value),
            }),
            h('button', {
              key: 'b', type: 'button', className: 'lt-btn',
              disabled: pluginDraft.trim() === '',
              onClick: () => {
                const name = pluginDraft.trim()
                if (name === '') return
                update({ plugins: toggleIn(mode.plugins ?? [], name) })
                setPluginDraft('')
              },
            }, t('page.add')),
          ]),
        ]),
      ]),
      }

      const TABS = panes === null ? [] : [
        { id: 'basics', label: t('page.tabBasics'), hint: t('page.tabBasicsHint'), pane: panes.basics },
        {
          id: 'priority', label: t('page.tabPriority'), hint: t('page.tabPriorityHint'),
          count: tools.length, pane: panes.priority,
        },
        {
          id: 'tools', label: t('page.tabTools'), hint: t('page.tabToolsHint'),
          count: catalog.length === 0 ? undefined : catalog.length, pane: panes.tools,
        },
        {
          id: 'plugins', label: t('page.tabPlugins'), hint: t('page.tabPluginsHint'),
          count: (mode?.plugins ?? []).length, pane: panes.plugins,
        },
      ]
      const active = TABS.find((x) => x.id === tab) ?? TABS[0] ?? null

      const tabStrip = active === null ? null : h('div', {
        key: 'tabs', className: 'lt-tabs', role: 'tablist',
        'aria-label': t('page.detail'),
      }, TABS.map((item) => h('button', {
        key: item.id,
        type: 'button',
        role: 'tab',
        className: 'lt-tab',
        'data-tab': item.id,
        'data-active': item.id === active.id ? 'true' : 'false',
        'aria-selected': item.id === active.id ? 'true' : 'false',
        onClick: () => setTab(item.id),
      }, [
        h('span', { key: 'l' }, item.label),
        typeof item.count === 'number'
          ? h('span', { key: 'c', className: 'lt-tab-count' }, String(item.count))
          : null,
      ])))

      // A failed load and an empty roster both leave `draft` null; only the
      // status tells them apart, so the page must not claim "no modes yet".
      const viewTabs = h('div', {
        key: 'views', className: 'lt-viewtabs', role: 'tablist', 'aria-label': t('page.detail'),
      }, [
        h('button', {
          key: 'models', type: 'button', className: 'lt-viewtab', 'data-view': 'models',
          'data-active': view === 'models' ? 'true' : 'false',
          'aria-selected': view === 'models' ? 'true' : 'false',
          onClick: () => setView('models'),
        }, t('page.viewModels')),
        h('button', {
          key: 'stats', type: 'button', className: 'lt-viewtab', 'data-view': 'stats',
          'data-active': view === 'stats' ? 'true' : 'false',
          'aria-selected': view === 'stats' ? 'true' : 'false',
          onClick: () => setView('stats'),
        }, t('page.viewStats')),
      ])

      const detail = mode === null
        ? h('div', { className: 'lt-page' }, [
            h('p', {
              key: 'e', className: 'lt-lead',
              'data-kind': status === 'failed' ? 'error' : undefined,
            }, status === 'failed' ? t('page.loadFailed') : draft === null ? '…' : t('page.empty')),
          ])
        : view === 'stats'
          ? StatsView({
              t,
              mode,
              stats,
              error: statsError,
              loading: statsLoading,
              selected: pickedSession,
              onSelect: setPickedSession,
              onRefresh: () => setStatsTick((n) => n + 1),
            })
          : h('div', { className: 'lt-page' }, [
            h('div', { key: 'top', className: 'lt-topbar' }, [
              h('h1', { key: 'h', className: 'lt-h1' }, mode.name || mode.id),
              h('span', { key: 'id', className: 'lt-mono' }, `${mode.id} · ${mode.pure === true ? 'pure' : 'standard'}`),
              h('span', { key: 'sp', className: 'lt-spacer' }),
              h('button', {
                key: 'dup', type: 'button', className: 'lt-btn', onClick: duplicateMode,
              }, t('page.duplicate')),
              h('button', {
                key: 'del', type: 'button', className: 'lt-btn', onClick: removeMode,
              }, t('page.delete')),
              h('button', {
                key: 'save', type: 'button', className: 'lt-btn lt-btn-primary',
                onClick: save, disabled: status === 'saving',
              }, status === 'saving' ? t('page.saving') : t('page.save')),
            ]),

            status === 'saved' ? h('p', { key: 'ok', className: 'lt-status', 'data-kind': 'ok' }, t('page.saved')) : null,
            status === 'failed'
              ? h('p', { key: 'bad', className: 'lt-status', 'data-kind': 'error' },
                  error === '' ? t('page.saveFailed') : `${t('page.saveFailed')}: ${error}`)
              : null,
            // What the save actually reached: the live sessions of this mode
            // gained or lost tool rows, or nothing was running to update.
            ...(status === 'saved' ? hot.map((report) => {
              const changed = Array.isArray(report?.added) ? report.added.length : 0
              const dropped = Array.isArray(report?.removed) ? report.removed.length : 0
              if (changed === 0 && dropped === 0) return null
              const names = [...(report.added ?? []), ...(report.removed ?? []).map((id) => `-${id}`)]
              const announced = Array.isArray(report?.announced) ? report.announced.length : 0
              // A mounted row is not the same as a tool the model believes in:
              // a conversation that already answered "I cannot" keeps answering
              // that until the change is written into its log. Say which happened.
              const tail = report.sessions > 0
                ? (announced > 0 ? t('page.hotNotified') : t('page.hotSilent'))
                : ''
              return h('p', {
                key: `hot-${report.presetId}`, className: 'lt-status',
                'data-kind': report.sessions > 0 ? 'ok' : undefined,
              }, report.sessions > 0
                ? t('page.hotApplied')
                    .replace('{n}', String(report.sessions))
                    .replace('{tools}', names.join(', ')) + tail
                : t('page.hotNone'))
            }).filter(Boolean) : []),
            // The browser bundle reloads on refresh but the host half only on a
            // restart, so a stale host answers without a catalog. Without this
            // notice the page silently shows "0 tools" and raw ids.
            stale
              ? h('div', { key: 'stale', className: 'lt-stale' }, [
                  h('strong', { key: 'h' }, t('page.staleTitle')),
                  h('span', { key: 'b' }, t('page.staleBody')),
                ])
              : null,

            tabStrip,
            h('p', { key: 'panehint', className: 'lt-lead' }, active.hint),
            active.pane,

            // ── live roster, collapsed out of the way ───────────────────────
            h('div', { key: 'live', className: 'lt-card' }, [
              h('div', {
                key: 'h', className: 'lt-card-head',
                style: { cursor: 'pointer', userSelect: 'none' },
                onClick: () => setLiveOpen((v) => !v),
              }, [
                h('span', { key: 'c', className: 'lt-caret' }, liveOpen ? '▼' : '▶'),
                h('span', { key: 't', className: 'lt-card-title' },
                  liveOpen ? t('page.liveHide') : t('page.liveShow')),
                h('span', { key: 'k', className: 'lt-count' }, String(live.length)),
              ]),
              liveOpen
                ? h('div', { key: 'b', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
                    h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.liveHint')),
                    live.length === 0
                      ? h('div', { key: 'e', className: 'lt-empty' }, t('page.liveEmpty'))
                      : h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                          live.map((row) => {
                            const reason = brokenReason(row)
                            return h('div', {
                              key: row.id, className: 'lt-live',
                              'data-broken': reason === null ? 'false' : 'true',
                            }, [
                              h('div', { key: 'h', className: 'lt-live-head' }, [
                                h('span', { key: 'n' }, row.name || row.id),
                                h('span', { key: 'i', className: 'lt-mono' }, row.id),
                                reason === null
                                  ? h('span', { key: 's', className: 'lt-badge', 'data-tone': 'on' }, 'ok')
                                  : h('span', { key: 's', className: 'lt-badge', 'data-tone': 'err' }, t('page.broken')),
                              ]),
                              reason === null
                                ? null
                                : h('div', { key: 'e', className: 'lt-err' }, reason),
                            ])
                          })),
                  ])
                : null,
            ]),
          ])

      return h('div', { className: 'lt-root' }, [
        rail,
        h('div', { key: 'main', className: 'lt-main' }, [
          typeof backToConversation === 'function'
            ? h('div', { key: 'back', style: { padding: '14px 26px 0' } },
                h('button', {
                  type: 'button', className: 'lt-btn', onClick: backToConversation,
                }, `← ${t('page.back')}`))
            : null,
          h('div', { key: 'views', style: { padding: '14px 26px 0' } }, viewTabs),
          detail,
        ]),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ensureStyles()
        if (typeof ctx.locale?.register === 'function') {
          ctx.effect(
            () => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }),
            'agent-modes: dictionaries',
          )
        }
        const t = ctx.locale?.bind?.(NS) ?? ((k) => k)

        let backToConversation = null
        try {
          const layout = ctx.get?.('layout')
          if (layout && typeof layout.selectPanel === 'function') {
            backToConversation = () => layout.selectPanel(null)
          }
        } catch { /* a host without a layout service simply has no back button */ }

        // Sidebar row: a glyph that opens the keyed main page.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 6,
            label: () => t('sidebar.title'),
            locale: NS,
          }, PanelIcon),
        )

        // The page the row opens; `key` must equal the row id.
        ctx.slots.inject('main', () =>
          ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ t, backToConversation }),
          }, ModesPage),
        )
      },
    }
  },
})
