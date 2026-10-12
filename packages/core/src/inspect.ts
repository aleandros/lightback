import type { ComponentInfo, ElementSelection, ElementSummary, Rect, SourceLocation } from './types';
import { uid } from './format';

const MAX_COMPONENTS = 12;
const MAX_TEXT = 200;
const MAX_HTML = 600;
const PROPS_DEPTH = 2;
const PROPS_KEYS = 40;
const PROPS_STRING = 200;

export function viewportRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export function toDocRect(rect: Rect): Rect {
  const sx = typeof window !== 'undefined' ? Math.round(window.scrollX) : 0;
  const sy = typeof window !== 'undefined' ? Math.round(window.scrollY) : 0;
  return { ...rect, x: rect.x + sx, y: rect.y + sy };
}

/** Describe a DOM element with enough context for a human or a model to locate it. */
export function describeElement(el: Element): ElementSelection {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Lightback: describeElement requires a browser DOM');
  const rect = viewportRect(el);
  const fw = frameworkInfo(el);
  return {
    id: uid(),
    kind: 'element',
    selector: uniqueSelector(el),
    tag: el.tagName.toLowerCase(),
    elementId: el.id || undefined,
    classes: Array.from(el.classList),
    text: elementText(el),
    attrs: interestingAttrs(el),
    rect,
    docRect: toDocRect(rect),
    framework: fw.framework,
    components: fw.chain.map((c) => c.name),
    chain: fw.chain,
    source: fw.source,
    props: fw.props,
    html: trimmedHtml(el),
  };
}

/** Lighter description used for the children of a region. */
export function summarizeElement(el: Element): ElementSummary {
  const rect = viewportRect(el);
  const fw = frameworkInfo(el);
  const role = el.getAttribute('role') ?? undefined;
  return {
    selector: uniqueSelector(el),
    tag: el.tagName.toLowerCase(),
    text: elementText(el, 80),
    role,
    components: fw.chain.slice(0, 4).map((c) => c.name),
    rect,
    docRect: toDocRect(rect),
    source: fw.source,
  };
}

function elementText(el: Element, max = MAX_TEXT): string {
  const input = el as HTMLInputElement;
  // Never read values out of form controls.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return (input.placeholder || input.getAttribute('aria-label') || '').slice(0, max);
  }
  return (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function interestingAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const n = attr.name;
    if (n === 'class' || n === 'id' || n === 'style' || n === 'value') continue;
    if (n.startsWith('data-') || n.startsWith('aria-') || ['role', 'name', 'type', 'href', 'alt', 'title', 'placeholder', 'for'].includes(n)) {
      out[n] = attr.value.slice(0, 120);
    }
  }
  return out;
}

function trimmedHtml(el: Element): string {
  const clone = el.cloneNode(false) as Element;
  clone.removeAttribute('value');
  const open = clone.outerHTML.replace(/<\/[^>]+>$/, '');
  const inner = el.innerHTML.replace(/\s+/g, ' ').trim();
  return `${open}${inner.slice(0, MAX_HTML)}${inner.length > MAX_HTML ? '…' : ''}</${el.tagName.toLowerCase()}>`;
}

/** Short, human-readable locator used in breadcrumbs: `button#save.primary` or `a[data-testid=nav]`. */
export function shortSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute('data-testid');
  if (testId) return `${tag}[data-testid=${testId}]`;
  if (el.id) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).slice(0, 2).join('.');
  return cls ? `${tag}.${cls}` : tag;
}

/** Build a selector that uniquely matches `el` in its document, preferring stable attributes. */
export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  const isUnique = (sel: string) => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const testId = el.getAttribute('data-testid');
  if (testId) {
    const s = `[data-testid="${cssEscape(testId)}"]`;
    if (isUnique(s)) return s;
  }
  if (el.id) {
    const s = `#${cssEscape(el.id)}`;
    if (isUnique(s)) return s;
  }

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    const anchorTestId = cur.getAttribute('data-testid');
    if (anchorTestId) {
      parts.unshift(`[data-testid="${cssEscape(anchorTestId)}"]`);
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    cur = parent;
  }
  return parts.join(' > ');
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/([^\w-])/g, '\\$1');
}

/* ------------------------------------------------------------------ */
/* Framework internals                                                 */
/* ------------------------------------------------------------------ */

export interface FrameworkInfo {
  framework: 'react' | 'vue' | null;
  chain: ComponentInfo[];
  source?: SourceLocation;
  props?: Record<string, unknown>;
}

/** Walk framework internals to find the component tree above an element, plus source and props when exposed. */
export function frameworkInfo(el: Element): FrameworkInfo {
  const stamped = parseSourceAttr(el.getAttribute('data-source') ?? el.getAttribute('data-lb-source'));
  const react = reactInfo(el);
  if (react.chain.length || react.source) return { framework: 'react', ...react, source: react.source ?? stamped };
  const vue = vueInfo(el);
  if (vue.chain.length) return { framework: 'vue', ...vue, source: vue.source ?? stamped };
  return { framework: null, chain: [], source: stamped };
}

/** Backwards-compatible helper: just the names. */
export function componentChain(el: Element): { framework: 'react' | 'vue' | null; components: string[] } {
  const info = frameworkInfo(el);
  return { framework: info.framework, components: info.chain.map((c) => c.name) };
}

/** `data-source="src/App.tsx:12:5"` as stamped by a build plugin. */
function parseSourceAttr(value: string | null): SourceLocation | undefined {
  if (!value) return undefined;
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(value);
  if (!m || !m[1]) return undefined;
  return { file: m[1], line: m[2] ? Number(m[2]) : undefined, column: m[3] ? Number(m[3]) : undefined };
}

