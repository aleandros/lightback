import { afterEach, expect, it } from 'vitest';
import { PageChanges } from '../src/page-changes';

const changes = new PageChanges();
afterEach(() => { changes.stop(); document.body.innerHTML = ''; });

it('coalesces mutations without retaining content, including synchronous edits before observer delivery', () => {
  document.body.innerHTML = '<main>old</main>';
  changes.start();
  const before = changes.key();
  document.querySelector('main')!.firstChild!.textContent = 'new';
  document.querySelector('main')!.setAttribute('class', 'updated');
  const after = changes.key();
  expect(after).not.toBe(before);
  expect(changes.key()).toBe(after);
  expect(after).not.toContain('new');
});

it('ignores widget insertion, attributes, removal and composed events', () => {
  changes.start();
  const before = changes.key();
  const host = document.createElement('div');
  host.setAttribute('data-lightback-ignore', '');
  document.body.append(host);
  host.style.opacity = '0';
  const input = document.createElement('input');
  host.attachShadow({ mode: 'open' }).append(input);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  host.remove();
  expect(changes.key()).toBe(before);
});

it.each(['scroll', 'resize', 'input', 'change', 'load', 'toggle'])('invalidates for host %s and disconnects on stop', (type) => {
  document.body.innerHTML = '<div><input></div>';
  changes.start();
  const before = changes.key();
  document.querySelector('input')!.dispatchEvent(new Event(type));
  expect(changes.key()).not.toBe(before);
  changes.stop();
  const stopped = changes.key();
  document.querySelector('input')!.dispatchEvent(new Event(type));
  document.querySelector('div')!.textContent = 'later';
  expect(changes.key()).toBe(stopped);
});
