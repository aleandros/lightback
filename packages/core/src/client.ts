import type {
  Attachment, Breadcrumb, ConsoleEntry, ElementSelection, ErrorEntry, FeedbackPayload,
  LightbackOptions, Limits, NetworkEntry, RedactOptions,
} from './types';
import { RingBuffer } from './ring';
import { installConsole } from './collectors/console';
import { installErrors } from './collectors/errors';
import { installNetwork } from './collectors/network';
import { installBreadcrumbs } from './collectors/breadcrumbs';
import { captureEnv } from './collectors/env';
import { mergeRedact, redactString } from './redact';
import { describeElement } from './inspect';
import { describeRegion, type RegionOptions } from './region';
import { fetchTransport } from './transport';
import { uid } from './format';

const DEFAULT_LIMITS: Limits = { console: 200, errors: 50, network: 100, breadcrumbs: 100, string: 2000 };

/** Attribute that marks DOM subtrees the collectors and the picker must ignore (the widget itself). */
export const IGNORE_ATTR = 'data-lightback-ignore';

export interface Draft {
  text: string;
  transcript?: string;
  selections: ElementSelection[];
  attachments: Attachment[];
}

export interface LightbackClient {
  readonly options: LightbackOptions;
  readonly redact: RedactOptions;
  setContext(context: Record<string, unknown>): void;
  getContext(): Record<string, unknown>;
  addBreadcrumb(message: string, data?: Record<string, unknown>): void;
  describeElement(el: Element): ElementSelection;
  /** Describe a dragged viewport rectangle (see `describeRegion`). */
  describeRegion(rect: { x: number; y: number; width: number; height: number }, opts?: RegionOptions): ElementSelection | null;
  isIgnored(el: Element): boolean;
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

function scrubDeep(value: unknown, scrub: (s: string) => string): unknown {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, scrub);
    return out;
  }
  return value;
}

export function createLightback(options: LightbackOptions = {}): LightbackClient {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const redact = mergeRedact(options.redact);
  const capture = { console: true, errors: true, network: true, breadcrumbs: true, networkBodies: false, ...options.capture };

  const consoleBuf = new RingBuffer<ConsoleEntry>(limits.console);
  const errorBuf = new RingBuffer<ErrorEntry>(limits.errors);
  const networkBuf = new RingBuffer<NetworkEntry>(limits.network);
  const breadcrumbBuf = new RingBuffer<Breadcrumb>(limits.breadcrumbs);
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
  const isMuted = () => muted > 0;

  const undo: Array<() => void> = [];
  if (capture.console) undo.push(installConsole(consoleBuf, limits.string, isMuted));
  if (capture.errors) undo.push(installErrors(errorBuf, limits.string));
  if (capture.network) {
    undo.push(installNetwork(networkBuf, { bodies: capture.networkBodies, maxString: limits.string, redact, ignore: isOwnEndpoint, isMuted }));
  }
  if (capture.breadcrumbs) undo.push(installBreadcrumbs(breadcrumbBuf, isIgnored));

  const scrub = (s: string) => redactString(s, redact);

  const client: LightbackClient = {
    options,
    redact,
    setContext(next) {
      context = { ...context, ...next };
    },
    getContext: () => ({ ...context }),
    addBreadcrumb(message, data) {
      breadcrumbBuf.push({ t: Date.now(), type: 'custom', message, data });
    },
    describeElement,
    describeRegion: (rect, opts) => describeRegion(rect, { isIgnored, ...opts }),
    isIgnored,
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
      return {
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
        note: { text: scrub(draft.text ?? ''), transcript: draft.transcript ? scrub(draft.transcript) : undefined },
        selections: (draft.selections ?? []).map((s) => scrubDeep(s, scrub) as ElementSelection),
        attachments: attachments.map(({ name, type, size }) => ({ name, type, size })),
        env: captureEnv(),
        console: consoleBuf.toArray().map((c) => ({ ...c, message: scrub(c.message) })),
        errors: errorBuf.toArray().map((e) => ({ ...e, message: scrub(e.message), stack: e.stack ? scrub(e.stack) : undefined })),
        network: networkBuf.toArray(),
        breadcrumbs: breadcrumbBuf.toArray(),
        context: JSON.parse(JSON.stringify(context)),
      };
    },
    async send(draft) {
      let payload = client.buildPayload(draft);
      if (options.beforeSend) {
        const result = await options.beforeSend(payload);
        if (!result) return null;
        payload = result;
      }
      const attachments = draft.attachments ?? [];
      if (options.send) {
        await options.send(payload, attachments);
      } else if (options.endpoint) {
        await fetchTransport(options.endpoint, payload, attachments, options.headers);
      } else {
        throw new Error('Lightback: provide either `endpoint` or `send`');
      }
      return payload;
    },
    destroy() {
      for (const u of undo.splice(0)) u();
    },
  };
  return client;
}
