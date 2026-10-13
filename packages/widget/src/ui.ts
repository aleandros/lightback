import {
  componentChain, shortSelector, toPromptContext,
  type Attachment, type ElementSelection, type LightbackClient, type Rect, type ScreenshotMask,
} from '@lightback/core';
import { defaultStrings, type WidgetStrings } from './strings';
export { defaultStrings, type WidgetStrings } from './strings';
import { styles } from './styles';
import { decodeScreenshot, maskShot, release, type Page, type Shot } from './screenshot';

import type { WidgetOptions, WidgetHandle } from './types';
import { createHost } from './shell';

const DRAG_THRESHOLD = 5;

const template = (s: WidgetStrings) => /* html */ `
<div class="lb-pill" part="pill" data-ref="pill" role="group" aria-label="${esc(s.feedback)}">
  <button class="lb-pill-btn" type="button" data-action="pick" data-ref="pillPick">${esc(s.pillPick)}</button>
  <span class="lb-pill-sep"></span>
  <button class="lb-pill-btn" type="button" data-action="open" data-ref="pillOpen">${esc(s.pillOpen)}</button>
</div>
<div class="lb-panel" part="panel" data-ref="panel" hidden role="dialog" aria-label="${esc(s.panelTitle)}">
  <header><strong>${esc(s.panelTitle)}</strong><button class="lb-icon" type="button" data-action="close" aria-label="${esc(s.close)}">✕</button></header>
  <div class="lb-body">
    <label>${esc(s.noteLabel)}<textarea data-ref="text" placeholder="${esc(s.notePlaceholder)}"></textarea></label>
    <div class="lb-actions">
      <button class="lb-btn" type="button" data-action="pick">${esc(s.pick)}</button>
      <button class="lb-btn" type="button" data-action="shot" data-ref="shotBtn" hidden>${esc(s.screenshot)}</button>
    </div>
    <div class="lb-selections" data-ref="selections"></div>
    <div class="lb-shot" data-ref="shot" hidden><img alt="${esc(s.screenshotPreview)}" data-ref="shotImg"><button class="lb-icon" type="button" data-action="shot-remove" aria-label="${esc(s.removeScreenshot)}">✕</button></div>
    <details class="lb-review" data-ref="review">
      <summary>${esc(s.reviewSummary)} <span class="lb-counts" data-ref="counts"></span></summary>
      <div class="lb-tabs"><button type="button" data-tab="prompt" data-ref="tabPrompt" class="active">${esc(s.tabPrompt)}</button><button type="button" data-tab="json" data-ref="tabJson">${esc(s.tabJson)}</button></div>
      <pre class="lb-preview" data-ref="preview"></pre>
    </details>
  </div>
  <footer><span class="lb-status" data-ref="status"></span><span class="lb-grow"></span><button class="lb-link danger" type="button" data-action="discard">${esc(s.discard)}</button><button class="lb-btn lb-primary" type="button" data-action="send">${esc(s.send)}</button></footer>
</div>
<div class="lb-pickbar" hidden>
  <span class="lb-pick-hint" data-ref="pickHint">${esc(s.pickHint)}</span>
  <span class="lb-count" data-ref="count">${esc(s.countSelected(0))}</span>
  <button class="lb-pick-btn" type="button" data-action="mask-mode" data-ref="maskMode" aria-pressed="false" title="${esc(s.maskHint)}" hidden>${esc(s.maskMode)}</button>
  <button class="lb-pick-btn" type="button" data-action="cancel-pick">${esc(s.cancel)}</button>
  <button class="lb-pick-btn lb-pick-done" type="button" data-action="done">${esc(s.done(0))}</button>
</div>
<div class="lb-highlight" hidden><div class="lb-tip"></div></div>
<div class="lb-drag" hidden></div>
<div class="lb-masks" data-ref="masks" hidden></div>
<div class="lb-pins" data-ref="pins"></div>
<div class="lb-popover" part="popover" data-ref="popover" hidden>
  <div class="lb-pop-head"><span class="lb-badge" data-ref="popBadge">1</span><strong data-ref="popTitle"></strong></div>
  <textarea data-ref="popText" placeholder="${esc(s.popoverPlaceholder)}"></textarea>
  <div class="lb-pop-actions">
    <button class="lb-link danger" type="button" data-action="pop-remove">${esc(s.remove)}</button>
    <span class="lb-grow"></span>
    <button class="lb-btn" type="button" data-action="pop-more" title="${esc(s.addMoreTitle)}">${esc(s.addMore)}</button>
    <button class="lb-btn lb-primary" type="button" data-action="pop-send" title="${esc(s.sendTitle)}">${esc(s.send)}</button>
  </div>
  <div class="lb-hint">${esc(s.popoverHint)}</div>
</div>
<div class="lb-pending" part="pending" data-ref="pending" hidden role="status">
  <div class="lb-pending-row">
    <strong data-ref="pendingTitle">${esc(s.sending)}</strong>
    <span class="lb-grow"></span>
    <button class="lb-btn" type="button" data-action="pending-edit">${esc(s.edit)}</button>
    <button class="lb-btn" type="button" data-action="pending-cancel">${esc(s.cancel)}</button>
  </div>
  <div class="lb-pending-summary" data-ref="pendingSummary"></div>
  <div class="lb-pending-bar"><i data-ref="pendingBar"></i></div>
</div>
<div class="lb-toast" hidden></div>
`;

