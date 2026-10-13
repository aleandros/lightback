import { afterEach, expect, it, vi } from 'vitest';
import { createLightback, type LightbackClient } from '../src/client';
import { describeElement, summarizeElement } from '../src/inspect';
import { describeRegion } from '../src/region';
import { toPromptContext } from '../src/prompt';
import { cleanupStorage, noCapture, selection, setupStorage, storedRecord } from './property-fixtures';

const clients: LightbackClient[] = [];
function client(options: Parameters<typeof createLightback>[0] = {}) {
  const instance = createLightback({ persistence: false, capture: noCapture, ...options });
  clients.push(instance);
  return instance;
}
afterEach(() => {
  clients.splice(0).reverse().forEach((instance) => instance.destroy());
  cleanupStorage();
  document.body.innerHTML = '';
});

const SECRET = /secret/i;
function mount(html: string) {
  document.body.innerHTML = html;
  return (selector: string) => document.querySelector(selector)!;
}

it('withholds content of a directly picked sensitive element and its nested descendants', () => {
  const $ = mount(`<section id="account"><p id="ssn" class="secret-class" title="secret-title" data-lightback-sensitive>
    SSN secret-123 <b id="nested" aria-label="secret-aria">secret-nested</b></p></section>`);
  for (const el of [$('#ssn'), $('#nested')]) {
    const desc = describeElement(el);
    expect(desc.sensitive).toBe(true);
    expect(desc.selector).toMatch(/^#/);
    expect(desc).toMatchObject({ text: '', attrs: {}, classes: [] });
    expect(desc.html).toBeUndefined();
    expect(desc.props).toBeUndefined();
    expect(JSON.stringify(desc)).not.toMatch(SECRET);
    expect(summarizeElement(el)).toMatchObject({ text: '', sensitive: true });
  }
});

it('removes sensitive descendants from an ancestor’s text and HTML without hiding the rest', () => {
  const $ = mount(`<section id="account"><h2>Account</h2>
    <p data-lightback-sensitive title="secret-title">secret-ssn <i>secret-inner</i></p><span>Visible</span></section>`);
  const desc = describeElement($('#account'));
  expect(desc.sensitive).toBeUndefined();
  expect(desc.text).toBe('Account Visible');
  expect(desc.html).toContain('<p data-lightback-sensitive=""></p>');
  expect(desc.html).toContain('Visible');
  expect(JSON.stringify(desc)).not.toMatch(SECRET);
  expect(summarizeElement($('#account')).text).toBe('Account Visible');
});

it('matches configured selectors with their ancestor context, including content added later', () => {
  const $ = mount(`<div class="billing"><div class="card" id="card">secret-4111</div></div><div class="card" id="other">public card</div>`);
  const instance = client({ privacy: { selectors: ['.billing .card'] } });
  expect(instance.describeElement($('#card'))).toMatchObject({ text: '', sensitive: true });
  expect(instance.describeElement($('#other'))).toMatchObject({ text: 'public card' });
  expect(instance.describeElement($('.billing')).text).toBe('');
  expect(instance.describeElement(document.body).html).not.toMatch(SECRET);
  // Dynamic content: an element marked after the client was created is still protected.
  $('#other').setAttribute('data-lightback-sensitive', '');
  expect(instance.isSensitive($('#other'))).toBe(true);
  $('.billing').insertAdjacentHTML('beforeend', '<div class="card" id="late">secret-late</div>');
  expect(instance.describeElement($('.billing')).text).toBe('');
  expect(JSON.stringify(instance.describeElement(document.body))).not.toMatch(SECRET);
});

it('rejects invalid privacy selectors instead of failing open', () => {
  expect(() => client({ privacy: { selectors: ['.ok', 'div >>> span'] } })).toThrow(/invalid privacy selector/);
});

it('keeps the configured privacy selector when region options try to override it', () => {
  const $ = mount(`<div class="billing" id="box"><span class="card">secret-card</span> total</div>`);
  const instance = client({ privacy: { selectors: ['.billing .card'] } });
  for (const opts of [{ sensitive: undefined }, { sensitive: '.nothing' }]) {
    const region = instance.describeRegion({ x: 0, y: 0, width: 10, height: 10 }, { hitTest: () => $('.card'), ...opts })!;
    expect(JSON.stringify(region)).not.toMatch(SECRET);
  }
});

it('sanitizes region containers and children', () => {
  const $ = mount(`<form id="pay"><label>Card</label><input id="num" data-lightback-sensitive aria-label="secret-label">
    <p id="note" data-lightback-sensitive role="note">secret-note</p><button>Pay</button></form>`);
  const hits = [$('label'), $('#num'), $('#note'), $('button')];
  let i = 0;
  const region = describeRegion({ x: 0, y: 0, width: 20, height: 20 }, { hitTest: () => hits[i++ % hits.length]! })!;
  expect(region.selector).toBe('#pay');
  expect(JSON.stringify(region)).not.toMatch(SECRET);
  const children = region.region!.children;
  expect(children.filter((c) => c.sensitive).map((c) => c.selector).sort()).toEqual(['#note', '#num']);
  expect(children.find((c) => c.selector === '#note')!.role).toBeUndefined();
  expect(region.text).toBe('Card Pay');
});

it('omits props of components that render sensitive content', () => {
  const $ = mount(`<div id="card"><span id="label">Card</span><span id="num" data-lightback-sensitive>secret-4111</span></div><div id="plain"><span id="ok">Hi</span></div>`);
  function CardView() {}
  function Plain() {}
  const host = (el: Element, parent: object) => ({ type: el.tagName.toLowerCase(), stateNode: el, return: parent, child: null, sibling: null });
  const attach = (el: Element, fiber: object) => { (el as unknown as Record<string, unknown>)['__reactFiber$test'] = fiber; };
  const card: Record<string, unknown> = { type: CardView, memoizedProps: { number: 'secret-4111' }, return: null };
  const cardDiv = host($('#card'), card); card.child = cardDiv;
  const label = host($('#label'), cardDiv); const num = host($('#num'), cardDiv);
  (cardDiv as Record<string, unknown>).child = label; (label as Record<string, unknown>).sibling = num;
  const plain: Record<string, unknown> = { type: Plain, memoizedProps: { greeting: 'hello' }, return: null };
  const plainDiv = host($('#plain'), plain); plain.child = plainDiv;
  const ok = host($('#ok'), plainDiv); (plainDiv as Record<string, unknown>).child = ok;
  for (const [el, fiber] of [[$('#card'), cardDiv], [$('#label'), label], [$('#num'), num], [$('#plain'), plainDiv], [$('#ok'), ok]] as const) attach(el, fiber);

  const labelDesc = describeElement($('#label'));
  expect(labelDesc.components).toEqual(['CardView']);
  expect(labelDesc.props).toBeUndefined();
  expect(JSON.stringify(labelDesc)).not.toMatch(SECRET);
  expect(describeElement($('#ok')).props).toEqual({ greeting: 'hello' });

  // Vue: rendered roots decide; fragments and unknown roots fail closed.
  const vue = (root: unknown, props: Record<string, unknown>) => ({ type: { name: 'VueCard' }, props, subTree: { el: root }, parent: null });
  const span = document.createElement('span'); span.textContent = 'x'; document.body.appendChild(span);
  (span as unknown as Record<string, unknown>).__vueParentComponent = vue($('#card'), { number: 'secret-4111' });
  expect(describeElement(span).props).toBeUndefined();
  (span as unknown as Record<string, unknown>).__vueParentComponent = vue(document.createTextNode(''), { number: 'secret-4111' });
  expect(describeElement(span).props).toBeUndefined();
  (span as unknown as Record<string, unknown>).__vueParentComponent = vue($('#plain'), { greeting: 'hello' });
  expect(describeElement(span).props).toEqual({ greeting: 'hello' });
  // Multi-root component whose second root is a v-for fragment (text anchor) of sensitive items.
  const anchor = document.createTextNode('');
  const fragment = { ...vue($('#plain'), { customers: ['secret-4111'] }), subTree: { el: anchor, children: [{ el: $('#plain') }, { el: anchor, children: [{ el: $('#num') }] }] } };
  (span as unknown as Record<string, unknown>).__vueParentComponent = fragment;
  expect(describeElement(span).props).toBeUndefined();
  // A child component rooted in a fragment is searched through its own subtree.
  const nested = { ...vue($('#plain'), { customers: ['secret-4111'] }), subTree: { el: anchor, children: [{ el: anchor, component: { subTree: { el: anchor, children: [{ el: $('#num') }] } } }] } };
  (span as unknown as Record<string, unknown>).__vueParentComponent = nested;
  expect(describeElement(span).props).toBeUndefined();
});

it('records clicks on sensitive elements and their ancestors without their text', () => {
  const $ = mount(`<button id="reveal"><span data-lightback-sensitive>secret-pin</span> Reveal</button><span id="direct" data-lightback-sensitive>secret-direct</span>`);
  const instance = client({ capture: { ...noCapture, breadcrumbs: true } });
  ($('#reveal') as HTMLElement).click();
  ($('#direct') as HTMLElement).click();
  const crumbs = instance.buildPayload({}).breadcrumbs.map((b) => b.message);
  expect(crumbs).toEqual(['button#reveal "Reveal"', 'span#direct']);
});

it('reports rendered sensitive rects in document space', () => {
  mount(`<div data-lightback-sensitive id="a">a</div><div data-lightback-sensitive id="hidden"></div><div data-lightback-ignore><i data-lightback-sensitive id="own">w</i></div>`);
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() {} });
  vi.spyOn(document.getElementById('a')!, 'getBoundingClientRect').mockReturnValue(rect(10.5, 20.2, 30, 5));
  vi.spyOn(document.getElementById('own')!, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 50, 50));
  // Overflowing contents widen the box; jsdom has no Range layout.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range) { return (this.startContainer as Element).id === 'a' ? rect(10, 20, 80, 5) : rect(0, 0, 0, 0); },
  });
  vi.stubGlobal('scrollX', 100); vi.stubGlobal('scrollY', 200);
  try {
    expect(client().sensitiveRects()).toEqual([{ x: 110, y: 220, width: 80, height: 6 }]);
  } finally {
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  }
});

