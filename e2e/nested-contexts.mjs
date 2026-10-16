import { launch, W, BASE_URL } from './lib.mjs';
const { page, assert, finish, OUT } = await launch('nested-contexts');
await page.route('**/same-frame.html', route => route.fulfill({ contentType: 'text/html', body: '<button id="same-origin-url">URL child</button>' }));
await page.route('**/foreign-frame.html', route => route.fulfill({ contentType: 'text/html', body: '<button>FOREIGN SECRET</button>' }));
await page.route('**/nested-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;height:1800px">
<div id="late"></div><iframe id="cross" src="${BASE_URL.replace('127.0.0.1', 'localhost')}/foreign-frame.html" style="position:absolute;left:850px;top:20px;width:160px;height:50px"></iframe><div id="outer" style="margin:100px 40px 0"></div><div id="closed" data-lightback-sensitive style="margin:15px;width:100px;height:30px"></div>
<iframe id="opaque" sandbox="" srcdoc="<button>OPAQUE SECRET</button>" style="position:absolute;left:850px;top:100px;width:160px;height:70px"></iframe>
</body></html>` }));
await page.goto(BASE_URL + '/nested-fixture.html');
await page.evaluate(async ({ corePath, widgetPath }) => {
  window.core = await import(corePath);
  const { mountWidget } = await import(widgetPath);
  const shadow = document.querySelector('#outer').attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>iframe{width:560px;height:330px;border:6px solid black;transform:scale(.85);transform-origin:top left}button{height:30px}</style>
  <button id="same" data-source="src/Outer.ts:8:2">Outer</button>
  <div id="raw-slot">RAW SLOT SECRET</div><div id="slot-host"><span id="slotted" slot="private">SLOT SECRET</span></div>
  <iframe id="frame"></iframe>`;
  shadow.querySelector('#raw-slot').attachShadow({ mode: 'open' }).innerHTML = '<div data-lightback-sensitive style="width:10px;height:10px;white-space:nowrap"><slot></slot></div>';
  shadow.querySelector('#raw-slot').style.marginBottom = '10px';
  shadow.querySelector('#slot-host').attachShadow({ mode: 'open' }).innerHTML = '<slot name="private" data-lightback-sensitive></slot>';
  document.querySelector('#closed').attachShadow({ mode: 'closed' }).innerHTML = '<button>CLOSED SECRET</button>';
  const frame = shadow.querySelector('#frame');
  await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = `<!doctype html><html><body style="margin:0;height:1300px">
    <div style="height:120px"></div><div id="inner"></div><iframe id="nested" style="width:250px;height:100px;border:3px solid blue"></iframe></body></html>`; });
  const doc = frame.contentDocument;
  doc.querySelector('#inner').attachShadow({ mode: 'open' }).innerHTML = `<button id="same" data-source="src/Inner.tsx:12:4" style="width:180px;height:45px">Inside</button><input id="field" value="INPUT SECRET" placeholder="Safe placeholder"><div class="private" style="width:120px;height:25px">FRAME SECRET</div><div data-lightback-ignore><button id="ignored">Ignore me</button></div>`;
  const nested = doc.querySelector('#nested');
  await new Promise(resolve => { nested.onload = resolve; nested.srcdoc = '<!doctype html><html><body><button id="deep" style="width:140px;height:40px" data-source="src/Deep.vue:5:3">Deep</button></body></html>'; });
  frame.contentWindow.scrollTo(0, 80);
  window.submitted = [];
  window.hostClicks = 0;
  doc.addEventListener('click', () => window.hostClicks++);
  const button = doc.querySelector('#inner').shadowRoot.querySelector('#same');
  function InnerComponent() {}
  const hostFiber = { type: 'button', stateNode: button, return: null };
  const component = { type: InnerComponent, memoizedProps: { label: 'safe' }, child: hostFiber, return: null };
  hostFiber.return = component;
  button.__reactFiber$fixture = hostFiber;
  window.client = core.createLightback({ privacy: { selectors: ['.private'] }, persistence: { attachments: true, key: 'nested-e2e' }, send: async (payload, attachments) => {
    const images = await Promise.all(attachments.map(async a => ({ name: a.name, area: a.area, bytes: Array.from(new Uint8Array(await a.blob.arrayBuffer())) })));
    window.submitted.push({ payload, images });
  } });
  window.widget = mountWidget({ client, screenshotArea: 'viewport', screenshot: async ({ area }) => {
    const canvas = document.createElement('canvas'); canvas.width = area.width * 2; canvas.height = area.height * 2;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } });
}, { corePath: '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname, widgetPath: '/@fs' + new URL('../packages/widget/src/index.ts', import.meta.url).pathname });
const nestedFrame = page.frameLocator('#outer #frame');
const inner = nestedFrame.locator('#inner #same');
const deep = nestedFrame.frameLocator('#nested').locator('#deep');
const describe = locator => locator.evaluate(el => window.top.client.describeElement(el));
let selection = await describe(inner);
assert(JSON.stringify(selection.context) === JSON.stringify([{ kind: 'shadow', selector: '#outer' }, { kind: 'frame', selector: '#frame' }, { kind: 'shadow', selector: '#inner' }]), 'outer-to-inner root path distinguishes duplicate IDs');
assert(selection.selector === '#same' && selection.source.file === 'src/Inner.tsx' && selection.components[0] === 'InnerComponent' && selection.props.label === 'safe', 'source stamps, components and safe props survive frame realms');
const actual = await inner.boundingBox();
assert(['x', 'y', 'width', 'height'].every(k => Math.abs(selection.rect[k] - actual[k]) <= 1), 'rect includes frame borders, scaling and inner scroll');
assert(!(await describe(nestedFrame.locator('#field'))).text.includes('INPUT SECRET'), 'cross-realm controls never expose values');
assert(!(await describe(page.locator('#raw-slot'))).text.includes('SECRET'), 'raw text assigned to a sensitive slot is withheld');
assert(await page.locator('#raw-slot').evaluate(el => {
  const range = document.createRange(); range.selectNode(el.firstChild); const r = range.getBoundingClientRect();
  return client.sensitiveRects().some(m => m.x <= r.x && m.y <= r.y && m.x + m.width >= r.right && m.y + m.height >= r.bottom);
}), 'inherited slot privacy masks overflowing raw text');
assert((await describe(page.locator('#slotted'))).sensitive, 'slot privacy crosses the assignment boundary');
assert((await describe(nestedFrame.locator('.private'))).text === '', 'privacy selectors run inside frame shadow roots');
assert(!(await describe(page.locator('#outer'))).html.includes('SECRET'), 'host HTML omits iframe srcdoc contents');
assert(await page.evaluate(() => {
  const host = document.createElement('div'); host.id = 'transformed'; host.style.cssText = 'position:absolute;left:600px;top:500px';
  host.attachShadow({ mode: 'open' }).innerHTML = '<div style="transform:rotate(45deg)"><slot></slot></div>';
  const frame = document.createElement('iframe'); frame.style.cssText = 'width:120px;height:60px;border:0'; host.append(frame); document.body.append(host);
  const opaque = core.frameGeometry(frame) === null;
  const r = core.elementRect(frame), masks = client.sensitiveRects();
  const covered = masks.some(m => m.x <= r.x && m.y <= r.y && m.x + m.width >= r.x + r.width && m.y + m.height >= r.y + r.height);
  host.remove(); return opaque && covered;
}), 'transforms on slot ancestors make frames opaque and fully masked');
assert(await page.evaluate(async () => {
  const parent = document.createElement('iframe'); document.body.append(parent);
  await new Promise(resolve => { parent.onload = resolve; parent.srcdoc = '<iframe src="/same-frame.html"></iframe>'; });
  const child = parent.contentDocument.querySelector('iframe');
  const accessible = core.frameDocument(child)?.querySelector('#same-origin-url') !== null && core.frameDocument(child) !== null;
  parent.remove(); return accessible;
}), 'URL-loaded frames inherit the effective origin of srcdoc parents');
const deepDesc = await describe(deep);
assert(deepDesc.context.map(c => c.kind).join(',') === 'shadow,frame,frame', 'nested frame locator retains every boundary');
const region = await inner.evaluate(el => { const r = top.core.elementRect(el.ownerDocument.querySelector('#inner')); return top.client.describeRegion(r); });
assert(region.region.children.some(c => c.selector === '#same' && c.context.length === 3) && region.region.children.some(c => c.sensitive), 'region sampling crosses roots and retains sensitive child flags and context');
// Use the actual browser's hit testing with a sibling overlay covering the nested frame.
assert(await inner.evaluate(el => { const r = top.core.elementRect(el); return top.core.deepElementFromPoint(r.x + 10, r.y + 10) === el; }), 'deep hit testing resolves a shadow element inside a frame');
await inner.evaluate(el => { const overlay = el.ownerDocument.createElement('div'); overlay.id = 'cover'; overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:9999'; el.ownerDocument.body.append(overlay); });
assert(await inner.evaluate(el => { const r = top.core.elementRect(el); return top.core.deepElementFromPoint(r.x + 10, r.y + 10).id === 'cover'; }), 'deep hit testing respects overlays');
await nestedFrame.locator('#cover').evaluate(el => el.remove());
await inner.click();
assert(await page.evaluate(() => client.buildPayload({ text: '', selections: [] }).breadcrumbs.filter(b => b.message.includes('Inside')).length === 1), 'frame/shadow click collected exactly once');
await page.locator(W + '[data-ref=pillPick]').click();
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=keyboardPicker]') === document.querySelector('lightback-widget').shadowRoot.activeElement);
await inner.click();
await page.locator(W + '[data-ref=popText]').fill('Nested target');
await page.waitForFunction(() => client.getDraft()?.attachments.some(a => a.name === 'selection-1.png'));
assert(await page.evaluate(() => window.hostClicks === 1), 'picking blocks frame host activation');
await page.keyboard.press('Escape');
await page.keyboard.press('ArrowDown');
assert((await page.locator(W + '[data-ref=pickAnnouncement]').textContent()).includes('#field'), 'keyboard continues within the frame shadow root');
await page.keyboard.press('Enter');
await page.locator(W + '[data-ref=popText]').waitFor();
await page.keyboard.press('Escape');
await deep.click();
await page.locator(W + '[data-ref=popText]').waitFor();
await page.keyboard.press('Escape');
// Mark a component sibling sensitive: props must now be withheld as well.
assert(await inner.evaluate(el => { const sibling = el.ownerDocument.querySelector('#inner').shadowRoot.querySelector('.private'); el.__reactFiber$fixture.sibling = { type: 'div', stateNode: sibling }; return top.client.describeElement(el).props === undefined; }), 'props guard sees sensitive siblings in a nested root');
// Frame ancestry propagates privacy and ignore rules.
assert(await inner.evaluate(el => { const f = el.ownerDocument.defaultView.frameElement; f.setAttribute('data-lightback-sensitive', ''); const hidden = top.client.describeElement(el).sensitive; f.removeAttribute('data-lightback-sensitive'); f.setAttribute('data-lightback-ignore', ''); const ignored = top.client.isIgnored(el); f.removeAttribute('data-lightback-ignore'); return hidden && ignored; }), 'sensitive and ignored frame hosts apply inside their documents');
await page.locator(W + '[data-action=done]').click();
await page.screenshot({ path: OUT + 'review.png' });
await page.locator(W + '[data-action=send]').click();
await page.waitForFunction(() => submitted.length === 1);
const report = await page.evaluate(() => submitted[0]);
assert(report.payload.selections.length === 3 && report.payload.selections[2].selector === '#deep', 'nested pointer and keyboard selections reach transport');
assert(report.payload.selections.every(s => s.crop && s.context.length), 'each nested selection has an independent crop and root path');
assert(await page.evaluate(() => core.toPromptContext(submitted[0].payload).includes('shadow `#outer` → frame `#frame`')), 'prompt exposes resolvable root context');
assert(report.images.filter(a => a.area).length === 4, 'screenshot and all crops carry top-document image areas');
const masks = report.payload.masks.filter(m => m.reason === 'sensitive');
assert(masks.length >= 4, 'masks include private frame content, slots, closed host and opaque frame');
const pixels = await page.evaluate(async () => {
  const shot = submitted[0].images.find(a => a.name === 'screenshot.png');
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(shot.bytes)], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
  return submitted[0].payload.masks.map(({ docRect: r }) => {
    const x = Math.floor((r.x + r.width / 2 - shot.area.x) * bitmap.width / shot.area.width);
    const y = Math.floor((r.y + r.height / 2 - shot.area.y) * bitmap.height / shot.area.height);
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  });
});
assert(pixels.every(p => p[0] < 100 && p[3] === 255), 'all sensitive masks cover the expected DPR-2 pixels');
// A shadow root attached without a light-DOM mutation is eventually observed.
await page.locator('#late').evaluate(el => { el.attachShadow({ mode: 'open' }).innerHTML = '<input id="late-input">'; });
await page.waitForFunction(() => {
  document.querySelector('#late').shadowRoot.querySelector('input').dispatchEvent(new Event('change', { bubbles: true }));
  return client.buildPayload({ text: '' }).breadcrumbs.some(b => b.message.includes('#late-input'));
});
assert(true, 'late attachShadow is discovered for noncomposed change events');
// Navigation replaces the frame document while picking; listeners move to the new context.
await page.locator(W + '[data-ref=pillPick]').click();
await page.locator('#outer #frame').evaluate(frame => { frame.srcdoc = '<button id="replacement" style="width:180px;height:80px">Replacement</button>'; });
await nestedFrame.locator('#replacement').waitFor();
await nestedFrame.locator('#replacement').click();
assert(await page.locator(W + '[data-ref=popText]').isVisible(), 'navigated frame acquires picker listeners');
await page.keyboard.press('Escape');
await page.locator(W + '[data-action=done]').click();
await page.locator(W + '[data-action=discard]').click();
await page.evaluate(() => { widget.destroy(); client.destroy(); });
assert(await nestedFrame.locator('#replacement').evaluate(el => { let clicks = 0; el.addEventListener('click', () => clicks++); el.click(); return clicks === 1; }), 'destroy removes nested interception');
await finish();