export function mountWidget(options: WidgetOptions, element?: HTMLElement): WidgetHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Lightback: mountWidget requires a browser DOM');
  return new Widget(options, element);
}

class Widget implements WidgetHandle {
  readonly element: HTMLElement;
  private root: ShadowRoot;
  private client: LightbackClient;
  private opts: WidgetOptions;
  private strings: WidgetStrings;

  private destroyed = false;
  private revision = 0;
  private restoring = false;
  private recovered = false;
  private recovery: Promise<void>;
  private recoveryIntent: 'pick' | null = null;
  private text = '';
  private selections: ElementSelection[] = [];
  /** Live DOM element for each selection (the container for regions), to re-anchor pins on scroll. */
  private liveEls = new Map<string, Element>();
  private screenshot: Blob | null = null;
  private screenshotUrl: string | null = null;
  /** Document size of the current screenshot; null when restored from storage (its geometry is unknown). */
  private screenshotPage: Page | null = null;
  /** Full-page capture taken when pick mode starts; crops are cut from it. Masks repaint it in place. */
  private base: Promise<Shot | null> | null = null;
  /** Bumped whenever base pixels change, so an in-flight crop of older pixels is dropped. */
  private baseVersion = 0;
  /** Areas the reporter hid, in document coordinates. Applied to every later capture too. */
  private masks: Rect[] = [];
  /** Sensitive element rects painted into the current screenshot, and into the base that crops are cut from. */
  private shotMasks: Rect[] = [];
  private baseMasks: Rect[] = [];
  private maskJob: Promise<void> = Promise.resolve();
  private maskMode = false;
  /** `width` is the crop's extent in CSS pixels, so a high-DPR crop previews at page size instead of doubled. */
  private crops = new Map<string, { blob: Blob; url: string; width: number }>();
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

