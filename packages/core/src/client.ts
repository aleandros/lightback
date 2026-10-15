import type {
  Attachment, Breadcrumb, ConsoleEntry, ElementSelection, ErrorEntry, FeedbackPayload,
  LightbackOptions, Limits, NetworkEntry, Rect, RedactOptions, ScreenshotMask,
} from './types';
import { RingBuffer } from './ring';
import { installConsole } from './collectors/console';
import { installErrors } from './collectors/errors';
import { installNetwork } from './collectors/network';
import { installBreadcrumbs } from './collectors/breadcrumbs';
import { captureEnv } from './collectors/env';
import { mergeRedact, redactDeep } from './redact';
import { describeElement } from './inspect';
import { describeRegion, type RegionOptions } from './region';
import { fetchTransport } from './transport';
import { uid } from './format';
import { createPersistence, type RecoveryState } from './persistence';
import { scrubRecovery, isRecoveredSelection, isRect, isScreenshotMask } from './recovery-redact';
import { isSensitive, sensitiveRects, sensitiveSelector } from './sensitive';

const DEFAULT_LIMITS: Limits = { console: 200, errors: 50, network: 100, breadcrumbs: 100, string: 2000 };

/** Attribute that marks DOM subtrees the collectors and the picker must ignore (the widget itself). */
export const IGNORE_ATTR = 'data-lightback-ignore';

export interface Draft {
  text: string;
  transcript?: string;
  selections: ElementSelection[];
  attachments: Attachment[];
  /** Screenshot masks to report and to reapply to later captures (the built-in widget records them). */
  masks?: ScreenshotMask[];
  /** Widget edit layers over masked attachment originals. Draft-only; the widget flattens these before sending. */
  imageAnnotations?: ImageAnnotations[];
}

