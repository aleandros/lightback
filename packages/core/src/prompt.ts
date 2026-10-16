import type { FeedbackPayload, NetworkEntry } from './types';

export interface PromptOptions {
  /** Maximum distinct groups per collector section (default 40). Zero omits collector entries. */
  maxLogLines?: number;
  /** Maximum characters in the entire prompt, including a truncation notice (default 64000). */
  maxChars?: number;
}

function limit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

const TRUNCATED = '\n[Prompt truncated; consult the raw payload for omitted context.]';

// Keep retained output bounded even when callers supply payloads larger than collector limits.
function boundedLines(max: number) {
  const chunks: string[] = [];
  let size = 0;
  let truncated = false;
  return {
    push(...lines: string[]) {
      for (const line of lines) {
        if (truncated) return;
        const chunk = (chunks.length ? '\n' : '') + line;
        const remaining = max - size;
        chunks.push(chunk.slice(0, remaining));
        size += Math.min(chunk.length, remaining);
        truncated = chunk.length > remaining;
      }
    },
    finish() {
      const output = chunks.join('');
      return truncated ? output.slice(0, Math.max(0, max - TRUNCATED.length)) + TRUNCATED.slice(0, max) : output;
    },
  };
}

interface EvidenceGroup<T> {
  entry: T;
  index: number;
  count: number;
  first: number;
  last: number;
  closest: number;
  distance: number;
  durationMin?: number;
  durationMax?: number;
  unknownDuration: boolean;
}

// Keys use complete evidence, never clipped display strings. Only time and request duration vary.
function groupEvidence<T extends { t: number; duration?: number }>(
  entries: T[], key: (entry: T) => string, anchor: number,
): EvidenceGroup<T>[] {
  const groups = new Map<string, EvidenceGroup<T>>();
  entries.forEach((entry, index) => {
    const identity = key(entry);
    const time = Number.isFinite(entry.t) ? entry.t : NaN;
    const distance = Number.isFinite(time) && Number.isFinite(anchor) ? Math.abs(time - anchor) : Infinity;
    const duration = Number.isFinite(entry.duration) ? entry.duration : undefined;
    const group = groups.get(identity);
    if (!group) {
      groups.set(identity, { entry, index, count: 1, first: time, last: time, closest: time, distance,
        durationMin: duration, durationMax: duration, unknownDuration: duration === undefined });
      return;
    }
    group.count++;
    if (Number.isFinite(time)) {
      group.first = Number.isFinite(group.first) ? Math.min(group.first, time) : time;
      group.last = Number.isFinite(group.last) ? Math.max(group.last, time) : time;
    }
    if (distance < group.distance) { group.distance = distance; group.closest = time; }
    if (duration !== undefined) {
      group.durationMin = Math.min(group.durationMin ?? duration, duration);
      group.durationMax = Math.max(group.durationMax ?? duration, duration);
    } else group.unknownDuration = true;
  });
  return [...groups.values()];
}

function failed(n: NetworkEntry): boolean {
  return n.error !== undefined || n.ok === false || (n.status !== undefined && (n.status === 0 || n.status >= 400));
}

