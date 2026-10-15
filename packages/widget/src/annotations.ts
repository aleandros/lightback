import type { ImageAnnotation } from '@lightback/core';
import { decodeScreenshot, release, type Drawable } from './screenshot';
import type { WidgetStrings } from './strings';

type Layer = { source: Blob; shapes: ImageAnnotation[]; blob: Blob; url?: string; job?: Promise<void>; version: number; running?: boolean; error?: unknown };
const copy = (shapes: ImageAnnotation[]) => shapes.map((s) => ({ ...s }));
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Paint in image coordinates; preview and attachment use the same renderer and PNG. */
export function paintAnnotations(canvas: HTMLCanvasElement, source: Drawable, shapes: ImageAnnotation[]): void {
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Lightback: annotations require a 2D canvas');
  ctx.drawImage(source, 0, 0);
  const width = Math.max(2, Math.min(canvas.width, canvas.height) / 150);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A white under-stroke keeps the orange mark visible on both dark and light screenshots.
  for (const s of shapes) {
    const x = s.x1 * canvas.width, y = s.y1 * canvas.height;
    const ex = s.x2 * canvas.width, ey = s.y2 * canvas.height;
    ctx.beginPath();
    if (s.kind === 'rectangle') ctx.rect(Math.min(x, ex), Math.min(y, ey), Math.abs(ex - x), Math.abs(ey - y));
    else {
      const angle = Math.atan2(ey - y, ex - x);
      const head = Math.min(width * 5, Math.hypot(ex - x, ey - y) / 2);
      ctx.moveTo(x, y); ctx.lineTo(ex, ey);
      ctx.moveTo(ex - head * Math.cos(angle - .5), ey - head * Math.sin(angle - .5));
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex - head * Math.cos(angle + .5), ey - head * Math.sin(angle + .5));
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = width + 2; ctx.stroke();
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = width; ctx.stroke();
  }
}

