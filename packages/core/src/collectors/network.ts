import type { NetworkEntry, RedactOptions } from '../types';
import { RingBuffer } from '../ring';
import { redactString, redactUrl, truncate } from '../redact';

interface NetworkConfig {
  bodies: boolean;
  maxString: number;
  redact: RedactOptions;
  /** Skip requests whose URL matches. The transport endpoint is always skipped. */
  ignore: (url: string) => boolean;
  /** While true, nothing is recorded (e.g. during a screenshot capture). */
  isMuted: () => boolean;
}

export function installNetwork(buffer: RingBuffer<NetworkEntry>, cfg: NetworkConfig): () => void {
  if (typeof window === 'undefined') return () => {};
  const undoFetch = patchFetch(buffer, cfg);
  const undoXhr = patchXhr(buffer, cfg);
  return () => {
    undoFetch();
    undoXhr();
  };
}

function cleanUrl(url: string, cfg: NetworkConfig): string {
  return truncate(redactString(redactUrl(url, cfg.redact), cfg.redact), cfg.maxString);
}

function cleanBody(body: string | undefined, cfg: NetworkConfig): string | undefined {
  if (body === undefined) return undefined;
  return truncate(redactString(body, cfg.redact), cfg.maxString);
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function patchFetch(buffer: RingBuffer<NetworkEntry>, cfg: NetworkConfig): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {};
  const original = window.fetch;
  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (cfg.isMuted() || cfg.ignore(url)) return original.call(window, input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const entry: NetworkEntry = { t: Date.now(), kind: 'fetch', method, url: cleanUrl(url, cfg) };
    const start = performance.now();
    if (cfg.bodies && isSameOrigin(url) && typeof init?.body === 'string') {
      entry.requestBody = cleanBody(init.body, cfg);
    }
    try {
      const res = await original.call(window, input, init);
      entry.status = res.status;
      entry.ok = res.ok;
      entry.duration = Math.round(performance.now() - start);
      if (cfg.bodies && isSameOrigin(url) && isTextLike(res.headers.get('content-type'))) {
        res
          .clone()
          .text()
          .then((text) => {
            entry.responseBody = cleanBody(text, cfg);
            buffer.touch();
          })
          .catch(() => {});
      }
      return res;
    } catch (err) {
      entry.duration = Math.round(performance.now() - start);
      entry.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      buffer.push(entry);
    }
  };
  return () => {
    window.fetch = original;
  };
}

function isTextLike(contentType: string | null): boolean {
  if (!contentType) return false;
  return /json|text|xml|javascript|x-www-form-urlencoded/i.test(contentType);
}

function patchXhr(buffer: RingBuffer<NetworkEntry>, cfg: NetworkConfig): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; start: number; ignored: boolean }>();

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const u = url.toString();
    meta.set(this, { method: method.toUpperCase(), url: u, start: 0, ignored: cfg.isMuted() || cfg.ignore(u) });
    return (originalOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = meta.get(this);
    if (m && !m.ignored) {
      m.start = performance.now();
      const entry: NetworkEntry = { t: Date.now(), kind: 'xhr', method: m.method, url: cleanUrl(m.url, cfg) };
      if (cfg.bodies && isSameOrigin(m.url) && typeof body === 'string') entry.requestBody = cleanBody(body, cfg);
      const finish = () => {
        entry.status = this.status;
        entry.ok = this.status >= 200 && this.status < 400;
        entry.duration = Math.round(performance.now() - m.start);
        if (this.status === 0) entry.error = 'network error';
        const textual = this.responseType === '' || this.responseType === 'text';
        if (cfg.bodies && textual && isSameOrigin(m.url)) {
          try {
            entry.responseBody = cleanBody(this.responseText, cfg);
          } catch {
            /* responseText may throw for non-text responses */
          }
        }
        buffer.push(entry);
      };
      this.addEventListener('loadend', finish, { once: true });
    }
    return originalSend.call(this, body);
  };

  return () => {
    proto.open = originalOpen;
    proto.send = originalSend;
  };
}