  constructor(opts: WidgetOptions, element?: HTMLElement) {
    this.opts = opts;
    this.strings = { ...defaultStrings, ...(opts.triggerLabel !== undefined ? { pillOpen: opts.triggerLabel } : {}), ...opts.strings };
    this.client = opts.client;
    this.autoShot = opts.autoScreenshot ?? Boolean(opts.screenshot);
    const host = element ?? createHost(opts);
    this.element = host;
    this.root = host.shadowRoot!;
    this.root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = styles;
    this.root.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = template(this.strings);
    while (wrap.firstChild) this.root.appendChild(wrap.firstChild);

    this.q('.lb-pill').hidden = Boolean(opts.hideTrigger);
    if (opts.screenshot) {
      this.q('[data-ref=shotBtn]').hidden = false;
      this.q('[data-ref=maskMode]').hidden = false;
    }

    this.root.addEventListener('click', (e) => this.onRootClick(e));
    this.q<HTMLTextAreaElement>('[data-ref=text]').addEventListener('input', (e) => {
      this.text = (e.target as HTMLTextAreaElement).value;
      this.refreshReview();
      this.renderPill();
      this.persistDraft();
    });
    this.q<HTMLDetailsElement>('[data-ref=review]').addEventListener('toggle', () => this.refreshReview());
    const list = this.q('[data-ref=selections]');
    list.addEventListener('mouseover', (e) => this.onSelectionHover(e));
    list.addEventListener('mouseout', () => this.hideHighlight());
    const pins = this.q('[data-ref=pins]');
    pins.addEventListener('mouseover', (e) => this.onSelectionHover(e));
    pins.addEventListener('mouseout', () => this.hideHighlight());
    const popText = this.q<HTMLTextAreaElement>('[data-ref=popText]');
    popText.addEventListener('input', () => {
      const selection = this.selections.find((s) => s.id === this.popoverFor);
      if (selection) selection.note = popText.value || undefined;
      this.persistDraft();
    });
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

    if (!host.isConnected) document.body.appendChild(host);
    const recoveryControls = this.root.querySelectorAll<HTMLTextAreaElement>('textarea');
    recoveryControls.forEach((control) => { control.disabled = true; });
    const revision = this.revision;
    this.recovery = Promise.resolve(this.client.ready).then(() => {
      if (this.destroyed) return;
      if (revision === this.revision) this.restoreDraft();
      this.recovered = true;
      recoveryControls.forEach((control) => { control.disabled = false; });
      if (!this.q('[data-ref=panel]').hidden && !this.root.activeElement) this.q<HTMLTextAreaElement>('[data-ref=text]').focus();
      if (this.recoveryIntent === 'pick') this.startPicking();
    });
  }

  /* ---------- public ---------- */

  open(): void {
    this.recoveryIntent = null;
    this.stopPicking();
    this.q('.lb-pill').hidden = true;
    this.q('.lb-panel').hidden = false;
    this.q<HTMLTextAreaElement>('[data-ref=text]').focus();
    this.refreshReview();
  }

  close(): void {
    this.recoveryIntent = null;
    this.q('.lb-panel').hidden = true;
    this.q('.lb-pill').hidden = Boolean(this.opts.hideTrigger);
    this.renderPill();
  }

  private renderPill(): void {
    const n = this.selections.length;
    this.q('[data-ref=pillPick]').textContent = n ? this.strings.pillPickCount(n) : this.strings.pillPick;
    this.q('[data-ref=pillOpen]').textContent = n || this.text ? this.strings.pillReview : this.strings.pillOpen;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.revision++;
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
      case 'mask-mode': return this.setMaskMode(!this.maskMode);
      case 'cancel-pick': this.closePopover(); this.stopPicking(); this.q('.lb-pill').hidden = Boolean(this.opts.hideTrigger); this.renderPill(); return;
      case 'shot': void this.takeScreenshot(); return;
      case 'shot-remove': return this.setScreenshot(null);
      case 'send': void this.send(); return;
      case 'pop-more': return this.savePopover();
      case 'pop-send': this.savePopover(); return this.queueSend();
      case 'pop-remove': if (this.popoverFor) this.removeSelection(this.popoverFor); return;
      case 'pending-edit': this.cancelPending(); return this.open();
      case 'pending-cancel': this.cancelPending(); this.q('.lb-pill').hidden = Boolean(this.opts.hideTrigger); this.renderPill(); this.toast(this.strings.draftKept); return;
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
      if (rect.width > DRAG_THRESHOLD && rect.height > DRAG_THRESHOLD) {
        if (this.maskMode) this.addMask(rect);
        else this.addRegion(rect);
      }
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
    if (el && this.maskMode) this.addMask(renderedBounds(el));
    else if (el) this.addSelection(el);
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
    if (!this.recovered) { this.recoveryIntent = 'pick'; return; }
    if (this.destroyed) return;
    this.recoveryIntent = null;
    if (this.picking) return;
    this.picking = true;
    this.q('.lb-panel').hidden = true;
    this.q('.lb-pill').hidden = true;
    this.q('.lb-pickbar').hidden = false;
    this.updateCount();
    this.q('[data-ref=masks]').hidden = false;
    this.renderMasks();
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
    this.setMaskMode(false);
    this.q('[data-ref=masks]').hidden = true;
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
    // Earlier pins sit over the page; hit testing must see the elements beneath them.
    const pins = this.q('[data-ref=pins]');
    pins.classList.add('passive');
    let desc: ElementSelection | null;
    try {
      desc = this.client.describeRegion(rect);
    } finally {
      pins.classList.remove('passive');
    }
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
    this.persistDraft();
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
    this.persistDraft();
  }