it('carries screenshot masks into the payload and prompt, dropping malformed ones', () => {
  const instance = client();
  const masks = [
    { docRect: { x: 1, y: 2, width: 3, height: 4 }, reason: 'sensitive' as const },
    { docRect: { x: 5, y: 6, width: 7, height: 8 }, reason: 'reporter' as const },
    { docRect: { x: 'bad' }, reason: 'reporter' },
    { docRect: { x: 1, y: 1, width: 1, height: 1 }, reason: 'other' },
  ] as never;
  const picked = { ...selection('one'), text: '', attrs: {}, sensitive: true };
  const blob = new Blob(['png'], { type: 'image/png' });
  const attachments = [{ name: 'screenshot.png', type: blob.type, size: blob.size, blob }];
  const payload = instance.buildPayload({ text: 'n', selections: [picked], masks, attachments });
  expect(payload.masks).toEqual([masks[0], masks[1]]);
  expect(instance.buildPayload({ text: 'n' }).masks).toBeUndefined();
  // Masks describe images: without attachments they are kept for later captures but not reported.
  expect(instance.buildPayload({ text: 'n', masks }).masks).toBeUndefined();
  // Many sensitive matches never evict the reporter's own areas.
  const many = Array.from({ length: 400 }, (_, i) => ({ docRect: { x: i, y: 0, width: 1, height: 1 }, reason: 'sensitive' as const }));
  const reporter = { docRect: { x: 9, y: 9, width: 9, height: 9 }, reason: 'reporter' as const };
  instance.saveDraft({ text: 'n', selections: [], attachments: [], masks: [...many, reporter] });
  expect(instance.getDraft()!.masks!.filter((m) => m.reason === 'reporter')).toEqual([reporter]);
  const prompt = toPromptContext(payload);
  expect(prompt).toContain('Sensitive: content withheld');
  expect(prompt).toContain('2 area(s) are covered by opaque boxes (1 sensitive, 1 hidden by the reporter)');
});

it('persists masks and sanitized selections across recovery', async () => {
  setupStorage();
  document.body.innerHTML = `<p id="p">Hello <b data-lightback-sensitive>secret-stored</b></p>`;
  const first = createLightback({ capture: noCapture });
  await first.ready;
  const picked = first.describeElement(document.getElementById('p')!);
  const mask = { docRect: { x: 1, y: 2, width: 3, height: 4 }, reason: 'reporter' as const };
  first.saveDraft({ text: 'n', selections: [picked], attachments: [], masks: [mask, { reason: 'reporter' } as never] });
  await first.flushPersistence();
  expect(JSON.stringify(await storedRecord())).not.toMatch(SECRET);
  first.destroy();
  const second = createLightback({ capture: noCapture });
  await second.ready;
  expect(second.getDraft()!.masks).toEqual([mask]);
  expect(second.getDraft()!.selections[0]!.text).toBe('Hello');
  await second.clearPersistence();
  second.destroy();
});
