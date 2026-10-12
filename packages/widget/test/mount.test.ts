import { expect, it } from 'vitest';
import { createLightback } from '@lightback/core';
import { mountWidget } from '../src/index';

it('supports simultaneous and repeated mounts without registering a custom element', () => {
  const client = createLightback();
  const first = mountWidget({ client });
  const second = mountWidget({ client });
  try {
    expect(first.element.shadowRoot).not.toBe(second.element.shadowRoot);
    first.open();
    second.startPicking();
    expect(first.element.isConnected).toBe(true);
    expect(second.element.isConnected).toBe(true);
  } finally {
    second.destroy();
    first.destroy();
    client.destroy();
  }
  const replacement = mountWidget({ client });
  replacement.destroy();
  expect(document.querySelector('lightback-widget')).toBeNull();
});