  private updateCount(): void {
    const n = this.selections.length;
    this.q('[data-ref=count]').textContent = this.strings.countSelected(n);
    this.q('[data-action=done]').textContent = this.strings.done(n);
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
    if (this.picking) this.renderMasks();
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
    // Names only: a full description (props, HTML, sensitivity walks) on every mousemove is too slow.
    const chain = componentChain(el).components.slice(0, 3);
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
      pin.innerHTML = `<span class="lb-badge${sel.kind === 'region' ? ' region' : ''}">${i + 1}</span><button class="lb-pin-x" type="button" data-action="sel-remove" aria-label="${esc(this.strings.removeSelection)}" title="${esc(this.strings.remove)}">✕</button>`;
      pin.title = sel.note || this.labelFor(sel);
      box.appendChild(pin);
    });
  }

  /* ---------- masks ---------- */

  private setMaskMode(on: boolean): void {
    this.maskMode = on;
    const button = this.q('[data-ref=maskMode]');
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('active', on);
    this.q('[data-ref=pickHint]').textContent = on ? this.strings.maskHint : this.strings.pickHint;
    this.q('.lb-highlight').classList.toggle('mask', on);
    if (on) this.closePopover();
  }

  private renderMasks(): void {
    const box = this.q('[data-ref=masks]');
    box.innerHTML = '';
    for (const m of this.masks) {
      const el = document.createElement('div');
      el.className = 'lb-mask';
      el.dataset.ref = 'mask';
      el.style.left = `${m.x - window.scrollX}px`;
      el.style.top = `${m.y - window.scrollY}px`;
      el.style.width = `${m.width}px`;
      el.style.height = `${m.height}px`;
      el.textContent = this.strings.maskedLabel;
      box.appendChild(el);
    }
  }

  /** Hide a viewport rect in the screenshot and every crop, now and in later captures. Masks only add pixels. */
  private addMask(viewport: Rect): void {
    const rect = {
      x: Math.floor(viewport.x + window.scrollX), y: Math.floor(viewport.y + window.scrollY),
      width: Math.ceil(viewport.width), height: Math.ceil(viewport.height),
    };
    if (rect.width <= 0 || rect.height <= 0) return;
    this.masks.push(rect);
    this.hideHighlight();
    this.renderMasks();
    this.persistDraft();
    const generation = this.captureGeneration;
    const live = () => !this.destroyed && generation === this.captureGeneration;
    this.maskJob = this.maskJob.then(async () => {
      const shot = await this.base;
      if (!live()) return;
      let repainted = false;
      if (shot) {
        const previous = shot.blob;
        const old = shot.bitmap;
        const next = await maskShot(shot, [rect]);
        if (next !== shot) {
          // Repaint in place: crop jobs and sends awaiting this base see the masked pixels.
          shot.blob = next.blob;
          shot.bitmap = next.bitmap;
          this.baseVersion++;
          repainted = true;
          release(old);
          if (live() && this.screenshot === previous) this.setScreenshot(next.blob, shot.page, this.shotMasks);
        }
      }
      if (!live()) return;
      const current = this.screenshot;
      if (current && current !== shot?.blob) {
        if (!this.screenshotPage) this.setScreenshot(null); // Restored image: its geometry is unknown, so drop it.
        else {
          const page = this.screenshotPage;
          const bitmap = await decodeScreenshot(current);
          try {
            const next = await maskShot({ blob: current, bitmap, page }, [rect]);
            if (live() && this.screenshot === current) this.setScreenshot(next.blob, page, this.shotMasks);
            if (next.bitmap !== bitmap) release(next.bitmap);
          } finally { release(bitmap); }
        }
      }
      if (!live()) return;
      const pad = this.opts.cropPadding ?? 16;
      let dropped = false;
      for (const sel of this.selections) {
        const job = this.cropJobs.get(sel.id);
        const hit = overlaps(sel.region ? sel.region.docRect : sel.docRect, rect, pad);
        // Drop an affected crop first: if re-cutting fails, nothing showing the hidden area remains.
        if (hit && this.crops.has(sel.id)) {
          URL.revokeObjectURL(this.crops.get(sel.id)!.url);
          this.crops.delete(sel.id);
          dropped = true;
        }
        // Re-cut affected crops, and in-flight ones discarded by the repaint (restored crops have no job).
        if (repainted && job && (hit || !this.crops.has(sel.id))) {
          this.cropJobs.set(sel.id, job.then(() => this.cropSelection(sel)).catch(() => {}));
        }
      }
      if (dropped) {
        this.renderSelections();
        this.persistDraft();
      }
    }).catch((err: unknown) => {
      if (!live()) return;
      // Fail closed: without a masked version, no image is kept, including crops still being cut.
      this.baseVersion++;
      this.base = null;
      this.setScreenshot(null);
      for (const c of this.crops.values()) URL.revokeObjectURL(c.url);
      this.crops.clear();
      this.renderSelections();
      this.opts.onError?.(err);
    });
  }

  private sensitiveRects(): Rect[] {
    if (this.client.sensitiveRects) return this.client.sensitiveRects();
    // Older core versions: honour the attribute at least.
    return Array.from(document.querySelectorAll('[data-lightback-sensitive]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.floor(r.x + window.scrollX), y: Math.floor(r.y + window.scrollY), width: Math.ceil(r.width) + 1, height: Math.ceil(r.height) + 1 };
    }).filter((r) => r.width > 1 && r.height > 1);
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
    this.persistDraft();
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
    if (sel.kind === 'region') return `${this.strings.areaIn(what)} · ${this.strings.elementCount(sel.region?.children.length ?? 0)}`;
    return sel.text ? `${what} “${sel.text.slice(0, 30)}${sel.text.length > 30 ? '…' : ''}”` : what;
  }

  /* ---------- screenshot ---------- */

  /**
   * Hide the widget, run the consumer's capturer, restore, then mask sensitive elements and reporter areas.
   * The capturer's unmasked blob and bitmap never leave this method.
   */
  private async capture(): Promise<{ shot: Shot; sensitive: Rect[] } | null> {
    if (!this.opts.screenshot) return null;
    const page = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    this.element.style.visibility = 'hidden';
    await nextFrame();
    await nextFrame();
    let blob: Blob | null;
    let sensitive: Rect[];
    try {
      // Measure on both sides: content can appear, move or become sensitive while the capturer runs.
      const before = this.sensitiveRects();
      // Screenshot libraries fetch fonts, images and blob URLs; none of that belongs in the report.
      blob = await this.client.mute(() => this.opts.screenshot!());
      sensitive = uniqueRects([...before, ...this.sensitiveRects()]);
    } finally {
      this.element.style.visibility = '';
    }
    if (!blob) return null;
    const bitmap = await decodeScreenshot(blob);
    let shot: Shot;
    try {
      shot = await maskShot({ blob, bitmap, page }, [...sensitive, ...this.masks]);
    } catch (err) {
      release(bitmap);
      throw err;
    }
    if (shot.bitmap !== bitmap) release(bitmap);
    return { shot, sensitive };
  }

  /** Full-page capture for the current pick session. Also becomes the attached screenshot. */
  private async captureBase(): Promise<Shot | null> {
    const generation = this.captureGeneration;
    try {
      const result = await this.capture();
      if (!result) return null;
      if (this.destroyed || generation !== this.captureGeneration) {
        release(result.shot.bitmap);
        return null;
      }
      this.setScreenshot(result.shot.blob, result.shot.page, result.sensitive);
      this.baseMasks = result.sensitive;
      return result.shot;
    } catch (err) {
      this.opts.onError?.(err);
      return null;
    }
  }

  /** Cut a padded crop of the selection out of the base capture and outline the selected rect. */
  private async cropSelection(sel: ElementSelection): Promise<void> {
    const base = await this.base;
    if (this.destroyed || !base || !this.selections.includes(sel)) return;
    const version = this.baseVersion;
    const r = sel.region ? sel.region.docRect : sel.docRect;
    const area = this.cropArea(sel, base.page);
    const sx = base.bitmap.width / base.page.width;
    const sy = base.bitmap.height / base.page.height;
    const x0 = Math.max(0, Math.floor(area.x * sx));
    const y0 = Math.max(0, Math.floor(area.y * sy));
    const x1 = Math.min(base.bitmap.width, Math.ceil((area.x + area.width) * sx));
    const y1 = Math.min(base.bitmap.height, Math.ceil((area.y + area.height) * sy));
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
    // A mask landed meanwhile: the mask job re-cuts this crop from the repainted base.
    if (this.destroyed || !blob || !this.selections.includes(sel) || version !== this.baseVersion) return;
    const prev = this.crops.get(sel.id);
    if (prev) URL.revokeObjectURL(prev.url);
    this.crops.set(sel.id, { blob, url: URL.createObjectURL(blob), width: w / sx });
    this.renderSelections();
    this.persistDraft();
  }

  /** A selection's crop in document CSS pixels: its rect plus `cropPadding`, clipped to the page. */
  private cropArea(sel: ElementSelection, page: Page): Rect {
    const pad = this.opts.cropPadding ?? 16;
    const r = sel.region ? sel.region.docRect : sel.docRect;
    const x = Math.max(0, r.x - pad);
    const y = Math.max(0, r.y - pad);
    return { x, y, width: Math.min(page.width, r.x + r.width + pad) - x, height: Math.min(page.height, r.y + r.height + pad) - y };
  }

  private async takeScreenshot(): Promise<void> {
    await this.recovery;
    if (this.destroyed) return;
    if (!this.opts.screenshot) return;
    const btn = this.q<HTMLButtonElement>('[data-ref=shotBtn]');
    btn.disabled = true;
    const generation = this.captureGeneration;
    try {
      const result = await this.capture();
      if (result) release(result.shot.bitmap);
      if (!this.destroyed && generation === this.captureGeneration) this.setScreenshot(result?.shot.blob ?? null, result?.shot.page, result?.sensitive);
    } catch (err) {
      this.setStatus(this.strings.screenshotFailed(err instanceof Error ? err.message : String(err)), true);
      this.opts.onError?.(err);
    } finally {
      btn.disabled = false;
    }
  }

  private setScreenshot(blob: Blob | null, page: Page | null = null, sensitive?: Rect[]): void {
    if (this.screenshotUrl) URL.revokeObjectURL(this.screenshotUrl);
    this.screenshot = blob;
    this.screenshotPage = blob ? page : null;
    if (sensitive) this.shotMasks = sensitive;
    this.screenshotUrl = blob ? URL.createObjectURL(blob) : null;
    const box = this.q('[data-ref=shot]');
    box.hidden = !blob;
    if (this.screenshotUrl) this.q<HTMLImageElement>('[data-ref=shotImg]').src = this.screenshotUrl;
    this.q('[data-ref=shotBtn]').textContent = blob ? this.strings.retakeScreenshot : this.strings.screenshot;
    this.refreshReview();
    this.persistDraft();
  }

  private captureGeneration = 0;

  private persistDraft(): void {
    if (this.destroyed || this.restoring) return;
    this.revision++;
    this.client.saveDraft?.(this.draft());
  }

  private restoreDraft(): void {
    const draft = this.client.getDraft?.();
    if (!draft) return;
    this.restoring = true;
    try {
      this.text = draft.text;
      this.q<HTMLTextAreaElement>('[data-ref=text]').value = this.text;
      this.selections = draft.selections;
      const masks = draft.masks ?? [];
      this.masks = masks.filter((m) => m.reason === 'reporter').map((m) => m.docRect);
      this.shotMasks = masks.filter((m) => m.reason === 'sensitive').map((m) => m.docRect);
      this.baseMasks = this.shotMasks;
      for (const selection of this.selections) {
        const crop = draft.attachments.find((a) => a.name === selection.crop);
        if (crop) {
          // The capture scale is not stored; estimate the CSS width from the selection against the current page.
          const page = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
          const width = this.cropArea(selection, page).width;
          this.crops.set(selection.id, { blob: crop.blob, url: URL.createObjectURL(crop.blob), width });
        }
        // Coordinates remain the captured coordinates; a selector may now point at different content.
      }
      this.setScreenshot(draft.attachments.find((a) => a.name === 'screenshot.png')?.blob ?? null);
      this.renderSelections();
      this.renderPins();
      this.updateCount();
      this.renderPill();
    } finally { this.restoring = false; }
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
    const masks: ScreenshotMask[] = [
      // Sensitive boxes painted into whichever images are attached; reporter masks are kept for later captures.
      ...uniqueRects([...(this.screenshot ? this.shotMasks : []), ...(this.crops.size ? this.baseMasks : [])])
        .map((docRect) => ({ docRect, reason: 'sensitive' as const })),
      ...this.masks.map((docRect) => ({ docRect, reason: 'reporter' as const })),
    ];
    return { text: this.text, selections, attachments, ...(masks.length ? { masks } : {}) };
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
    if (n) bits.push(this.strings.summarySelections(n));
    const note = this.text.trim() || this.selections.find((s) => s.note)?.note;
    if (note) bits.push(`“${note.length > 48 ? note.slice(0, 48) + '…' : note}”`);
    if (this.screenshot) bits.push(this.strings.summaryScreenshot);
    return bits.join(' · ');
  }

  private async send(): Promise<void> {
    await this.recovery;
    if (this.destroyed) return;
    if (this.sending) return;
    if (!this.text.trim() && this.selections.length === 0) {
      this.setStatus(this.strings.emptyDraft, true);
      return;
    }
    this.sending = true;
    const generation = this.captureGeneration;
    const btn = this.q<HTMLButtonElement>('[data-action=send]');
    btn.disabled = true;
    this.setStatus(this.strings.sendingStatus);
    try {
      // Masks, crops and the base screenshot may still be rendering if the user sent quickly.
      await this.maskJob;
      await this.base;
      await Promise.all(this.cropJobs.values());
      if (this.destroyed || generation !== this.captureGeneration) return;
      const payload = await this.client.send(this.draft());
      if (this.destroyed || generation !== this.captureGeneration) return;
      if (payload) {
        this.opts.onSent?.(payload);
        this.reset();
        this.close();
        this.toast(this.strings.sent);
      } else {
        this.setStatus(this.strings.cancelled, true);
        this.open();
      }
    } catch (err) {
      if (this.destroyed || generation !== this.captureGeneration) return;
      this.setStatus(this.strings.sendFailed(err instanceof Error ? err.message : String(err)), true);
      this.opts.onError?.(err);
      this.open(); // surface the error with the draft intact
    } finally {
      this.sending = false;
      btn.disabled = false;
    }
  }

  private reset(): void {
    this.revision++;
    this.captureGeneration++;
    this.restoring = true;
    this.cancelPending();
    this.closePopover();
    void this.client.clearPersistence?.();
    this.text = '';
    this.q<HTMLTextAreaElement>('[data-ref=text]').value = '';
    this.selections = [];
    this.liveEls.clear();
    for (const c of this.crops.values()) URL.revokeObjectURL(c.url);
    this.crops.clear();
    this.cropJobs.clear();
    this.base = null;
    this.masks = [];
    this.shotMasks = [];
    this.baseMasks = [];
    this.maskJob = Promise.resolve();
    this.renderMasks();
    this.setScreenshot(null);
    this.renderPins();
    this.renderSelections();
    this.setStatus('');
    this.renderPill();
    this.restoring = false;
  }

  /* ---------- rendering ---------- */

  private renderSelections(): void {
    const box = this.q('[data-ref=selections]');
    box.innerHTML = this.selections
      .map((s, i) => {
        const chain = s.components.length
          ? s.components.map(esc).join('<span class="sep">‹</span>')
          : `<span style="color:var(--lb-muted)">&lt;${esc(s.tag)}&gt;</span>`;
        const kind = s.kind === 'region' ? `<span class="lb-kind">${esc(this.strings.area)} · ${esc(this.strings.elementCount(s.region?.children.length ?? 0))}</span>` : '';
        const source = s.source ? `<span class="lb-source">${esc(fmtSource(s.source))}</span>` : '';
        const children = s.kind === 'region' && s.region
          ? `<div class="lb-children">${s.region.children.slice(0, 8).map((c) => `<span class="lb-chip" title="${esc(c.selector)}">${esc(c.components[0] ?? c.tag)}${c.text ? ` “${esc(c.text.slice(0, 20))}”` : ''}</span>`).join('')}${s.region.children.length > 8 ? `<span class="lb-chip">+${s.region.children.length - 8}</span>` : ''}</div>`
          : '';
        const hidden = s.sensitive ? `<div class="lb-sensitive" data-ref="sensitive">🔒 ${esc(this.strings.sensitiveContent)}</div>` : '';
        const note = s.note ? `<div class="lb-note">💬 ${esc(s.note)}</div>` : `<div class="lb-note empty">${esc(this.strings.noComment)}</div>`;
        const crop = this.crops.get(s.id);
        // Natural proportions, never enlarged past the selected area's on-page size (+2 for the border-box border).
        const cap = Number.isFinite(crop?.width) ? ` style="max-width:min(100%, ${Math.max(1, Math.round(crop!.width)) + 2}px)"` : '';
        const thumb = crop ? `<img class="lb-thumb" src="${crop.url}"${cap} alt="${esc(this.strings.cropPreview(i + 1))}">` : '';
        return `<div class="lb-sel" data-id="${esc(s.id)}">
  <div class="lb-sel-head"><span class="lb-badge${s.kind === 'region' ? ' region' : ''}">${i + 1}</span><span class="lb-chain" title="${esc(s.components.join(' < '))}">${chain} ${kind}</span><button class="lb-icon" type="button" data-action="sel-edit" aria-label="${esc(this.strings.editComment)}" title="${esc(this.strings.editComment)}">✎</button><button class="lb-icon" type="button" data-action="sel-remove" aria-label="${esc(this.strings.removeSelection)}">✕</button></div>
  <code class="lb-selector">${esc(s.selector)}</code>
  ${source}
  ${s.kind === 'element' && s.text ? `<div class="lb-text">“${esc(s.text.slice(0, 80))}”</div>` : ''}
  ${hidden}
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
      this.strings.reviewCounts(st);
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

/** Border box plus contents, so overflowing text and positioned descendants are covered too. */
function renderedBounds(el: Element): Rect {
  const boxes: Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }> = [el.getBoundingClientRect()];
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    if (typeof range.getBoundingClientRect === 'function') boxes.push(range.getBoundingClientRect());
  } catch { /* unsupported */ }
  const visible = boxes.filter((b) => b.width > 0 && b.height > 0);
  if (!visible.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...visible.map((b) => b.left));
  const top = Math.min(...visible.map((b) => b.top));
  return { x: left, y: top, width: Math.max(...visible.map((b) => b.right)) - left, height: Math.max(...visible.map((b) => b.bottom)) - top };
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x - pad < b.x + b.width && b.x < a.x + a.width + pad && a.y - pad < b.y + b.height && b.y < a.y + a.height + pad;
}

function uniqueRects(rects: Rect[]): Rect[] {
  const seen = new Set<string>();
  return rects.filter((r) => {
    const key = `${r.x},${r.y},${r.width},${r.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… truncated (${s.length} chars total)` : s;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
