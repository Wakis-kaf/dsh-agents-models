/**
 * Agent Modes — browser half.
 *
 * Registers a sidebar panel row plus the keyed `main` page it opens, mirroring
 * how the host's own Plugins row and WorkBuddy's panel work. The page edits the
 * mode list; every mode becomes a real agent preset.
 *
 * Layout: a top-level module tab bar. The entire mode rail and detail layout
 * belongs to the Mode management panel; Tool management is a separate panel.
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
.lt-params { display: flex; flex-direction: column; }
.lt-param {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 14px;
  align-items: center; padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l3);
}
.lt-params > .lt-param:first-child { border-top: none; padding-top: 2px; }
.lt-param-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.lt-param-name { font-size: 12.5px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.lt-param-ctl { display: flex; align-items: center; gap: 6px; }
.lt-param-ctl > .lt-input { width: 96px; text-align: right; }
.lt-param-unit {
  font-size: 11px; color: var(--dsw-alias-label-tertiary);
  min-width: 20px; font-variant-numeric: tabular-nums;
}
.lt-param-reset {
  border: none; background: none; padding: 2px 4px; cursor: pointer;
  font: inherit; font-size: 11px; color: var(--dsw-alias-label-tertiary);
  border-radius: var(--dsw-radius-sm, 6px);
}
.lt-param-reset:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.lt-param-group + .lt-param-group { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l3)); }
.lt-param-group-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 2px; }
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
/* The persona box holds a system prompt, so it gets room to read a paragraph
   instead of one and a half lines; expanding is for editing, collapsed is for
   scanning. */
.lt-persona-box { min-height: 96px; }
.lt-persona-box[data-expanded="true"] { min-height: 420px; }
.lt-persona-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lt-persona-count { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.lt-persona-count[data-kind="heavy"] { color: var(--dsw-alias-state-warn-label, #d9a441); }
.lt-btn-quiet { padding: 3px 9px; font-size: 11.5px; }
.lt-snippets { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.lt-snippets-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lt-snippets-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lt-snippets-note { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.lt-snippet-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lt-snippet-list { display: flex; flex-direction: column; gap: 10px; }
.lt-snippet-item {
  display: flex; flex-direction: column; gap: 5px; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2);
}
.lt-snippet-item-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lt-snippet-item-title { font-size: 12.5px; font-weight: 600; }
.lt-snippet-text { min-height: 64px; font-size: 12px; }
/* Own class: .lt-chip is the plugin pane's small monospace tag, and reusing
   it here made the snippet buttons collapse into empty pills. */
.lt-snippet-btn {
  padding: 3px 10px; font-size: 11.5px; font-family: inherit; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l3); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.lt-snippet-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.lt-snippet-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5); outline-offset: 1px; }
/* Skill cards: the header is the disclosure, the body is the whole SKILL.md. */
.lt-skill-list { display: flex; flex-direction: column; gap: 8px; }
.lt-skillbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lt-btn[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  border-color: var(--dsw-alias-border-l3);
}
/* The import button is a label wrapping a hidden file input: a real <button>
   cannot open a file dialog, and a bare input renders as an ugly native chip. */
.lt-skill-file { position: relative; overflow: hidden; }
.lt-skill-file-input {
  position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%;
}
.lt-skill-toggle { margin-top: -6px; }
.lt-skill-group { display: flex; flex-direction: column; gap: 6px; }
.lt-skill-group-head { display: flex; align-items: center; gap: 8px; }
.lt-skill-group-btn {
  display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;
  padding: 7px 10px; font-family: inherit; cursor: pointer; text-align: left;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
}
.lt-skill-group-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-skill-group-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5); outline-offset: -2px; }
.lt-skill-group-body { display: flex; flex-direction: column; gap: 8px; padding-left: 12px; }
.lt-skill-flat { display: flex; flex-direction: column; gap: 8px; }
.lt-skill-row { display: flex; align-items: center; gap: 6px; }
.lt-skill-pick { margin: 0 0 0 10px; }
.lt-skill-foot { display: flex; align-items: center; gap: 8px; padding: 0 12px 10px; }
.lt-skill-cat { width: auto; min-width: 132px; padding: 3px 8px; font-size: 11.5px; }
/* The on/off switch reads as a state, not an action: a pill that changes colour
   plus the word, so a glance answers "is the model seeing this" without a click. */