/** Owns bounded vector layers and derived PNGs. Sources are always already masked. */
export class AnnotationEditor {
  private layers = new Map<string, Layer>();
  private active: string | null = null;
  private bitmap: Drawable | null = null;
  private history: ImageAnnotation[][] = [];
  private selected = -1;
  private drag: ImageAnnotation | null = null;
  private pointer: number | null = null;
  private opener: HTMLElement | null = null;
  private load = 0;
  private canvas: HTMLCanvasElement;
  private box: HTMLElement;
  constructor(private root: ShadowRoot, private strings: WidgetStrings, private changed: () => void, private closed: () => void) {
    this.box = this.q('annotationEditor');
    this.canvas = this.q('annotationCanvas');
    this.canvas.width = this.canvas.height = 1;
    this.q<HTMLSelectElement>('annotationList').addEventListener('change', (e) => {
      this.selected = Number((e.target as HTMLSelectElement).value); this.fields();
    });
    const point = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.bitmap || this.pointer !== null || this.current()!.shapes.length >= 50) return;
      e.preventDefault();
      const p = point(e);
      this.pointer = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { kind: this.q<HTMLSelectElement>('annotationKind').value as ImageAnnotation['kind'], x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.pointer) return;
      const p = point(e); this.drag.x2 = p.x; this.drag.y2 = p.y; this.paint();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.drag || e.pointerId !== this.pointer) return;
      const p = point(e), shape = { ...this.drag, x2: p.x, y2: p.y };
      this.cancelDrag();
      if (Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > .005) this.commit([...this.current()!.shapes, shape]);
    });
    this.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.canvas.addEventListener('lostpointercapture', () => this.cancelDrag());
    this.box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.drag) this.cancelDrag(); else void this.finish(); }
      if (e.key === 'Tab') {
        const controls = Array.from(this.box.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)'));
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && this.root.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && this.root.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
  }
  private q<T extends HTMLElement>(ref: string): T { return this.root.querySelector(`[data-ref=${ref}]`) as T; }
  private current() { return this.active ? this.layers.get(this.active) : undefined; }
  shapes(key: string): ImageAnnotation[] { return copy(this.layers.get(key)?.shapes ?? []); }
  blob(key: string, fallback: Blob): Blob { return this.layers.get(key)?.blob ?? fallback; }
  url(key: string, fallback: string): string { return this.layers.get(key)?.url ?? fallback; }
  hasSource(key: string): boolean { return this.layers.has(key); }
  setSource(key: string, source: Blob, shapes = this.shapes(key)): void {
    // Reserve a slot for the screenshot, plus at most 50 editable crops.
    if (!this.layers.has(key) && key !== 'screenshot' && [...this.layers.keys()].filter((k) => k !== 'screenshot').length >= 50) return;
    if (this.layers.get(key)?.source === source) return;
    this.remove(key);
    const layer: Layer = { source, shapes: copy(shapes).slice(0, 50), blob: source, version: 0 };
    this.layers.set(key, layer);
    if (layer.shapes.length) this.render(key, layer);
  }
  restore(key: string, shapes: ImageAnnotation[]): void {
    const layer = this.layers.get(key);
    if (layer) { layer.shapes = copy(shapes).slice(0, 50); this.render(key, layer); }
  }
  remove(key: string): void {
    if (this.active === key) this.close();
    const layer = this.layers.get(key);
    if (layer?.url) URL.revokeObjectURL(layer.url);
    this.layers.delete(key);
  }
  clear(): void { this.close(false); for (const key of this.layers.keys()) this.remove(key); }
  get hasJobs(): boolean { return [...this.layers.values()].some((l) => !!l.job); }
  async flush(): Promise<void> {
    // New edits or replaced images may arrive while an encode is in progress.
    while (true) {
      const jobs = [...this.layers.values()].map((l) => l.job);
      await Promise.all(jobs);
      if ([...this.layers.values()].some((l) => l.job && !jobs.includes(l.job))) continue;
      for (const l of this.layers.values()) if (l.error) throw l.error;
      return;
    }
  }
  async open(key: string, opener: HTMLElement): Promise<void> {
    this.close(false);
    const layer = this.layers.get(key);
    if (!layer) return;
    this.active = key; this.opener = opener; this.history = []; this.selected = layer.shapes.length - 1;
    this.box.hidden = false;
    for (const child of this.root.children) if (child instanceof HTMLElement && child !== this.box) child.inert = true;
    this.q('annotationStatus').textContent = this.strings.loading;
    this.q('annotationKind').focus();
    const load = ++this.load;
    try {
      const bitmap = await decodeScreenshot(layer.source);
      if (load !== this.load) { release(bitmap); return; }
      this.bitmap = bitmap;
      this.controls(); this.paint();
    } catch (error) {
      if (load === this.load) this.q('annotationStatus').textContent = this.strings.screenshotFailed(String(error));
    }
  }
  private async finish(): Promise<void> {
    const load = this.load;
    this.q('annotationStatus').textContent = this.strings.loading;
    try {
      await this.flush();
      if (load === this.load) this.close();
    } catch (error) {
      if (load === this.load) this.q('annotationStatus').textContent = this.strings.screenshotFailed(String(error));
    }
  }
  close(notify = true): void {
    if (this.active === null) return;
    const opener = this.opener;
    const action = opener?.dataset.action;
    const id = opener?.closest<HTMLElement>('[data-id]')?.dataset.id;
    this.load++; this.cancelDrag();
    this.active = null; this.box.hidden = true;
    for (const child of this.root.children) if (child instanceof HTMLElement) child.inert = false;
    if (this.bitmap) release(this.bitmap);
    this.bitmap = null; this.canvas.width = this.canvas.height = 1; this.history = [];
    this.opener = null;
    if (notify) {
      this.closed();
      // Rendering a crop replaces its card; restore focus to the replacement control.
      const target = opener?.isConnected ? opener : Array.from(this.root.querySelectorAll<HTMLElement>('[data-action]'))
        .find((el) => el.dataset.action === action && el.closest<HTMLElement>('[data-id]')?.dataset.id === id);
      target?.focus();
    }
  }
  action(action: string): void {
    const layer = this.current();
    if (!layer) return;
    if (action === 'annotation-close') { void this.finish(); return; }
    if (!this.bitmap) return;
    this.cancelDrag();
    if (action === 'annotation-undo') {
      const prior = this.history.pop();
      if (prior) { layer.shapes = prior; this.selected = prior.length - 1; this.update(); }
    } else if (action === 'annotation-reset') this.commit([]);
    else if (action === 'annotation-delete') this.commit(layer.shapes.filter((_, i) => i !== this.selected));
    else if (action === 'annotation-add') {
      if (layer.shapes.length < 50) this.commit([...layer.shapes, { kind: this.q<HTMLSelectElement>('annotationKind').value as ImageAnnotation['kind'], x1: .2, y1: .2, x2: .7, y2: .7 }]);
    } else if (action === 'annotation-apply' && this.selected >= 0) {
      const values = ['X1', 'Y1', 'X2', 'Y2'].map((ref) => this.q<HTMLInputElement>('annotation' + ref).valueAsNumber);
      if (values.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
        this.q('annotationStatus').textContent = this.strings.annotationInvalid; return;
      }
      const [x1, y1, x2, y2] = values.map((n) => n / 100) as [number, number, number, number];
      const next = copy(layer.shapes); next[this.selected] = { ...next[this.selected]!, x1, y1, x2, y2 };
      this.commit(next, this.selected);
    }
  }
  private cancelDrag(): void {
    const pointer = this.pointer; this.pointer = null; this.drag = null;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.paint();
  }
  private commit(shapes: ImageAnnotation[], selected = shapes.length - 1): void {
    this.history.push(copy(this.current()!.shapes));
    if (this.history.length > 20) this.history.shift();
    this.current()!.shapes = copy(shapes); this.selected = selected; this.update();
  }
  private update(): void {
    this.controls(); this.paint(); this.render(this.active!, this.current()!); this.changed();
  }
  private render(key: string, layer: Layer): void {
    layer.version++;
    layer.error = undefined;
    // One worker per image reads only the latest layer: rapid edits never queue bitmap copies or snapshots.
    if (layer.running) return;
    layer.running = true;
    const job = (async () => {
      await Promise.resolve();
      while (this.layers.get(key) === layer) {
        const version = layer.version;
        const shapes = copy(layer.shapes);
        let blob = layer.source;
        try {
          if (shapes.length) {
            const bitmap = await decodeScreenshot(layer.source);
            try {
              const canvas = document.createElement('canvas');
              paintAnnotations(canvas, bitmap, shapes);
              blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode annotations')), 'image/png'));
            } finally { release(bitmap); }
          }
        } catch (error) {
          if (this.layers.get(key) !== layer) return;
          if (version !== layer.version) continue;
          throw error;
        }
        // Superseded renders and completions after replacement/discard/destroy never reach previews or send.
        if (this.layers.get(key) !== layer) return;
        if (version !== layer.version) continue;
        if (layer.url) URL.revokeObjectURL(layer.url);
        layer.blob = blob; layer.url = URL.createObjectURL(blob);
        this.changed();
        // An encode finishing must not overwrite endpoint inputs the reporter is currently editing.
        if (this.active === key) this.q('annotationStatus').textContent = this.strings.annotationCount(layer.shapes.length);
        return;
      }
    })();
    layer.job = job;
    void job.then(() => { layer.running = false; }, (error: unknown) => {
      layer.running = false;
      if (this.layers.get(key) !== layer) return;
      layer.error = error;
      if (this.active === key) this.q('annotationStatus').textContent = this.strings.screenshotFailed(String(error));
    });
  }
  private paint(): void {
    if (this.bitmap && this.current()) paintAnnotations(this.canvas, this.bitmap, [...this.current()!.shapes, ...(this.drag ? [this.drag] : [])]);
  }
  private controls(): void {
    const shapes = this.current()!.shapes;
    const list = this.q<HTMLSelectElement>('annotationList');
    list.replaceChildren(...shapes.map((s, i) => new Option(`${i + 1}. ${s.kind === 'arrow' ? this.strings.annotationArrow : this.strings.annotationRectangle}`, String(i))));
    list.value = String(this.selected); list.disabled = !shapes.length;
    for (const action of ['apply', 'delete']) this.root.querySelector<HTMLButtonElement>(`[data-action=annotation-${action}]`)!.disabled = this.selected < 0;
    this.root.querySelector<HTMLButtonElement>('[data-action=annotation-add]')!.disabled = shapes.length >= 50;
    this.root.querySelector<HTMLButtonElement>('[data-action=annotation-reset]')!.disabled = !shapes.length;
    this.root.querySelector<HTMLButtonElement>('[data-action=annotation-undo]')!.disabled = !this.history.length;
    this.q('annotationStatus').textContent = this.strings.annotationCount(shapes.length);
    this.fields();
  }
  private fields(): void {
    const s = this.current()?.shapes[this.selected];
    ['X1', 'Y1', 'X2', 'Y2'].forEach((ref, i) => {
      const input = this.q<HTMLInputElement>('annotation' + ref);
      input.disabled = !s;
      input.value = s ? String(Math.round([s.x1, s.y1, s.x2, s.y2][i]! * 1000) / 10) : '';
    });
  }
}
