import {
  IGNORE_ATTR, shortSelector, toPromptContext,
  type Attachment, type ElementSelection, type FeedbackPayload, type LightbackClient, type Rect,
} from '@lightback/core';
import { styles } from './styles';
import { decodeScreenshot } from './screenshot';

export interface WidgetOptions {
  client: LightbackClient;
  /** Return an image blob of the full page. Called with the widget hidden. Omit to disable screenshots. */
  screenshot?: () => Promise<Blob | null>;
  /**
   * Capture a screenshot automatically when pick mode starts and attach a padded crop of every selection.
   * Defaults to true when `screenshot` is provided.
   */
  autoScreenshot?: boolean;
  /** Padding in CSS pixels around a selection in its crop. Default 16. */
  cropPadding?: number;
  /**
   * Milliseconds the "Sending…" card stays cancellable before the report actually goes out.
   * 0 sends immediately. Default 5000.
   */
  sendDelay?: number;
  position?: 'bottom-right' | 'bottom-left';
  triggerLabel?: string;
  /** CSS color for buttons and highlights. */
  accent?: string;
  onSent?: (payload: FeedbackPayload) => void;
  onError?: (error: unknown) => void;
}

export interface WidgetHandle {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  startPicking(): void;
  destroy(): void;
}

const DRAG_THRESHOLD = 5;

interface BaseShot {
  blob: Blob;
  bitmap: ImageBitmap | HTMLCanvasElement;
  /** Document size when captured, so document-space rects map onto the bitmap. */
  page: { width: number; height: number };
}

const TEMPLATE = /* html */ `
<div class="lb-pill" role="group" aria-label="Feedback">
  <button class="lb-pill-btn" type="button" data-action="pick" data-ref="pillPick">⌖ Point at something</button>
  <span class="lb-pill-sep"></span>
  <button class="lb-pill-btn" type="button" data-action="open" data-ref="pillOpen">✎ Write feedback</button>
</div>
<div class="lb-panel" hidden role="dialog" aria-label="Send feedback">
  <header><strong>Send feedback</strong><button class="lb-icon" type="button" data-action="close" aria-label="Close">✕</button></header>
  <div class="lb-body">
    <label>What happened?<textarea data-ref="text" placeholder="Describe the problem or idea. Point at elements to add context."></textarea></label>
    <div class="lb-actions">
      <button class="lb-btn" type="button" data-action="pick">⌖ Point at something</button>
      <button class="lb-btn" type="button" data-action="shot" data-ref="shotBtn" hidden>📷 Screenshot</button>
    </div>
    <div class="lb-selections" data-ref="selections"></div>
    <div class="lb-shot" data-ref="shot" hidden><img alt="Screenshot preview" data-ref="shotImg"><button class="lb-icon" type="button" data-action="shot-remove" aria-label="Remove screenshot">✕</button></div>
    <details class="lb-review" data-ref="review">
      <summary>Review what will be sent <span class="lb-counts" data-ref="counts"></span></summary>
      <div class="lb-tabs"><button type="button" data-tab="prompt" class="active">Prompt</button><button type="button" data-tab="json">JSON</button></div>
      <pre class="lb-preview" data-ref="preview"></pre>
    </details>
  </div>
  <footer><span class="lb-status" data-ref="status"></span><span class="lb-grow"></span><button class="lb-link danger" type="button" data-action="discard">Discard</button><button class="lb-btn lb-primary" type="button" data-action="send">Send</button></footer>
</div>
<div class="lb-pickbar" hidden>
  <span class="lb-pick-hint">Click an element or drag an area</span>
  <span class="lb-count" data-ref="count">0 selected</span>
  <button class="lb-pick-btn" type="button" data-action="cancel-pick">Cancel</button>
  <button class="lb-pick-btn lb-pick-done" type="button" data-action="done">Done</button>
</div>
<div class="lb-highlight" hidden><div class="lb-tip"></div></div>
<div class="lb-drag" hidden></div>
<div class="lb-pins" data-ref="pins"></div>
<div class="lb-popover" data-ref="popover" hidden>
  <div class="lb-pop-head"><span class="lb-badge" data-ref="popBadge">1</span><strong data-ref="popTitle"></strong></div>
  <textarea data-ref="popText" placeholder="What about this? (optional)"></textarea>
  <div class="lb-pop-actions">
    <button class="lb-link danger" type="button" data-action="pop-remove">Remove</button>
    <span class="lb-grow"></span>
    <button class="lb-btn" type="button" data-action="pop-more" title="Save and keep pointing">Add more</button>
    <button class="lb-btn lb-primary" type="button" data-action="pop-send" title="Enter">Send</button>
  </div>
  <div class="lb-hint">Enter to send · Shift+Enter for a new line</div>
</div>
<div class="lb-pending" data-ref="pending" hidden role="status">
  <div class="lb-pending-row">
    <strong data-ref="pendingTitle">Sending feedback…</strong>
    <span class="lb-grow"></span>
    <button class="lb-btn" type="button" data-action="pending-edit">Edit</button>
    <button class="lb-btn" type="button" data-action="pending-cancel">Cancel</button>
  </div>
  <div class="lb-pending-summary" data-ref="pendingSummary"></div>
  <div class="lb-pending-bar"><i data-ref="pendingBar"></i></div>
</div>
<div class="lb-toast" hidden></div>
`;

