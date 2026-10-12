// @vitest-environment node
import { expect, it } from 'vitest';
import { createLightback, describeElement, describeRegion } from '../src/index';

it('can create, use and destroy a server client without patching global APIs', async () => {
  const originalConsole = { ...console };
  const originalFetch = globalThis.fetch;
  const client = createLightback({ send: async () => {} });
  try {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      expect(console[level]).toBe(originalConsole[level]);
    }
    expect(globalThis.fetch).toBe(originalFetch);
    expect(client.stats()).toEqual({ console: 0, errors: 0, network: 0, breadcrumbs: 0 });
    client.setContext({ release: 'test' });
    const payload = await client.send({ text: 'SSR' });
    expect(payload?.context.release).toBe('test');
    expect(payload?.page.url).toBe('');
    expect(payload?.env.viewport).toEqual({ width: 0, height: 0 });
    expect(() => client.describeElement(null as unknown as Element)).toThrow('describeElement requires a browser DOM');
    expect(() => describeElement(null as unknown as Element)).toThrow('describeElement requires a browser DOM');
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(() => client.describeRegion(rect)).toThrow('describeRegion requires a browser DOM');
    expect(() => describeRegion(rect)).toThrow('describeRegion requires a browser DOM');
  } finally {
    client.destroy();
    client.destroy();
  }
});
