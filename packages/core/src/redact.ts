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

/** Query parameters can occur in navigation messages, stack traces and JSON strings. */
export function redactText(value: string, opts: RedactOptions): string {
  return redactString(value, opts).replace(/([?&])([^\s=&?#]+)=([^\s&#"'<>]*)/g, (match, separator, key, parameter) => {
    try {
      // Network URLs may already carry URL-encoded redaction from the collector.
      if (parameter === encodeURIComponent(opts.replacement)) return match;
      return opts.urlParams.includes(decodeURIComponent(key)) ? `${separator}${key}=${opts.replacement}` : match;
    } catch { return match; }
  });
}

/** Copy and redact the complete payload, retaining its schema and attachment references. */
export function redactDeep(value: unknown, opts: RedactOptions): unknown {
  // Resolve Dates and user toJSON hooks before scrubbing, so serialization cannot
  // introduce new secrets after this boundary. Reports follow JSON semantics.
  const json = JSON.stringify(value);
  return json === undefined ? undefined : scrubJson(JSON.parse(json), opts);
}

function scrubJson(value: unknown, opts: RedactOptions, depth = 0): unknown {
  if (depth > 32) return opts.replacement;
  if (typeof value === 'string') {
    const text = redactText(value, opts);
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return JSON.stringify(scrubJson(parsed, opts, depth + 1));
    } catch { /* ordinary text */ }
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, opts, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      result[key] = [...opts.headers, ...opts.urlParams].some((secret) => secret.toLowerCase() === key.toLowerCase())
        ? opts.replacement : scrubJson(item, opts, depth + 1);
    }
    return result;
  }
  return value;
}
