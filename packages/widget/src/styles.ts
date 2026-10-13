import { shellStyles } from './shell';

export const styles = /* css */ `
${shellStyles}
/* Stacking inside the host: pins live on the page, chrome goes above them. */
.lb-masks, .lb-pins { z-index: 1; }
.lb-highlight, .lb-drag { z-index: 2; }
.lb-pickbar { z-index: 3; }
.lb-popover { z-index: 4; }
.lb-panel, .lb-pill { z-index: 5; position: relative; }
.lb-panel { position: absolute; }
.lb-pending { z-index: 5; }
.lb-toast { z-index: 6; }
.lb-panel {
  position: absolute; bottom: 0; right: 0; width: 380px; max-width: calc(100vw - 40px);
  max-height: min(80vh, 720px); display: flex; flex-direction: column;
  background: var(--lb-bg); border: 1px solid var(--lb-border); border-radius: var(--lb-radius);
  box-shadow: var(--lb-shadow); overflow: hidden;
}
:host([data-position="bottom-left"]) .lb-panel { right: auto; left: 0; }
header, footer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid var(--lb-border);
}
footer { border-bottom: 0; border-top: 1px solid var(--lb-border); justify-content: flex-start; }
header strong { font-size: 15px; }
.lb-body { padding: 12px 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--lb-muted); font-weight: 600; }
textarea, input[type=text] {
  font: inherit; color: var(--lb-fg); background: var(--lb-surface);
  border: 1px solid var(--lb-border); border-radius: 8px; padding: 8px 10px; width: 100%;
}
textarea { min-height: 84px; resize: vertical; }
textarea:focus, input:focus { outline: 2px solid var(--lb-accent); outline-offset: -1px; }
.lb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--lb-surface); color: var(--lb-fg); border: 1px solid var(--lb-border);
  border-radius: 8px; padding: 7px 10px; font-weight: 500;
}
.lb-btn:hover { border-color: var(--lb-accent); }
.lb-btn[disabled] { opacity: .5; cursor: default; }
.lb-primary { background: var(--lb-accent); color: var(--lb-accent-contrast); border-color: transparent; }
.lb-icon { background: transparent; border: 0; color: var(--lb-muted); font-size: 16px; padding: 2px 6px; border-radius: 6px; }
.lb-icon:hover { background: var(--lb-surface); color: var(--lb-fg); }
.lb-selections { display: flex; flex-direction: column; gap: 8px; }
.lb-sel {
  border: 1px solid var(--lb-border); border-radius: 10px; padding: 8px 10px; background: var(--lb-surface);
  display: flex; flex-direction: column; gap: 6px;
}
.lb-sel:hover { border-color: var(--lb-accent); }
.lb-sel-head { display: flex; align-items: center; gap: 8px; }
.lb-badge {
  display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 999px; background: var(--lb-accent); color: var(--lb-accent-contrast); font-size: 11px; font-weight: 700;
}
.lb-badge.region { border-radius: 5px; }
.lb-chain { flex: 1; font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-chain .sep { color: var(--lb-muted); font-weight: 400; margin: 0 4px; }
.lb-kind { font-size: 11px; color: var(--lb-muted); font-weight: 400; }
code.lb-selector, .lb-source { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--lb-muted); word-break: break-all; }
.lb-source { color: var(--lb-accent); }
.lb-text { font-size: 12px; color: var(--lb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-children { display: flex; flex-wrap: wrap; gap: 4px; }
.lb-chip { font-size: 11px; background: var(--lb-bg); border: 1px solid var(--lb-border); border-radius: 999px; padding: 1px 8px; color: var(--lb-muted); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-sel .lb-note { font-size: 13px; }
.lb-sel .lb-note.empty { color: var(--lb-muted); font-style: italic; }
.lb-shot { position: relative; border: 1px solid var(--lb-border); border-radius: 10px; overflow: hidden; }
.lb-shot img { display: block; width: 100%; max-height: 180px; object-fit: cover; object-position: top; }
.lb-shot .lb-icon { position: absolute; top: 6px; right: 6px; background: var(--lb-bg); }
details.lb-review { border: 1px solid var(--lb-border); border-radius: 10px; padding: 8px 10px; }
details.lb-review summary { cursor: pointer; font-weight: 600; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
.lb-counts { color: var(--lb-muted); font-weight: 400; font-size: 12px; }
.lb-tabs { display: flex; gap: 6px; margin: 8px 0; }
.lb-tabs button { background: transparent; border: 1px solid var(--lb-border); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--lb-muted); }
.lb-tabs button.active { border-color: var(--lb-accent); color: var(--lb-accent); font-weight: 600; }
pre.lb-preview {
  margin: 0; max-height: 220px; overflow: auto; background: var(--lb-surface); border-radius: 8px; padding: 8px;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word;
}
.lb-status { font-size: 12px; color: var(--lb-muted); }
.lb-status.error { color: var(--lb-danger); }

/* ---- pick mode ---- */
.lb-pickbar {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  background: var(--lb-fg); color: var(--lb-bg); padding: 6px 8px 6px 14px; border-radius: 999px;
  font-size: 13px; font-weight: 600; box-shadow: var(--lb-shadow); white-space: nowrap;
}
.lb-pickbar .lb-pick-hint { opacity: .85; font-weight: 500; }
.lb-pickbar .lb-count { background: var(--lb-accent); color: var(--lb-accent-contrast); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.lb-pick-btn { background: transparent; color: var(--lb-bg); border: 1px solid color-mix(in srgb, var(--lb-bg) 35%, transparent); border-radius: 999px; padding: 5px 12px; font-weight: 600; }
.lb-pick-btn:hover { background: color-mix(in srgb, var(--lb-bg) 15%, transparent); }
.lb-pick-btn.lb-pick-done { background: var(--lb-bg); color: var(--lb-fg); border-color: transparent; }
.lb-highlight {
  position: fixed; top: 0; left: 0; pointer-events: none;
  outline: 2px solid var(--lb-accent); outline-offset: 1px;
  background: color-mix(in srgb, var(--lb-accent) 12%, transparent);
  border-radius: 3px;
}
.lb-tip {
  position: absolute; left: 0; bottom: 100%; margin-bottom: 6px; white-space: nowrap;
  background: var(--lb-accent); color: var(--lb-accent-contrast); padding: 3px 8px; border-radius: 6px;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
}
.lb-tip.below { bottom: auto; top: 100%; margin: 6px 0 0; }
.lb-drag {
  position: fixed; top: 0; left: 0; pointer-events: none;
  border: 2px dashed var(--lb-accent); background: color-mix(in srgb, var(--lb-accent) 8%, transparent); border-radius: 3px;
}

/* ---- pins and popover (live on the page while a draft exists) ---- */
.lb-masks, .lb-pins { position: fixed; top: 0; left: 0; width: 0; height: 0; }
.lb-mask {
  position: fixed; pointer-events: none; display: flex; align-items: center; justify-content: center; overflow: hidden;
  background: repeating-linear-gradient(135deg, rgba(17,24,39,.82) 0 8px, rgba(17,24,39,.68) 8px 16px);
  color: #fff; font-size: 12px; font-weight: 600; border-radius: 4px;
}
.lb-highlight.mask { outline-color: #111827; background: rgba(17,24,39,.25); }
.lb-pick-btn[aria-pressed=true] { background: var(--lb-bg); color: var(--lb-fg); border-color: transparent; }
.lb-sensitive { font-size: 12px; color: var(--lb-muted); }
.lb-pin {
  position: fixed; pointer-events: auto; cursor: pointer;
  outline: 2px solid var(--lb-accent); outline-offset: 1px; border-radius: 3px;
  background: color-mix(in srgb, var(--lb-accent) 6%, transparent);
}
.lb-pin.region { outline-style: dashed; }
.lb-pins.passive .lb-pin { pointer-events: none !important; }
.lb-pin.active, .lb-pin:hover { background: color-mix(in srgb, var(--lb-accent) 14%, transparent); }
.lb-pin .lb-badge { position: absolute; top: -10px; left: -10px; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
.lb-pin-x {
  position: absolute; top: -10px; right: -10px; width: 20px; height: 20px; border-radius: 999px; border: 0;
  background: var(--lb-fg); color: var(--lb-bg); font-size: 11px; line-height: 20px; padding: 0; text-align: center;
  box-shadow: 0 2px 6px rgba(0,0,0,.25); opacity: 0; transition: opacity .12s;
}
.lb-pin:hover .lb-pin-x, .lb-pin.active .lb-pin-x { opacity: 1; }
.lb-pin-x:hover { background: var(--lb-danger); color: #fff; }
.lb-popover {
  position: fixed; width: 300px; max-width: calc(100vw - 24px);
  background: var(--lb-bg); color: var(--lb-fg); border: 1px solid var(--lb-border); border-radius: 10px;
  box-shadow: var(--lb-shadow); padding: 10px; display: flex; flex-direction: column; gap: 8px;
}
.lb-popover .lb-pop-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--lb-muted); }
.lb-popover .lb-pop-head strong { color: var(--lb-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.lb-popover textarea { min-height: 56px; }
.lb-popover .lb-pop-actions { display: flex; align-items: center; gap: 6px; }
.lb-grow { flex: 1; }
.lb-link { background: transparent; border: 0; color: var(--lb-muted); padding: 4px 6px; border-radius: 6px; font-size: 12px; }
.lb-link:hover { background: var(--lb-surface); }
.lb-link.danger:hover { color: var(--lb-danger); }
.lb-hint { font-size: 11px; color: var(--lb-muted); }
.lb-pending {
  position: absolute; bottom: 0; right: 0; width: 340px; max-width: calc(100vw - 40px);
  background: var(--lb-bg); color: var(--lb-fg); border: 1px solid var(--lb-border); border-radius: var(--lb-radius);
  box-shadow: var(--lb-shadow); padding: 12px 14px 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden;
}
:host([data-position="bottom-left"]) .lb-pending { right: auto; left: 0; }
.lb-pending-row { display: flex; align-items: center; gap: 6px; }
.lb-pending-summary { font-size: 12px; color: var(--lb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-bottom: 10px; }
.lb-pending-bar { height: 3px; background: var(--lb-surface); margin: 0 -14px; }
.lb-pending-bar i { display: block; height: 100%; background: var(--lb-accent); width: 100%; }
.lb-thumb { display: block; width: 100%; max-height: 120px; object-fit: contain; object-position: left; border: 1px solid var(--lb-border); border-radius: 8px; background: var(--lb-bg); }
.lb-toast {
  position: absolute; bottom: 0; right: 0; background: var(--lb-fg); color: var(--lb-bg);
  padding: 10px 14px; border-radius: 10px; font-weight: 600; box-shadow: var(--lb-shadow); white-space: nowrap;
}
`;
