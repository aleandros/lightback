import { IGNORE_ATTR } from '@lightback/core';
import type { WidgetOptions } from './types';

export const shellStyles = /* css */ `
:host {
  --lb-accent: #4f46e5;
  --lb-accent-contrast: #fff;
  --lb-bg: #ffffff;
  --lb-fg: #111827;
  --lb-muted: #6b7280;
  --lb-border: #e5e7eb;
  --lb-surface: #f9fafb;
  --lb-danger: #dc2626;
  --lb-radius: 12px;
  --lb-shadow: 0 10px 30px rgba(0,0,0,.18);
  all: initial;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--lb-fg);
  position: fixed;
  z-index: 2147483000;
  bottom: 20px;
  right: 20px;
}
:host([data-position="bottom-left"]) { right: auto; left: 20px; }
:host([data-theme="dark"]) {
  --lb-bg: #111827; --lb-fg: #f3f4f6; --lb-muted: #9ca3af; --lb-border: #374151; --lb-surface: #1f2937;
}
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --lb-bg: #111827; --lb-fg: #f3f4f6; --lb-muted: #9ca3af; --lb-border: #374151; --lb-surface: #1f2937;
  }
}
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
[hidden] { display: none !important; }
.lb-panel, .lb-pill {
  display: inline-flex; align-items: stretch; background: var(--lb-bg); color: var(--lb-fg);
  border: 1px solid var(--lb-border); border-radius: 999px; box-shadow: var(--lb-shadow); overflow: hidden; padding: 3px;
}
.lb-pill-btn { background: transparent; border: 0; color: var(--lb-fg); padding: 8px 14px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
.lb-pill-btn:hover { background: var(--lb-surface); }
.lb-pill-btn[data-ref=pillOpen] { background: var(--lb-accent); color: var(--lb-accent-contrast); }
.lb-pill-btn[data-ref=pillOpen]:hover { filter: brightness(1.08); }
.lb-pill-sep { width: 1px; background: var(--lb-border); margin: 6px 3px; }
`;

export function createHost(opts: WidgetOptions): HTMLElement {
  const host = document.createElement('lightback-widget');
  host.setAttribute(IGNORE_ATTR, '');
  host.dataset.theme = opts.theme ?? 'auto';
  host.dataset.position = opts.position ?? 'bottom-right';
  if (opts.accent) host.style.setProperty('--lb-accent', opts.accent);
  host.attachShadow({ mode: 'open' });
  return host;
}