function fmtSource(s: { file: string; line?: number; column?: number }): string {
  const file = s.file.replace(/^.*?\/(src|app|pages|components)\//, '$1/');
  return s.line ? `${file}:${s.line}${s.column ? `:${s.column}` : ''}` : file;
}

/**
 * Render bounded markdown with ranked, deduplicated evidence without changing the payload.
 * Temporal proximity is a heuristic, not a diagnosis. Attach screenshots separately.
 */
export function toPromptContext(p: FeedbackPayload, opts: PromptOptions = {}): string {
  const max = limit(opts.maxLogLines, 40);
  const lines = boundedLines(limit(opts.maxChars, 64_000));
  const t0 = Date.parse(p.createdAt);
  const rel = (t: number) => !Number.isFinite(t) ? 'unknown time' : Number.isFinite(t0)
    ? `${((t - t0) / 1000).toFixed(3)}s` : `${t}ms since Unix epoch`;
  // Selections have no timestamp. Visibility/custom events and post-submission activity
  // must not displace the latest captured interaction used as the ranking reference.
  const action = p.breadcrumbs.reduce<FeedbackPayload['breadcrumbs'][number] | undefined>((latest, b) => {
    if (!['click', 'input', 'navigation'].includes(b.type) || !Number.isFinite(b.t) || b.t > t0) return latest;
    return !latest || b.t > latest.t ? b : latest;
  }, undefined);
  const anchor = action?.t ?? t0;
  const stamp = <T>(g: EvidenceGroup<T>) => g.count === 1 ? rel(g.first)
    : `${rel(g.first)} .. ${rel(g.last)}; ${g.count} occurrences; nearest ${rel(g.closest)}`;
  const evidence = <T extends { t: number; duration?: number }>(
    title: string, entries: T[], key: (entry: T) => string, priority: (entry: T) => number,
    render: (group: EvidenceGroup<T>) => void,
  ) => {
    if (!entries.length) return;
    const groups = groupEvidence(entries, key, anchor);
    groups.sort((a, b) => priority(a.entry) - priority(b.entry)
      || a.distance - b.distance || a.index - b.index);
    const shown = groups.slice(0, max);
    lines.push('', `## ${title} (${entries.length})`,
      `Showing ${shown.length} of ${groups.length} distinct groups; ${groups.length - shown.length} omitted.`);
    shown.forEach(render);
  };

  lines.push(`# User feedback`);
  lines.push(`Submitted: ${p.createdAt}`);
  lines.push(`Page: ${p.page.title} (${p.page.url})`);
  lines.push('');
  lines.push(`## Note`);
  lines.push(p.note.text || '(no text)');
  if (p.note.transcript) lines.push(`\nVoice transcript:\n${p.note.transcript}`);

  if (p.selections.length) {
    lines.push('', `## Selected elements (${p.selections.length})`);
    p.selections.forEach((s, i) => {
      const label = s.kind === 'region' ? 'Region inside' : 'Element';
      lines.push(`${i + 1}. ${label} <${s.tag}> \`${s.selector}\``);
      if (s.context?.length) lines.push(`   Context: ${s.context.map(c => `${c.kind} \`${c.selector}\``).join(' → ')}`);
      if (s.note) lines.push(`   Reporter note: ${s.note}`);
      if (s.crop) lines.push(`   Crop: ${s.crop} (see attachments)`);
      if (s.chain.length) {
        lines.push(`   Components: ${s.chain.map((c) => (c.source ? `${c.name} (${fmtSource(c.source)})` : c.name)).join(' < ')}`);
      }
      if (s.source) lines.push(`   Source: ${fmtSource(s.source)}`);
      if (s.sensitive) lines.push(`   Sensitive: content withheld by the app`);
      if (s.text) lines.push(`   Text: "${s.text}"`);
      const attrs = Object.entries(s.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      if (attrs) lines.push(`   Attrs: ${attrs}`);
      if (s.props && Object.keys(s.props).length) lines.push(`   Props: ${JSON.stringify(s.props)}`);
      const r = s.kind === 'region' && s.region ? s.region.rect : s.rect;
      lines.push(`   Rect: x=${r.x} y=${r.y} w=${r.width} h=${r.height}`);
      if (s.kind === 'region' && s.region) {
        lines.push(`   Contains ${s.region.children.length} visible elements:`);
        for (const c of s.region.children) {
          const bits = [`<${c.tag}>`];
          if (c.context?.length) bits.push(`context: ${c.context.map(root => `${root.kind} \`${root.selector}\``).join(' → ')}; selector: \`${c.selector}\``);
          if (c.sensitive) bits.push('(sensitive)');
          if (c.role) bits.push(`role=${c.role}`);
          if (c.text) bits.push(`"${c.text}"`);
          if (c.components.length) bits.push(`[${c.components.join(' < ')}]`);
          if (c.source) bits.push(fmtSource(c.source));
          lines.push(`   - ${bits.join(' ')}`);
        }
      }
    });
  }

  if (p.errors.length || p.network.length || p.console.length || p.breadcrumbs.length) {
    lines.push('', '## Evidence ordering',
      action ? `Time anchor: latest captured ${action.type} before submission [${rel(action.t)}]: ${action.message.slice(0, 160)}`
        : 'Time anchor: report submission (no eligible interaction breadcrumb).',
      'Within each section: failures first (console errors, then warnings), then nearest occurrence to the anchor; ties keep input order.',
      'Times are relative to submission. Repeats retain first/last times and counts. Selections have no timestamps; temporal proximity is not evidence of causality.');
  }
  evidence('Errors', p.errors, e => JSON.stringify([e.kind, e.message, e.source, e.stack]), () => 0, g => {
    const e = g.entry;
    lines.push(`- [${stamp(g)}] ${e.kind}: ${e.message}${e.source ? ` @ ${e.source}` : ''}`);
    if (e.stack) lines.push('  ' + e.stack.split('\n').slice(0, 4).join('\n  '));
  });
  evidence('Network', p.network,
    n => JSON.stringify([n.kind, n.method, n.url, n.status, n.ok, n.error, n.requestBody, n.responseBody]),
    n => failed(n) ? 0 : 1, g => {
      const n = g.entry;
      const status = n.error !== undefined ? `ERR ${n.error}` : `${n.status ?? '?'}`;
      const duration = g.durationMin === undefined ? '?' : g.durationMin === g.durationMax
        ? `${g.durationMin}` : `${g.durationMin}..${g.durationMax}`;
      lines.push(`- [${stamp(g)}] ${n.method} ${n.url} -> ${status} (${duration}ms${g.unknownDuration && g.durationMin !== undefined ? '; some durations unknown' : ''})`);
      if (n.responseBody && failed(n)) lines.push(`  body: ${n.responseBody.slice(0, 300)}`);
    });
  evidence('Console', p.console, c => JSON.stringify([c.level, c.message]),
    c => c.level === 'error' ? 0 : c.level === 'warn' ? 1 : 2,
    g => lines.push(`- [${stamp(g)}] ${g.entry.level}: ${g.entry.message}`));
  evidence('Breadcrumbs', p.breadcrumbs, b => JSON.stringify([b.type, b.message, b.data]), () => 0,
    g => lines.push(`- [${stamp(g)}] ${g.entry.type}: ${g.entry.message}`));

  lines.push('', `## Environment`);
  lines.push(`- Viewport ${p.env.viewport.width}x${p.env.viewport.height} @${p.env.devicePixelRatio}x, screen ${p.env.screen.width}x${p.env.screen.height}`);
  lines.push(`- ${p.env.userAgent}`);
  lines.push(`- Language ${p.env.language}, timezone ${p.env.timezone}, online=${p.env.online}`);

  if (Object.keys(p.context).length) {
    lines.push('', `## App context`, '```json', JSON.stringify(p.context, null, 2), '```');
  }
  if (p.masks?.length) {
    const count = (reason: string) => p.masks!.filter((m) => m.reason === reason).length;
    lines.push('', `## Screenshot masks`);
    lines.push(`- ${p.masks.length} area(s) are covered by opaque boxes (${count('sensitive')} sensitive, ${count('reporter')} hidden by the reporter). Their content is intentionally absent.`);
  }
  if (p.attachments.length) {
    lines.push('', `## Attachments`);
    for (const a of p.attachments) {
      const area = a.area ? `, shows document area x=${a.area.x} y=${a.area.y} ${a.area.width}×${a.area.height}` : '';
      lines.push(`- ${a.name} (${a.type}, ${a.size} bytes${area})`);
    }
  }
  return lines.finish();
}
