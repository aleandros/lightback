import { afterEach, expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { mountWidget, defaultStrings, type WidgetOptions } from '../src/index';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); vi.useRealTimers(); });
function mount(options: Partial<WidgetOptions> = {}) {
  const client = createLightback({ send: async () => {} });
  cleanup.push(() => client.destroy());
  const widget = mountWidget({ client, ...options });
  cleanup.push(() => widget.destroy());
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => widget.element.shadowRoot!.querySelector<T>(selector)!;
  const click = (action: string) => q(`[data-action="${action}"]`).click();
  return { widget, q, click };
}

it('escapes translations, preserves defaults and gives strings precedence over triggerLabel', () => {
  const translated = '<img src=x onerror="alert(1)"> & "Hola"';
  const { q, widget } = mount({ triggerLabel: 'Legacy', strings: { pillOpen: translated, close: translated, notePlaceholder: translated, countSelected: (n) => `${n} elegidos` } });
  expect(q('[data-ref=pillOpen]').textContent).toBe(translated);
  expect(q('[data-action=close]').getAttribute('aria-label')).toBe(translated);
  expect(q('[data-ref=text]').getAttribute('placeholder')).toBe(translated);
  expect(q('[data-ref=pillPick]').textContent).toBe(defaultStrings.pillPick);
  expect(widget.element.shadowRoot!.querySelector('[onerror]')).toBeNull();
  widget.startPicking();
  expect(q('[data-ref=count]').textContent).toBe('0 elegidos');
});

it('keeps the legacy trigger label after opening and closing', () => {
  const { widget, q } = mount({ triggerLabel: 'Report' });
  widget.open(); widget.close();
  expect(q('[data-ref=pillOpen]').textContent).toBe('Report');
});

it('keeps a hidden trigger hidden through close, picking cancellation and discard', () => {
  const { widget, q, click } = mount({ hideTrigger: true, theme: 'dark' });
  expect(widget.element.dataset.theme).toBe('dark');
  expect(q('[data-ref=pill]').hidden).toBe(true);
  widget.open(); expect(q('[data-ref=panel]').hidden).toBe(false);
  widget.close(); expect(q('[data-ref=pill]').hidden).toBe(true);
  widget.startPicking(); click('cancel-pick'); expect(q('[data-ref=pill]').hidden).toBe(true);
  widget.open(); click('discard'); expect(q('[data-ref=pill]').hidden).toBe(true);
  for (const name of ['pill', 'panel', 'popover', 'pending']) expect(q(`[data-ref=${name}]`).getAttribute('part')).toBe(name);
});

it('translates send failures and vetoes while retaining the draft, then hides the trigger on success', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  let veto = true;
  const client = createLightback({ send, beforeSend: (payload) => veto ? null : payload });
  cleanup.push(() => client.destroy());
  const { widget, q, click } = mount({ client, hideTrigger: true, strings: { cancelled: 'Cancelado', sendFailed: (m) => `Fallo: ${m}`, sent: 'Gracias' } });
  widget.open();
  const text = q<HTMLTextAreaElement>('[data-ref=text]');
  text.value = 'A report'; text.dispatchEvent(new Event('input'));
  click('send');
  await vi.waitFor(() => expect(q('[data-ref=status]').textContent).toBe('Cancelado'));
  expect(send).not.toHaveBeenCalled();
  expect(text.value).toBe('A report');
  veto = false; click('send');
  await vi.waitFor(() => expect(q('[data-ref=status]').textContent).toBe('Fallo: offline'));
  expect(text.value).toBe('A report');
  click('send');
  await vi.waitFor(() => expect(q('[data-ref=panel]').hidden).toBe(true));
  expect(q('[data-ref=pill]').hidden).toBe(true);
  expect(text.value).toBe('');
});
