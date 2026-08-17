export const TIM_WORKBENCH_STYLES = `
:host {
  display: block;
  min-height: 0;
  color: var(--tim-workbench-text, #d8e0ea);
  font: 13px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
}
* { box-sizing: border-box; }
.shell {
  --tim-breath-brightness: clamp(.985, var(--data-breath-brightness, 1), 1.015);
  --tim-breath-shift-y: var(--data-breath-shift-y, 0px);
  --tim-breath-scale: clamp(.998, var(--v31-panel-scale, 1), 1.002);
  position: relative; isolation: isolate;
  height: 100%; min-height: 420px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden; border-top: 1px solid rgba(var(--theme-highlight-rgb, 255,255,255), .12);
  background: transparent;
  filter: brightness(var(--tim-breath-brightness));
  transform: translateY(clamp(-2px, var(--tim-breath-shift-y), 2px)) scale(var(--tim-breath-scale));
  transform-origin: 50% 100%;
  box-shadow: inset 0 1px rgba(255,255,255,.025), 0 -8px 28px rgba(70, 94, 116, .035);
  transition: filter 500ms ease, transform 600ms ease, box-shadow 600ms ease;
}
.shell::before {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: linear-gradient(145deg,
    rgba(var(--theme-panel-rgb, 16,23,19), var(--tim-workbench-surface-opacity, 0)),
    rgba(var(--theme-panel2-rgb, 8,13,11), var(--tim-workbench-surface-opacity-2, 0)));
  filter: brightness(var(--tim-workbench-surface-brightness, 1));
}
.shell > * { position: relative; z-index: 1; }
:host-context(html[data-breath-phase]) .shell { box-shadow: inset 0 1px rgba(255,255,255,.035), 0 -10px 32px rgba(79, 106, 132, .055); }
:host-context(html[data-breath-mode="off"]) .shell { filter: none; transform: none; box-shadow: inset 0 1px rgba(255,255,255,.025); transition: none; }
.head { min-height: 50px; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 9px 14px; border-bottom: 1px solid rgba(var(--theme-highlight-rgb,255,255,255),.08); }
.title-line { min-width: 0; display: flex; align-items: center; gap: 8px; }
.title, .state-badge, .head-action { font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1.35; }
.title { min-width: 0; color: #edf2f7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.state-badge { flex: 0 0 auto; padding: 2px 6px; border: 1px solid rgba(148,163,184,.14); border-radius: 999px; color: #8f9eac; background: rgba(148,163,184,.05); }
.state-badge[data-state="running"] { color: #9fc5e5; border-color: rgba(103,169,220,.25); background: rgba(57,119,166,.12); }
.state-badge[data-state="needs_input"] { color: #e2c27c; border-color: rgba(218,166,59,.25); background: rgba(144,98,15,.12); }
.state-badge[data-state="ready"] { color: #9ed4b2; border-color: rgba(75,181,116,.24); background: rgba(36,129,72,.12); }
.state-badge[data-state="blocked"] { color: #d7a0a0; border-color: rgba(201,91,91,.24); background: rgba(133,48,48,.12); }
.state-badge[data-state="extras"] { color: #b8acd9; border-color: rgba(146,123,199,.24); background: rgba(89,68,139,.12); }
.head-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.head-action { min-height: 30px; padding: 4px 8px; border: 1px solid transparent; border-radius: 8px; color: #aebbc9; background: transparent; cursor: pointer; }
.head-action:hover, .head-action:focus-visible { color: var(--theme-highlight, #e8fff4); border-color: rgba(var(--theme-highlight-rgb,255,255,255),.12); background: rgba(var(--theme-highlight-rgb,255,255,255),.055); outline: none; }
.head-action:focus-visible { box-shadow: 0 0 0 2px rgba(var(--theme-accent-rgb,0,230,118),.18); }
.random-interactions-toggle { min-width: 52px; border-color: rgba(148,163,184,.13); color: #8795a3; background: rgba(148,163,184,.045); }
.random-interactions-toggle[data-enabled="true"] { color: #acd8bc; border-color: rgba(75,181,116,.28); background: rgba(36,129,72,.12); }
.random-interactions-toggle[data-enabled="false"] { color: #7f8b98; }
.head-clear { color: #8694a2; }
.head-clear:hover, .head-clear:focus-visible { color: #d2dbe4; }
.stage { position: relative; min-height: 0; display: grid; grid-template-rows: 132px minmax(72px,1fr); }
tim-assistant { align-self: end; width: 100%; height: 132px; overflow: visible; opacity: .96; }
button { font: inherit; }
.thread { min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.2) transparent; }
.thread::-webkit-scrollbar, textarea::-webkit-scrollbar { width: 6px; }
.thread::-webkit-scrollbar-track, textarea::-webkit-scrollbar-track { background: transparent; }
.thread::-webkit-scrollbar-thumb, textarea::-webkit-scrollbar-thumb { background: rgba(148,163,184,.18); border-radius: 999px; }
.thread::-webkit-scrollbar-thumb:hover, textarea::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.3); }
.message { max-width: 92%; padding: 7px 9px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-user { align-self: flex-end; color: #e1e8ef; background: rgba(75, 96, 117, .42); }
.message-assistant { align-self: flex-start; color: #c7d1db; background: rgba(25, 34, 44, .72); border: 1px solid rgba(148,163,184,.1); }
.message-error { align-self: stretch; max-width: none; color: #d6b8b8; background: rgba(94, 48, 48, .22); border: 1px solid rgba(190, 111, 111, .2); }
.empty { margin: auto 4px; color: #7e8b99; text-align: center; font-size: 12px; }
.composer { padding: 6px 12px 12px; border-top: 1px solid rgba(var(--theme-highlight-rgb,255,255,255),.08); background: rgba(var(--theme-panel2-rgb,8,13,11),.1); }
.composer-surface { min-height: 128px; display: flex; flex-direction: column; padding: 12px; border: 1px solid rgba(148,163,184,.17); border-radius: 22px; color: #e1e7ee; background: rgba(7,11,16,.68); box-shadow: inset 0 1px rgba(255,255,255,.025), 0 8px 22px rgba(0,0,0,.12); }
.composer-surface:focus-within { border-color: rgba(139,164,187,.4); box-shadow: 0 0 0 2px rgba(103,130,153,.08), 0 8px 22px rgba(0,0,0,.12); }
textarea { width: 100%; min-height: 70px; max-height: min(260px, 35vh); flex: 1 1 auto; resize: none; border: 0; padding: 0 2px 8px; color: #e1e7ee; background: transparent; font: inherit; line-height: 1.5; outline: none; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.2) transparent; }
textarea::placeholder { color: #758291; }
.composer-actions { display: flex; align-items: center; min-height: 34px; gap: 8px; }
.mode-toggle { min-height: 28px; padding: 4px 10px; border: 1px solid rgba(148,163,184,.18); border-radius: 999px; color: #a4b3c2; background: rgba(7,11,16,.45); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; transition: color 160ms ease, border-color 160ms ease, background 160ms ease; }
.mode-toggle:hover, .mode-toggle:focus-visible { color: var(--theme-highlight, #e8fff4); border-color: rgba(var(--theme-accent-rgb,0,230,118),.45); background: rgba(var(--theme-accent-rgb,0,230,118),.08); outline: none; }
.mode-toggle[data-provider="codex"] { color: #c5e8d4; border-color: rgba(75,181,116,.35); background: rgba(36,129,72,.12); }
.mode-toggle[data-provider="codex"]:hover, .mode-toggle[data-provider="codex"]:focus-visible { border-color: rgba(75,181,116,.55); background: rgba(36,129,72,.2); }
.composer-spacer { flex: 1 1 auto; }
.composer-submit, .composer-stop { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px; padding: 0; border-radius: 999px; cursor: pointer; }
.composer-submit { border: 0; color: #10151a; background: #edf2f7; line-height: 1; }
.composer-submit svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.composer-stop { border: 0; color: #10151a; background: #edf2f7; font-size: 11px; line-height: 1; }
.composer-submit:hover, .composer-submit:focus-visible, .composer-stop:hover, .composer-stop:focus-visible { background: #fff; outline: none; box-shadow: 0 0 0 3px rgba(237,242,247,.12); }
.composer button[hidden] { display: none; }
.composer button:disabled, textarea:disabled { cursor: not-allowed; opacity: .52; }
.status { min-height: 22px; display: flex; align-items: center; gap: 8px; padding: 0 4px 5px; color: #8795a3; font-size: 11px; overflow-wrap: anywhere; }
.retry { flex: 0 0 auto; min-height: 24px; padding: 2px 8px; border: 1px solid rgba(148,163,184,.16); border-radius: 7px; color: #bac7d3; background: rgba(148,163,184,.07); cursor: pointer; }
.retry[hidden] { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (prefers-reduced-motion: reduce) {
  .shell { filter: none; transform: none; box-shadow: inset 0 1px rgba(255,255,255,.025); transition: none; }
}
`;