/** Endpoints relative to the image (0–1), independent of bitmap scale and document scroll. */
export interface ImageAnnotation {
  kind: 'rectangle' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface ImageAnnotations {
  attachment: string;
  shapes: ImageAnnotation[];
}

function cleanAnnotations(value: unknown, names: Set<string>): ImageAnnotations[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 51).flatMap((layer) => {
    if (!layer || typeof layer.attachment !== 'string' || !names.has(layer.attachment) || !Array.isArray(layer.shapes)) return [];
    const shapes = layer.shapes.slice(0, 50).filter((s: ImageAnnotation) => s &&
      ['rectangle', 'arrow'].includes(s.kind) && [s.x1, s.y1, s.x2, s.y2].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
      .map((s: ImageAnnotation) => ({ kind: s.kind, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }));
    return shapes.length ? [{ attachment: layer.attachment, shapes }] : [];
  });
}

export interface LightbackClient {
  readonly options: LightbackOptions;
  readonly redact: RedactOptions;
  /** Resolves once session recovery has finished (also resolves if storage is unavailable). */
  readonly ready: Promise<void>;
  /** Recovered/current draft, defensively copied. Await ready before the first read. */
  getDraft(): Draft | null;
  /** Checkpoint a custom editor's draft; the built-in widget calls this automatically. */
  saveDraft(draft: Draft): void;
  /** Flush pending recovery writes. Best effort; unavailable storage never rejects. */
  flushPersistence(): Promise<void>;
  /** Clear the draft and captured buffers, in memory and in recovery storage. */
  clearPersistence(): Promise<void>;
  setContext(context: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  addBreadcrumb(message: string, data?: Record<string, unknown>): void;
  describeElement(el: Element): ElementSelection;
  /** Describe a dragged viewport rectangle (see `describeRegion`). */
  describeRegion(rect: { x: number; y: number; width: number; height: number }, opts?: RegionOptions): ElementSelection | null;
  isIgnored(el: Element): boolean;
  /** True for elements inside `data-lightback-sensitive` or a `privacy.selectors` match. */
  isSensitive(el: Element): boolean;
  /** Document-space rects of rendered sensitive elements, for masking screenshot pixels. */
  sensitiveRects(): Rect[];
  /** Snapshot everything captured so far plus the draft into a payload. Does not send. */
  buildPayload(draft: Partial<Draft>): FeedbackPayload;
  /** Build, run beforeSend, and deliver. Resolves with the payload that was sent, or null if vetoed. */
  send(draft: Partial<Draft>): Promise<FeedbackPayload | null>;
  /** Counts of what is currently buffered, for UI badges. */
  stats(): { console: number; errors: number; network: number; breadcrumbs: number };
  /** Run `fn` with console and network capture paused, so the library's own work leaves no trace. */
  mute<T>(fn: () => Promise<T>): Promise<T>;
  destroy(): void;
}

function cleanMasks(masks: unknown): ScreenshotMask[] {
  if (!Array.isArray(masks)) return [];
  const valid = masks.filter(isScreenshotMask);
  // Bound each reason separately: many sensitive matches must not evict the reporter's own areas.
  return [
    ...valid.filter((m) => m.reason === 'sensitive').slice(0, 300),
    ...valid.filter((m) => m.reason === 'reporter').slice(0, 100),
  ].map((m) => ({ docRect: { x: m.docRect.x, y: m.docRect.y, width: m.docRect.width, height: m.docRect.height }, reason: m.reason }));
}

/** A copy of a valid, non-empty image area, so attachment metadata carries only numbers. */
function cleanArea(area: unknown): { area: Rect } | Record<string, never> {
  if (!isRect(area) || area.width <= 0 || area.height <= 0) return {};
  return { area: { x: area.x, y: area.y, width: area.width, height: area.height } };
}

export function createLightback(options: LightbackOptions = {}): LightbackClient {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const redact = mergeRedact(options.redact);
  const sensitive = sensitiveSelector(options.privacy?.selectors);
  const capture = { console: true, errors: true, network: true, breadcrumbs: true, networkBodies: false, ...options.capture };

  let persistence: ReturnType<typeof createPersistence> | undefined;
  let savedDraft: Draft | null = null;
  let draftChanged = false;
  const changed = () => persistence?.schedule();
  const consoleBuf = new RingBuffer<ConsoleEntry>(limits.console, changed);
  const errorBuf = new RingBuffer<ErrorEntry>(limits.errors, changed);
  const networkBuf = new RingBuffer<NetworkEntry>(limits.network, changed);
  const breadcrumbBuf = new RingBuffer<Breadcrumb>(limits.breadcrumbs, changed);
  let context: Record<string, unknown> = { ...options.context };

  const isIgnored = (el: Element) => el.closest(`[${IGNORE_ATTR}]`) !== null;
  const isOwnEndpoint = (url: string) => {
    if (!options.endpoint) return false;
    try {
      return new URL(url, location.href).href === new URL(options.endpoint, location.href).href;
    } catch {
      return false;
    }
  };

  let muted = 0;
  let networkEpoch = 0;
  let destroyed = false;
  const isMuted = () => muted > 0;

  const undo: Array<() => void> = [];
  if (capture.console) undo.push(installConsole(consoleBuf, limits.string, isMuted));
  if (capture.errors) undo.push(installErrors(errorBuf, limits.string));
  if (capture.network) {
    undo.push(installNetwork(networkBuf, { bodies: capture.networkBodies, maxString: limits.string, redact, ignore: isOwnEndpoint, isMuted, epoch: () => destroyed ? undefined : networkEpoch }));
  }
  if (capture.breadcrumbs) undo.push(installBreadcrumbs(breadcrumbBuf, isIgnored, sensitive));

  const clean = <T>(value: T): T => scrubRecovery(value, redact, limits.string) as T;
  const cleanDraft = (draft: Draft): Draft => {
    // Masks are rebuilt from validated numbers and an enum, so they need no string scrubbing or its array cap.
    const { attachments, masks, imageAnnotations, ...metadata } = draft;
    const result = clean(metadata);
    return {
      ...result,
      ...(masks !== undefined ? { masks: cleanMasks(masks) } : {}),
      ...(imageAnnotations !== undefined ? { imageAnnotations: cleanAnnotations(imageAnnotations, new Set(attachments.slice(0, 51).map((a) => a?.name))).map((l) => ({ ...l, attachment: clean(l.attachment) })) } : {}),
      selections: result.selections.slice(0, 50),
      attachments: attachments.slice(0, 51).filter((a) => a && typeof a.name === 'string' && a.blob instanceof Blob).map((a) => ({
        name: clean(a.name), type: clean(a.blob.type), size: a.blob.size, ...cleanArea(a.area), blob: a.blob,
      })),
    };
  };
  const snapshot = (): RecoveryState => ({
    console: consoleBuf.toArray().map(clean), errors: errorBuf.toArray().map(clean),
    network: networkBuf.toArray().map(clean), breadcrumbs: breadcrumbBuf.toArray().map(clean),
    draft: savedDraft ? cleanDraft(savedDraft) : null,
  });
  const merge = <T extends { t: number }>(buffer: RingBuffer<T>, previous: T[], enabled: boolean, valid: (entry: T) => boolean) => {
    if (!enabled) return;
    const entries = [...previous.filter((entry) => entry && Number.isFinite(entry.t) && valid(entry)), ...buffer.toArray()].sort((a, b) => a.t - b.t);
    buffer.clear();
    for (const entry of entries) buffer.push(entry);
  };
  persistence = createPersistence(options.persistence, snapshot, (state) => {
    merge(consoleBuf, state.console.map(clean), capture.console, (e) => typeof e.message === 'string' && ['log', 'info', 'warn', 'error', 'debug'].includes(e.level));
    merge(errorBuf, state.errors.map(clean), capture.errors, (e) => typeof e.message === 'string' && ['error', 'unhandledrejection'].includes(e.kind));
    merge(networkBuf, state.network.map(clean).map((entry) => capture.networkBodies ? entry : { ...entry, requestBody: undefined, responseBody: undefined }), capture.network,
      (e) => typeof e.url === 'string' && typeof e.method === 'string' && ['fetch', 'xhr'].includes(e.kind));
    merge(breadcrumbBuf, state.breadcrumbs.map(clean), capture.breadcrumbs, (e) => typeof e.message === 'string' && typeof e.type === 'string');
    if (!draftChanged && state.draft) {
      const draft = cleanDraft(state.draft);
      draft.selections = draft.selections.filter(isRecoveredSelection);
      if (!options.persistence || !options.persistence.attachments) draft.attachments = [];
      const names = new Set(draft.attachments.map((attachment) => attachment.name));
      draft.selections.forEach((selection) => { if (!names.has(selection.crop ?? '')) delete selection.crop; });
      savedDraft = draft;
    }
    changed(); // Re-checkpoint under the current capture, redaction and attachment policy.
  });

  const client: LightbackClient = {
    options,
    redact,
    ready: persistence.ready,
    getDraft: () => savedDraft ? cleanDraft(savedDraft) : null,
    saveDraft(draft) {
      draftChanged = true;
      savedDraft = cleanDraft(draft);
      changed();
    },
    flushPersistence: () => persistence!.flush(),
    clearPersistence() {
      networkEpoch++;
      draftChanged = true;
      savedDraft = null;
      consoleBuf.clear(); errorBuf.clear(); networkBuf.clear(); breadcrumbBuf.clear();
      return persistence!.clear();
    },
    setContext(next) {
      context = { ...context, ...next };
    },
    getContext: () => ({ ...context }),
    addBreadcrumb(message, data) {
      breadcrumbBuf.push({ t: Date.now(), type: 'custom', message, data });
    },
    describeElement: (el) => describeElement(el, { sensitive }),
    // The configured privacy selector cannot be overridden or cleared per call.
    describeRegion: (rect, opts) => describeRegion(rect, { isIgnored, ...opts, sensitive }),
    isIgnored,
    isSensitive: (el) => isSensitive(el, sensitive),
    sensitiveRects: () => sensitiveRects(sensitive, isIgnored),
    stats: () => ({ console: consoleBuf.size, errors: errorBuf.size, network: networkBuf.size, breadcrumbs: breadcrumbBuf.size }),
    async mute(fn) {
      muted++;
      try {
        return await fn();
      } finally {
        muted--;
      }
    },
    buildPayload(draft) {
      const attachments = draft.attachments ?? [];
      return redactDeep({
        version: 1,
        id: uid(),
        createdAt: new Date().toISOString(),
        page: {
          url: typeof location !== 'undefined' ? location.href : '',
          title: typeof document !== 'undefined' ? document.title : '',
          referrer: typeof document !== 'undefined' ? document.referrer : '',
          scroll: typeof window !== 'undefined' ? { x: Math.round(window.scrollX), y: Math.round(window.scrollY) } : { x: 0, y: 0 },
          size:
            typeof document !== 'undefined'
              ? { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }
              : { width: 0, height: 0 },
        },
        note: { text: draft.text ?? '', transcript: draft.transcript },
        selections: draft.selections ?? [],
        attachments: attachments.map(({ name, type, size, area }) => ({ name, type, size, ...cleanArea(area) })),
        env: captureEnv(),
        console: consoleBuf.toArray(),
        errors: errorBuf.toArray(),
        network: networkBuf.toArray(),
        breadcrumbs: breadcrumbBuf.toArray(),
        context,
        // Masks describe images; a draft without attachments keeps them only for later captures.
        ...(draft.masks?.length && attachments.length ? { masks: cleanMasks(draft.masks) } : {}),
      }, redact) as FeedbackPayload;
    },
    async send(draft) {
      await client.ready;
      let payload = client.buildPayload(draft);
      if (options.beforeSend) {
        const result = await options.beforeSend(payload);
        if (!result) return null;
        payload = result;
      }
      const attachments = (draft.attachments ?? []).map(({ blob, area, ...ref }) => ({
        ...redactDeep(ref, redact) as Omit<Attachment, 'blob'>, ...cleanArea(area), blob,
      }));
      if (options.send) {
        await options.send(payload, attachments);
      } else if (options.endpoint) {
        await fetchTransport(options.endpoint, payload, attachments, options.headers);
      } else {
        throw new Error('Lightback: provide either `endpoint` or `send`');
      }
      await client.clearPersistence();
      return payload;
    },
    destroy() {
      destroyed = true;
      for (const u of undo.splice(0)) u();
      persistence!.destroy();
    },
  };
  return client;
}