export function mountWidget(options: WidgetOptions): WidgetHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Lightback: mountWidget requires a browser DOM');
  return new Widget(options);
}

class Widget implements WidgetHandle {
  readonly element: HTMLElement;
  private root: ShadowRoot;
  private client: LightbackClient;
  private opts: WidgetOptions;

  private text = '';
  private selections: ElementSelection[] = [];
  /** Live DOM element for each selection (the container for regions), to re-anchor pins on scroll. */
  private liveEls = new Map<string, Element>();
  private screenshot: Blob | null = null;
  private screenshotUrl: string | null = null;
  /** Full-page capture taken when pick mode starts; crops are cut from it. */
  private base: Promise<BaseShot | null> | null = null;
  private crops = new Map<string, { blob: Blob; url: string }>();
  private cropJobs = new Map<string, Promise<void>>();
  private pendingTimer: number | null = null;
  private autoShot: boolean;
  private sending = false;
  private picking = false;
  private reviewTab: 'prompt' | 'json' = 'prompt';

  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private suppressClick = false;
  private popoverFor: string | null = null;

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  constructor(opts: WidgetOptions) {
    this.opts = opts;
    this.client = opts.client;
    this.autoShot = opts.autoScreenshot ?? Boolean(opts.screenshot);
    const host = document.createElement('lightback-widget');
    host.setAttribute(IGNORE_ATTR, '');
    host.dataset.position = opts.position ?? 'bottom-right';
    if (opts.accent) host.style.setProperty('--lb-accent', opts.accent);
    this.element = host;
    this.root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    while (wrap.firstChild) this.root.appendChild(wrap.firstChild);

    if (opts.triggerLabel) this.q('[data-ref=pillOpen]').textContent = opts.triggerLabel;
    if (opts.screenshot) this.q('[data-ref=shotBtn]').hidden = false;

    this.root.addEventListener('click', (e) => this.onRootClick(e));
    this.q<HTMLTextAreaElement>('[data-ref=text]').addEventListener('input', (e) => {
      this.text = (e.target as HTMLTextAreaElement).value;
      this.refreshReview();
      this.renderPill();
    });
    this.q<HTMLDetailsElement>('[data-ref=review]').addEventListener('toggle', () => this.refreshReview());
    const list = this.q('[data-ref=selections]');
    list.addEventListener('mouseover', (e) => this.onSelectionHover(e));
    list.addEventListener('mouseout', () => this.hideHighlight());
    const pins = this.q('[data-ref=pins]');
    pins.addEventListener('mouseover', (e) => this.onSelectionHover(e));
    pins.addEventListener('mouseout', () => this.hideHighlight());
    const popText = this.q<HTMLTextAreaElement>('[data-ref=popText]');
    popText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.savePopover();
        this.queueSend();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closePopover();
      }
    });
    window.addEventListener('scroll', this.relayout, true);
    window.addEventListener('resize', this.relayout);

    document.body.appendChild(host);
  }

  /* ---------- public ---------- */

  open(): void {
    this.stopPicking();
    this.q('.lb-pill').hidden = true;
    this.q('.lb-panel').hidden = false;
    this.q<HTMLTextAreaElement>('[data-ref=text]').focus();
    this.refreshReview();
  }

  close(): void {
    this.q('.lb-panel').hidden = true;
    this.q('.lb-pill').hidden = false;
    this.renderPill();
  }

  private renderPill(): void {
    const n = this.selections.length;
    this.q('[data-ref=pillPick]').textContent = n ? `⌖ Point at something (${n})` : '⌖ Point at something';
    this.q('[data-ref=pillOpen]').textContent = n || this.text ? '✎ Review & send' : (this.opts.triggerLabel ?? '✎ Write feedback');
  }

  destroy(): void {
    this.cancelPending();
    this.stopPicking();
    for (const c of this.crops.values()) URL.revokeObjectURL(c.url);
    if (this.screenshotUrl) URL.revokeObjectURL(this.screenshotUrl);
    window.removeEventListener('scroll', this.relayout, true);
    window.removeEventListener('resize', this.relayout);
    this.element.remove();
  }

  /* ---------- events ---------- */

  private isOwn(e: Event): boolean {
    return e.composedPath().includes(this.element);
  }

  private onRootClick(e: Event): void {
    const target = (e.composedPath()[0] as Element).closest?.('[data-action],[data-tab]') as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    const tab = target.dataset.tab;
    if (tab === 'prompt' || tab === 'json') {
      this.reviewTab = tab;
      this.root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
      this.refreshReview();
      return;
    }
    const selId = (target.closest('[data-id]') as HTMLElement | null)?.dataset.id;
    switch (action) {
      case 'open': return this.open();
      case 'close': return this.close();
      case 'pick': return this.startPicking();
      case 'done': this.savePopover(); return this.open();
      case 'cancel-pick': this.closePopover(); this.stopPicking(); this.q('.lb-pill').hidden = false; this.renderPill(); return;
      case 'shot': void this.takeScreenshot(); return;
      case 'shot-remove': return this.setScreenshot(null);
      case 'send': void this.send(); return;
      case 'pop-more': return this.savePopover();
      case 'pop-send': this.savePopover(); return this.queueSend();
      case 'pop-remove': if (this.popoverFor) this.removeSelection(this.popoverFor); return;
      case 'pending-edit': this.cancelPending(); return this.open();
      case 'pending-cancel': this.cancelPending(); this.q('.lb-pill').hidden = false; this.renderPill(); this.toast('Not sent. Your draft is kept.'); return;
      case 'discard': this.reset(); return this.close();
      case 'sel-remove': if (selId) this.removeSelection(selId); return;
      case 'sel-edit': if (selId) this.openPopover(selId); return;
      case 'pin': if (selId) this.openPopover(selId); return;
    }
  }

  private onSelectionHover(e: Event): void {
    const card = (e.target as Element).closest('[data-id]') as HTMLElement | null;
    if (!card) return;
    const sel = this.selections.find((s) => s.id === card.dataset.id);
    if (sel) this.drawHighlightRect(this.currentRect(sel), false);
  }

  /* ---------- picking ---------- */

  private moveHandler = (e: MouseEvent) => {
    if (this.isOwn(e)) return;
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.dragging = true;
        this.hideHighlight();
        this.closePopover();
      }
      if (this.dragging) {
        this.drawDrag(this.normalizeRect(this.dragStart, { x: e.clientX, y: e.clientY }));
        return;
      }
    }
    const el = this.targetAt(e.clientX, e.clientY);
    if (el) this.drawHighlight(el);
    else this.hideHighlight();
  };
  private downHandler = (e: MouseEvent) => {
    if (this.isOwn(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.button !== 0) return;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  };
  private upHandler = (e: MouseEvent) => {
    if (this.isOwn(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.dragging && this.dragStart) {
      const rect = this.normalizeRect(this.dragStart, { x: e.clientX, y: e.clientY });
      this.dragStart = null;
      this.dragging = false;
      this.suppressClick = true;
      this.q('.lb-drag').hidden = true;
      if (rect.width > DRAG_THRESHOLD && rect.height > DRAG_THRESHOLD) this.addRegion(rect);
    }
    this.dragStart = null;
  };
  private clickHandler = (e: MouseEvent) => {
    if (this.isOwn(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    // Clicking the page while a popover is open commits the comment and continues picking.
    if (this.popoverFor) this.savePopover();
    const el = this.targetAt(e.clientX, e.clientY);
    if (el) this.addSelection(el);
  };
  private swallow = (e: Event) => {
    if (this.isOwn(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  /** Pointer events must not be default-prevented: that would suppress the mouse events the drag logic uses. */
  private stopOnly = (e: Event) => {
    if (this.isOwn(e)) return;
    e.stopImmediatePropagation();
  };
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.popoverFor) {
        this.closePopover();
        return;
      }
      this.stopPicking();
      this.open();
    }
  };

  startPicking(): void {
    if (this.picking) return;
    this.picking = true;
    this.q('.lb-panel').hidden = true;
    this.q('.lb-pill').hidden = true;
    this.q('.lb-pickbar').hidden = false;
    this.updateCount();
    if (this.autoShot) this.base = this.captureBase();
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mousemove', this.moveHandler, true);
    document.addEventListener('mousedown', this.downHandler, true);
    document.addEventListener('mouseup', this.upHandler, true);
    document.addEventListener('click', this.clickHandler, true);
    for (const t of ['pointerdown', 'pointerup']) document.addEventListener(t, this.stopOnly, true);
    for (const t of ['dblclick', 'contextmenu', 'selectstart']) document.addEventListener(t, this.swallow, true);
    document.addEventListener('keydown', this.keyHandler, true);
  }

  private stopPicking(): void {
    if (!this.picking) return;
    this.picking = false;
    this.closePopover();
    this.q('.lb-pickbar').hidden = true;
    this.q('.lb-drag').hidden = true;
    this.hideHighlight();
    this.dragStart = null;
    this.dragging = false;
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', this.moveHandler, true);
    document.removeEventListener('mousedown', this.downHandler, true);
    document.removeEventListener('mouseup', this.upHandler, true);
    document.removeEventListener('click', this.clickHandler, true);
    for (const t of ['pointerdown', 'pointerup']) document.removeEventListener(t, this.stopOnly, true);
    for (const t of ['dblclick', 'contextmenu', 'selectstart']) document.removeEventListener(t, this.swallow, true);
    document.removeEventListener('keydown', this.keyHandler, true);
  }

  private targetAt(x: number, y: number): Element | null {
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) return null;
    if (this.client.isIgnored(el)) return null;
    return el;
  }

  private normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  }

  private addSelection(el: Element): void {
    const desc = this.client.describeElement(el);
    this.selections.push(desc);
    this.liveEls.set(desc.id, el);
    this.client.addBreadcrumb(`lightback: selected ${shortSelector(el)}`);
    this.afterSelectionAdded(desc);
  }

  private addRegion(rect: Rect): void {
    const desc = this.client.describeRegion(rect);
    if (!desc) return;
    this.selections.push(desc);
    const container = document.querySelector(desc.selector);
    if (container) this.liveEls.set(desc.id, container);
    this.client.addBreadcrumb(`lightback: selected region in ${desc.selector} (${desc.region?.children.length ?? 0} elements)`);
    this.afterSelectionAdded(desc);
  }

  private afterSelectionAdded(desc: ElementSelection): void {
    this.hideHighlight();
    this.renderPins();
    this.renderSelections();
    this.updateCount();
    this.openPopover(desc.id);
    this.cropJobs.set(desc.id, this.cropSelection(desc).catch(() => {}));
  }

  private removeSelection(id: string): void {
    if (this.popoverFor === id) this.closePopover();
    this.selections = this.selections.filter((s) => s.id !== id);
    this.liveEls.delete(id);
    const crop = this.crops.get(id);
    if (crop) URL.revokeObjectURL(crop.url);
    this.crops.delete(id);
    this.cropJobs.delete(id);
    this.renderPins();
    this.renderSelections();
    this.updateCount();
  }

  private updateCount(): void {
    const n = this.selections.length;
    this.q('[data-ref=count]').textContent = `${n} selected`;
    this.q('[data-action=done]').textContent = n ? `Done (${n})` : 'Done';
  }

  /* ---------- geometry ---------- */

  /** Where a selection is right now (elements move when the page scrolls). */
  private currentRect(sel: ElementSelection): Rect {
    if (sel.kind === 'region' && sel.region) {
      const d = sel.region.docRect;
      return { x: d.x - window.scrollX, y: d.y - window.scrollY, width: d.width, height: d.height };
    }
    const el = this.liveEls.get(sel.id);
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return { x: sel.docRect.x - window.scrollX, y: sel.docRect.y - window.scrollY, width: sel.docRect.width, height: sel.docRect.height };
  }

  private relayout = () => {
    if (this.selections.length === 0) return;
    this.renderPins();
    if (this.popoverFor) this.positionPopover(this.popoverFor);
  };

  private drawHighlight(el: Element): void {
    const r = el.getBoundingClientRect();
    this.drawHighlightRect({ x: r.left, y: r.top, width: r.width, height: r.height }, true, el);
  }

  private drawHighlightRect(r: Rect, withTip: boolean, el?: Element): void {
    const hl = this.q('.lb-highlight');
    hl.hidden = false;
    hl.style.transform = `translate(${r.x}px, ${r.y}px)`;
    hl.style.width = `${r.width}px`;
    hl.style.height = `${r.height}px`;
    const tip = this.q('.lb-tip');
    if (!withTip || !el) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    const chain = this.client.describeElement(el).components.slice(0, 3);
    tip.textContent = `${chain.length ? chain.join(' ‹ ') + '  ' : ''}${shortSelector(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    tip.classList.toggle('below', r.y < 32);
  }

  private hideHighlight(): void {
    this.q('.lb-highlight').hidden = true;
  }

  private drawDrag(r: Rect): void {
    const d = this.q('.lb-drag');
    d.hidden = false;
    d.style.transform = `translate(${r.x}px, ${r.y}px)`;
    d.style.width = `${r.width}px`;
    d.style.height = `${r.height}px`;
  }

  /* ---------- pins ---------- */

  private renderPins(): void {
    const box = this.q('[data-ref=pins]');
    box.innerHTML = '';
    this.selections.forEach((sel, i) => {
      const r = this.currentRect(sel);
      const pin = document.createElement('div');
      pin.className = `lb-pin${sel.kind === 'region' ? ' region' : ''}${this.popoverFor === sel.id ? ' active' : ''}`;
      pin.dataset.id = sel.id;
      pin.dataset.action = 'pin';
      pin.style.left = `${r.x}px`;
      pin.style.top = `${r.y}px`;
      pin.style.width = `${r.width}px`;
      pin.style.height = `${r.height}px`;
      // While dragging a new region the pins must not steal hit testing.
      pin.style.pointerEvents = this.dragging ? 'none' : 'auto';
      pin.innerHTML = `<span class="lb-badge${sel.kind === 'region' ? ' region' : ''}">${i + 1}</span><button class="lb-pin-x" type="button" data-action="sel-remove" aria-label="Remove selection" title="Remove">✕</button>`;
      pin.title = sel.note || this.labelFor(sel);
      box.appendChild(pin);
    });
  }

  /* ---------- popover ---------- */

  private openPopover(id: string): void {
    const sel = this.selections.find((s) => s.id === id);
    if (!sel) return;
    this.popoverFor = id;
    const pop = this.q('[data-ref=popover]');
    pop.hidden = false;
    this.q('[data-ref=popBadge]').textContent = String(this.selections.indexOf(sel) + 1);
    this.q('[data-ref=popTitle]').textContent = this.labelFor(sel);
    const ta = this.q<HTMLTextAreaElement>('[data-ref=popText]');
    ta.value = sel.note ?? '';
    this.positionPopover(id);
    this.renderPins();
    ta.focus();
  }

  private positionPopover(id: string): void {
    const sel = this.selections.find((s) => s.id === id);
    if (!sel) return;
    const pop = this.q('[data-ref=popover]');
    const r = this.currentRect(sel);
    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 140;
    const gap = 8;
    let x = Math.max(12, Math.min(r.x, window.innerWidth - pw - 12));
    let y = r.y + r.height + gap;
    if (y + ph > window.innerHeight - 12) y = r.y - ph - gap;
    if (y < 12) {
      // Tall selection: dock inside it near the top.
      y = Math.max(12, Math.min(r.y + gap, window.innerHeight - ph - 12));
      x = Math.max(12, Math.min(r.x + r.width + gap, window.innerWidth - pw - 12));
    }
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }

  private savePopover(): void {
    if (!this.popoverFor) return;
    const sel = this.selections.find((s) => s.id === this.popoverFor);
    const value = this.q<HTMLTextAreaElement>('[data-ref=popText]').value.trim();
    if (sel) sel.note = value || undefined;
    this.closePopover();
    this.renderSelections();
  }

  private closePopover(): void {
    if (!this.popoverFor) return;
    this.popoverFor = null;
    this.q('[data-ref=popover]').hidden = true;
    this.renderPins();
  }

  private labelFor(sel: ElementSelection): string {
    const chain = sel.components.slice(0, 2).join(' ‹ ');
    const what = chain || `<${sel.tag}>`;
    if (sel.kind === 'region') return `Area in ${what} · ${sel.region?.children.length ?? 0} elements`;
    return sel.text ? `${what} “${sel.text.slice(0, 30)}${sel.text.length > 30 ? '…' : ''}”` : what;
  }

  /* ---------- screenshot ---------- */

  /** Hide the widget, run the consumer's capturer, restore. */
  private async rawCapture(): Promise<Blob | null> {
    if (!this.opts.screenshot) return null;
    this.element.style.visibility = 'hidden';
    await nextFrame();
    await nextFrame();
    try {
      // Screenshot libraries fetch fonts, images and blob URLs; none of that belongs in the report.
      return await this.client.mute(() => this.opts.screenshot!());
    } finally {
      this.element.style.visibility = '';
    }
  }

  /** Full-page capture for the current pick session. Also becomes the attached screenshot. */
  private async captureBase(): Promise<BaseShot | null> {
    try {
      const page = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
      const blob = await this.rawCapture();
      if (!blob) return null;
      const bitmap = await decodeScreenshot(blob);
      this.setScreenshot(blob);
      return { blob, bitmap, page };
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }
  }

  /** Cut a padded crop of the selection out of the base capture and outline the selected rect. */
  private async cropSelection(sel: ElementSelection): Promise<void> {
    const base = await this.base;
    if (!base || !this.selections.includes(sel)) return;
    const pad = this.opts.cropPadding ?? 16;
    const r = sel.region ? sel.region.docRect : sel.docRect;
    const sx = base.bitmap.width / base.page.width;
    const sy = base.bitmap.height / base.page.height;
    const x0 = Math.max(0, Math.floor((r.x - pad) * sx));
    const y0 = Math.max(0, Math.floor((r.y - pad) * sy));
    const x1 = Math.min(base.bitmap.width, Math.ceil((r.x + r.width + pad) * sx));
    const y1 = Math.min(base.bitmap.height, Math.ceil((r.y + r.height + pad) * sy));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base.bitmap, x0, y0, w, h, 0, 0, w, h);
    ctx.strokeStyle = getComputedStyle(this.element).getPropertyValue('--lb-accent').trim() || '#4f46e5';
    ctx.lineWidth = Math.max(2, 2 * sx);
    if (sel.kind === 'region') ctx.setLineDash([6 * sx, 4 * sx]);
    ctx.strokeRect(r.x * sx - x0, r.y * sy - y0, r.width * sx, r.height * sy);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || !this.selections.includes(sel)) return;
    const prev = this.crops.get(sel.id);
    if (prev) URL.revokeObjectURL(prev.url);
    this.crops.set(sel.id, { blob, url: URL.createObjectURL(blob) });
    this.renderSelections();
  }

  private async takeScreenshot(): Promise<void> {
    if (!this.opts.screenshot) return;
    const btn = this.q<HTMLButtonElement>('[data-ref=shotBtn]');
    btn.disabled = true;
    try {
      const blob = await this.rawCapture();
      this.setScreenshot(blob);
    } catch (err) {
      this.setStatus(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`, true);
      this.opts.onError?.(err);
    } finally {
      btn.disabled = false;
    }
  }

  private setScreenshot(blob: Blob | null): void {
    if (this.screenshotUrl) URL.revokeObjectURL(this.screenshotUrl);
    this.screenshot = blob;
    this.screenshotUrl = blob ? URL.createObjectURL(blob) : null;
    const box = this.q('[data-ref=shot]');
    box.hidden = !blob;
    if (this.screenshotUrl) this.q<HTMLImageElement>('[data-ref=shotImg]').src = this.screenshotUrl;
    this.q('[data-ref=shotBtn]').textContent = blob ? '📷 Retake screenshot' : '📷 Screenshot';
    this.refreshReview();
  }

  /* ---------- send ---------- */

  private draft() {
    const attachments: Attachment[] = [];
    if (this.screenshot) {
      attachments.push({ name: 'screenshot.png', type: this.screenshot.type || 'image/png', size: this.screenshot.size, blob: this.screenshot });
    }
    const selections = this.selections.map((sel, i) => {
      const crop = this.crops.get(sel.id);
      if (!crop) return { ...sel, crop: undefined };
      const name = `selection-${i + 1}.png`;
      attachments.push({ name, type: 'image/png', size: crop.blob.size, blob: crop.blob });
      return { ...sel, crop: name };
    });
    return { text: this.text, selections, attachments };
  }

  /** Leave pick mode and show the cancellable "Sending…" card; the report goes out when it drains. */
  private queueSend(): void {
    if (this.sending || this.pendingTimer !== null) return;
    if (!this.text.trim() && this.selections.length === 0) return;
    this.stopPicking();
    this.q('.lb-panel').hidden = true;
    this.q('.lb-pill').hidden = true;
    const delay = this.opts.sendDelay ?? 5000;
    if (delay <= 0) {
      void this.send();
      return;
    }
    const card = this.q('[data-ref=pending]');
    this.q('[data-ref=pendingSummary]').textContent = this.summary();
    const bar = this.q('[data-ref=pendingBar]');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    card.hidden = false;
    void bar.offsetWidth; // restart the transition
    bar.style.transition = `width ${delay}ms linear`;
    bar.style.width = '0%';
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      card.hidden = true;
      void this.send();
    }, delay);
  }

  private cancelPending(): void {
    if (this.pendingTimer !== null) window.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.q('[data-ref=pending]').hidden = true;
  }

  private summary(): string {
    const n = this.selections.length;
    const bits: string[] = [];
    if (n) bits.push(`${n} selection${n === 1 ? '' : 's'}`);
    const note = this.text.trim() || this.selections.find((s) => s.note)?.note;
    if (note) bits.push(`“${note.length > 48 ? note.slice(0, 48) + '…' : note}”`);
    if (this.screenshot) bits.push('📷 screenshot');
    return bits.join(' · ');
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    if (!this.text.trim() && this.selections.length === 0) {
      this.setStatus('Add a note or select an element first.', true);
      return;
    }
    this.sending = true;
    const btn = this.q<HTMLButtonElement>('[data-action=send]');
    btn.disabled = true;
    this.setStatus('Sending…');
    try {
      // Crops and the base screenshot may still be rendering if the user sent quickly.
      await this.base;
      await Promise.all(this.cropJobs.values());
      const payload = await this.client.send(this.draft());
      if (payload) {
        this.opts.onSent?.(payload);
        this.reset();
        this.close();
        this.toast('Feedback sent. Thank you!');
      } else {
        this.setStatus('Cancelled by beforeSend.', true);
        this.open();
      }
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : String(err), true);
      this.opts.onError?.(err);
      this.open(); // surface the error with the draft intact
    } finally {
      this.sending = false;
      btn.disabled = false;
    }
  }

  private reset(): void {
    this.text = '';
    this.q<HTMLTextAreaElement>('[data-ref=text]').value = '';
    this.selections = [];
    this.liveEls.clear();
    for (const c of this.crops.values()) URL.revokeObjectURL(c.url);
    this.crops.clear();
    this.cropJobs.clear();
    this.base = null;
    this.setScreenshot(null);
    this.renderPins();
    this.renderSelections();
    this.setStatus('');
    this.renderPill();
  }

  /* ---------- rendering ---------- */

  private renderSelections(): void {
    const box = this.q('[data-ref=selections]');
    box.innerHTML = this.selections
      .map((s, i) => {
        const chain = s.components.length
          ? s.components.map(esc).join('<span class="sep">‹</span>')
          : `<span style="color:var(--lb-muted)">&lt;${esc(s.tag)}&gt;</span>`;
        const kind = s.kind === 'region' ? `<span class="lb-kind">area · ${s.region?.children.length ?? 0} elements</span>` : '';
        const source = s.source ? `<span class="lb-source">${esc(fmtSource(s.source))}</span>` : '';
        const children = s.kind === 'region' && s.region
          ? `<div class="lb-children">${s.region.children.slice(0, 8).map((c) => `<span class="lb-chip" title="${esc(c.selector)}">${esc(c.components[0] ?? c.tag)}${c.text ? ` “${esc(c.text.slice(0, 20))}”` : ''}</span>`).join('')}${s.region.children.length > 8 ? `<span class="lb-chip">+${s.region.children.length - 8}</span>` : ''}</div>`
          : '';
        const note = s.note ? `<div class="lb-note">💬 ${esc(s.note)}</div>` : `<div class="lb-note empty">No comment</div>`;
        const crop = this.crops.get(s.id);
        const thumb = crop ? `<img class="lb-thumb" src="${crop.url}" alt="Crop of selection ${i + 1}">` : '';
        return `<div class="lb-sel" data-id="${s.id}">
  <div class="lb-sel-head"><span class="lb-badge${s.kind === 'region' ? ' region' : ''}">${i + 1}</span><span class="lb-chain" title="${esc(s.components.join(' < '))}">${chain} ${kind}</span><button class="lb-icon" type="button" data-action="sel-edit" aria-label="Edit comment" title="Edit comment">✎</button><button class="lb-icon" type="button" data-action="sel-remove" aria-label="Remove">✕</button></div>
  <code class="lb-selector">${esc(s.selector)}</code>
  ${source}
  ${s.kind === 'element' && s.text ? `<div class="lb-text">“${esc(s.text.slice(0, 80))}”</div>` : ''}
  ${children}
  ${thumb}
  ${note}
</div>`;
      })
      .join('');
    this.refreshReview();
  }

  private refreshReview(): void {
    const st = this.client.stats();
    this.q('[data-ref=counts]').textContent =
      `${st.errors} errors · ${st.network} requests · ${st.console} logs · ${st.breadcrumbs} crumbs`;
    const details = this.q<HTMLDetailsElement>('[data-ref=review]');
    if (!details.open) return;
    const payload = this.client.buildPayload(this.draft());
    const pre = this.q('[data-ref=preview]');
    pre.textContent = this.reviewTab === 'prompt' ? toPromptContext(payload) : clip(JSON.stringify(payload, null, 2), 40000);
  }

  private setStatus(msg: string, isError = false): void {
    const el = this.q('[data-ref=status]');
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  private toast(msg: string): void {
    if (!this.q('.lb-panel').hidden) {
      // The panel's footer already has a status line; a floating toast would cover its buttons.
      this.setStatus(msg);
      return;
    }
    const t = this.q('.lb-toast');
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2500);
  }
}

function fmtSource(s: { file: string; line?: number; column?: number }): string {
  const file = s.file.replace(/^.*?\/(src|app|pages|components)\//, '$1/');
  return s.line ? `${file}:${s.line}${s.column ? `:${s.column}` : ''}` : file;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… truncated (${s.length} chars total)` : s;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
