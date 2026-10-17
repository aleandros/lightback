import type { RedactOptions } from './types';
import { redactString, redactText } from './redact';

/** Scrub before truncation, and never store inspection HTML or form-control values. */
export function scrubRecovery(value: unknown, options: RedactOptions, maxString: number, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (typeof value === 'string') {
    let text = redactText(value, options);
    // JSON bodies and logs may contain secret keys as text.
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') text = JSON.stringify(scrubRecovery(parsed, options, maxString, depth + 1));
    } catch { /* ordinary text */ }
    return text.slice(0, Math.max(0, maxString));
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => scrubRecovery(item, options, maxString, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      const lower = key.toLowerCase();
      if (['html', 'value', 'defaultvalue', 'innerhtml', 'dangerouslysetinnerhtml'].includes(lower)) continue;
      // Tiny value limits must not rename structural fields such as `selections`.
      const cleanKey = redactString(key, options).slice(0, Math.max(64, maxString));
      result[cleanKey] = [...options.headers, ...options.urlParams].some((secret) => secret.toLowerCase() === lower)
        ? options.replacement : scrubRecovery(item, options, maxString, depth + 1);
    }
    return result;
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined;
}

/** A corrupt/older selection must not reach the widget's rendering code. */
export function isRecoveredSelection(value: unknown): boolean {
  const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  const source = (v: unknown) => v === undefined || (object(v) && typeof v.file === 'string' &&
    (v.line === undefined || Number.isFinite(v.line)) && (v.column === undefined || Number.isFinite(v.column)));
  const summary = (v: unknown) => object(v) && typeof v.selector === 'string' && typeof v.tag === 'string' &&
    (v.context === undefined || (Array.isArray(v.context) && v.context.every((c: unknown) => object(c) && ['shadow', 'frame'].includes(c.kind) && typeof c.selector === 'string'))) &&
    typeof v.text === 'string' && strings(v.components) && isRect(v.rect) && isRect(v.docRect) && source(v.source);
  return object(value) && summary(value) && typeof value.id === 'string' && ['element', 'region'].includes(value.kind) &&
    strings(value.classes) && object(value.attrs) && Object.values(value.attrs).every((v) => typeof v === 'string') &&
    Array.isArray(value.chain) && value.chain.every((v) => object(v) && typeof v.name === 'string' && source(v.source)) &&
    (value.note === undefined || typeof value.note === 'string') && (value.crop === undefined || typeof value.crop === 'string') &&
    (value.kind !== 'region' || (object(value.region) && isRect(value.region.rect) && isRect(value.region.docRect) &&
      Array.isArray(value.region.children) && value.region.children.every(summary)));
}

export function isRect(value: unknown): value is import('./types').Rect {
  const v = value as Record<string, unknown> | null;
  return !!v && typeof v === 'object' && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(v[key]));
}

export function isScreenshotMask(value: unknown): value is import('./types').ScreenshotMask {
  const v = value as Record<string, any> | null;
  return !!v && typeof v === 'object' && (v.reason === 'sensitive' || v.reason === 'reporter') && isRect(v.docRect);
}
