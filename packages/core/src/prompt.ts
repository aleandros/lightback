import type { FeedbackPayload } from './types';

/**
 * Render a payload as bounded markdown suitable for dropping into a model prompt.
 * Attach the screenshot separately if your model supports images.
 */
function fmtSource(s: { file: string; line?: number; column?: number }): string {
  const file = s.file.replace(/^.*?\/(src|app|pages|components)\//, '$1/');
  return s.line ? `${file}:${s.line}${s.column ? `:${s.column}` : ''}` : file;
}

export function toPromptContext(p: FeedbackPayload, opts: { maxLogLines?: number } = {}): string {
  const max = opts.maxLogLines ?? 40;
  const lines: string[] = [];
  const t0 = Date.parse(p.createdAt);
  const rel = (t: number) => `${((t - t0) / 1000).toFixed(1)}s`;

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

  if (p.errors.length) {
    lines.push('', `## Errors (${p.errors.length})`);
    for (const e of p.errors.slice(-max)) {
      lines.push(`- [${rel(e.t)}] ${e.kind}: ${e.message}${e.source ? ` @ ${e.source}` : ''}`);
      if (e.stack) lines.push('  ' + e.stack.split('\n').slice(0, 4).join('\n  '));
    }
  }

  if (p.network.length) {
    lines.push('', `## Network (last ${Math.min(max, p.network.length)} of ${p.network.length})`);
    for (const n of p.network.slice(-max)) {
      const status = n.error ? `ERR ${n.error}` : `${n.status}`;
      lines.push(`- [${rel(n.t)}] ${n.method} ${n.url} -> ${status} (${n.duration ?? '?'}ms)`);
      if (n.responseBody && !n.ok) lines.push(`  body: ${n.responseBody.slice(0, 300)}`);
    }
  }

  if (p.console.length) {
    lines.push('', `## Console (last ${Math.min(max, p.console.length)} of ${p.console.length})`);
    for (const c of p.console.slice(-max)) lines.push(`- [${rel(c.t)}] ${c.level}: ${c.message}`);
  }

  if (p.breadcrumbs.length) {
    lines.push('', `## Breadcrumbs (last ${Math.min(max, p.breadcrumbs.length)} of ${p.breadcrumbs.length})`);
    for (const b of p.breadcrumbs.slice(-max)) lines.push(`- [${rel(b.t)}] ${b.type}: ${b.message}`);
  }

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
  return lines.join('\n');
}