.lt-skill-switch {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 2px 9px 2px 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-tertiary);
}
.lt-skill-switch[data-on="true"] {
  border-color: var(--dsw-alias-state-success-primary, #2f9e44);
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}
.lt-skill-switch-input { width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: currentColor; }
.lt-skill-switch-input:disabled { opacity: .5; cursor: default; }
.lt-skill-locked { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
/* A switched-off card is dimmed, so a page of mostly-off rows reads at a glance. */
.lt-skill-card[data-enabled="false"] > .lt-skill-desc,
.lt-skill-card[data-enabled="false"] > .lt-skill-when { opacity: .55; }
.lt-skill-card {
  border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.lt-skill-head {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 10px 12px; font-family: inherit; cursor: pointer;
  border: 0; background: transparent; color: var(--dsw-alias-label-primary);
}
.lt-skill-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-skill-head:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4c8bf5); outline-offset: -2px; }
.lt-skill-card > .lt-skill-desc,
.lt-skill-card > .lt-skill-when { padding: 0 12px; }
.lt-skill-card > .lt-skill-when { padding-bottom: 10px; }
.lt-skill-name { font-size: 12.5px; font-weight: 600; font-family: ui-monospace, Consolas, monospace; }
.lt-skill-desc { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.lt-skill-when { font-size: 11px; color: var(--dsw-alias-label-tertiary); line-height: 1.55; }
.lt-skill-body { border-top: 1px solid var(--dsw-alias-border-l3); padding: 10px 12px; }
.lt-skill-body-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.lt-skill-chars { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
/* The full text, scrollable: skills can run to hundreds of lines. */
.lt-skill-pre {
  margin: 0; max-height: 420px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, Consolas, monospace);
  font-size: 11.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-markdown-code-block); border-radius: 6px; padding: 10px 12px;
}
.lt-tag {
  font-size: 10.5px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-tertiary);
}
.lt-tag[data-tone="warn"] { border-color: var(--dsw-alias-state-warn-label, #d9a441); color: var(--dsw-alias-state-warn-label, #d9a441); }
.lt-pkg-tag { margin-left: 6px; opacity: .8; }
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
.lt-status[data-kind="error"], .lt-status[data-kind="err"] { color: var(--dsw-alias-state-error-primary, #d64545); }
.lt-status[data-kind="ok"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
.lt-status[data-kind="warn"] { color: var(--dsw-alias-state-warn-label, #d9a441); }
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

const MODULE_CSS = `

.lt-control-center { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; color:var(--dsw-alias-label-primary); font-family:var(--dsw-font-family,inherit); }
.lt-control-header { display:flex; align-items:center; gap:24px; flex-shrink:0; padding:0 22px; border-bottom:1px solid var(--dsw-alias-border-l2); }
.lt-control-brand { font-size:10px; font-weight:600; letter-spacing:1.8px; color:var(--dsw-alias-label-tertiary); }
.lt-module-tabs { display:flex; align-items:stretch; gap:24px; }
.lt-module-tab { position:relative; padding:18px 2px 16px; border:0; border-bottom:2px solid transparent; background:none; color:var(--dsw-alias-label-secondary); font:inherit; font-size:14px; white-space:nowrap; cursor:pointer; }
.lt-module-tab[aria-selected="true"] { border-bottom-color:var(--dsw-alias-label-primary); color:var(--dsw-alias-label-primary); font-weight:600; }
.lt-module-tab:hover { color:var(--dsw-alias-label-primary); }
.lt-module-tab:focus-visible { outline:2px solid var(--dsw-focus-ring-color,#4c8bf5); outline-offset:-4px; border-radius:4px; }
.lt-module-panel { display:flex; flex:1 1 auto; min-height:0; min-width:0; }
.lt-module-panel[hidden] { display:none; }
.lt-module-panel > .lt-root { flex:1 1 auto; width:100%; min-width:0; }
.lt-mode-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 26px 0; margin-bottom:16px; }
.lt-tools-placeholder { box-sizing:border-box; width:min(100%,680px); margin:54px auto; padding:28px; align-self:flex-start; }
.lt-tools-placeholder h1 { margin:14px 0 10px; font-size:24px; letter-spacing:-.5px; }
.lt-tools-placeholder p { max-width:480px; margin:0; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:1.8; }
@media (max-width:720px) { .lt-control-header { padding:0 14px; gap:16px; flex-wrap:wrap; } .lt-control-brand { display:none; } .lt-module-tabs { gap:22px; } .lt-module-tab { padding:15px 0 13px; } .lt-mode-toolbar { padding:14px 18px 0; flex-wrap:wrap; } .lt-tools-placeholder { margin:28px auto; padding:22px; } }
.lt-mode-lock { display:contents; }
.lt-eyebrow { font-size:10px; letter-spacing:1.8px; color:var(--dsw-alias-label-tertiary); }
.lt-share-wrap { padding:0 26px; }
.lt-share { padding:22px; margin:0 0 22px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1)); animation:lt-enter .2s ease-out; }
.lt-share-grid { display:grid; grid-template-columns:minmax(200px,.8fr) minmax(260px,1.2fr); gap:24px; }
.lt-share-side { min-width:0; }
.lt-share > .lt-card-head { justify-content:space-between; }
.lt-share h3 { font-size:13px; margin:14px 0; }
.lt-share label { display:block; font-size:12px; line-height:1.6; }
.lt-share select { margin-top:8px; width:100%; }
.lt-dropzone { position:relative; cursor:pointer; padding:22px; border:1px dashed var(--dsw-alias-border-l3); border-radius:10px; background:var(--dsw-alias-bg-base); }
.lt-share-file { position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; }
.lt-dropzone:focus-within { outline:2px solid var(--dsw-focus-ring-color,#4c8bf5); outline-offset:3px; }
.lt-dropzone strong,.lt-dropzone span { display:block; }
.lt-dropzone span { color:var(--dsw-alias-label-tertiary); font-size:11px; margin-top:6px; }
.lt-import-plan { margin-top:16px; max-height:480px; overflow:auto; overflow-wrap:anywhere; }
.lt-dependency { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.lt-consent { padding:14px 0; }
.lt-consent input { margin-right:8px; }
.lt-cap-summary { display:flex; align-items:center; gap:18px; padding:18px 20px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:linear-gradient(120deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1)); }
.lt-cap-summary p { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.7; margin:6px 0 0; }
.lt-cap-list { max-height:460px; overflow:auto; }
.lt-cap-list .lt-mono,.lt-dependency .lt-mono { font-size:12px; }
.lt-cap-list .lt-tool-main { min-width:0; overflow-wrap:anywhere; }
.lt-share details,.lt-pane details { font-size:12px; line-height:1.7; }
@keyframes lt-enter { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
@media (max-width:760px) { .lt-topbar { flex-wrap:wrap; } .lt-topbar > .lt-spacer { flex-basis:100%; height:0; } .lt-share-grid { grid-template-columns:1fr; gap:10px; } .lt-share-wrap { padding:0 14px; } .lt-cap-summary { flex-direction:column; align-items:flex-start; } .lt-card-head { flex-wrap:wrap; } }
@media (prefers-reduced-motion:reduce) { .lt-share { animation:none; } }
.lt-tools-module { padding:0; }
/* The panel stretches .lt-root, not every child: this module needs its own rule
   or the card column collapses to its content width (measured: 697px in a 1180px
   page). NO backticks in here — this block lives inside a template literal, and
   a backtick would terminate the whole stylesheet string. */
.lt-module-panel > .lt-tools-module { flex:1 1 auto; width:100%; min-width:0; }
.lt-tools-body { padding:22px 26px 30px; display:flex; flex-direction:column; gap:10px; max-width:980px; }
.lt-viewtabs-wrap { display:inline-flex; }
.lt-ext-list { display:flex; flex-direction:column; gap:14px; margin-top:6px; align-items:stretch; }
.lt-ext-card { padding:18px 20px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1)); display:flex; flex-direction:column; gap:10px; }
.lt-ext-card[data-enabled="false"] { opacity:.72; }
.lt-ext-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.lt-ext-name { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); }
.lt-ext-ver { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.lt-ext-desc { margin:0; font-size:12.5px; line-height:1.75; color:var(--dsw-alias-label-secondary); }
.lt-ext-features { margin:0; padding-left:18px; font-size:12px; line-height:1.8; color:var(--dsw-alias-label-secondary); }
.lt-ext-facts { display:flex; flex-direction:column; gap:4px; padding-top:10px; border-top:1px solid var(--dsw-alias-border-l1); }
.lt-ext-path { overflow-wrap:anywhere; font-size:11.5px; }
.lt-ext-facts .lt-kv-v[data-tone="off"] { color:var(--dsw-alias-label-tertiary); }
.lt-spend { display:inline-flex; align-items:center; padding:2px 6px; border:0; border-radius:6px; background:none; font:inherit; font-size:12px; color:var(--dsw-alias-label-secondary); cursor:pointer; white-space:nowrap; }
.lt-spend:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.lt-spend[data-empty="true"] { color:var(--dsw-alias-label-tertiary); }
/* The label and the number are separate runs so only the number is emphasized;
   without their own spacing they butt together (measured 4.6px, which read as
   one word on screen). */
.lt-spend-label { margin-right:5px; }
.lt-spend-value { font-weight:600; color:#d97757; font-variant-numeric:tabular-nums; margin:0 2px; }
.lt-spend-unit { color:var(--dsw-alias-label-tertiary); }
`

const STYLE_ID = 'agent-modes/pages.css'

/** Install the page stylesheet once; a hot reload reuses the same element. */
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'agent-modes'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CSS + MODULE_CSS
  document.head.append(style)
}

window.__ModuleLoader__.load({
  id: 'dsh-agents-modes',
  factory(require) {
    const DICT_EN = {
      "page.managementModules": "Management modules",
      "page.moduleModes": "Mode management",
      "page.moduleTools": "Tool management",
      "page.moduleComingSoon": "Coming soon",
      "page.toolsModulePlaceholder": "Tool management will be implemented here as a separate module. The mode list, configuration, statistics and sharing remain in Mode management.",
      'page.extTab': 'Extensions',
      'page.extTabHint': 'Switches for features built into this plugin. A change lands on the next reading; no host restart.',
      'page.extTitle': 'Extensions',
      'page.extEmpty': 'This build ships no extensions yet.',
      'page.extOn': 'On',
      'page.extOff': 'Off',
      'page.extEnable': 'Turn on',
      'page.extDisable': 'Turn off',
      'page.extSaving': 'Switching…',
      'page.extBroken': 'The extension state file could not be parsed; showing the shipped default. Toggling anything rewrites it.',
      'page.extFailed': 'Could not switch',
      'page.extNoHost': 'This host exposes no extension route. Restart DeepSeek Harness.',
      'page.extLedger': 'Credit ledger',
      'page.extLedgerPath': 'File',
      'page.extLedgerSessions': '{n} session(s) recorded',
      'page.extLedgerMissing': 'No ledger file yet — it is created the first time a credit charge is read.',
      'page.extPrice': 'Price table',
      'page.extConnector': 'WorkBuddy connector',
      'page.extConnectorOn': 'Ready: {base}',
      'page.extConnectorOff': 'Not detected (credits unavailable; yuan still shown)',
      'page.spendTitle': 'This conversation',
      'page.spendCredit': 'credits',
      'page.spendCny': 'CNY',
      'page.spendApprox': 'at the published rate',
      'page.spendNone': 'Nothing measurable in this conversation yet.',
      'page.spendRequests': '{n} model call(s)',
      'page.spendCreditBilled': 'WorkBuddy bills in credits; not converted to money',
      'page.spendModel': 'Model',
      'page.spendMiss': 'Uncached input',
      'page.spendHit': 'Cache hit',
      'page.spendOut': 'Output',
      'page.spendAssumed': 'priced as Flash',
      'page.spendRestarted': 'The ledger is on disk, so it survives a restart',
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
      'page.params': 'Parameters',
      'page.paramsHint': 'Only rows that expose a schema are listed, and only the values you change are stored — everything else follows the shipped default.',
      'page.paramsEmpty': 'No mounted row exposes a tunable parameter.',
      'page.paramGroupHint': 'Only the fields you changed are written to this mode.',
      'page.paramReset': 'Reset',
      'page.paramOverridden': 'changed',
      'page.paramUnlimited': 'unlimited',
      'page.paramRestart': 'Parameters are read when a preset is built, so they apply to the next task, not to a session already running.',
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
      'page.templateLegacyTitle': 'Built-in modes are frozen in this profile.',
      'page.templateLegacyBody': 'This profile stores a full copy of the mode list from install time, and a profile copy replaces the package defaults — so a plugin update cannot reach these modes. Convert it to "template + my changes": untouched fields then follow releases, your edits stay, and a field both sides changed is reported instead of overwritten.',
      'page.templateEnable': 'Convert and keep my changes',
      'page.templateEnabling': 'Converting…',
      'page.templateReset': 'Take shipped version',
      'page.templateConflictTitle': 'Upstream changed these fields too.',
      'page.templateConflictBody': 'You overrode {fields}. Your version is being used; "Take shipped version" switches to the upstream text.',
      'page.templateFailed': 'Template action failed',
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
      'page.tabParams': 'Parameters',
      'page.tabParamsHint': 'Thresholds inside the rows this mode mounts.',
      'page.liveInTab': 'Live activation state of the registered presets.',
      'page.liveShow': 'Show registered presets',
      'page.liveHide': 'Hide registered presets',
      'page.hotApplied': 'Applied to {n} running session(s): {tools} will be available from the next turn.',
      'page.hotNotified': ' The session log now records the change, so the model no longer trusts its earlier answer.',
      'page.hotSilent': ' The change is mounted but could not be written into the session log; ask again in a new task if the model still says it cannot.',
      'page.hotNone': 'No running session is on this mode, so only new tasks pick this up.',
      'page.hotSkipped': 'Some sessions rejected the change',
      'page.viewModels': 'Configuration',
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
      'page.pluginToolsHint': 'A package mounts through its own row. Each tool name is a switch: click it to deny just that tool.',
      'page.pluginNoTools': 'no declared tools',
      'page.pluginTools': 'tools',
      'page.setDefault': 'Set as new-task default',
      'page.defaultSaving': 'Setting…',
      'page.defaultCurrent': 'New-task default',
      'page.defaultSaved': 'New tasks now start on {name}.',
      'page.defaultFailed': 'Could not set the default',
      'page.personaChars': '{n} chars',
      'page.personaExpand': 'Expand',
      'page.personaCollapse': 'Collapse',
      'page.personaTemplates': 'Insert a sentence',
      'page.personaTemplatesHint': 'A persona line, not a skill - editable, saved in this browser',
      'page.templateScope': 'Scope discipline',
      'page.templateEvidence': 'Evidence discipline',
      'page.templateStop': 'When to stop and ask',
      'page.snippetInsert': 'Insert',
      'page.snippetReset': 'Reset',
      'page.snippetSeed': 'seed',
      'page.snippetEdited': 'edited',
      'page.snippetDelete': 'Delete',
      'page.snippetAdd': 'Add',
      'page.snippetAddPlaceholder': 'Write your own sentence, then add',
      'page.skillNew': 'New skill',
      'page.skillCancel': 'Cancel',
      'page.skillSave': 'Write SKILL.md',
      'page.skillSaving': 'Writing…',
      'page.skillSaveFailed': 'Write failed',
      'page.skillNewHint': 'Writes ~/.dsh/skills/<name>/SKILL.md; the host generates the frontmatter',
      'page.skillName': 'Skill name (kebab-case)',
      'page.skillBody': 'Body (Markdown)',
      'page.skillBodyPlaceholder': '# Skill title - state the trigger and the steps',
      'page.tabSkills': 'Skills',
      'page.tabSkillsHint': 'Skills the host discovered for this workspace. Open one to read its full SKILL.md.',
      'page.skillsHint': 'The workspace shares this skill library; these switches control global visibility. Configure per-mode call access in Capabilities.',
      'page.skillsEmpty': 'No skills found. Create ~/.dsh/skills/<name>/SKILL.md to add one.',
      'page.skillsError': 'Could not read the skill registry',
      'page.skillsFilter': 'Filter by name',
      'page.skillsUserOnly': 'user-only',
      'page.skillsSource': 'source',
      'page.skillsWhen': 'When:',
      'page.skillChars': '{n} chars',
      'page.skillLoadFailed': 'Could not load this skill',
      'page.skillsGrouped': 'By category',
      'page.skillsFlat': 'One list',
      'page.skillsCategory': 'Category',
      'page.skillsCategoryAuto': '{name} (auto)',
      'page.skillsAutoPick': 'Pick automatically',
      'page.skillsAutoOnSave': 'Let the name decide',
      'page.skillsPickAll': 'All',
      'page.skillsPickCancel': 'Cancel',
      'page.skillsSwitch': 'Enabled',
      'page.skillsSwitchOn': 'On',
      'page.skillsSwitchOff': 'Off',
      'page.skillsSwitchOnHint': 'Turn on: the model sees this skill again from the next turn.',
      'page.skillsSwitchOffHint': 'Turn off: the model stops seeing this skill; you can still load it by hand.',
      'page.skillsSwitchFailed': 'Could not switch this skill',
      'page.skillsSwitchReadOnly': 'read-only',
      'page.skillsOn': 'on',
      'page.skillsOff': 'off',
      'page.skillsOffTag': 'off',
      'page.skillsNewCategory': 'New category',
      'page.skillsCategoryId': 'Category id (kebab-case)',
      'page.skillsCategoryIdHint': 'Lowercase letters, digits and hyphens. Used in the skill pack.',
      'page.skillsCategoryLabel': 'Display name',
      'page.skillsCategoryAdd': 'Add category',
      'page.skillsCategoryDelete': 'Delete',
      'page.skillsCategoryDeleteHint': 'Skills filed here fall back to Uncategorised; the skills themselves are untouched.',
      'page.skillsCategoryFailed': 'Could not save the category',
      'page.skillsOriginUser': 'yours',
      'page.skillsOriginProject': 'project',
      'page.skillsOriginBundled': 'bundled',
      'page.skillsOriginOther': 'other',
      'page.skillsOriginCopy': 'copied',
      'page.skillsPick': 'Select for export',
      'page.skillsPicked': '{n} selected',
      'page.skillsExport': 'Export pack',
      'page.skillsExportNone': 'Tick at least one skill first',
      'page.skillsExportDone': 'Exported {n} skill(s) to a pack file.',
      'page.skillsExportFailed': 'Could not build the pack',
      'page.skillsImport': 'Import pack',
      'page.skillsImportHint': 'A pack is one .json file. Import writes each skill into ~/.dsh/skills/<name>/SKILL.md.',
      'page.skillsImportOverwrite': 'Overwrite skills that already exist',
      'page.skillsImportDone': 'Imported: {n} written, {s} skipped, {f} failed.',
      'page.skillsImportFailed': 'Nothing could be imported',
      'page.skillsImportBadJson': 'That file is not JSON',
      'page.skillsStoreBroken': 'The category file could not be parsed; showing the shipped categories. Saving a category will rewrite it.',
      'page.skillsExpandAll': 'Expand all',
      'page.skillsCollapseAll': 'Collapse all',
      'sidebar.title': 'Leiting',
    }
    const DICT_ZH = {
      "page.managementModules": "管理模块",
      "page.moduleModes": "模式管理",
      "page.moduleTools": "工具管理",
      "page.moduleComingSoon": "待建设",
      "page.toolsModulePlaceholder": "工具管理将在这里独立提供，具体功能待后续接入。现有模式列表、配置、统计和导入导出均位于“模式管理”中。",
      'page.extTab': '扩展管理',
      'page.extTabHint': '这个插件自带的功能开关。改完下一次读数就生效，不用重启宿主。',
      'page.extTitle': '扩展',
      'page.extEmpty': '这个版本还没有内置扩展。',
      'page.extOn': '已开启',
      'page.extOff': '已关闭',
      'page.extEnable': '开启',
      'page.extDisable': '关闭',
      'page.extSaving': '切换中…',
      'page.extBroken': '扩展状态文件解析失败，现在按出厂默认显示。点任意开关会重写它。',
      'page.extFailed': '切换失败',
      'page.extNoHost': '这个宿主没有提供扩展路由，请重启 DeepSeek Harness。',
      'page.extLedger': '积分台账',
      'page.extLedgerPath': '文件',
      'page.extLedgerSessions': '已记录 {n} 个会话',
      'page.extLedgerMissing': '还没有台账文件 —— 第一次读到积分时会自动创建。',
      'page.extPrice': '单价表版本',
      'page.extConnector': 'WorkBuddy 连接器',
      'page.extConnectorOn': '已就绪：{base}',
      'page.extConnectorOff': '未检测到（积分读不出来，元照常显示）',
      'page.spendTitle': '本会话消耗',
      'page.spendCredit': '积分',
      'page.spendCny': '元',
      'page.spendApprox': '按公开单价折算',
      'page.spendNone': '这个会话还没有可计量的消耗。',
      'page.spendRequests': '{n} 次模型调用',
      'page.spendCreditBilled': 'WorkBuddy 按积分计费，不折算成元',
      'page.spendModel': '模型',
      'page.spendMiss': '未命中输入',
      'page.spendHit': '缓存命中',
      'page.spendOut': '输出',
      'page.spendAssumed': '按 Flash 价估算',
      'page.spendRestarted': '台账已落盘，重启后仍在',
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
      'page.params': '参数',
      'page.paramsHint': '只有带参数定义的行会出现在这里。只存你改过的值——其余一律跟着出厂默认走。',
      'page.paramsEmpty': '已挂载的行都没有可调参数。',
      'page.paramGroupHint': '只把改过的字段写进这个模式。',
      'page.paramReset': '恢复默认',
      'page.paramOverridden': '已改动',
      'page.paramUnlimited': '不限制',
      'page.paramRestart': '参数在构建预设时读取，所以只对下一个新任务生效，正在跑的会话不会变。',
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
      'page.templateLegacyTitle': '内置模式还停在这台机器上的旧快照里。',
      'page.templateLegacyBody': '这个 profile 存的是安装时复制进来的整份模式列表，而 profile 的配置会整段替换包内默认值——插件升级改不到这些模式。转成「内置模板 + 我的改动」后，没改过的字段会跟着版本走，改过的字段保留；如果上游也改到同一个字段，会提示冲突而不是直接覆盖。',
      'page.templateEnable': '转换并保留我的改动',
      'page.templateEnabling': '转换中…',
      'page.templateReset': '恢复内置版本',
      'page.templateConflictTitle': '上游也改了这些字段。',
      'page.templateConflictBody': '你覆盖了 {fields}，当前用的是你的版本；点「恢复内置版本」改用上游文本。',
      'page.templateFailed': '模板操作失败',
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
      'page.tabParams': '参数',
      'page.tabParamsHint': '这个模式挂载的行内部可调的阈值。',
      'page.liveInTab': '已注册预设的实时激活状态。',
      'page.liveShow': '查看已注册的预设',
      'page.liveHide': '收起已注册的预设',
      'page.hotApplied': '已对 {n} 个正在运行的会话生效：{tools} 从下一轮开始可用。',
      'page.hotNotified': '变更已写入会话记录，模型不会再沿用之前「用不了」的结论。',
      'page.hotSilent': '工具已挂载，但没能写进会话记录；如果模型仍说用不了，请开新任务再问。',
      'page.hotNone': '当前没有会话在用这个模式，只有新任务会应用。',
      'page.hotSkipped': '有会话拒绝了这次变更',
      'page.viewModels': '配置',
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
      'page.pluginToolsHint': '插件包用它自己那一行的复选框挂载。工具名是独立开关：点一下只禁用这个工具。',
      'page.pluginNoTools': '没有发现声明的工具',
      'page.pluginTools': '件工具',
      'page.setDefault': '设为默认模式',
      'page.defaultSaving': '设置中…',
      'page.defaultCurrent': '新任务默认',
      'page.defaultSaved': '已设为新任务的默认模式：{name}。开新任务时会用它。',
      'page.defaultFailed': '设为默认失败',
      'page.personaChars': '{n} 字符',
      'page.personaExpand': '展开',
      'page.personaCollapse': '收起',
      'page.personaTemplates': '插入一句话',
      'page.personaTemplatesHint': '这是人设的一句话，不是技能——可编辑，存在本机浏览器',
      'page.templateScope': '收敛边界',
      'page.templateEvidence': '证据纪律',
      'page.templateStop': '何时停下发问',
      'page.snippetInsert': '插入',
      'page.snippetReset': '还原',
      'page.snippetSeed': '预设',
      'page.snippetEdited': '已改',
      'page.snippetDelete': '删除',
      'page.snippetAdd': '添加',
      'page.snippetAddPlaceholder': '自己写一句，回车添加',
      'page.skillNew': '新建技能',
      'page.skillCancel': '取消',
      'page.skillSave': '写入 SKILL.md',
      'page.skillSaving': '写入中…',
      'page.skillSaveFailed': '写入失败',
      'page.skillNewHint': '会写到 ~/.dsh/skills/<名称>/SKILL.md，frontmatter 由宿主生成',
      'page.skillName': '技能名（kebab-case）',
      'page.skillBody': '正文（Markdown）',
      'page.skillBodyPlaceholder': '# 技能标题 · 写清触发条件和步骤',
      'page.tabSkills': '技能',
      'page.tabSkillsHint': '宿主为这个工作区发现的技能。点开一个可读它的完整 SKILL.md。',
      'page.skillsHint': '技能库由工作区共享；这里的开关影响全局可见性。模式内的调用范围请到“能力与审计”配置。',
      'page.skillsEmpty': '没有发现技能。新建 ~/.dsh/skills/<名称>/SKILL.md 即可添加。',
      'page.skillsError': '读取技能注册表失败',
      'page.skillsFilter': '按名称筛选',
      'page.skillsUserOnly': '仅用户',
      'page.skillsSource': '来源',
      'page.skillsWhen': '何时用：',
      'page.skillChars': '{n} 字符',
      'page.skillLoadFailed': '这个技能加载失败',
      'page.skillsGrouped': '按分类',
      'page.skillsFlat': '一个列表',
      'page.skillsCategory': '分类',
      'page.skillsCategoryAuto': '{name}（自动）',
      'page.skillsAutoPick': '自动归入',
      'page.skillsAutoOnSave': '按名称自动判断',
      'page.skillsPickAll': '全选',
      'page.skillsPickCancel': '取消',
      'page.skillsSwitch': '启用',
      'page.skillsSwitchOn': '开',
      'page.skillsSwitchOff': '关',
      'page.skillsSwitchOnHint': '开启：模型从下一轮开始重新看见这个技能。',
      'page.skillsSwitchOffHint': '关闭：模型不再看见它，你仍可以手动加载。',
      'page.skillsSwitchFailed': '切换失败',
      'page.skillsSwitchReadOnly': '只读',
      'page.skillsOn': '已启用',
      'page.skillsOff': '已关闭',
      'page.skillsOffTag': '已关闭',
      'page.skillsNewCategory': '新建分类',
      'page.skillsCategoryId': '分类标识（kebab-case）',
      'page.skillsCategoryIdHint': '小写字母、数字和短横线。技能包里用它。',
      'page.skillsCategoryLabel': '显示名称',
      'page.skillsCategoryAdd': '添加分类',
      'page.skillsCategoryDelete': '删除',
      'page.skillsCategoryDeleteHint': '这一类的技能会退回「未分类」，技能本身不受影响。',
      'page.skillsCategoryFailed': '分类保存失败',
      'page.skillsOriginUser': '自己的',
      'page.skillsOriginProject': '项目内',
      'page.skillsOriginBundled': '内置',
      'page.skillsOriginOther': '其他',
      'page.skillsOriginCopy': '已接手副本',
      'page.skillsPick': '勾选用于导出',
      'page.skillsPicked': '已选 {n} 个',
      'page.skillsExport': '导出技能包',
      'page.skillsExportNone': '先勾选至少一个技能',
      'page.skillsExportDone': '已导出 {n} 个技能到一个技能包文件。',
      'page.skillsExportFailed': '生成技能包失败',
      'page.skillsImport': '导入技能包',
      'page.skillsImportHint': '技能包是一个 .json 文件。导入会把每个技能写进 ~/.dsh/skills/<名称>/SKILL.md。',
      'page.skillsImportOverwrite': '覆盖已存在的同名技能',
      'page.skillsImportDone': '导入完成：写入 {n} 个，跳过 {s} 个，失败 {f} 个。',
      'page.skillsImportFailed': '没有导入任何技能',
      'page.skillsImportBadJson': '这个文件不是 JSON',
      'page.skillsStoreBroken': '分类文件解析失败，现在显示的是出厂分类。保存任意分类会重写它。',
      'page.skillsExpandAll': '全部展开',
      'page.skillsCollapseAll': '全部收起',
      'sidebar.title': '雷霆',
    }
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const PANEL_ID = 'agent-modes'

    /**
     * Short persona templates — a single sentence each, not skills.
     *
     * These exist only because an operator retypes the same one-line rule.
     * Skills are a different thing entirely: a SKILL.md is a full instruction
     * set that can run to hundreds of lines and is loaded on demand, so it is
     * never summarised into a chip here.
     */
    const PERSONA_TEMPLATES = [
      {
        id: 'scope',
        labelKey: 'page.templateScope',
        text: '最小改动：只碰完成这件事必须碰的行。不顺手重构，不补没要求的注释和测试。',
      },
      {
        id: 'evidence',
        labelKey: 'page.templateEvidence',
        text: '只写工具返回里看得到的。没测过写「未验证」，禁止「应该 / 通常 / 一般来说 / 可能是」。',
      },
      {
        id: 'stop',
        labelKey: 'page.templateStop',
        text: '必须停下来问的三种情况：会覆盖已有文件且没读过它 / 需要花钱或联网的不可逆操作 / 需求里两条约束直接冲突。',
      },
    ]

    /** localStorage key holding operator edits to the persona templates. */
    const TEMPLATE_STORE = 'dsh-agents-modes/persona-templates'

    /** localStorage key holding sentences the operator added themselves. */
    const CUSTOM_TEMPLATE_STORE = 'dsh-agents-modes/persona-templates-custom'

    /**
     * Read the operator's saved template text.
     *
     * localStorage is absent in the test sandbox and can throw when disabled,
     * so a failed read degrades to the seed text instead of breaking the pane.
     */
    function readTemplateStore() {
      try {
        const raw = globalThis.localStorage?.getItem(TEMPLATE_STORE)
        if (typeof raw !== 'string' || raw === '') return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /** Persist one template's text; a storage failure is not worth a dialog. */
    function writeTemplateStore(next) {
      try {
        globalThis.localStorage?.setItem(TEMPLATE_STORE, JSON.stringify(next))
      } catch {
        /* private mode or a full quota: the edit still applies this session */
      }
    }

    /** Persist the operator's own added sentences. */
    function writeCustomTemplates(next) {
      try {
        globalThis.localStorage?.setItem(CUSTOM_TEMPLATE_STORE, JSON.stringify(next))
      } catch {
        /* private mode or a full quota: the edit still applies this session */
      }
    }

    /** Read the operator's own added sentences. */
    function readCustomTemplates() {
      try {
        const raw = globalThis.localStorage?.getItem(CUSTOM_TEMPLATE_STORE)
        if (typeof raw !== 'string' || raw === '') return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((x) => x !== null && typeof x === 'object'
          && typeof x.id === 'string' && typeof x.text === 'string')
      } catch {
        return []
      }
    }

    /**
     * Hand one text file to the browser as a download.
     *
     * A skill pack has to leave this machine to be useful, and the file system
     * access API is not available on every host, so an anchor download is the
     * only route that works everywhere. The object URL is revoked on the next
     * tick: leaving it alive pins the whole pack in memory for the session.
     *
     * @param filename suggested name, already sanitized by the host.
     * @param text the file content.
     */
    function saveTextFile(filename, text) {
      try {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.rel = 'noopener'
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      } catch {
        /* a browser that blocks downloads gets the note but no file */
      }
    }
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

    const post = async (path, body) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let payload
      try { payload = await response.json() }
      catch { throw new Error(`${path}: HTTP ${response.status ?? '?'} - invalid JSON response`) }
      if (response.ok === false) {
        const detail = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
        throw new Error(`${path}: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`)
      }
      return payload
    }

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

    /**
     * The npm package a mounted row belongs to.
     *
     * A mode may mount a subpath export (`dsh-work-fish/core/persona`) so a
     * package can ship extra rows without a second package. Every question of
     * the form "is this package mounted?" has to ask about the package, not the
     * literal string, or the checkbox and the count disagree.
     */
    function packageOf(name) {
      if (typeof name !== 'string' || name === '') return ''
      return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
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
            // Who actually ships the code behind this row. The row itself is this
            // plugin's orchestration; the package is what registers the tools.
            entry.package
              ? h('span', {
                  key: 'pkg', className: 'lt-mono lt-pkg-tag',
                  title: lang === 'zh'
                    ? '这个包提供该行的工具实现；雷霆只负责把行挂进模式'
                    : 'This package ships the tools; the mode list only decides what to mount',
                }, entry.package)
              : null,
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
    function useModeManagementView({ t, isModuleActive }) {
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
      const [loadError, setLoadError] = useState('')
      const [error, setError] = useState('')
      const [stale, setStale] = useState(false)
      const [selected, setSelected] = useState(0)
      const [openCats, setOpenCats] = useState({})
      const [pluginDraft, setPluginDraft] = useState('')
      const [tab, setTab] = useState('basics')
      const [liveOpen, setLiveOpen] = useState(false)
      const [hot, setHot] = useState([])
      const [view, setView] = useState('models')
      const [capabilities, setCapabilities] = useState({})
      const [implicit, setImplicit] = useState([])
      const [capQuery, setCapQuery] = useState('')
      const [customTool, setCustomTool] = useState('')
      const [shareOpen, setShareOpen] = useState(false)
      const [shareScope, setShareScope] = useState('mode')
      const [shareItems, setShareItems] = useState(null)
      const [sharePack, setSharePack] = useState(null)
      const [sharePlan, setSharePlan] = useState(null)
      const [shareBusy, setShareBusy] = useState(false)
      const [shareAction, setShareAction] = useState('analyze')
      const [shareError, setShareError] = useState('')
      const [shareInstall, setShareInstall] = useState(false)
      const [shareConflict, setShareConflict] = useState('copy')
      const [shareDone, setShareDone] = useState(false)
      const text = (zh, en) => lang === 'zh' ? zh : en
      const [stats, setStats] = useState(null)
      const [statsError, setStatsError] = useState('')
      const [statsLoading, setStatsLoading] = useState(false)
      const [statsTick, setStatsTick] = useState(0)
      // Skills are host-wide, not per mode, so this is loaded once and never
      // part of the save payload. `null` means "not asked yet".
      const [skills, setSkills] = useState(null)
      const [skillsError, setSkillsError] = useState('')
      const [skillsQuery, setSkillsQuery] = useState('')
      // Which slice of the workspace catalog the pane shows: everything, or only
      // what this mode actually brings in (a mounted package's skills plus the
      // names its `skills` allowlist admits).
      const [skillScope, setSkillScope] = useState('all')
      // Grouping state. `grouped` is the default because 29 skills in one list is
      // the complaint this pane exists to answer; `skillsCollapsed` remembers
      // which category heads the operator folded, keyed by category id.
      const [skillCats, setSkillCats] = useState([])
      const [skillGrouped, setSkillGrouped] = useState(true)
      const [skillCollapsed, setSkillCollapsed] = useState({})
      const [skillStoreBroken, setSkillStoreBroken] = useState(false)
      // Category editor + import/export state.
      const [catDraft, setCatDraft] = useState(null)
      const [catError, setCatError] = useState('')
      const [picked, setPicked] = useState({})
      // Selection exists only while exporting: a permanently visible empty
      // checkbox on every card reads as "this skill is off", which it never was.
      const [skillPicking, setSkillPicking] = useState(false)
      // Per-skill switch: which rows are mid-write, and the last failure.
      const [toggling, setToggling] = useState({})
      const [packBusy, setPackBusy] = useState(false)
      const [packNote, setPackNote] = useState('')
      const [packError, setPackError] = useState('')
      const [importOverwrite, setImportOverwrite] = useState(false)
      // Per-skill expansion and lazily fetched SKILL.md body, keyed by name.
      const [skillOpen, setSkillOpen] = useState({})
      const [skillDetail, setSkillDetail] = useState({})
      // New-skill composer. `null` means closed; the host writes the file.
      const [skillDraft, setSkillDraft] = useState(null)
      const [skillSaving, setSkillSaving] = useState(false)
      const [skillSaveError, setSkillSaveError] = useState('')
      // Persona editing state: collapsed preview vs full editor, per mode id.
      const [personaOpen, setPersonaOpen] = useState({})
      // Prompt-template editor: operator overrides of the seed text, persisted
      // in localStorage so an edit survives a reload without touching the bundle.
      const [snippetsOpen, setSnippetsOpen] = useState(false)
      const [templateEdits, setTemplateEdits] = useState(() => readTemplateStore())
      const [customTemplates, setCustomTemplates] = useState(() => readCustomTemplates())
      const [newTemplate, setNewTemplate] = useState('')
      const [pickedSession, setPickedSession] = useState('')
      const [defaultMode, setDefaultMode] = useState('')
      const [defaultState, setDefaultState] = useState(null)
      const [defaultSavedName, setDefaultSavedName] = useState('')
      const [defaultError, setDefaultError] = useState('')
      // Which modes are package-owned templates, and which fields still carry an
      // operator override. Null means the host predates template layering, so
      // every reader below renders nothing rather than guessing.
      const [templateInfo, setTemplateInfo] = useState(null)
      const [templateBusy, setTemplateBusy] = useState(false)
      const [templateError, setTemplateError] = useState('')

      const load = useCallback(() => {
        post('/api/agent-modes/roster', {})
          .then((b) => {
            if (!b?.ok) {
              setLoadError(typeof b?.error === 'string' ? b.error : b?.error?.message || 'Invalid roster response')
              setStatus((prev) => (prev === 'saved' ? prev : 'failed'))
              return
            }
            setLoadError('')
            setDraft(b.value.configured ?? [])
            setLive(b.value.live ?? [])
            setCatalog(b.value.catalog ?? [])
            setCapabilities(b.value.capabilities ?? {})
            setImplicit(b.value.implicit ?? [])
            setCategories(b.value.categories ?? [])
            setPlugins(b.value.plugins ?? [])
            setDefaults(b.value.defaults ?? [])
            setDefaultMode(typeof b.value.defaultMode === 'string' ? b.value.defaultMode : '')
            setTemplateInfo(b.value.templates ?? null)
            // A host that predates this page answers without a catalog. Say so
            // instead of rendering an empty tool list as if nothing were checked.
            setStale(b.value.catalog === undefined)
            // A reload after a successful save keeps the confirmation visible.
            setStatus((prev) => (prev === 'saved' ? prev : null))
          })
          .catch((error) => {
            setLoadError(error instanceof Error ? error.message : String(error))
            setStatus((prev) => (prev === 'saved' ? prev : 'failed'))
          })
      }, [])

      useEffect(() => { load() }, [load])

      // The skill list is workspace-wide and only read when the pane is opened,
      // so a session with skills disabled costs nothing until someone looks.
      // It keys off the detail tab, not the models/stats view switch.
      useEffect(() => {
        if (!isModuleActive || (tab !== 'skills' && tab !== 'capabilities') || skills !== null) return undefined
        let cancelled = false
        post('/api/agent-modes/skills', {})
          .then((b) => {
            if (cancelled) return
            if (!b?.ok) {
              setSkills([])
              setSkillsError(typeof b?.error === 'string' ? b.error : '')
              return
            }
            setSkills(Array.isArray(b.value?.skills) ? b.value.skills : [])
            setSkillCats(Array.isArray(b.value?.categories) ? b.value.categories : [])
            setSkillStoreBroken(b.value?.storeBroken === true)
            setSkillsError('')
          })
          .catch((e) => {
            if (cancelled) return
            setSkills([])
            setSkillsError(e instanceof Error ? e.message : String(e))
          })
        return () => { cancelled = true }
      }, [isModuleActive, tab, skills])

      /**
       * Fetch one skill's full text.
       *
       * Cache miss only: an already-loaded body is not refetched when the row
       * is collapsed and reopened.
       */
      const loadSkill = useCallback((name) => {
        setSkillDetail((prev) => ({ ...prev, [name]: prev[name] ?? { pending: true } }))
        post('/api/agent-modes/skill', { name })
          .then((b) => {
            setSkillDetail((prev) => {
              if (prev[name] === undefined) return prev
              return {
                ...prev,
                [name]: b?.ok
                  ? { ok: true, content: String(b.value?.content ?? ''), path: b.value?.path }
                  : { ok: false, error: typeof b?.error === 'string' ? b.error : '' },
              }
            })
          })
          .catch((e) => {
            setSkillDetail((prev) => ({
              ...prev,
              [name]: { ok: false, error: e instanceof Error ? e.message : String(e) },
            }))
          })
      }, [])

      /**
       * Write a new SKILL.md through the host.
       *
       * The host owns both the path and the frontmatter, so this ships only the
       * four values an operator typed. On success the catalog is invalidated so
       * the new skill appears without a page reload.
       */
      const saveSkill = useCallback(() => {
        if (skillDraft === null) return
        setSkillSaving(true)
        setSkillSaveError('')
        post('/api/agent-modes/skill-save', {
          name: skillDraft.name.trim(),
          description: skillDraft.description.trim(),
          whenToUse: skillDraft.whenToUse.trim(),
          ...(typeof skillDraft.category === 'string' && skillDraft.category !== ''
            && skillDraft.category !== '_auto'
            ? { category: skillDraft.category }
            : {}),
          content: skillDraft.content,
        })
          .then((b) => {
            setSkillSaving(false)
            if (!b?.ok) {
              setSkillSaveError(typeof b?.error === 'string' ? b.error : t('page.skillSaveFailed'))
              return
            }
            setSkillDraft(null)
            setSkills(null)
          })
          .catch((e) => {
            setSkillSaving(false)
            setSkillSaveError(e instanceof Error ? e.message : String(e))
          })
      }, [skillDraft, t])

      /**
       * Switch one skill on or off by rewriting its frontmatter.
       *
       * The host owns the file and the field; this only says which way the
       * operator flipped it. The catalog is refetched so the row shows the state
       * the provider actually reports, not the state that was clicked — and since
       * the host watches the skills root, the change reaches the running session's
       * catalog without a restart.
       */
      const toggleSkill = useCallback((name, enabled) => {
        setToggling((prev) => ({ ...prev, [name]: true }))
        setPackError('')
        post('/api/agent-modes/skill-toggle', { name, enabled })
          .then((b) => {
            setToggling((prev) => {
              const next = { ...prev }
              delete next[name]
              return next
            })
            if (!b?.ok) {
              setPackError(typeof b?.error === 'string' ? b.error : t('page.skillsSwitchFailed'))
              return
            }
            // Drop the cached body so an open card re-reads the rewritten file.
            setSkillDetail((prev) => {
              const next = { ...prev }
              delete next[name]
              return next
            })
            setSkills(null)
          })
          .catch((e) => {
            setToggling((prev) => {
              const next = { ...prev }
              delete next[name]
              return next
            })
            setPackError(e instanceof Error ? e.message : String(e))
          })
      }, [t])

      /**
       * Write one category change and adopt the answer as the new list.
       *
       * The host answers with the whole store, so the page never has to guess
       * what a rename did to the ordering or which assignment a delete dropped.
       */
      const editCats = useCallback((payload) => {
        setCatError('')
        post('/api/agent-modes/skill-category', payload)
          .then((b) => {
            if (!b?.ok) {
              setCatError(typeof b?.error === 'string' ? b.error : t('page.skillsCategoryFailed'))
              return
            }
            setSkillCats(Array.isArray(b.value?.categories) ? b.value.categories : [])
            // Assignments changed too: refetch so every row carries its new bucket
            // instead of patching a copy the host may have repaired.
            setSkills(null)
            setCatDraft(null)
            setSkillStoreBroken(false)
          })
          .catch((e) => setCatError(e instanceof Error ? e.message : String(e)))
      }, [t])

      /** File one skill, or unfile it when the value is the empty string. */
      const fileSkill = useCallback((name, category) => {
        setCatError('')
        post('/api/agent-modes/skill-category', { name, category })
          .then((b) => {
            if (!b?.ok) {
              setCatError(typeof b?.error === 'string' ? b.error : t('page.skillsCategoryFailed'))
              return
            }
            setSkillCats(Array.isArray(b.value?.categories) ? b.value.categories : [])
            setSkills(null)
          })
          .catch((e) => setCatError(e instanceof Error ? e.message : String(e)))
      }, [t])

      /**
       * Download the picked skills as one pack file.
       *
       * The host renders the JSON; the browser only turns it into a blob. A
       * download is the one delivery the operator can actually forward, so the
       * pack is not kept anywhere on this machine — the file is the artifact.
       */
      const exportPack = useCallback(() => {
        const names = Object.keys(picked).filter((name) => picked[name] === true)
        if (names.length === 0) {
          setPackError(t('page.skillsExportNone'))
          return
        }
        setPackBusy(true)
        setPackError('')
        setPackNote('')
        post('/api/agent-modes/skill-pack-export', { names, title: 'leiting' })
          .then((b) => {
            setPackBusy(false)
            if (!b?.ok) {
              setPackError(typeof b?.error === 'string' ? b.error : t('page.skillsExportFailed'))
              return
            }
            const text = JSON.stringify(b.value.pack, null, 2)
            const file = typeof b.value.file === 'string' && b.value.file !== ''
              ? b.value.file
              : 'skills-skill-pack.json'
            saveTextFile(file, text)
            setPackNote(t('page.skillsExportDone').replace('{n}', String(names.length)))
            setPicked({})
          })
          .catch((e) => {
            setPackBusy(false)
            setPackError(e instanceof Error ? e.message : String(e))
          })
      }, [picked, t])

      /** Import one pack file the operator picked. */
      const importPack = useCallback((text) => {
        let pack
        try {
          pack = JSON.parse(text)
        } catch {
          setPackError(t('page.skillsImportBadJson'))
          return
        }
        setPackBusy(true)
        setPackError('')
        setPackNote('')
        post('/api/agent-modes/skill-pack-import', { pack, overwrite: importOverwrite })
          .then((b) => {
            setPackBusy(false)
            if (!b?.ok) {
              const detail = typeof b?.error === 'string' ? b.error : ''
              const warnings = Array.isArray(b?.value?.warnings) ? b.value.warnings.join('; ') : ''
              setPackError([detail || t('page.skillsImportFailed'), warnings].filter((x) => x !== '').join(' — '))
              return
            }
            const written = Array.isArray(b.value?.written) ? b.value.written.length : 0
            const skipped = Array.isArray(b.value?.skipped) ? b.value.skipped.length : 0
            const failed = Array.isArray(b.value?.failed) ? b.value.failed.length : 0
            setPackNote(t('page.skillsImportDone')
              .replace('{n}', String(written))
              .replace('{s}', String(skipped))
              .replace('{f}', String(failed)))
            setSkills(null)
          })
          .catch((e) => {
            setPackBusy(false)
            setPackError(e instanceof Error ? e.message : String(e))
          })
      }, [importOverwrite, t])

      const mode = draft !== null && draft.length > 0
        ? draft[Math.min(selected, draft.length - 1)]
        : null

      // Statistics are read on demand: the tab asks the host to fold the mode's
      // session logs, which is the expensive half, so nothing happens while the
      // operator stays on the model editor.
      const modeId = typeof mode?.id === 'string' ? mode.id : ''
      useEffect(() => {
        if (!isModuleActive || view !== 'stats' || modeId === '') return undefined
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
      }, [isModuleActive, view, modeId, statsTick, t])

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

      // Persona editing is keyed by mode: the collapse state must not follow
      // the rail selection onto a different mode.
      const modeKey = typeof mode?.id === 'string' && mode.id !== '' ? mode.id : `#${selected}`
      const isPersonaOpen = personaOpen[modeKey] === true
      const personaChars = typeof mode?.persona === 'string' ? mode.persona.length : 0

      /** Effective text of one persona template: the operator's edit, else seed. */
      const templateText = (tpl) => {
        if (tpl.custom === true) return tpl.text
        const edited = templateEdits[tpl.id]
        return typeof edited === 'string' ? edited : tpl.text
      }

      /** Seed sentences plus the operator's own, in insertion order. */
      const allTemplates = [...PERSONA_TEMPLATES, ...customTemplates]

      /**
       * Packages this mode mounts (through a subpath export too), by package name.
       *
       * Declared before the skill filter so "only this mode" can be answered:
       * that question means "skills shipped by a package this mode mounts".
       */
      const mountedPackages = new Set((mode?.plugins ?? []).map((name) => packageOf(name)))

      /**
       * Skill names that belong to this mode.
       *
       * Two mechanisms, both real: a skill shipped inside a mounted package, and
       * a name listed in `mode.skills` (the explicit call allowlist). Everything
       * else is workspace-visible but not this mode's own.
       */
      const modeSkillNames = new Set(Array.isArray(mode?.skills) ? mode.skills : [])
      for (const skill of Array.isArray(skills) ? skills : []) {
        if (typeof skill?.package === 'string' && mountedPackages.has(skill.package)) modeSkillNames.add(skill.name)
      }

      // Scope first, then the name filter: skill descriptions are long, and a
      // fuzzy match over them makes the obvious rows disappear.
      const filteredSkills = (() => {
        const all = Array.isArray(skills) ? skills : []
        const scoped = skillScope === 'mode' ? all.filter((skill) => modeSkillNames.has(skill.name)) : all
        const q = skillsQuery.trim().toLowerCase()
        if (q === '') return scoped
        return scoped.filter((s) => String(s.name).toLowerCase().includes(q))
      })()

      /**
       * The skills folded into category buckets, in the store's own order.
       *
       * A category with no matching skill is dropped rather than rendered empty:
       * the point of the pane is to shorten the scroll, and a run of empty heads
       * is the same scroll with extra noise. The fallback bucket is kept even
       * when empty so an operator can see where an unfiled skill would land.
       */
      const skillGroups = useMemo(() => {
        const rows = filteredSkills
        const cats = Array.isArray(skillCats) ? skillCats : []
        const groups = cats.map((category) => ({
          category,
          rows: rows.filter((s) => s.category === category.id),
        }))
        // A skill filed under an id the store no longer knows still has to appear;
        // dropping it would hide a skill because its bucket was deleted.
        const known = new Set(cats.map((c) => c.id))
        const orphans = rows.filter((s) => !known.has(s.category))
        if (orphans.length > 0) {
          groups.push({
            category: { id: '__orphan', zh: '未分类', en: 'Uncategorised' },
            rows: orphans,
          })
        }
        return groups.filter((g) => g.rows.length > 0)
      }, [filteredSkills, skillCats])

      /** Category label in the reader's language, falling back to the id. */
      const catLabel = (category) => {
        if (category === undefined) return ''
        const localized = lang === 'zh' ? category.zh : category.en
        return typeof localized === 'string' && localized !== '' ? localized : category.id
      }

      const pickedCount = Object.keys(picked).filter((name) => picked[name] === true).length

      /** Names the current filter and folded heads actually show. */
      const visibleSkillNames = () => skillGroups.flatMap((group) => {
        const folded = skillGrouped
          ? (skillCollapsed[group.category.id] === undefined
              ? group.rows.length > 2
              : skillCollapsed[group.category.id] === true)
          : false
        return folded ? [] : group.rows.map((row) => row.name)
      })

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

      /**
       * Convert this profile from a frozen mode snapshot to template layering.
       *
       * The host writes the current list as per-field diffs, so a package update
       * afterwards reaches every field that was never touched here.
       */
      const enableTemplates = async () => {
        setTemplateBusy(true)
        setTemplateError('')
        try {
          const b = await post('/api/agent-modes/template', { action: 'enable' })
          if (!b?.ok) throw new Error(b?.error || 'rejected')
          load()
        } catch (e) {
          setTemplateError(e instanceof Error ? e.message : String(e))
        } finally {
          setTemplateBusy(false)
        }
      }

      /** Drop one mode's overrides and take the shipped template as it is now. */
      const resetTemplate = async () => {
        if (mode === null) return
        setTemplateBusy(true)
        setTemplateError('')
        try {
          const b = await post('/api/agent-modes/template', { action: 'reset', mode: mode.id })
          if (!b?.ok) throw new Error(b?.error || 'rejected')
          load()
        } catch (e) {
          setTemplateError(e instanceof Error ? e.message : String(e))
        } finally {
          setTemplateBusy(false)
        }
      }

      const addMode = () => {        setDraft((prev) => {
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

      /**
       * Mounted rows that declare a parameter schema.
       *
       * A row that is unchecked keeps no tuning: the host drops it on save, and
       * hiding it here means the page never shows a knob that cannot take
       * effect. Order follows the catalog, not the priority list, so the panel
       * does not jump around when the operator reorders tools.
       */
      const tunable = catalog.filter(
        (entry) => (entry.params ?? []).length > 0 && tools.includes(entry.id),
      )

      const overrides = mode?.config !== null && typeof mode?.config === 'object'
        ? mode.config
        : {}

      /** Write one parameter, keeping the rest of the mode untouched. */
      const setParam = useCallback((toolId, key, value) => {
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          return prev.map((m, k) => {
            if (k !== index) return m
            const config = { ...(m.config ?? {}) }
            config[toolId] = { ...(config[toolId] ?? {}), [key]: value }
            return { ...m, config }
          })
        })
      }, [selected])

      /** Drop one override, falling back to whatever the catalog ships. */
      const clearParam = useCallback((toolId, key) => {
        setDraft((prev) => {
          if (prev === null) return prev
          const index = Math.min(selected, prev.length - 1)
          return prev.map((m, k) => {
            if (k !== index) return m
            const config = { ...(m.config ?? {}) }
            const values = { ...(config[toolId] ?? {}) }
            delete values[key]
            if (Object.keys(values).length === 0) delete config[toolId]
            else config[toolId] = values
            // No overrides left means the key should be absent, not empty: the
            // body stays a description of what changed.
            const next = { ...m, config }
            if (Object.keys(config).length === 0) delete next.config
            return next
          })
        })
      }, [selected])

      /** Whether this mode is already the one a new task would start on. */
      const isDefaultMode = mode !== null && defaultMode !== '' && defaultMode === mode.id

      /**
       * Make this mode the one a new task starts on.
       *
       * The default belongs to the preset registry, not to this plugin's mode
       * list, so this is a separate host write: saving a mode changes what it
       * contains, this changes which one is picked when no preset is named.
       */
      const setAsDefault = async () => {
        if (mode === null) return
        setDefaultState('saving')
        setDefaultError('')
        try {
          const b = await post('/api/agent-modes/default', { mode: mode.id })
          if (!b?.ok) throw new Error(b?.error || 'rejected')
          setDefaultMode(typeof b.value?.defaultMode === 'string' ? b.value.defaultMode : mode.id)
          // The name is captured now: promoting another mode later must not
          // rewrite the confirmation of the one that was just promoted.
          setDefaultSavedName(mode.name || mode.id)
          setDefaultState('saved')
        } catch (e) {
          setDefaultError(e instanceof Error ? e.message : String(e))
          setDefaultState('failed')
        }
      }

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
                onClick: () => {
                  setSelected(i)
                  // The default confirmation belongs to the mode it was made
                  // for, not to whichever mode the rail shows next.
                  setDefaultState(null)
                  setDefaultError('')
                },
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
      // failed read, so the whole block is built only for a real mode. The
      // skills pane is the exception: skills belong to the workspace, so it is
      // built even when no mode loaded.

      /**
       * One skill card: pick box, disclosure head, copy, and the filing select.
       *
       * The pick box sits outside the head because a checkbox inside a button is
       * invalid markup and swallows its own click. The select sits in a footer
       * rather than the head for the same reason, and because filing is a
       * deliberate act, not part of scanning a title.
       */
      const skillCard = (skill) => {
        const open = skillOpen[skill.name] === true
        const detail = skillDetail[skill.name]
        const category = skillCats.find((c) => c.id === skill.category)
        const originKey = skill.origin === 'user'
          ? 'page.skillsOriginUser'
          : skill.origin === 'project'
            ? 'page.skillsOriginProject'
            : skill.origin === 'bundled' ? 'page.skillsOriginBundled' : 'page.skillsOriginOther'
        return h('div', {
          key: skill.name, className: 'lt-skill-card', 'data-open': open ? 'true' : 'false',
          'data-enabled': skill.modelInvocable === false ? 'false' : 'true',
        }, [
          h('div', { key: 'top', className: 'lt-skill-row' }, [
            // The pick box only exists in export mode, so an unchecked box never
            // reads as "disabled" the way it did when it lived here permanently.
            skillPicking
              ? h('input', {
                  key: 'p', type: 'checkbox', className: 'lt-check lt-skill-pick',
                  'aria-label': t('page.skillsPick'),
                  checked: picked[skill.name] === true,
                  onChange: (e) => setPicked((prev) => ({ ...prev, [skill.name]: e.target.checked })),
                })
              : null,
            h('button', {
              key: 'h', type: 'button', className: 'lt-skill-head',
              'data-skill': skill.name,
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => {
                setSkillOpen((prev) => ({ ...prev, [skill.name]: !open }))
                if (detail === undefined) loadSkill(skill.name)
              },
            }, [
              h('span', { key: 'c', className: 'lt-caret' }, open ? '▼' : '▶'),
              h('span', { key: 'n', className: 'lt-skill-name' }, skill.name),
              skill.modelInvocable === false
                ? h('span', { key: 'u', className: 'lt-tag', 'data-tone': 'warn' },
                    t('page.skillsOffTag'))
                : null,
              h('span', { key: 's', className: 'lt-spacer' }),
              // Provenance, at a glance: a skill shipped inside a plugin package
              // names that package; otherwise the origin root says whose it is.
              // A package this mode mounts is called out separately, because that
              // is the one an operator means by "comes with this mode".
              mountedPackages.has(skill.package)
                ? h('span', {
                    key: 'm', className: 'lt-badge', 'data-tone': 'on',
                    title: text('这个模式挂载了这个包，它的技能随模式一起生效', 'This mode mounts that package, so its skills are part of the mode'),
                  }, text('本模式', 'in this mode'))
                : null,
              skill.shadowed === true
                ? h('span', { key: 'o', className: 'lt-tag' }, t('page.skillsOriginCopy'))
                : skill.package !== undefined
                  ? h('span', {
                      key: 'o', className: 'lt-tag',
                      'data-tone': 'warn',
                      title: text('随插件包提供；升级这个包会重写同名技能', 'Shipped inside a plugin package; updating that package rewrites it'),
                    }, skill.package)
                  : h('span', { key: 'o', className: 'lt-tag' }, t(originKey)),
            ]),
          ]),
          h('div', { key: 'd', className: 'lt-skill-desc' }, skill.description),
          skill.whenToUse
            ? h('div', { key: 'w', className: 'lt-skill-when' },
                `${t('page.skillsWhen')} ${skill.whenToUse}`)
            : null,
          h('div', { key: 'f', className: 'lt-skill-foot' }, [
            h('span', { key: 'l', className: 'lt-label' }, t('page.skillsCategory')),
            h('select', {
              key: 's', className: 'lt-select lt-skill-cat',
              'aria-label': t('page.skillsCategory'),
              value: skill.categoryExplicit === true && category !== undefined ? skill.category : '',
              onChange: (e) => fileSkill(skill.name, e.target.value),
            }, [
              // The empty value is "let the derivator decide", which is the
              // honest default: most rows are never filed by hand.
              h('option', { key: 'a', value: '' },
                t('page.skillsAutoPick')),
              ...skillCats.map((c) => h('option', { key: c.id, value: c.id }, catLabel(c))),
            ]),
            h('span', { key: 'sp', className: 'lt-spacer' }),
            skillSwitch(skill),
          ]),
          open
            ? (detail === undefined
                ? h('div', { key: 'l', className: 'lt-empty' }, '…')
                : detail.ok !== true
                  ? h('div', { key: 'e', className: 'lt-status', 'data-kind': 'err' },
                      `${t('page.skillLoadFailed')}: ${detail.error ?? ''}`)
                  : h('div', { key: 'b', className: 'lt-skill-body' }, [
                      h('div', { key: 'm', className: 'lt-skill-body-head' }, [
                        h('span', { key: 'c', className: 'lt-skill-chars' },
                          t('page.skillChars').replace('{n}', String((detail.content ?? '').length))),
                        detail.path
                          ? h('span', { key: 'p', className: 'lt-mono' }, detail.path)
                          : null,
                      ]),
                      // The whole SKILL.md, verbatim. A skill is an instruction
                      // set, not a sentence: truncating it here would defeat the
                      // point of showing it.
                      h('pre', { key: 't', className: 'lt-skill-pre' }, detail.content ?? ''),
                    ]))
            : null,
        ])
      }

      /**
       * The on/off control for one skill.
       *
       * "Off" is not a new concept this plugin invented: it writes the
       * `disable-model-invocation` frontmatter field the host's own provider
       * already reads, so the model stops seeing the skill while the operator can
       * still invoke it by hand. Only a skill under `~/.dsh/skills` can be
       * switched — a bundled or project skill lives in a package or a repository,
       * so the page says where it lives instead of offering a dead control.
       */
      const skillSwitch = (skill) => {
        if (skill.switchable !== true) {
          return h('span', { key: 'sw', className: 'lt-skill-locked' },
            t('page.skillsSwitchReadOnly'))
        }
        const on = skill.modelInvocable !== false
        const busy = toggling[skill.name] === true
        return h('label', {
          key: 'sw', className: 'lt-skill-switch', 'data-on': on ? 'true' : 'false',
          title: on ? t('page.skillsSwitchOffHint') : t('page.skillsSwitchOnHint'),
        }, [
          h('input', {
            key: 'i', type: 'checkbox', className: 'lt-check lt-skill-switch-input',
            'aria-label': t('page.skillsSwitch'),
            'data-skill': skill.name,
            checked: on,
            disabled: busy,
            onChange: (e) => toggleSkill(skill.name, e.target.checked),
          }),
          h('span', { key: 'l', className: 'lt-label' }, on ? t('page.skillsOn') : t('page.skillsOff')),
        ])
      }
      /**
       * The cards, either as one list or as foldable category sections.
       *
       * A group header is a real button with `aria-expanded`, because the whole
       * complaint this answers is scrolling: the operator has to be able to close
       * a bucket without a page reload.
       */
      const skillCardList = (groups) => h('div', {
        key: 'list', className: 'lt-skill-list', 'data-grouped': skillGrouped ? 'true' : 'false',
      }, groups.map((group) => {
        if (group.category === null) {
          return h('div', { key: 'flat', className: 'lt-skill-flat' }, group.rows.map(skillCard))
        }
        const id = group.category.id
        // Everything starts folded except a bucket holding a row or two: a
        // 29-skill catalog should open as a table of contents, and a bucket of
        // three is already taller than the fold on a laptop.
        const folded = skillCollapsed[id] === undefined
          ? group.rows.length > 2
          : skillCollapsed[id] === true
        return h('div', { key: id, className: 'lt-skill-group', 'data-cat': id }, [
          h('div', { key: 'h', className: 'lt-skill-group-head' }, [
            h('button', {
              key: 't', type: 'button', className: 'lt-skill-group-btn',
              'data-cat': id,
              'aria-expanded': folded ? 'false' : 'true',
              onClick: () => setSkillCollapsed((prev) => ({ ...prev, [id]: !folded })),
            }, [
              h('span', { key: 'c', className: 'lt-caret' }, folded ? '▶' : '▼'),
              h('span', { key: 'n', className: 'lt-cat-name' }, catLabel(group.category)),
              h('span', { key: 'k', className: 'lt-count' }, String(group.rows.length)),
            ]),
            id === '__orphan' || id === 'other'
              ? null
              : h('button', {
                  key: 'd', type: 'button', className: 'lt-param-reset',
                  title: t('page.skillsCategoryDeleteHint'),
                  onClick: () => editCats({ action: 'remove', id }),
                }, t('page.skillsCategoryDelete')),
          ]),
          folded ? null : h('div', { key: 'b', className: 'lt-skill-group-body' }, group.rows.map(skillCard)),
        ])
      }))

      const skillsPane = h('div', { key: 'skills', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'card', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' }, [
            h('h2', { key: 't', className: 'lt-card-title' }, t('page.tabSkills')),
            h('span', { key: 'c', className: 'lt-count' },
              skills === null ? '…' : String(filteredSkills.length)),
            h('span', { key: 's', className: 'lt-spacer' }),
            h('button', {
              key: 'new', type: 'button', className: 'lt-btn lt-btn-quiet',
              onClick: () => setSkillDraft((prev) => (prev === null
                ? { name: '', description: '', whenToUse: '', content: '' }
                : null)),
            }, skillDraft === null ? t('page.skillNew') : t('page.skillCancel')),
            typeof backToConversation === 'function'
              ? h('button', {
                  key: 'b', type: 'button', className: 'lt-btn lt-btn-quiet',
                  onClick: backToConversation,
                }, t('page.back'))
              : null,
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.skillsHint')),
          h('p', { key: 'provenance', className: 'lt-card-hint' }, text(
            '标签就是来源：包名 = 该插件包自带（升级这个包会重写同名技能）；「本模式」= 这个模式挂载的包提供；你的 = ~/.dsh/skills；项目内 = 工作区；DSH 自带 = 宿主内置；已接手副本 = 你改过的那一份。',
            'The tag is the source: a package name means the file ships inside that plugin (updating it rewrites the skill); "in this mode" means this mode mounts that package; yours = ~/.dsh/skills; project = the workspace; DSH built-in = shipped with the host; copied = your edited copy.',
          )),
          h('p', { key: 'packhint', className: 'lt-card-hint' }, t('page.skillsImportHint')),
          skillsError !== ''
            ? h('p', { key: 'err', className: 'lt-status', 'data-kind': 'err' },
                `${t('page.skillsError')}: ${skillsError}`)
            : null,
          skillStoreBroken
            ? h('p', { key: 'broken', className: 'lt-status', 'data-kind': 'warn' },
                t('page.skillsStoreBroken'))
            : null,
          skills !== null && skills.length > 4
            ? h('input', {
                key: 'f', className: 'lt-input', value: skillsQuery,
                placeholder: t('page.skillsFilter'),
                onChange: (e) => setSkillsQuery(e.target.value),
              })
            : null,
          // Grouping switch plus the two bulk verbs. Kept in one row so the
          // operator reads "how am I looking at this" and "what can I do with it"
          // in one glance instead of hunting two separate toolbars.
          h('div', { key: 'bar', className: 'lt-skillbar' }, [
            // Scope is the answer to "which of these does my mode actually
            // bring": everything in the workspace, or just this mode's own.
            // Without a selected mode there is no "own", so the switch is absent.
            ...(mode === null ? [] : [
              h('button', {
                key: 'scope-all', type: 'button', className: 'lt-btn',
                'data-active': skillScope === 'all' ? 'true' : 'false',
                onClick: () => setSkillScope('all'),
              }, `${text('全部', 'All')} ${Array.isArray(skills) ? skills.length : 0}`),
              h('button', {
                key: 'scope-mode', type: 'button', className: 'lt-btn',
                'data-active': skillScope === 'mode' ? 'true' : 'false',
                title: text(
                  '只列出这个模式挂载的包带来的技能，以及模式明确允许的技能',
                  'Only skills shipped by a package this mode mounts, plus the names its allowlist admits',
                ),
                onClick: () => setSkillScope((prev) => (prev === 'mode' ? 'all' : 'mode')),
              }, `${text('本模式', 'This mode')} ${modeSkillNames.size}`),
            ]),
            h('button', {
              key: 'g', type: 'button', className: 'lt-btn lt-btn-quiet',
              'data-active': skillGrouped ? 'true' : 'false',
              onClick: () => setSkillGrouped((prev) => !prev),
            }, skillGrouped ? t('page.skillsGrouped') : t('page.skillsFlat')),
            skillGrouped
              ? h('button', {
                  key: 'all', type: 'button', className: 'lt-btn lt-btn-quiet',
                  onClick: () => setSkillCollapsed((prev) => {
                    // If anything is open, fold everything; otherwise open it all.
                    const anyOpen = skillGroups.some((g) => prev[g.category.id] !== true)
                    const next = {}
                    for (const group of skillGroups) next[group.category.id] = anyOpen
                    return next
                  }),
                }, skillGroups.some((g) => skillCollapsed[g.category.id] !== true)
                  ? t('page.skillsCollapseAll')
                  : t('page.skillsExpandAll'))
              : null,
            h('button', {
              key: 'cat', type: 'button', className: 'lt-btn lt-btn-quiet',
              onClick: () => setCatDraft((prev) => (prev === null ? { id: '', zh: '' } : null)),
            }, t('page.skillsNewCategory')),
            h('span', { key: 'sp', className: 'lt-spacer' }),
            // Selection only exists while exporting. A permanently visible empty
            // checkbox on every card reads as "this skill is off", which is the
            // one thing it does not mean.
            skillPicking
              ? [
                  h('span', { key: 'picked', className: 'lt-skill-chars' },
                    t('page.skillsPicked').replace('{n}', String(pickedCount))),
                  h('button', {
                    key: 'all', type: 'button', className: 'lt-btn lt-btn-quiet',
                    onClick: () => setPicked(() => {
                      // Toggle the whole *visible* set: what the filter and the
                      // folded heads actually show is what the operator means.
                      const visible = visibleSkillNames()
                      const allOn = visible.length > 0 && visible.every((n) => picked[n] === true)
                      const next = {}
                      for (const name of visible) next[name] = !allOn
                      return next
                    }),
                  }, t('page.skillsPickAll')),
                  h('button', {
                    key: 'go', type: 'button', className: 'lt-btn',
                    disabled: packBusy || pickedCount === 0,
                    onClick: exportPack,
                  }, t('page.skillsExport')),
                  h('button', {
                    key: 'x', type: 'button', className: 'lt-btn lt-btn-quiet',
                    onClick: () => { setSkillPicking(false); setPicked({}) },
                  }, t('page.skillsPickCancel')),
                ]
              : h('button', {
                  key: 'exp', type: 'button', className: 'lt-btn',
                  disabled: packBusy,
                  onClick: () => { setSkillPicking(true); setPicked({}) },
                }, t('page.skillsExport')),
            h('label', { key: 'imp', className: 'lt-btn lt-skill-file' }, [
              h('span', { key: 'l' }, t('page.skillsImport')),
              h('input', {
                key: 'i', type: 'file', accept: 'application/json,.json',
                className: 'lt-skill-file-input',
                disabled: packBusy,
                onChange: (e) => {
                  const file = e.target.files?.[0]
                  if (file === undefined || file === null) return
                  e.target.value = ''
                  file.text().then(importPack).catch((err) => {
                    setPackError(err instanceof Error ? err.message : String(err))
                  })
                },
              }),
            ]),
          ]),
          h('label', { key: 'ow', className: 'lt-toggle lt-skill-toggle' }, [
            h('input', {
              key: 'i', type: 'checkbox', className: 'lt-check', checked: importOverwrite,
              onChange: (e) => setImportOverwrite(e.target.checked),
            }),
            h('span', { key: 't', className: 'lt-label' }, t('page.skillsImportOverwrite')),
          ]),
          packNote !== ''
            ? h('p', { key: 'pnote', className: 'lt-status', 'data-kind': 'ok' }, packNote)
            : null,
          packError !== ''
            ? h('p', { key: 'perr', className: 'lt-status', 'data-kind': 'err' }, packError)
            : null,
          catError !== ''
            ? h('p', { key: 'cerr', className: 'lt-status', 'data-kind': 'err' }, catError)
            : null,
          // Category editor: id, label, and the delete affordance per row.
          catDraft === null
            ? null
            : h('div', { key: 'catnew', className: 'lt-skill-newcard' }, [
                h('div', { key: 'h', className: 'lt-snippet-item-head' }, [
                  h('span', { key: 'l', className: 'lt-snippet-item-title' }, t('page.skillsNewCategory')),
                  h('span', { key: 's', className: 'lt-spacer' }),
                  h('button', {
                    key: 'add', type: 'button', className: 'lt-btn',
                    disabled: !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(catDraft.id.trim())
                      || catDraft.zh.trim() === '',
                    onClick: () => editCats({
                      action: 'add', id: catDraft.id.trim(), zh: catDraft.zh.trim(),
                    }),
                  }, t('page.skillsCategoryAdd')),
                ]),
                h('label', { key: 'i', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillsCategoryId')),
                  h('input', {
                    key: 'in', className: 'lt-input', value: catDraft.id,
                    placeholder: 'my-category',
                    onChange: (e) => setCatDraft({ ...catDraft, id: e.target.value }),
                  }),
                  h('span', { key: 'h', className: 'lt-card-hint' }, t('page.skillsCategoryIdHint')),
                ]),
                h('label', { key: 'z', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillsCategoryLabel')),
                  h('input', {
                    key: 'in', className: 'lt-input', value: catDraft.zh,
                    onChange: (e) => setCatDraft({ ...catDraft, zh: e.target.value }),
                  }),
                ]),
              ]),
          // The composer creates a new SKILL.md at ~/.dsh/skills/<name>/.
          skillDraft === null
            ? null
            : h('div', { key: 'new', className: 'lt-skill-newcard' }, [
                h('div', { key: 'h', className: 'lt-snippet-item-head' }, [
                  h('span', { key: 'l', className: 'lt-snippet-item-title' }, t('page.skillNew')),
                  h('span', { key: 's', className: 'lt-spacer' }),
                  h('button', {
                    key: 'save', type: 'button', className: 'lt-btn',
                    disabled: skillSaving || skillDraft.name.trim() === ''
                      || skillDraft.description.trim() === '' || skillDraft.content.trim() === '',
                    onClick: saveSkill,
                  }, skillSaving ? t('page.skillSaving') : t('page.skillSave')),
                ]),
                h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.skillNewHint')),
                h('label', { key: 'n', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillName')),
                  h('input', {
                    key: 'i', className: 'lt-input', value: skillDraft.name,
                    placeholder: 'my-skill-name',
                    onChange: (e) => setSkillDraft({ ...skillDraft, name: e.target.value }),
                  }),
                ]),
                h('label', { key: 'd', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.fieldDescription')),
                  h('input', {
                    key: 'i', className: 'lt-input', value: skillDraft.description,
                    onChange: (e) => setSkillDraft({ ...skillDraft, description: e.target.value }),
                  }),
                ]),
                h('label', { key: 'w', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillsWhen')),
                  h('input', {
                    key: 'i', className: 'lt-input', value: skillDraft.whenToUse,
                    onChange: (e) => setSkillDraft({ ...skillDraft, whenToUse: e.target.value }),
                  }),
                ]),
                h('label', { key: 'cc', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillsCategory')),
                  h('select', {
                    key: 'i', className: 'lt-select', value: skillDraft.category ?? '_auto',
                    onChange: (e) => setSkillDraft({ ...skillDraft, category: e.target.value }),
                  }, [
                    h('option', { key: 'a', value: '_auto' },
                      t('page.skillsAutoOnSave')),
                    ...skillCats.map((c) => h('option', { key: c.id, value: c.id }, catLabel(c))),
                  ]),
                ]),
                h('label', { key: 'c', className: 'lt-field' }, [
                  h('span', { key: 'l', className: 'lt-label' }, t('page.skillBody')),
                  h('textarea', {
                    key: 'i', className: 'lt-textarea lt-skill-editor', value: skillDraft.content,
                    placeholder: t('page.skillBodyPlaceholder'),
                    spellCheck: false,
                    onChange: (e) => setSkillDraft({ ...skillDraft, content: e.target.value }),
                  }),
                ]),
                skillSaveError !== ''
                  ? h('p', { key: 'e', className: 'lt-status', 'data-kind': 'err' }, skillSaveError)
                  : null,
              ]),
          skills === null
            ? h('div', { key: 'l', className: 'lt-empty' }, '…')
            : filteredSkills.length === 0
              ? h('div', { key: 'e', className: 'lt-empty' }, skillScope === 'mode'
                  ? text(
                      '这个模式没有专属技能：它挂载的包没有带技能，也没有手动限定技能名单。切到「全部」看工作区技能。',
                      'This mode brings no skills of its own: no mounted package ships any and no allowlist is set. Switch to All to see the workspace catalog.',
                    )
                  : t('page.skillsEmpty'))
              : skillCardList(skillGrouped ? skillGroups : [{ category: null, rows: filteredSkills }]),
        ]),
      ])

      const panes = mode === null ? { skills: skillsPane } : {
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
          h('div', { key: 'p', className: 'lt-field' }, [
            h('div', { key: 'head', className: 'lt-persona-head' }, [
              h('span', { key: 'l', className: 'lt-label' }, t('page.fieldPersona')),
              // Character count is the only honest signal of how much prompt
              // this mode ships on every turn, so it sits next to the label.
              h('span', { key: 'c', className: 'lt-persona-count', 'data-kind': personaChars > 900 ? 'heavy' : undefined },
                t('page.personaChars').replace('{n}', String(personaChars))),
              h('span', { key: 's', className: 'lt-spacer' }),
              h('button', {
                key: 'exp', type: 'button', className: 'lt-btn lt-btn-quiet',
                onClick: () => setPersonaOpen((prev) => ({ ...prev, [modeKey]: !isPersonaOpen })),
              }, isPersonaOpen ? t('page.personaCollapse') : t('page.personaExpand')),
            ]),
            mode.persona === false
              ? h('p', { key: 'owned', className: 'lt-lead' },
                  text(
                    '人设由这个模式挂载的插件提供（例如 dsh-work-fish 的 persona 行），这里不再挂载内置 persona 行；同一个提示段落名注册两次会让预设无法激活。',
                    'The prompt section is provided by a plugin this mode mounts, so the stock persona row is not mounted either — registering the same section name twice makes the preset fail to activate.',
                  ))
              : null,
            h('textarea', {
              key: 'i',
              className: 'lt-textarea lt-persona-box',
              'data-expanded': isPersonaOpen ? 'true' : 'false',
              disabled: mode.persona === false,
              value: mode.persona === false ? '' : (mode.persona ?? ''),
              spellCheck: false,
              onChange: (e) => update({ persona: e.target.value }),
            }),
            h('div', { key: 'snippets', className: 'lt-snippets' }, [
              h('div', { key: 'head', className: 'lt-snippets-head' }, [
                h('span', { key: 'l', className: 'lt-snippets-label' }, t('page.personaTemplates')),
                h('span', { key: 'h', className: 'lt-snippets-note' }, t('page.personaTemplatesHint')),
                h('span', { key: 's', className: 'lt-spacer' }),
                h('button', {
                  key: 't', type: 'button', className: 'lt-btn lt-btn-quiet',
                  onClick: () => setSnippetsOpen((v) => !v),
                }, snippetsOpen ? t('page.personaCollapse') : t('page.personaExpand')),
              ]),
              snippetsOpen
                ? h('div', { key: 'list', className: 'lt-snippet-list' }, [
                    ...allTemplates.map((tpl) => {
                      const text = templateText(tpl)
                      const custom = tpl.custom === true
                      const changedOne = custom || templateEdits[tpl.id] !== undefined
                      return h('div', { key: tpl.id, className: 'lt-snippet-item' }, [
                        h('div', { key: 'h', className: 'lt-snippet-item-head' }, [
                          h('span', { key: 'l', className: 'lt-snippet-item-title' },
                            custom ? (tpl.label || tpl.id) : t(tpl.labelKey)),
                          changedOne
                            ? h('span', { key: 'b', className: 'lt-tag', 'data-tone': 'warn' },
                                t('page.snippetEdited'))
                            : h('span', { key: 'b', className: 'lt-tag' }, t('page.snippetSeed')),
                          h('span', { key: 's', className: 'lt-spacer' }),
                          h('button', {
                            key: 'i', type: 'button', className: 'lt-btn lt-btn-quiet',
                            onClick: () => {
                              if (mode.persona === false) return
                              update({ persona: `${(mode.persona ?? '').replace(/\s+$/, '')}${(mode.persona ?? '').trim() === '' ? '' : '\n\n'}${text}` })
                            },
                          }, t('page.snippetInsert')),
                          changedOne && !custom
                            ? h('button', {
                                key: 'r', type: 'button', className: 'lt-btn lt-btn-quiet',
                                onClick: () => {
                                  setTemplateEdits((prev) => {
                                    const next = { ...prev }
                                    delete next[tpl.id]
                                    writeTemplateStore(next)
                                    return next
                                  })
                                },
                              }, t('page.snippetReset'))
                            : null,
                          // A custom line can be removed outright; a seed line
                          // only resets, because the seed is not the operator's.
                          custom
                            ? h('button', {
                                key: 'x', type: 'button', className: 'lt-btn lt-btn-quiet',
                                onClick: () => {
                                  setCustomTemplates((prev) => {
                                    const next = prev.filter((t) => t.id !== tpl.id)
                                    writeCustomTemplates(next)
                                    return next
                                  })
                                },
                              }, t('page.snippetDelete'))
                            : null,
                        ]),
                        // One sentence, not a skill: a skill is a whole
                        // instruction set and lives in the Skills pane.
                        h('textarea', {
                          key: 't', className: 'lt-textarea lt-snippet-text',
                          value: text,
                          spellCheck: false,
                          onChange: (e) => {
                            if (custom) {
                              setCustomTemplates((prev) => {
                                const next = prev.map((t) => (t.id === tpl.id
                                  ? { ...t, text: e.target.value }
                                  : t))
                                writeCustomTemplates(next)
                                return next
                              })
                            } else {
                              setTemplateEdits((prev) => {
                                const next = { ...prev, [tpl.id]: e.target.value }
                                writeTemplateStore(next)
                                return next
                              })
                            }
                          },
                        }),
                      ])
                    }),
                    h('div', { key: 'add', className: 'lt-snippet-add' }, [
                      h('input', {
                        key: 'i', className: 'lt-input', value: newTemplate,
                        placeholder: t('page.snippetAddPlaceholder'),
                        onChange: (e) => setNewTemplate(e.target.value),
                      }),
                      h('button', {
                        key: 'b', type: 'button', className: 'lt-btn',
                        disabled: newTemplate.trim() === '',
                        onClick: () => {
                          const text = newTemplate.trim()
                          if (text === '') return
                          const id = `custom-${Date.now().toString(36)}`
                          setCustomTemplates((prev) => {
                            const next = [...prev, { id, label: text.slice(0, 24), text, custom: true }]
                            writeCustomTemplates(next)
                            return next
                          })
                          setNewTemplate('')
                        },
                      }, t('page.snippetAdd')),
                    ]),
                  ])
                : h('div', { key: 'chips', className: 'lt-snippet-chips' }, allTemplates.map((tpl) => h('button', {
                    key: tpl.id, type: 'button', className: 'lt-snippet-btn',
                    title: templateText(tpl),
                    'data-template': tpl.id,
                    onClick: () => update({ persona: `${(mode.persona ?? '').replace(/\s+$/, '')}${(mode.persona ?? '').trim() === '' ? '' : '\n\n'}${templateText(tpl)}` }),
                  }, tpl.custom === true ? (tpl.label || tpl.id) : t(tpl.labelKey)))),
            ]),
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
          h('p', { key: 'provenance', className: 'lt-card-hint' }, text(
            '行上的包名是真正提供这些工具的插件包：@deepseek-ai/* 是 DSH 自带，其他名字是你装的插件。雷霆这一层只决定挂哪些行。',
            'The package on a row is what actually ships those tools: @deepseek-ai/* is the host, any other name is a plugin you installed. This plugin only decides which rows are mounted.',
          )),
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
                // Count packages, not strings: three subpath rows of one package
                // are one checked box, and the number has to match the boxes.
                : `${plugins.filter((plugin) => mountedPackages.has(plugin.name)).length} / ${plugins.length}`),
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.pluginsHint')),
          h('p', { key: 'thint', className: 'lt-card-hint' }, t('page.pluginToolsHint')),
          // A mode may mount a package's subpath row (Work Fish mounts
          // `dsh-work-fish/core/{persona,guard,skills}`). Those rows are not
          // packages, so they would otherwise be invisible here — and an operator
          // could not see, let alone release, what the mode actually mounts.
          ...(() => {
            const extras = (mode.plugins ?? []).filter((name) => !plugins.some((plugin) => plugin.name === name))
            if (extras.length === 0) return []
            return [h('div', { key: 'subpaths' }, [
              h('p', { className: 'lt-card-hint' }, text(
                '这些是插件包里的子路径行，不是独立包；它们随模式挂载，来源是下面的包：',
                'These are subpath rows of a package, not standalone packages. They mount with this mode and ship with the package below:',
              )),
              ...extras.map((name) => h('div', { key: name, className: 'lt-plugin', 'data-on': 'true' }, [
                h('div', { className: 'lt-tool-main' }, [
                  h('span', { className: 'lt-mono' }, name),
                  h('div', { className: 'lt-tool-desc' }, text(
                    `随 ${packageOf(name)} 升级`,
                    `updated with ${packageOf(name)}`,
                  )),
                ]),
                h('button', {
                  className: 'lt-btn',
                  onClick: () => update({ plugins: (mode.plugins ?? []).filter((item) => item !== name) }),
                }, text('移除', 'Remove')),
              ])),
            ])]
          })(),
          plugins.length === 0
            ? h('div', { key: 'e', className: 'lt-empty' }, t('page.noPlugins'))
            : plugins.map((plugin) => {
                // A package counts as mounted when any of its rows is mounted,
                // including a subpath export. Unchecking removes every row of
                // that package, so the box and the list cannot drift apart.
                const subpaths = (mode.plugins ?? []).filter((name) => name !== plugin.name && packageOf(name) === plugin.name)
                const mounted = mountedPackages.has(plugin.name)
                const declared = Array.isArray(plugin.tools) ? plugin.tools : []
                return h('div', {
                  key: plugin.name, className: 'lt-plugin', 'data-on': mounted ? 'true' : 'false',
                }, [
                  h(Toggle, {
                    key: 'c', checked: mounted,
                    onChange: () => update({
                      plugins: mounted
                        ? (mode.plugins ?? []).filter((name) => packageOf(name) !== plugin.name)
                        : [...(mode.plugins ?? []), plugin.name],
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
                      subpaths.length > 0
                        ? h('span', {
                            key: 'sp', className: 'lt-badge', 'data-tone': 'on',
                            title: subpaths.join('\n'),
                          }, text(`${subpaths.length} 子路径行`, `${subpaths.length} subpath rows`))
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
                            'data-on': mounted && !(mode.disabledTools ?? []).includes(tool) ? 'true' : 'false',
                            disabled: !mounted,
                            'aria-pressed': mounted && !(mode.disabledTools ?? []).includes(tool),
                            title: text('独立切换此工具；保存后执行层拦截', 'Toggle only this tool; enforced after saving'),
                            onClick: () => update({ disabledTools: toggleIn(mode.disabledTools ?? [], tool) }),
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

        params: h('div', { key: 'params', className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'card', className: 'lt-card' }, [
          h('div', { key: 'h', className: 'lt-card-head' }, [
            h('h2', { key: 't', className: 'lt-card-title' }, t('page.params')),
            h('span', { key: 'c', className: 'lt-count' },
              `${tunable.filter((e) => Object.keys(overrides[e.id] ?? {}).length > 0).length} / ${tunable.length}`),
          ]),
          h('p', { key: 'hint', className: 'lt-card-hint' }, t('page.paramsHint')),
          h('p', { key: 'ro', className: 'lt-card-hint' }, t('page.paramRestart')),
          tunable.length === 0
            ? h('div', { key: 'e', className: 'lt-empty' }, t('page.paramsEmpty'))
            : tunable.map((entry) => {
                const values = overrides[entry.id] ?? {}
                const changedCount = Object.keys(values).length
                return h('div', { key: entry.id, className: 'lt-param-group' }, [
                  h('div', { key: 'gh', className: 'lt-param-group-head' }, [
                    h('h3', { key: 'l', className: 'lt-card-title' }, lang === 'zh' ? entry.zh : entry.en),
                    changedCount > 0
                      ? h('span', { key: 'b', className: 'lt-badge', 'data-tone': 'warn' },
                          `${t('page.paramOverridden')} ${changedCount}`)
                      : h('span', { key: 'b', className: 'lt-badge' }, t('page.paramGroupHint')),
                    (entry.tools ?? []).length > 0
                      ? h('span', { key: 'm', className: 'lt-mono' }, entry.tools.join(' · '))
                      : null,
                  ]),
                  h('div', { key: 'list', className: 'lt-params' },
                    (entry.params ?? []).map((param) => {
                      const raw = values[param.key] ?? param.default
                      const scale = Number.isFinite(param.scale) && param.scale > 0 ? param.scale : 1
                      // Scaling is display-only: bytes and milliseconds are
                      // stored raw, so the operator never types 10485760.
                      const shown = typeof raw === 'number'
                        ? Math.round((raw / scale) * 100) / 100
                        : raw
                      const changedOne = values[param.key] !== undefined
                      return h('div', { key: param.key, className: 'lt-param' }, [
                        h('div', { key: 'm', className: 'lt-param-main' }, [
                          h('div', { key: 'n', className: 'lt-param-name' }, [
                            h('span', { key: 'l' }, lang === 'zh' ? param.zh : param.en),
                            changedOne
                              ? h('span', { key: 'b', className: 'lt-badge', 'data-tone': 'warn' },
                                  t('page.paramOverridden'))
                              : null,
                          ]),
                          h('span', { key: 'h', className: 'lt-card-hint' },
                            lang === 'zh' ? param.hintZh : param.hintEn),
                        ]),
                        h('div', { key: 'c', className: 'lt-param-ctl' }, [
                          param.type === 'bool'
                            ? h(Toggle, {
                                key: 't',
                                checked: raw === true,
                                onChange: (on) => setParam(entry.id, param.key, on),
                              })
                            : param.type === 'string'
                              ? h('input', {
                                  key: 't',
                                  className: 'lt-input',
                                  type: 'text',
                                  value: typeof raw === 'string' ? raw : '',
                                  onChange: (e) => setParam(entry.id, param.key, e.target.value),
                                })
                              : h('input', {
                                  key: 't',
                                  className: 'lt-input',
                                  type: 'number',
                                  min: param.min,
                                  max: param.max,
                                  step: param.step ?? 1,
                                  value: String(shown),
                                  onChange: (e) => {
                                    const typed = Number(e.target.value)
                                    if (!Number.isFinite(typed)) return
                                    setParam(entry.id, param.key, typed * scale)
                                  },
                                }),
                          param.type === 'bool' || param.type === 'string'
                            ? null
                            : h('span', { key: 'u', className: 'lt-param-unit' }, param.unit ?? ''),
                          h('button', {
                            key: 'r',
                            type: 'button',
                            className: 'lt-param-reset',
                            disabled: !changedOne,
                            onClick: () => clearParam(entry.id, param.key),
                          }, t('page.paramReset')),
                        ]),
                      ])
                    }),
                  ),
                ])
              }),
        ]),
      ]),
        skills: skillsPane,
      }

      const declaredTools = new Map()
      if (mode) {
        for (const row of catalog) for (const name of row.tools ?? []) {
          const item = declaredTools.get(name) ?? { name, sources: [], mounted: false, rows: [] }
          item.sources.push(row.package ?? row.id)
          // Which catalog rows can mount this name: turning a tool on grants it,
          // but only a mounted row puts it into the model's catalog.
          item.rows.push(row.id)
          item.mounted ||= tools.includes(row.id)
          declaredTools.set(name, item)
        }
        for (const plugin of plugins) for (const name of plugin.tools ?? []) {
          const item = declaredTools.get(name) ?? { name, sources: [], mounted: false, rows: [], packages: [] }
          item.sources.push(plugin.name)
          // A tool shipped by an installed package is switchable by mounting that
          // package; it is not host-only just because it is currently unmounted.
          item.packages ??= []
          item.packages.push(plugin.name)
          item.mounted ||= (mode.plugins ?? []).includes(plugin.name)
          declaredTools.set(name, item)
        }
        for (const name of mode.allowedTools ?? []) {
          const item = declaredTools.get(name) ?? { name, sources: [text('手动授权 / 动态工具', 'Manual grant / dynamic tool')], mounted: true, rows: [] }
          item.mounted = true
          declaredTools.set(name, item)
        }
        for (const name of mode.disabledTools ?? []) if (!declaredTools.has(name)) declaredTools.set(name, { name, sources: [text('显式禁用', 'Explicit deny')], mounted: false, rows: [] })
      }
      const capabilityPane = mode === null ? null : h('div', { className: 'lt-pane', role: 'tabpanel' }, [
        h('div', { key: 'summary', className: 'lt-cap-summary' }, [
          h('div', { key: 'lead' }, [h('strong', {}, text('能力边界，一目了然', 'Know your capability boundary')),
            h('p', {}, text('保存后按工具名白名单拦截，包括已运行会话的后续调用；不终止正在执行的任务。新插件挂载仍需重启。', 'Saving enforces a tool-name allowlist on subsequent calls, including running sessions. In-flight work is not cancelled; new plugin mounts require a restart.'))]),
          h('span', { className: 'lt-badge', key: 'count' }, `${[...declaredTools.values()].filter((row) => row.mounted && !(mode.disabledTools ?? []).includes(row.name)).length} ${text('待保存/配置授权', 'configured grants')}`),
        ]),
        h('div', { key: 'tools', className: 'lt-card' }, [
          h('div', { className: 'lt-card-head', key: 'head' }, [h('h2', { className: 'lt-card-title' }, text('工具执行权限', 'Tool execution permissions')),
            h('input', { className: 'lt-input', style: { maxWidth: 260 }, value: capQuery, placeholder: text('搜索工具或来源包', 'Filter tools or packages'), onChange: (e) => setCapQuery(e.target.value) })]),
          h('div', { className: 'lt-card-hint' }, text('来源为静态扫描，不等于运行时工具清单。未知工具默认拒绝，可按准确名称手动授权。禁用优先于授权，跨插件同名工具一起禁用。', 'Sources are static declarations, not runtime discovery. Unknown tools are denied; grant exact names below. Denials override grants across all packages.')),
          h('div', { className: 'lt-cap-list' }, [...declaredTools.values()].filter((row) => `${row.name} ${row.sources.join(' ')}`.toLowerCase().includes(capQuery.toLowerCase())).map((row) => {
            const on = row.mounted && !(mode.disabledTools ?? []).includes(row.name)
            // Turning a tool on has to mount whatever declares it: a grant without
            // a mounted row never reaches the model's catalog, so the switch would
            // show "on" and change nothing.
            const mountableRows = (row.rows ?? [])
              .filter((id) => byId[id] !== undefined && byId[id].hostOnly !== true)
            const mountablePackages = row.packages ?? []
            const canMount = mountableRows.length > 0 || mountablePackages.length > 0
            // A row rendered for a tool that only the host can provide, or that
            // was denied by hand, still gets a reason next to its dead switch.
            const reason = canMount ? null : text('仅宿主', 'Host only')
            return h('div', { key: row.name, className: 'lt-plugin', 'data-on': String(on) }, [
              h(Toggle, {
                checked: on,
                disabled: row.mounted ? false : !canMount,
                onChange: (next) => {
                  if (next === true) {
                    update({
                      tools: [...new Set([...tools, ...mountableRows])],
                      plugins: [...new Set([...(mode.plugins ?? []), ...mountablePackages])],
                      disabledTools: (mode.disabledTools ?? []).filter((name) => name !== row.name),
                    })
                    return
                  }
                  update({ disabledTools: toggleIn(mode.disabledTools ?? [], row.name) })
                },
              }),
              h('div', { className: 'lt-tool-main' }, [h('strong', { className: 'lt-mono' }, row.name), h('div', { className: 'lt-tool-desc' }, [...new Set(row.sources)].join(' · '))]),
              h('span', { className: 'lt-badge' }, reason !== null ? reason : on ? text('允许', 'Allowed') : text('已禁用', 'Denied')),
              (mode.allowedTools ?? []).includes(row.name) ? h('button', { className: 'lt-btn', onClick: () => update({ allowedTools: (mode.allowedTools ?? []).filter((name) => name !== row.name) }) }, text('撤销授权', 'Revoke grant')) : null,
            ])
          })),
          h('div', { className: 'lt-addrow' }, [h('input', { className: 'lt-input', value: customTool, placeholder: text('动态工具准确名称（不是插件名）', 'Exact dynamic tool name (not package name)'), onChange: (e) => setCustomTool(e.target.value) }),
            h('button', { className: 'lt-btn', disabled: !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(customTool), onClick: () => { update({ allowedTools: [...new Set([...(mode.allowedTools ?? []), customTool])], disabledTools: (mode.disabledTools ?? []).filter((name) => name !== customTool) }); setCustomTool('') } }, text('明确授权', 'Grant explicitly'))]),
        ]),
        h('details', { key: 'skill-policy', className: 'lt-card' }, [h('summary', {}, text('此模式的技能访问范围', 'Skill access for this mode')),
          h('p', { className: 'lt-card-hint' }, text('独立于技能页的全局开关。在此限制 skill(name) 的执行权限；不会隐藏工作区技能描述，也不限制 shell 或 read 的间接读取。完整模式会携带明确选择的技能及其目录附件。', 'Separate from global skill visibility. Restricts skill(name) calls, not skill descriptions or indirect shell/file reads. Full mode exports include explicitly selected skills and directory attachments.')),
          h('label', { className: 'lt-consent' }, [h('input', { type: 'checkbox', checked: Array.isArray(mode.skills), onChange: (e) => update({ skills: e.target.checked ? [] : undefined }) }), text('仅允许明确选择的技能', 'Allow only explicitly selected skills')]),
          Array.isArray(mode.skills) ? h('div', { className: 'lt-cap-list' }, [...new Set([...(skills ?? []).map((skill) => skill.name), ...mode.skills])].map((name) => h('label', { key: name, className: 'lt-consent' }, [h('input', { type: 'checkbox', checked: mode.skills.includes(name), onChange: () => update({ skills: toggleIn(mode.skills, name) }) }), name]))) : null,
          skillsError ? h('p', { className: 'lt-err' }, skillsError) : null,
        ]),
        h('details', { key: 'mounts', className: 'lt-card' }, [h('summary', {}, text('隐式挂载与资料边界', 'Implicit mounts and context boundary')),
          h('p', { className: 'lt-card-hint' }, text('资料注入开关只控制本模式挂载，在新会话中生效；宿主全局注入可能仍存在。权限守卫始终挂载，人设在基础信息中编辑。', 'These switches control only this mode’s context mounts in new sessions; global host injections may remain. The policy guard always mounts; edit the persona in Basics.')),
          ...implicit.map((row) => {
            const key = row.id === 'agent-instructions' ? 'projectInstructions' : row.id === 'time-context' ? 'timeContext' : null
            return h('label', { key: row.id, className: 'lt-consent' }, [key ? h('input', { type: 'checkbox', checked: mode.context?.[key] !== false, onChange: (e) => update({ context: { ...mode.context, [key]: e.target.checked } }) }) : null, h('span', { className: 'lt-mono' }, `${row.id} · ${row.name}`)])
          }),
          h('p', { className: 'lt-card-hint' }, text('人设、时间、项目指令属于资料注入，不是模型工具；技能页展示工作区共享资料。允许 shell、文件读写或网络工具后，它们仍可间接访问其他能力。这里不是操作系统沙箱。', 'Persona, time and project instructions inject context, not tools. Skills are shared workspace resources. Shell, file and network tools may indirectly access other capabilities; this is not an OS sandbox.'))]),
        h('details', { key: 'live-capabilities', className: 'lt-card' }, [h('summary', {}, text('运行中会话的真实注册与挂载', 'Live session registrations and mounts')),
          h('p', { className: 'lt-card-hint' }, text('直接读取宿主工具注册表与会话 Loader，不是静态扫描。注册不等于当前步骤已暴露给模型；权限仍按保存的配置判定。', 'Read from host tool registries and session Loaders, not static scans. Registered does not mean admitted to the current model step. Saved policy still controls dispatch.')),
          !(capabilities[mode.id]?.sessions ?? []).length ? h('p', { className: 'lt-empty' }, text('当前没有此模式的运行中会话。', 'No running session for this mode.')) : null,
          ...(capabilities[mode.id]?.sessions ?? []).map((session) => h('details', { key: session.id }, [h('summary', { className: 'lt-mono' }, `${session.id} · ${session.mounts.includes('dsh-agents-modes/capability-policy') ? text('已发现守卫挂载', 'Guard mount found') : text('未发现守卫，请新建会话', 'Guard not found; start a new session')}`),
            session.registered === null ? h('p', { className: 'lt-card-hint' }, text('此宿主不提供工具注册表读取。', 'This host does not expose tool registry inspection.')) : h('div', { className: 'lt-chips' }, session.registered.map((name) => h('span', { key: name, className: 'lt-chip', 'data-on': String((capabilities[mode.id]?.allowed ?? []).includes(name)) }, `${name} · ${(capabilities[mode.id]?.allowed ?? []).includes(name) ? text('允许', 'Allowed') : text('拦截', 'Denied')}`))),
            h('p', { className: 'lt-mono' }, session.mounts.join(' · ')),
          ])),
        ]),
        h('div', { key: 'audit', className: 'lt-card' }, [h('div', { className: 'lt-card-head' }, [h('h2', { className: 'lt-card-title' }, text('最近调用决策', 'Recent dispatch decisions')), h('button', { className: 'lt-btn', onClick: async () => { try { const response = await post('/api/agent-modes/roster', {}); if (response.ok) { setCapabilities(response.value.capabilities ?? {}); setLive(response.value.live ?? []) } else setError(response.error || 'Refresh failed') } catch (error) { setError(String(error.message ?? error)) } } }, text('刷新', 'Refresh'))]),
          h('p', { className: 'lt-card-hint' }, text('仅当前宿主进程最近 100 条；记录权限检查，不代表执行成功。不采集参数或工具输出。', 'Last 100 checks in this host process, not execution results. Arguments and output are not collected.')),
          h('p', { className: 'lt-mono' }, `${text('当前已保存授权', 'Saved grants')}: ${(capabilities[mode.id]?.allowed ?? []).join(', ') || '—'}`),
          ...(capabilities[mode.id]?.events ?? []).slice().reverse().map((event, i) => h('div', { key: i, className: 'lt-plugin' }, [h('span', { className: 'lt-mono' }, event.tool), h('span', { className: 'lt-tool-desc' }, `${new Date(event.at).toLocaleTimeString()} · ${event.session ?? '—'}`), h('span', { className: 'lt-badge', 'data-tone': event.denied ? 'warn' : 'on' }, event.denied ? text('拦截', 'Denied') : text('权限通过', 'Policy passed'))])),
          !(capabilities[mode.id]?.events ?? []).length ? h('p', { className: 'lt-empty' }, text('暂无调用记录。旧会话需重启一次以挂载权限守卫。', 'No checks yet. Older sessions need one restart to mount the policy guard.')) : null,
        ]),
      ])

      const analyzeShare = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setSharePack(null); setSharePlan(null); setShareError(''); setShareDone(false); setShareInstall(false)
        if (file.size > 36 * 1024 * 1024) { setShareError(text('共享包超过 36 MiB', 'Pack exceeds 36 MiB')); return }
        setShareAction('analyze'); setShareBusy(true)
        try {
          const pack = JSON.parse(await file.text())
          const response = await post('/api/agent-modes/pack-analyze', { pack, currentModes: draft, target: mode?.id })
          if (!response?.ok) throw new Error(response?.error || 'Analysis failed')
          setSharePack(pack); setSharePlan(response.value)
        } catch (e) { setShareError(String(e.message ?? e)) } finally { setShareBusy(false) }
      }
      const exportShare = async () => {
        setShareAction('export'); setShareBusy(true); setShareError('')
        try {
          let selectedMode = mode
          if (shareItems !== null && mode) {
            if (shareScope === 'tools') {
              const selectedNames = new Set(catalog.filter((row) => shareItems.includes(row.id)).flatMap((row) => row.tools ?? []))
              selectedMode = { ...mode, tools: tools.filter((id) => shareItems.includes(id)),
                allowedTools: (mode.allowedTools ?? []).filter((name) => shareItems.includes(`grant:${name}`)),
                disabledTools: (mode.disabledTools ?? []).filter((name) => selectedNames.has(name) || shareItems.includes(`grant:${name}`)) }
            } else if (shareScope === 'plugins') selectedMode = { ...mode, plugins: (mode.plugins ?? []).filter((name) => shareItems.includes(name)) }
            else if (shareScope === 'parameters') selectedMode = { ...mode, config: Object.fromEntries(Object.entries(mode.config ?? {}).map(([id, config]) => [id, Object.fromEntries(Object.entries(config).filter(([key]) => shareItems.includes(`${id}:${key}`)))]).filter(([, config]) => Object.keys(config).length)) }
          }
          const response = await post('/api/agent-modes/pack-export', { modes: shareScope === 'all' ? draft : [selectedMode], scope: shareScope === 'all' ? 'mode' : shareScope })
          if (!response?.ok) throw new Error(response?.error || 'Export failed')
          saveTextFile(response.value.file, JSON.stringify(response.value.pack, null, 2))
        } catch (e) { setShareError(String(e.message ?? e)) } finally { setShareBusy(false) }
      }
      const importShare = async () => {
        setShareAction('import'); setShareBusy(true); setShareError('')
        try {
          const response = await post('/api/agent-modes/pack-import', { pack: sharePack, currentModes: draft, target: mode?.id, conflict: shareConflict, install: shareInstall })
          if (!response?.ok) throw new Error(response?.error || 'Import failed')
          setDraft(response.value.modes); setStatus(null); setShareDone(true)
        } catch (e) { setShareError(String(e.message ?? e)) } finally { setShareBusy(false) }
      }
      const exportItems = !mode ? [] : shareScope === 'tools'
        ? [...tools.map((id) => ({ id, label: id })), ...(mode.allowedTools ?? []).map((name) => ({ id: `grant:${name}`, label: name }))]
        : shareScope === 'plugins' ? (mode.plugins ?? []).map((name) => ({ id: name, label: name }))
          : shareScope === 'parameters' ? Object.entries(mode.config ?? {}).flatMap(([id, config]) => Object.keys(config).map((key) => ({ id: `${id}:${key}`, label: `${id} / ${key}` }))) : []
      const pendingDeps = [...(sharePlan?.dependencies ?? []), ...(sharePlan?.resources ?? [])].filter((dep) => dep.status === 'download' || dep.status === 'bundled')
      const sharePanel = !shareOpen ? null : h('section', { className: 'lt-share', 'aria-busy': shareBusy, 'aria-label': text('共享工作台', 'Sharing workbench') }, [
        h('div', { key: 'header', className: 'lt-card-head' }, [h('div', {}, [h('span', { className: 'lt-eyebrow' }, 'PORTABLE WORKSPACE'), h('h2', { className: 'lt-card-title' }, text('共享工作台', 'Sharing workbench'))]), h('button', { className: 'lt-btn', disabled: shareBusy, onClick: () => setShareOpen(false) }, text('收起', 'Close'))]),
        h('p', { key: 'intro', className: 'lt-card-hint' }, text('分析 → 确认依赖 → 合并草稿 → 保存生效。本地包随产物携带；远程包按版本识别。明确选择的技能及附件随完整模式分享，也可在技能页独立分享。', 'Analyze → confirm dependencies → merge draft → save. Local packages travel with the pack; remote packages carry versions. Selected skills and attachments travel with full modes; standalone sharing remains in Skills.')),
        h('div', { key: 'grid', className: 'lt-share-grid' }, [
          h('div', { className: 'lt-share-side' }, [h('h3', {}, text('01 / 导出', '01 / Export')),
            h('label', {}, [text('导出范围', 'Export scope'), h('select', { className: 'lt-input', value: shareScope, onChange: (e) => { setShareScope(e.target.value); setShareItems(null) } }, [['mode', text('当前完整模式', 'Current mode')], ['all', text('全部模式', 'All modes')], ['tools', text('工具与权限', 'Tools and permissions')], ['parameters', text('参数配置', 'Parameters')], ['plugins', text('插件及依赖', 'Plugins and dependencies')]].map(([value, label]) => h('option', { key: value, value }, label)))]),
            exportItems.length ? h('details', { className: 'lt-share-selection' }, [h('summary', {}, text('按需选择内容（默认全部）', 'Choose individual items (all by default)')),
              ...exportItems.map((item) => h('label', { key: item.id, className: 'lt-consent' }, [h('input', { type: 'checkbox', checked: shareItems === null || shareItems.includes(item.id), onChange: () => setShareItems(toggleIn(shareItems ?? exportItems.map((row) => row.id), item.id)) }), h('span', { className: 'lt-mono' }, item.label)]))]) : null,
            h('p', { className: 'lt-card-hint' }, text('从当前草稿导出。默认排除 .env、密钥文件和 node_modules；分享前仍请检查敏感资料与绝对路径。', 'Exports the current draft. .env, key files and node_modules are excluded. Review other secrets and absolute paths before sharing.')),
            h('button', { className: 'lt-btn lt-btn-primary', disabled: shareBusy || !mode, 'data-action': 'export-pack', onClick: exportShare }, text('生成共享包', 'Export pack'))]),
          h('div', { className: 'lt-share-side' }, [h('h3', {}, text('02 / 分析与导入', '02 / Analyze and import')),
            h('label', { className: 'lt-dropzone', 'aria-disabled': shareBusy }, [h('strong', {}, shareBusy ? text('处理中…', 'Working…') : text('选择共享包，自动分析', 'Choose a pack to analyze')), h('span', {}, 'JSON · ≤ 36 MiB'), h('input', { type: 'file', className: 'lt-share-file', 'aria-label': text('选择共享包', 'Choose sharing pack'), accept: '.json,application/json', disabled: shareBusy, 'data-action': 'analyze-pack', onChange: analyzeShare })]),
            sharePlan ? h('div', { className: 'lt-import-plan' }, [
              h('p', {}, `${sharePlan.modes?.length ?? 0} ${text('个模式片段', 'mode entries')} · ${sharePlan.dependencies?.length ?? 0} ${text('个依赖', 'dependencies')}`),
              ...(sharePlan.modes ?? []).map((row) => h('div', { className: 'lt-mono', key: row.id }, `${row.name ?? row.id} · ${row.id}`)),
              ...(sharePlan.dependencies ?? []).map((dep) => h('div', { className: 'lt-dependency', key: dep.name }, [h('span', { className: 'lt-mono' }, `${dep.name}@${dep.version}`), h('span', { className: 'lt-badge' }, ({ installed: text('已就绪', 'Ready'), bundled: text('本地随包', 'Bundled'), download: text('需下载', 'Download'), host: text('宿主提供', 'Host provided'), 'version-conflict': text('版本冲突', 'Conflict') })[dep.status] ?? dep.status)])),
              ...(sharePlan.resources ?? []).map((resource) => h('div', { className: 'lt-dependency', key: `skill-${resource.name}` }, [h('span', { className: 'lt-mono' }, `${resource.name} · ${resource.files} ${text('个技能文件', 'skill files')}`), h('span', { className: 'lt-badge' }, ({ installed: text('已就绪', 'Ready'), bundled: text('技能随包', 'Bundled skill'), conflict: text('内容冲突', 'Content conflict') })[resource.status] ?? resource.status)])),
              ...(sharePlan.errors ?? []).map((error, i) => h('p', { className: 'lt-err', key: `error-${i}` }, error)),
              h('details', {}, [h('summary', {}, text('兼容性与安全提示', 'Compatibility and security')), ...(sharePlan.warnings ?? []).map((warning, i) => h('p', { key: i, className: 'lt-card-hint' }, warning))]),
              sharePlan.scope !== 'mode' ? h('p', { className: 'lt-card-hint' }, `${text('合并到当前模式', 'Merge into current mode')}: ${mode?.name ?? mode?.id ?? '—'}`) : null,
              (sharePlan.conflicts ?? []).length && sharePlan.scope === 'mode' ? h('label', {}, [text('同名模式处理', 'Mode ID conflicts'), h('select', { className: 'lt-input', value: shareConflict, onChange: (e) => setShareConflict(e.target.value) }, [['copy', text('保留两份（推荐）', 'Keep both (recommended)')], ['replace', text('替换现有模式', 'Replace existing')], ['skip', text('跳过同名模式', 'Skip conflicts')]].map(([value, label]) => h('option', { key: value, value }, label)))]) : null,
              pendingDeps.length ? h('label', { className: 'lt-consent' }, [h('input', { type: 'checkbox', checked: shareInstall, onChange: (e) => setShareInstall(e.target.checked) }), text('我信任来源，同意安装上述依赖与技能（不运行安装脚本）', 'I trust the source and approve installing these dependencies and skills (scripts disabled)')]) : null,
              h('button', { className: 'lt-btn lt-btn-primary', disabled: shareBusy || shareDone || !!sharePlan.errors?.length || (pendingDeps.length > 0 && !shareInstall) || (sharePlan.scope !== 'mode' && !mode), 'data-action': 'import-pack', onClick: importShare }, text('确认导入到草稿', 'Import into draft')),
            ]) : null,
          ]),
        ]),
        shareBusy ? h('p', { key: 'busy', className: 'lt-status', role: 'status', 'aria-live': 'polite' }, shareAction === 'import' ? text('正在校验、安装已确认的依赖与技能并合并草稿。安装最多等待 2 分钟，不运行安装脚本。', 'Validating, installing approved dependencies/skills and merging. Installation is limited to 2 minutes; scripts stay disabled.') : shareAction === 'export' ? text('正在收集依赖和本地文件，准备共享包…', 'Collecting dependencies and local files for export…') : text('正在读取共享包并分析兼容性与依赖…', 'Reading the pack and checking compatibility/dependencies…')) : null,
        shareError ? h('p', { key: 'error', className: 'lt-err', role: 'alert' }, shareError) : null,
        shareDone ? h('p', { key: 'done', className: 'lt-status', role: 'status' }, text('已合并到草稿，请检查后点击保存；新插件需重启宿主。', 'Merged into draft. Review and save; restart the host for new plugins.')) : null,
      ])

      // The skills tab exists even with no mode loaded: it reports workspace
      // facts the mode editor does not own.
      const TABS = panes === null ? [] : [
        ...(mode === null ? [] : [
        { id: 'capabilities', label: text('能力与审计', 'Capabilities'), hint: text('独立授权、来源追踪与执行决策。', 'Individual grants, sources and dispatch decisions.'), pane: capabilityPane },
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
          id: 'params', label: t('page.tabParams'), hint: t('page.tabParamsHint'),
          count: tunable.length === 0 ? undefined : tunable.length, pane: panes.params,
        },
        {
          id: 'plugins', label: t('page.tabPlugins'), hint: t('page.tabPluginsHint'),
          // Packages, not mount strings: a mode that mounts three subpath rows of
          // one package must read "1", matching the checked box.
          count: plugins.filter((plugin) => mountedPackages.has(plugin.name)).length, pane: panes.plugins,
        },
        ]),
        {
          id: 'skills', label: t('page.tabSkills'), hint: t('page.tabSkillsHint'),
          count: skills === null ? undefined : skills.length, pane: panes.skills,
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
              // Which mode a new task starts on is a registry setting, not a
              // property of this mode list, so it gets its own button and its
              // own one-line report instead of riding along with Save.
              isDefaultMode
                ? h('span', { key: 'def', className: 'lt-badge', 'data-tone': 'on' },
                    t('page.defaultCurrent'))
                : h('button', {
                    key: 'setdef', type: 'button', className: 'lt-btn',
                    onClick: setAsDefault, disabled: defaultState === 'saving',
                  }, defaultState === 'saving' ? t('page.defaultSaving') : t('page.setDefault')),
              // Only a package-owned mode that actually carries overrides can be
              // reset; a plain operator mode has nothing to fall back to.
              templateInfo?.enabled === true && (templateInfo.overridden ?? []).includes(mode.id)
                ? h('button', {
                    key: 'tmpl', type: 'button', className: 'lt-btn',
                    onClick: resetTemplate, disabled: templateBusy,
                  }, t('page.templateReset'))
                : null,
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
            defaultState === 'saved'
              ? h('p', { key: 'defok', className: 'lt-status', 'data-kind': 'ok' },
                  t('page.defaultSaved').replace('{name}', defaultSavedName))
              : null,
            defaultState === 'failed'
              ? h('p', { key: 'defbad', className: 'lt-status', 'data-kind': 'error' },
                  defaultError === '' ? t('page.defaultFailed') : `${t('page.defaultFailed')}: ${defaultError}`)
              : null,
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
            // A profile that stored whole modes at install time keeps that copy
            // forever: the profile patch replaces the package row's config, so no
            // later npm update reaches it. Say so, and offer the one-way
            // conversion that turns the list into per-field diffs.
            templateInfo?.legacy === true
              ? h('div', { key: 'tmpl-legacy', className: 'lt-stale' }, [
                  h('strong', { key: 'h' }, t('page.templateLegacyTitle')),
                  h('span', { key: 'b' }, t('page.templateLegacyBody')),
                  h('button', {
                    key: 'go', type: 'button', className: 'lt-btn lt-btn-primary',
                    onClick: enableTemplates, disabled: templateBusy,
                  }, templateBusy ? t('page.templateEnabling') : t('page.templateEnable')),
                ])
              : null,
            templateInfo?.conflicts?.[mode.id]?.length > 0
              ? h('div', { key: 'tmpl-conflict', className: 'lt-stale', 'data-tone': 'warn' }, [
                  h('strong', { key: 'h' }, t('page.templateConflictTitle')),
                  h('span', { key: 'b' }, t('page.templateConflictBody')
                    .replace('{fields}', templateInfo.conflicts[mode.id].join(', '))),
                ])
              : null,
            templateError === ''
              ? null
              : h('p', { key: 'tmpl-err', className: 'lt-status', 'data-kind': 'error' },
                  `${t('page.templateFailed')}: ${templateError}`),

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

      return h('div', { className: 'lt-root', 'data-module': 'mode-management' }, [
        h('fieldset', { key: 'rail-lock', className: 'lt-mode-lock', disabled: shareBusy, 'aria-label': text('模式列表', 'Modes') }, rail),
        h('div', { key: 'main', className: 'lt-main' }, [
          h('div', { key: 'mode-toolbar', className: 'lt-mode-toolbar' }, [
            h('fieldset', { className: 'lt-mode-lock', disabled: shareBusy }, viewTabs),
            h('button', { type: 'button', className: 'lt-btn', 'data-action': 'sharing', disabled: shareBusy, onClick: () => setShareOpen((open) => !open) }, text('导入 / 导出', 'Import / Export')),
          ]),
          status === 'failed' && draft === null ? h('div', { key: 'load-error', className: 'lt-share-wrap', role: 'alert' }, [
            h('p', { className: 'lt-err' }, loadError),
            h('button', { type: 'button', className: 'lt-btn', 'data-action': 'retry-roster', onClick: () => { setStatus(null); load() } }, text('重试读取', 'Retry loading')),
          ]) : null,
          h('div', { key: 'sharing', className: 'lt-share-wrap' }, sharePanel),
          h('fieldset', { key: 'editor-lock', className: 'lt-mode-lock', disabled: shareBusy, 'aria-label': text('模式配置', 'Mode configuration') }, [
            detail,
          ]),
        ]),
      ])
    }

    /**
     * 工具管理 → 扩展管理.
     *
     * A sub-tab strip inside the tools module, because that is where the user
     * asked for it: 工具管理 groups everything that is neither a mode nor a
     * conversation, and an extension of THIS plugin belongs there rather than in
     * 模式管理 (which edits presets) or the plugins tab (which mounts packages).
     *
     * The card is data-driven off `/api/agent-modes/extensions`, so a second
     * extension is a registry entry, not a second pane. Its facts are read back
     * from the same payload that flips the switch, which is why the state after a
     * press is always something the host said rather than something assumed.
     */
    function useToolsManagementView({ t }) {
      const [sub, setSub] = useState('extensions')
      const [data, setData] = useState(null)
      const [failed, setFailed] = useState('')
      const [busy, setBusy] = useState('')
      const text = t('page.extOn') === DICT_ZH['page.extOn']
        ? (zh, en) => zh
        : (zh, en) => en

      const load = useCallback(async (toggle) => {
        try {
          const payload = await post('/api/agent-modes/extensions', toggle === undefined ? {} : toggle)
          if (payload?.ok !== true) throw new Error(payload?.error ?? 'extension route failed')
          setData(payload.value)
          setFailed('')
          return payload.value
        } catch (error) {
          setFailed(error instanceof Error ? error.message : String(error))
          return null
        }
      }, [])

      useEffect(() => { load() }, [load])

      const flip = async (id, enabled) => {
        setBusy(id)
        await load({ toggle: id, enabled })
        setBusy('')
      }

      const rows = Array.isArray(data?.extensions) ? data.extensions : []
      const ledger = data?.ledger
      const connector = data?.connector

      const subTabs = h('div', {
        key: 'subtabs', className: 'lt-viewtabs', role: 'tablist',
        'aria-label': text('工具管理分组', 'Tool management sections'),
      }, [
        h('button', {
          key: 'extensions', type: 'button', role: 'tab', className: 'lt-viewtab',
          'data-subtab': 'extensions',
          'data-active': sub === 'extensions' ? 'true' : 'false',
          'aria-selected': sub === 'extensions' ? 'true' : 'false',
          onClick: () => setSub('extensions'),
        }, t('page.extTab')),
      ])

      const cards = rows.length === 0
        ? h('div', { key: 'empty', className: 'lt-empty' }, t('page.extEmpty'))
        : h('div', { key: 'cards', className: 'lt-ext-list' }, rows.map((row) => {
          const on = row.enabled === true
          const label = text(row.nameZh, row.nameEn)
          const desc = text(row.descZh, row.descEn)
          const features = text(row.featuresZh?.join('\u0000') ?? '', row.featuresEn?.join('\u0000') ?? '').split('\u0000').filter(Boolean)
          return h('div', {
            key: row.id, className: 'lt-ext-card', 'data-extension': row.id,
            'data-enabled': on ? 'true' : 'false',
          }, [
            h('div', { key: 'head', className: 'lt-ext-head' }, [
              h('span', { key: 'n', className: 'lt-ext-name' }, label),
              h('span', { key: 'v', className: 'lt-mono lt-ext-ver' }, `v${row.version}`),
              h('span', {
                key: 's', className: 'lt-badge',
                'data-tone': on ? 'on' : 'off',
                'data-state': on ? 'on' : 'off',
              }, on ? t('page.extOn') : t('page.extOff')),
              h('span', { key: 'sp', className: 'lt-spacer' }),
              h('button', {
                key: 't', type: 'button', className: 'lt-btn',
                'data-action': 'toggle-extension', 'data-extension': row.id,
                disabled: busy === row.id,
                onClick: () => flip(row.id, !on),
              }, busy === row.id ? t('page.extSaving') : on ? t('page.extDisable') : t('page.extEnable')),
            ]),
            h('p', { key: 'd', className: 'lt-ext-desc' }, desc),
            h('ul', { key: 'f', className: 'lt-ext-features' }, features.map((line, index) =>
              h('li', { key: String(index) }, line))),
            row.id === 'conversation-spend'
              ? h('div', { key: 'facts', className: 'lt-ext-facts' }, [
                  h('div', { key: 'l', className: 'lt-kv' }, [
                    h('span', { key: 'k', className: 'lt-kv-k' }, t('page.extLedger')),
                    h('span', { key: 'v', className: 'lt-kv-v' }, ledger === undefined || ledger.exists !== true
                      ? t('page.extLedgerMissing')
                      : t('page.extLedgerSessions').replace('{n}', String(ledger.total ?? 0))),
                  ]),
                  ledger === undefined
                    ? null
                    : h('div', { key: 'lp', className: 'lt-kv' }, [
                        h('span', { key: 'k', className: 'lt-kv-k' }, t('page.extLedgerPath')),
                        h('span', { key: 'v', className: 'lt-mono lt-ext-path' }, ledger.path ?? ''),
                      ]),
                  h('div', { key: 'p', className: 'lt-kv' }, [
                    h('span', { key: 'k', className: 'lt-kv-k' }, t('page.extPrice')),
                    h('span', { key: 'v', className: 'lt-kv-v' }, String(data?.priceVersion ?? '—')),
                  ]),
                  h('div', { key: 'c', className: 'lt-kv' }, [
                    h('span', { key: 'k', className: 'lt-kv-k' }, t('page.extConnector')),
                    h('span', {
                      key: 'v', className: 'lt-kv-v',
                      'data-tone': connector?.mounted === true ? 'on' : 'off',
                    }, connector?.mounted === true
                      ? t('page.extConnectorOn').replace('{base}', String(connector.base ?? ''))
                      : t('page.extConnectorOff')),
                  ]),
                ])
              : null,
          ])
        }))

      return h('div', { className: 'lt-tools-module', 'data-module': 'tools-management' }, [
        h('div', { key: 'toolbar', className: 'lt-mode-toolbar' }, [
          h('div', { key: 'tabs', className: 'lt-viewtabs-wrap' }, subTabs),
          h('span', { key: 'sp', className: 'lt-spacer' }),
          h('button', {
            key: 'reload', type: 'button', className: 'lt-btn',
            onClick: () => load(),
          }, text('刷新', 'Refresh')),
        ]),
        h('div', { key: 'body', className: 'lt-tools-body' }, [
          h('h2', { key: 'h', className: 'lt-card-title' }, t('page.extTitle')),
          h('p', { key: 'hint', className: 'lt-lead' }, t('page.extTabHint')),
          data?.stateBroken === true
            ? h('p', { key: 'broken', className: 'lt-status', 'data-kind': 'warn' }, t('page.extBroken'))
            : null,
          failed === ''
            ? null
            : h('p', { key: 'err', className: 'lt-status', 'data-kind': 'error', role: 'alert' },
                `${t('page.extFailed')}: ${failed}`),
          cards,
        ]),
      ])
    }

    /**
     * 对话消耗展示 — the in-conversation readout.
     *
     * WHY IT ASKS THIS PLUGIN'S OWN ROUTE RATHER THAN THE CONNECTOR'S. The
     * connector's `session-credits` route answers from a `Map` in its process, so
     * after a restart it reports nothing for an old session and the readout
     * disappears — the reported bug. This plugin's route folds the DURABLE session
     * log for tokens/money and merges the connector's answer into its own file for
     * credits, so the same conversation keeps its number across a restart, a
     * session switch and a host upgrade.
     *
     * WHERE IT RENDERS. `conversation.composer.dock` is a list seat next to the
     * host's own round/token pills, and it is session-scoped, so the id it injects
     * is the conversation this number is about. `composer` would be the other
     * legal seat but the connector already occupies it; reading the same total
     * twice in one row would be worse than not showing it.
     *
     * WHAT IT SHOWS. Credits when the upstream billed in credits (WorkBuddy), yuan
     * when it billed in money (the official channel). A figure it did not measure
     * is absent rather than zero, and the yuan figure carries "≈" because the
     * price table is published-rate arithmetic, not the invoice.
     */
    const SPEND_REFRESH_MS = 15_000

    /** Credits: at most two decimals, no trailing `.0`. */
    function formatCredits(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const rounded = Math.round(value * 100) / 100
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')
    }

    /** Money: small amounts keep enough decimals to stay non-zero. */
    function formatCny(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value === 0) return '0.00'
      if (value < 0.01) return value.toFixed(4)
      if (value < 1) return value.toFixed(3)
      return value.toFixed(2)
    }

    function ConversationSpend(props) {
      const { t, sessionId, onOpenPanel } = props
      const [spend, setSpend] = useState(null)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        let cancelled = false
        let timer
        const controller = new AbortController()
        const read = async () => {
          try {
            const response = await fetch('/api/agent-modes/spend', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId }),
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (cancelled || controller.signal.aborted) return
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'spend route failed')
            if (payload.value?.disabled === true) {
              setSpend(null)
              setFailed(false)
              return
            }
            setSpend(payload.value?.spend ?? null)
            setFailed(false)
          } catch {
            if (!cancelled && !controller.signal.aborted) setFailed(true)
          }
        }
        read().finally(() => {
          if (cancelled) return
          timer = window.setInterval(read, SPEND_REFRESH_MS)
        })
        return () => {
          cancelled = true
          if (timer !== undefined) window.clearInterval(timer)
          controller.abort()
        }
      }, [sessionId])

      if (failed && spend === null) return null
      if (spend === null) return null

      const hasCredit = typeof spend.credit === 'number'
      const hasCny = typeof spend.cny === 'number' && spend.cny > 0
      if (!hasCredit && !hasCny) {
        return h('span', {
          className: 'lt-spend', 'data-empty': 'true',
          title: t('page.spendNone'),
        }, t('page.spendTitle'), ' · —')
      }

      const parts = []
      parts.push(h('span', { key: 'l', className: 'lt-spend-label' }, t('page.spendTitle')))
      parts.push(' · ')
      if (hasCredit) {
        parts.push(h('strong', { key: 'c', className: 'lt-spend-value' }, formatCredits(spend.credit)))
        parts.push(' ')
        parts.push(h('span', { key: 'cu', className: 'lt-spend-unit' }, t('page.spendCredit')))
      }
      if (hasCny) {
        if (hasCredit) parts.push(' · ')
        parts.push(h('strong', { key: 'y', className: 'lt-spend-value' }, `≈${formatCny(spend.cny)}`))
        parts.push(' ')
        parts.push(h('span', { key: 'yu', className: 'lt-spend-unit' }, t('page.spendCny')))
      }

      const title = [
        hasCredit ? `${t('page.spendCredit')} ${formatCredits(spend.credit)}（${t('page.spendRestarted')}）` : '',
        hasCny ? `${t('page.spendCny')} ≈${formatCny(spend.cny)} · ${t('page.spendApprox')} ${spend.priceVersion}` : '',
        t('page.spendRequests').replace('{n}', String(spend.requests ?? 0)),
      ].filter(Boolean).join('\n')

      return h('button', {
        type: 'button',
        className: 'lt-spend',
        title,
        'data-spend': 'session',
        onClick: () => { if (typeof onOpenPanel === 'function') onOpenPanel() },
      }, parts)
    }

    function ControlCenterPage({ t, backToConversation }) {
      const [module, setModule] = useState('modes')
      // Keep the mode hook mounted so a module switch never discards an unsaved
      // draft. All mode UI, including the rail, lives inside its own tabpanel.
      const modes = useModeManagementView({ t, isModuleActive: module === 'modes' })
      const tools = useToolsManagementView({ t })
      const selectWithKeyboard = (event) => {
        let next
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = module === 'modes' ? 'tools' : 'modes'
        else if (event.key === 'Home') next = 'modes'
        else if (event.key === 'End') next = 'tools'
        else return
        event.preventDefault()
        setModule(next)
        event.currentTarget.parentElement?.querySelector(`[data-module-tab="${next}"]`)?.focus()
      }
      return h('section', { className: 'lt-control-center' }, [
        h('header', { key: 'header', className: 'lt-control-header' }, [
          h('span', { className: 'lt-control-brand' }, 'LEITING'),
          h('div', { className: 'lt-module-tabs', role: 'tablist', 'aria-label': t('page.managementModules') }, [
            ['modes', t('page.moduleModes')], ['tools', t('page.moduleTools')],
          ].map(([id, label]) => h('button', {
            key: id, id: `lt-module-tab-${id}`, type: 'button', role: 'tab', className: 'lt-module-tab',
            'data-module-tab': id, 'aria-selected': module === id, 'aria-controls': `lt-module-panel-${id}`,
            tabIndex: module === id ? 0 : -1, onClick: () => setModule(id), onKeyDown: selectWithKeyboard,
          }, label))),
          h('span', { className: 'lt-spacer' }),
          typeof backToConversation === 'function' ? h('button', { type: 'button', className: 'lt-btn', onClick: backToConversation }, t('page.back')) : null,
        ]),
        h('section', { key: 'modes', id: 'lt-module-panel-modes', className: 'lt-module-panel', role: 'tabpanel',
          'data-module-panel': 'modes', 'aria-labelledby': 'lt-module-tab-modes', hidden: module !== 'modes',
        }, modes),
        h('section', { key: 'tools', id: 'lt-module-panel-tools', className: 'lt-module-panel', role: 'tabpanel',
          'data-module-panel': 'tools', 'aria-labelledby': 'lt-module-tab-tools', hidden: module !== 'tools',
        }, tools),
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
          }, ControlCenterPage),
        )

        /**
         * 对话消耗展示, in the ambient dock below the composer card.
         *
         * Registered UNCONDITIONALLY and gated by the extension switch at read
         * time, for the reason the connector states for its own seats: a slot that
         * has to be re-registered when a setting changes is one live `id` away
         * from "already registered" and silently vanishing. The switch is checked
         * on the host, so turning it off costs one wasted local request and zero
         * pixels.
         *
         * `order` 12 keeps it right of the shell's own pills (0) and of the
         * connector's readout (10-11), so the numbers a user already reads stay
         * where they were.
         */
        try {
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register({
              name: 'conversation.composer.dock',
              id: 'agent-modes-conversation-spend',
              order: 12,
              locale: NS,
              inject: (sessionId) => ({
                t,
                ...(sessionId === undefined ? {} : { sessionId }),
                onOpenPanel: backToConversation,
              }),
            }, ConversationSpend),
          )
        } catch (error) {
          console.error('[agent-modes] conversation spend slot failed to register:', error)
        }
      },
    }
  },
})
