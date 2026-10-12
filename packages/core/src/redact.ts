import type { RedactOptions } from './types';

export const DEFAULT_REDACT: RedactOptions = {
  headers: ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'],
  urlParams: ['token', 'access_token', 'api_key', 'apikey', 'key', 'secret', 'password'],
  patterns: [
    // JWT
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    // Credit card-ish sequences
    /\b(?:\d[ -]?){13,19}\b/g,
  ],
  replacement: '[redacted]',
};

export function mergeRedact(partial?: Partial<RedactOptions>): RedactOptions {
  if (!partial) return DEFAULT_REDACT;
  return {
    headers: [...DEFAULT_REDACT.headers, ...(partial.headers ?? [])].map((h) => h.toLowerCase()),
    urlParams: [...DEFAULT_REDACT.urlParams, ...(partial.urlParams ?? [])],
    patterns: [...DEFAULT_REDACT.patterns, ...(partial.patterns ?? [])],
    replacement: partial.replacement ?? DEFAULT_REDACT.replacement,
  };
}

export function redactString(value: string, opts: RedactOptions): string {
  let out = value;
  for (const re of opts.patterns) {
    re.lastIndex = 0;
    out = out.replace(re, opts.replacement);
  }
  return out;
}

export function redactUrl(url: string, opts: RedactOptions): string {
  try {
    const u = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost');
    let touched = false;
    for (const p of opts.urlParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, opts.replacement);
        touched = true;
      }
    }
    return touched ? u.toString() : url;
  } catch {
    return url;
  }
}

export function redactHeaders(headers: Record<string, string>, opts: RedactOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = opts.headers.includes(k.toLowerCase()) ? opts.replacement : v;
  }
  return out;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + `… [+${value.length - max} chars]` : value;
}
