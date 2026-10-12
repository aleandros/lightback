/** Serialize console args the way a human would read them, safely. */
export function formatArgs(args: unknown[], max: number): string {
  return args.map((a) => formatValue(a, max)).join(' ');
}

export function formatValue(value: unknown, max: number): string {
  if (typeof value === 'string') return clip(value, max);
  if (value instanceof Error) return clip(`${value.name}: ${value.message}`, max);
  if (value === undefined) return 'undefined';
  try {
    return clip(JSON.stringify(value, safeReplacer(), 0) ?? String(value), max);
  } catch {
    return clip(String(value), max);
  }
}

function safeReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return `[fn ${v.name || 'anonymous'}]`;
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (typeof Node !== 'undefined' && v instanceof Node) return `[${(v as Element).tagName ?? v.nodeName}]`;
    }
    return v;
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
