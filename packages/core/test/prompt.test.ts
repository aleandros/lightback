// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toPromptContext, type PromptOptions } from '../src/index';
import type { FeedbackPayload } from '../src/types';

const submitted = Date.parse('2026-10-15T12:00:00.000Z');
const t = (seconds: number) => submitted + seconds * 1000;
function report(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    version: 1, id: 'prompt-fixture', createdAt: new Date(submitted).toISOString(),
    page: { title: 'Invoices', url: 'https://app.test/invoices', referrer: '',
      scroll: { x: 0, y: 0 }, size: { width: 1200, height: 800 } },
    note: { text: 'Payment did not finish' }, selections: [], attachments: [],
    env: { userAgent: 'fixture', language: 'en', timezone: 'UTC', online: true,
      devicePixelRatio: 1, viewport: { width: 1200, height: 800 }, screen: { width: 1200, height: 800 } },
    errors: [], network: [], console: [], breadcrumbs: [], context: {}, ...overrides,
  };
}

function section(prompt: string, title: string): string {
  return prompt.split(`## ${title} (`)[1]?.split('\n## ')[0] ?? '';
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

describe('prompt evidence (without a browser)', () => {
  it('surfaces interaction-adjacent failures despite newer polling noise, without mutating the report', () => {
    const p = report({
      breadcrumbs: [
        { t: t(-20), type: 'click', message: '#pay' },
        { t: t(-1), type: 'visibility', message: 'visible' },
        { t: t(-0.5), type: 'custom', message: 'background refresh' },
        { t: t(1), type: 'click', message: 'after submission' },
      ],
      errors: [
        { t: t(-1), kind: 'error', message: 'unrelated recent error' },
        { t: t(-19.999), kind: 'error', message: 'payment failed', stack: 'Error\n at pay\n at click' },
      ],
      network: [
        { t: t(-100), kind: 'fetch', method: 'GET', url: '/old', status: 500, ok: false },
        { t: t(-19), kind: 'fetch', method: 'POST', url: '/pay', status: 503, ok: false, responseBody: 'unavailable' },
        ...Array.from({ length: 100 }, (_, i) => ({
          t: t(-10 + i / 10), kind: 'fetch' as const, method: 'GET', url: '/poll', status: 200, ok: true, duration: i + 1,
        })),
      ],
      console: [
        ...Array.from({ length: 100 }, (_, i) => ({ t: t(-10 + i / 10), level: 'log' as const, message: 'polling' })),
        { t: t(-19), level: 'error', message: 'checkout error' },
        { t: t(-20), level: 'warn', message: 'checkout warning' },
      ],
    });
    const before = JSON.stringify(p);
    freeze(p);
    const md = toPromptContext(p, { maxLogLines: 1 });
    expect(md).toContain('latest captured click before submission [-20.000s]: #pay');
    expect(section(md, 'Errors')).toContain('[-19.999s] error: payment failed');
    expect(section(md, 'Errors')).not.toContain('unrelated recent error');
    expect(section(md, 'Network')).toContain('POST /pay -> 503');
    expect(section(md, 'Network')).not.toContain('/poll');
    expect(section(md, 'Console')).toContain('error: checkout error');
    expect(md).toContain('Showing 1 of 3 distinct groups; 2 omitted.');
    expect(md).toContain('Selections have no timestamps; temporal proximity is not evidence of causality.');
    expect(toPromptContext(p, { maxLogLines: 1 })).toBe(md);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('groups repeats before limiting and preserves time spans, counts and request duration ranges', () => {
    const p = report({
      errors: [-4, -10, -2].map(s => ({ t: t(s), kind: 'error', message: 'repeat', source: 'app.ts', stack: 'same stack' })),
      network: [40, 10, 30].map((duration, i) => ({
        t: t(-3 + i), kind: 'xhr', method: 'GET', url: '/poll', status: 200, ok: true, duration,
      })),
      console: [-4, -2].map(s => ({ t: t(s), level: 'warn', message: 'repeat warning' })),
      breadcrumbs: [-5, -3].map(s => ({ t: t(s), type: 'custom', message: 'repeat custom', data: { id: 1 } })),
    });
    const md = toPromptContext(p);
    expect(md).toContain('[-10.000s .. -2.000s; 3 occurrences; nearest -2.000s] error: repeat');
    expect(md).toContain('[-3.000s .. -1.000s; 3 occurrences; nearest -1.000s] GET /poll -> 200 (10..40ms)');
    expect(md).toContain('[-4.000s .. -2.000s; 2 occurrences; nearest -2.000s] warn: repeat warning');
    expect(md).toContain('[-5.000s .. -3.000s; 2 occurrences; nearest -3.000s] custom: repeat custom');
    expect(md.match(/Showing 1 of 1 distinct groups; 0 omitted\./g)).toHaveLength(4);
  });

  it('does not merge distinct stacks, sources, levels, request details or breadcrumb data', () => {
    const base = { t: t(-1), kind: 'fetch' as const, method: 'GET', url: '/same', status: 500, ok: false };
    const p = report({
      errors: [
        { t: t(-1), kind: 'error', message: 'same', stack: 'first', source: 'a' },
        { t: t(-1), kind: 'error', message: 'same', stack: 'second', source: 'a' },
        { t: t(-1), kind: 'error', message: 'same', stack: 'second', source: 'b' },
      ],
      network: [base, { ...base, method: 'POST' }, { ...base, status: 502 },
        { ...base, requestBody: 'different' }, { ...base, responseBody: 'x'.repeat(300) + 'A' },
        { ...base, responseBody: 'x'.repeat(300) + 'B' }, { ...base, kind: 'xhr' }, { ...base, url: '/other' }],
      console: [{ t: t(-1), level: 'warn', message: 'same' }, { t: t(-1), level: 'error', message: 'same' }],
      breadcrumbs: [1, 2].map(id => ({ t: t(-1), type: 'custom', message: 'same', data: { id } })),
    });
    const md = toPromptContext(p);
    expect(section(md, 'Errors')).toContain('Showing 3 of 3');
    expect(section(md, 'Network')).toContain('Showing 8 of 8');
    expect(section(md, 'Console')).toContain('Showing 2 of 2');
    expect(section(md, 'Breadcrumbs')).toContain('Showing 2 of 2');
    expect(md).not.toContain('occurrences');
  });

  it('uses actual occurrence proximity, not a repeat span, and keeps ties in input order', () => {
    const md = toPromptContext(report({
      breadcrumbs: [{ t: t(-10), type: 'click', message: '#pay' }],
      errors: [
        { t: t(-20), kind: 'error', message: 'spans anchor' },
        { t: t(0), kind: 'error', message: 'spans anchor' },
        { t: t(-9), kind: 'error', message: 'first tied group' },
        { t: t(-11), kind: 'error', message: 'second tied group' },
      ],
    }));
    const errors = section(md, 'Errors');
    expect(errors.indexOf('first tied group')).toBeLessThan(errors.indexOf('second tied group'));
    expect(errors.indexOf('second tied group')).toBeLessThan(errors.indexOf('spans anchor'));
  });

  it.each(['click', 'input', 'navigation'] as const)('anchors to the latest %s by timestamp, not array position', type => {
    const md = toPromptContext(report({ breadcrumbs: [
      { t: t(-2), type, message: 'latest' }, { t: t(-10), type: 'click', message: 'older' },
    ] }));
    expect(md).toContain(`latest captured ${type} before submission [-2.000s]: latest`);
  });

  it('uses submission as fallback and shows distant evidence without claiming it explains the report', () => {
    const md = toPromptContext(report({
      errors: [{ t: t(-600), kind: 'error', message: 'background failure' }],
      breadcrumbs: [{ t: t(-1), type: 'custom', message: 'heartbeat' }],
    }));
    expect(md).toContain('Time anchor: report submission (no eligible interaction breadcrumb).');
    expect(md).toContain('[-600.000s] error: background failure');
    expect(md).toContain('temporal proximity is not evidence of causality');
  });

  it('recognizes status-only and transport failures ahead of successful requests', () => {
    const md = toPromptContext(report({ network: [
      { t: t(-1), kind: 'fetch', method: 'GET', url: '/success', status: 200, ok: true },
      { t: t(-3), kind: 'fetch', method: 'GET', url: '/http', status: 500 },
      { t: t(-2), kind: 'xhr', method: 'GET', url: '/transport', error: 'offline' },
    ] }));
    expect(md.indexOf('/transport')).toBeLessThan(md.indexOf('/http'));
    expect(md.indexOf('/http')).toBeLessThan(md.indexOf('/success'));
  });

  it('renders an empty report without inventing evidence', () => {
    const md = toPromptContext(report({ note: { text: '' } }));
    expect(md).toContain('(no text)');
    expect(md).toContain('## Environment');
    expect(md).not.toContain('## Evidence');
    expect(md).not.toContain('## Errors');
  });

  it('bounds the entire output, including notes, selections and context, and signals truncation', () => {
    const huge = 'x'.repeat(80_000);
    for (const overrides of [{ note: { text: huge } }, { context: { huge } }, {
      selections: [{ id: 's', kind: 'element' as const, selector: '#pay', tag: 'button', classes: [],
        text: huge, attrs: {}, framework: null, components: [], chain: [],
        rect: { x: 0, y: 0, width: 1, height: 1 }, docRect: { x: 0, y: 0, width: 1, height: 1 } }],
    }]) {
      const md = toPromptContext(report(overrides));
      expect(md).toHaveLength(64_000);
      expect(md).toMatch(/\[Prompt truncated; consult the raw payload for omitted context\.\]$/);
    }
    const p = report();
    const full = toPromptContext(p);
    expect(toPromptContext(p, { maxChars: full.length })).toBe(full);
    for (const maxChars of [0, 1, 63, 100, 200.9]) {
      expect(toPromptContext(p, { maxChars }).length).toBeLessThanOrEqual(Math.floor(maxChars));
    }
  });

  it('handles zero, fractional, negative and non-finite limits explicitly', () => {
    const p = report({ console: [1, 2, 3].map(i => ({ t: t(-i), level: 'log', message: `entry-${i}` })) });
    for (const maxLogLines of [0, -1]) {
      const md = toPromptContext(p, { maxLogLines });
      expect(md).toContain('Showing 0 of 3 distinct groups; 3 omitted.');
      expect(md).not.toContain('entry-');
    }
    expect(toPromptContext(p, { maxLogLines: 1.9 })).toContain('Showing 1 of 3');
    for (const value of [NaN, Infinity, -Infinity]) {
      const opts: PromptOptions = { maxChars: value, maxLogLines: value };
      expect(toPromptContext(p, opts)).toBe(toPromptContext(p));
    }
    expect(toPromptContext(p, { maxChars: -1 })).toBe('');
  });
});
