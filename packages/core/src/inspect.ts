import type { ComponentInfo, ElementSelection, ElementSummary, Rect, SourceLocation } from './types';
import { composedClosest, domRoots, elementRect, ownerFrame } from './dom';
import { uid } from './format';
import { containsSensitive, DEFAULT_SENSITIVE, isSensitive, SENSITIVE_ATTR } from './sensitive';

const MAX_COMPONENTS = 12;
const MAX_TEXT = 200;
const MAX_HTML = 600;
const PROPS_DEPTH = 2;
const PROPS_KEYS = 40;
const PROPS_STRING = 200;

export function viewportRect(el: Element): Rect {
  const r = elementRect(el);
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export function toDocRect(rect: Rect): Rect {
  const sx = typeof window !== 'undefined' ? Math.round(window.scrollX) : 0;
  const sy = typeof window !== 'undefined' ? Math.round(window.scrollY) : 0;
  return { ...rect, x: rect.x + sx, y: rect.y + sy };
}

export interface InspectOptions {
  /** CSS selector of sensitive subtrees. Defaults to `[data-lightback-sensitive]`. */
  sensitive?: string;
}

/** Describe a DOM element with enough context for a human or a model to locate it. */
export function describeElement(el: Element, opts: InspectOptions = {}): ElementSelection {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Lightback: describeElement requires a browser DOM');
  const sensitive = opts.sensitive ?? DEFAULT_SENSITIVE;
  const rect = viewportRect(el);
  const fw = frameworkInfo(el, sensitive);
  // Selectors, tags and component names locate the element; content, attributes and props are withheld.
  const hidden = isSensitive(el, sensitive);
  return {
    id: uid(),
    kind: 'element',
    selector: uniqueSelector(el),
    ...(elementContext(el).length ? { context: elementContext(el) } : {}),
    tag: el.tagName.toLowerCase(),
    elementId: el.id || undefined,
    classes: hidden ? [] : Array.from(el.classList),
    text: elementText(el, MAX_TEXT, sensitive),
    attrs: hidden ? {} : interestingAttrs(el),
    rect,
    docRect: toDocRect(rect),
    framework: fw.framework,
    components: fw.chain.map((c) => c.name),
    chain: fw.chain,
    source: fw.source,
    props: hidden ? undefined : fw.props,
    html: hidden ? undefined : trimmedHtml(el, sensitive),
    ...(hidden ? { sensitive: true } : {}),
  };
}

/** Lighter description used for the children of a region. */
export function summarizeElement(el: Element, opts: InspectOptions = {}): ElementSummary {
  const sensitive = opts.sensitive ?? DEFAULT_SENSITIVE;
  const rect = viewportRect(el);
  const fw = frameworkInfo(el, sensitive);
  const hidden = isSensitive(el, sensitive);
  return {
    selector: uniqueSelector(el),
    ...(elementContext(el).length ? { context: elementContext(el) } : {}),
    tag: el.tagName.toLowerCase(),
    text: elementText(el, 80, sensitive),
    role: hidden ? undefined : el.getAttribute('role') ?? undefined,
    components: fw.chain.slice(0, 4).map((c) => c.name),
    rect,
    docRect: toDocRect(rect),
    source: fw.source,
    ...(hidden ? { sensitive: true } : {}),
  };
}

export function elementText(el: Element, max = MAX_TEXT, sensitive = DEFAULT_SENSITIVE): string {
  if (isSensitive(el, sensitive)) return '';
  // Descendants of editors inherit their editable contents, even without their own attribute.
  if (composedClosest(el, '[contenteditable]')) return '';
  const input = el as HTMLInputElement;
  // Never read values out of form controls.
  if (el.matches('input, textarea, select')) {
    return (input.placeholder || input.getAttribute('aria-label') || '').slice(0, max);
  }
  if (composedClosest(el, 'textarea, select')) return '';
  const clone = safeClone(el, sensitive);
  clone.querySelectorAll('input, textarea, select, [contenteditable]').forEach((control) => control.remove());
  return (clone.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
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

/**
 * Deep clone with sensitive descendants replaced by empty, attribute-free placeholders. Matching runs on the
 * live tree so host selectors keep their ancestor context (`.billing .card` would not match inside a clone).
 */
function safeClone(el: Element, sensitive: string): Element {
  const clone = el.cloneNode(true) as Element;
  // Text assigned directly to a sensitive slot has no descendant Element to replace.
  const liveText = el.ownerDocument.createTreeWalker(el, 4);
  const copyText = el.ownerDocument.createTreeWalker(clone, 4);
  for (let node = liveText.nextNode(), copy = copyText.nextNode(); node && copy; node = liveText.nextNode(), copy = copyText.nextNode()) {
    const slot = (node as Text).assignedSlot;
    if (slot && isSensitive(slot, sensitive)) copy.textContent = '';
  }
  // srcdoc contains an entire embedded document, including form values and private markup.
  for (const frame of [clone, ...Array.from(clone.querySelectorAll('iframe'))]) frame.removeAttribute('srcdoc');
  const live = Array.from(el.querySelectorAll('*'));
  const copy = Array.from(clone.querySelectorAll('*'));
  live.forEach((node, i) => {
    const target = copy[i];
    if (!isSensitive(node, sensitive) || !target?.parentNode) return;
    const placeholder = el.ownerDocument.createElement(node.tagName.toLowerCase());
    placeholder.setAttribute(SENSITIVE_ATTR, '');
    target.replaceWith(placeholder);
  });
  return clone;
}

function trimmedHtml(el: Element, sensitive: string): string {
  if (composedClosest(el, '[contenteditable], textarea, select')) return '';
  const safe = safeClone(el, sensitive);
  for (const control of [safe, ...Array.from(safe.querySelectorAll('input, textarea, select, [contenteditable]'))]) {
    control.removeAttribute('value');
    if (control.matches('textarea, select, [contenteditable]')) control.textContent = '';
  }
  const clone = safe.cloneNode(false) as Element;
  const open = clone.outerHTML.replace(/<\/[^>]+>$/, '');
  const inner = safe.innerHTML.replace(/\s+/g, ' ').trim();
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
  const root = el.getRootNode() as Document | ShadowRoot;
  const isUnique = (sel: string) => {
    try {
      return root.querySelectorAll(sel).length === 1;
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
    const siblings = parent ?? (cur.getRootNode() as ShadowRoot);
    if (siblings.children) {
      const sameTag = Array.from(siblings.children).filter((c) => c.tagName === cur!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    cur = parent;
  }
  return parts.join(' > ');
}

/** Outer-to-inner context path; selectors remain ordinary CSS within each root. */
export function elementContext(el: Element): import('./types').ElementContext[] {
  const path: import('./types').ElementContext[] = [];
  let current: Element | null = el;
  while (current) {
    const root = current.getRootNode() as Document | ShadowRoot;
    const host: Element | null = (root as ShadowRoot).host ?? ownerFrame(current.ownerDocument);
    if (!host || (root === document)) break;
    path.unshift({ kind: (root as ShadowRoot).host ? 'shadow' : 'frame', selector: uniqueSelector(host) });
    current = host;
  }
  return path;
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

/**
 * Walk framework internals to find the component tree above an element, plus source and props when exposed.
 * Props are omitted when the owning component renders sensitive content: they are likely its data source.
 */
export function frameworkInfo(el: Element, sensitive = DEFAULT_SENSITIVE, withProps = true): FrameworkInfo {
  const stamped = parseSourceAttr(el.getAttribute('data-source') ?? el.getAttribute('data-lb-source'));
  // Cheap global check first: most pages have nothing sensitive and skip the subtree walks.
  let anySensitive = true;
  if (!withProps) anySensitive = false;
  else try { anySensitive = isSensitive(el, sensitive) || domRoots(document).some(root => root.querySelector(sensitive) !== null); } catch { /* fail closed */ }
  const guard = anySensitive ? sensitive : null;
  const react = reactInfo(el, guard, withProps);
  if (react.chain.length || react.source) return { framework: 'react', ...react, source: stamped ?? react.source };
  const vue = vueInfo(el, guard, withProps);
  if (vue.chain.length) return { framework: 'vue', ...vue, source: stamped ?? vue.source };
  return { framework: null, chain: [], source: stamped };
}

/** Backwards-compatible helper: just the names. */
export function componentChain(el: Element): { framework: 'react' | 'vue' | null; components: string[] } {
  // Names only: skips props snapshots and their sensitivity walks (used on every hover).
  const info = frameworkInfo(el, DEFAULT_SENSITIVE, false);
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
  tag?: number;
  child?: Fiber | null;
  sibling?: Fiber | null;
  stateNode?: unknown;
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

const MAX_SUBTREE = 5000;
/** Marks the nearest props as found but withheld, so outer components are not used instead. */
const WITHHELD: Record<string, unknown> = Object.freeze({});
const shown = (props?: Record<string, unknown>) => (props === WITHHELD ? undefined : props);

/** Does a component's rendered output contain sensitive DOM? Unknown or oversized subtrees count as sensitive. */
const HOST_PORTAL = 4;

/**
 * Does a component's rendered output contain sensitive DOM? Unknown or oversized subtrees count as sensitive.
 * A clean host node vouches for its DOM subtree, so only portals below it need their own DOM checks.
 */
function fiberRendersSensitive(fiber: Fiber, sensitive: string): boolean {
  const stack: Array<[Fiber, boolean]> = fiber.child ? [[fiber.child, false]] : [];
  let seen = 0;
  while (stack.length) {
    const [f, covered] = stack.pop()!;
    if (++seen > MAX_SUBTREE) return true;
    let childCovered = covered && f.tag !== HOST_PORTAL;
    const node = f.stateNode as Element | null | undefined;
    if (!covered && node && typeof node === 'object' && node.nodeType === 1) {
      if (isSensitive(node, sensitive) || containsSensitive(node, sensitive)) return true;
      childCovered = true;
    }
    if (f.tag === HOST_PORTAL) childCovered = false;
    if (f.sibling) stack.push([f.sibling, covered]);
    if (f.child) stack.push([f.child, childCovered]);
  }
  return false;
}

function reactInfo(el: Element, sensitive: string | null, withProps = true): Omit<FrameworkInfo, 'framework'> {
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
      if (withProps && !props && fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
        // Only the nearest component's props are considered; withheld props stay withheld.
        props = sensitive !== null && fiberRendersSensitive(fiber, sensitive) ? WITHHELD : snapshotProps(fiber.memoizedProps as Record<string, unknown>);
      }
    }
    fiber = fiber.return;
  }
  return { chain, source, props: shown(props) };
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
    if (['children', 'value', 'defaultValue', 'innerHTML', 'dangerouslySetInnerHTML'].includes(k)) continue;
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
    if (typeof o.nodeType === 'number' && typeof o.nodeName === 'string') return `[${o.tagName ?? o.nodeName}]`;
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

interface VueNode { el?: unknown; children?: unknown; component?: { subTree?: VueNode } | null }
interface VueInstance {
  subTree?: VueNode;
  $el?: unknown;
  type?: { name?: string; __name?: string; __file?: string };
  parent?: VueInstance | null;
  props?: Record<string, unknown>;
  $options?: { name?: string; _componentTag?: string; __file?: string };
  $parent?: VueInstance | null;
  $props?: Record<string, unknown>;
}

const isElement = (n: unknown): n is Element => !!n && typeof n === 'object' && (n as Node).nodeType === 1;

/**
 * Vue 3 rendered roots: an element vnode vouches for its DOM subtree; fragments (v-for, v-if, templates) and
 * fragment-rooted child components are searched through their children. Unknown or oversized trees count as sensitive.
 */
function vueRendersSensitive(instance: VueInstance, sensitive: string): boolean {
  if (!instance.subTree) {
    const root = instance.$el; // Vue 2
    return !isElement(root) || isSensitive(root, sensitive) || containsSensitive(root, sensitive);
  }
  const stack: VueNode[] = [instance.subTree];
  let seen = 0;
  let found = false;
  while (stack.length) {
    const vnode = stack.pop();
    if (!vnode || typeof vnode !== 'object') continue;
    if (++seen > MAX_SUBTREE) return true;
    if (isElement(vnode.el)) {
      found = true;
      if (isSensitive(vnode.el, sensitive) || containsSensitive(vnode.el, sensitive)) return true;
      continue;
    }
    if (vnode.component?.subTree) stack.push(vnode.component.subTree);
    if (Array.isArray(vnode.children)) stack.push(...(vnode.children as VueNode[]));
  }
  return !found;
}

function vueProps(instance: VueInstance, raw: Record<string, unknown>, sensitive: string | null): Record<string, unknown> {
  return sensitive !== null && vueRendersSensitive(instance, sensitive) ? WITHHELD : snapshotProps(raw);
}

function vueInfo(el: Element, sensitive: string | null, withProps = true): Omit<FrameworkInfo, 'framework'> {
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
      if (withProps && !props && v3.props) props = vueProps(v3, v3.props, sensitive);
    }
    v3 = v3.parent;
  }
  if (chain.length) return { chain, props: shown(props), source: chain[0]?.source };
  // Vue 2
  let v2: VueInstance | null | undefined = anyEl.__vue__;
  while (v2 && chain.length < MAX_COMPONENTS) {
    const name = v2.$options?.name || v2.$options?._componentTag || fileName(v2.$options?.__file);
    if (name && chain[chain.length - 1]?.name !== name) {
      chain.push({ name, source: v2.$options?.__file ? { file: v2.$options.__file } : undefined });
      if (withProps && !props && v2.$props) props = vueProps(v2, v2.$props, sensitive);
    }
    v2 = v2.$parent;
  }
  return { chain, props: shown(props), source: chain[0]?.source };
}

function fileName(path?: string): string | null {
  if (!path) return null;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.vue$/, '');
}
