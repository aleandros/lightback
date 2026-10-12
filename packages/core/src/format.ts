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

/** Report identifiers only; the final fallback is not a security token. */
export function uid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