interface Fiber {
  type: unknown;
  return: Fiber | null;
  memoizedProps?: unknown;
  _debugSource?: { fileName: string; lineNumber?: number; columnNumber?: number } | null;
  _debugStack?: Error | null;
}

function fiberSource(fiber: Fiber): SourceLocation | undefined {
  const s = fiber._debugSource;
  if (s?.fileName) return { file: s.fileName, line: s.lineNumber, column: s.columnNumber };
  // React 19 dev builds keep a captured stack instead; the first user frame is the call site.
  const stack = fiber._debugStack?.stack;
  if (stack) return firstUserFrame(stack);
  return undefined;
}

function firstUserFrame(stack: string): SourceLocation | undefined {
  for (const line of stack.split('\n')) {
    const m = /(?:at\s+.*?\(|@|at\s+)?((?:https?:\/\/|\/|[A-Za-z]:\\)[^\s)]+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m || !m[1]) continue;
    if (/node_modules|react-dom|react\.development|\/react\//.test(m[1])) continue;
    return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
  }
  return undefined;
}

function reactInfo(el: Element): Omit<FrameworkInfo, 'framework'> {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return { chain: [] };
  let fiber = (el as unknown as Record<string, Fiber | undefined>)[key] ?? null;
  const source = fiber ? fiberSource(fiber) : undefined;
  const chain: ComponentInfo[] = [];
  let props: Record<string, unknown> | undefined;
  while (fiber && chain.length < MAX_COMPONENTS) {
    const name = reactTypeName(fiber.type);
    if (name && chain[chain.length - 1]?.name !== name) {
      chain.push({ name, source: fiberSource(fiber) });
      if (!props && fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
        props = snapshotProps(fiber.memoizedProps as Record<string, unknown>);
      }
    }
    fiber = fiber.return;
  }
  return { chain, source, props };
}

function reactTypeName(type: unknown): string | null {
  if (typeof type === 'function') return (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name || null;
  if (typeof type === 'object' && type !== null) {
    const t = type as { displayName?: string; render?: { name?: string; displayName?: string }; type?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render) return t.render.displayName || t.render.name || null; // forwardRef
    if (t.type) return reactTypeName(t.type); // memo
  }
  return null; // host components, fragments, providers
}

/** Reduce a props object to something safe and small to ship. */
export function snapshotProps(props: Record<string, unknown>, depth = PROPS_DEPTH): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children') continue;
    if (++n > PROPS_KEYS) {
      out['…'] = `${Object.keys(props).length - PROPS_KEYS} more keys`;
      break;
    }
    out[k] = snapshotValue(v, depth);
  }
  return out;
}

function snapshotValue(v: unknown, depth: number): unknown {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') return v.length > PROPS_STRING ? v.slice(0, PROPS_STRING) + '…' : v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'function') return `[fn ${v.name || 'anonymous'}]`;
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$$typeof' in o) return '[element]';
    if (typeof Node !== 'undefined' && v instanceof Node) return `[${(v as Element).tagName ?? v.nodeName}]`;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) {
      if (depth <= 0) return `[array ${v.length}]`;
      return v.slice(0, 10).map((x) => snapshotValue(x, depth - 1)).concat(v.length > 10 ? [`… ${v.length - 10} more`] : []);
    }
    if (depth <= 0) return '[object]';
    try {
      return snapshotProps(o, depth - 1);
    } catch {
      return '[object]';
    }
  }
  return String(v);
}

interface VueInstance {
  type?: { name?: string; __name?: string; __file?: string };
  parent?: VueInstance | null;
  props?: Record<string, unknown>;
  $options?: { name?: string; _componentTag?: string; __file?: string };
  $parent?: VueInstance | null;
  $props?: Record<string, unknown>;
}

function vueInfo(el: Element): Omit<FrameworkInfo, 'framework'> {
  const anyEl = el as unknown as { __vueParentComponent?: VueInstance; __vue__?: VueInstance };
  const chain: ComponentInfo[] = [];
  let props: Record<string, unknown> | undefined;
  // Vue 3
  let v3: VueInstance | null | undefined = anyEl.__vueParentComponent;
  if (!v3) {
    let p: Element | null = el.parentElement;
    while (p && !v3) {
      v3 = (p as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
      p = p.parentElement;
    }
  }
  while (v3 && chain.length < MAX_COMPONENTS) {
    const name = v3.type?.name || v3.type?.__name || fileName(v3.type?.__file);
    if (name && chain[chain.length - 1]?.name !== name) {
      chain.push({ name, source: v3.type?.__file ? { file: v3.type.__file } : undefined });
      if (!props && v3.props) props = snapshotProps(v3.props);
    }
    v3 = v3.parent;
  }
  if (chain.length) return { chain, props, source: chain[0]?.source };
  // Vue 2
  let v2: VueInstance | null | undefined = anyEl.__vue__;
  while (v2 && chain.length < MAX_COMPONENTS) {
    const name = v2.$options?.name || v2.$options?._componentTag || fileName(v2.$options?.__file);
    if (name && chain[chain.length - 1]?.name !== name) {
      chain.push({ name, source: v2.$options?.__file ? { file: v2.$options.__file } : undefined });
      if (!props && v2.$props) props = snapshotProps(v2.$props);
    }
    v2 = v2.$parent;
  }
  return { chain, props, source: chain[0]?.source };
}

function fileName(path?: string): string | null {
  if (!path) return null;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.vue$/, '');
}
