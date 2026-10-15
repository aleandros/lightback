import { launch, W, BASE_URL } from './lib.mjs';

const { page, assert, finish, OUT } = await launch('keyboard-picking');
await page.route('**/keyboard-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
<html><body><main data-testid="main"><h1 data-testid="heading">Page</h1>
<form data-testid="form"><input data-testid="input" value="unchanged"><button data-testid="submit"><span data-testid="icon" aria-hidden="true">Submit</span></button></form>
<div data-lightback-ignore><button data-testid="ignored">Ignore</button></div>
<div hidden><button data-testid="hidden">Hidden</button></div>
<div inert><button data-testid="inert">Inert</button></div>
<div aria-hidden="true"><button data-testid="ariaHidden">Hidden</button></div>
<div style="display:none"><button data-testid="displayNone">Hidden</button></div>
<div data-testid="sensitive" data-lightback-sensitive>PRIVATE CONTENT</div>
<div data-testid="last" style="margin-top:1500px">Last target</div></main></body></html>` }));
const focused = ref => page.evaluate(ref => document.querySelector('lightback-widget').shadowRoot.activeElement?.dataset.ref === ref, ref);
const actionFocused = action => page.evaluate(action => document.querySelector('lightback-widget').shadowRoot.activeElement?.dataset.action === action, action);
const target = async id => assert((await page.locator(W + '[data-ref=pickAnnouncement]').textContent()).includes(`[data-testid="${id}"]`), `keyboard target: ${id}`);
const press = key => page.keyboard.press(key);

for (const lazy of [true, false]) {
  await page.goto(BASE_URL + '/keyboard-fixture.html');
  await page.evaluate(async ({ corePath, widgetPath, lazy }) => {
    const { createLightback } = await import(corePath);
    const module = await import(widgetPath);
    window.submitted = [];
    window.hostEvents = [];
    document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.hostEvents.push('submit'); });
    document.querySelector('main').addEventListener('click', () => window.hostEvents.push('click'));
    document.querySelector('main').addEventListener('focusin', () => window.hostEvents.push('focus'));
    document.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape'].includes(e.key)) window.hostEvents.push('shortcut'); }, true);
    document.addEventListener('keydown', () => window.hostEvents.push('key'));
    document.addEventListener('keypress', () => window.hostEvents.push('keypress'));
    window.client = createLightback({ persistence: false, send: async payload => { window.submitted.push(payload); } });
    window.widget = (lazy ? module.mountLazyWidget : module.mountWidget)({ client: window.client, autoScreenshot: false, sendDelay: 5000 });
  }, { lazy, corePath: '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname,
    widgetPath: '/@fs' + new URL(`../packages/widget/src/${lazy ? 'lazy' : 'index'}.ts`, import.meta.url).pathname });
  await page.locator(W + '[data-ref=pillPick]').focus();
  await press('Enter');
  await page.locator(W + '[data-ref=keyboardPicker]').waitFor();
  assert(await focused('keyboardPicker'), `${lazy ? 'lazy' : 'eager'} entry focuses picker`);
  await page.evaluate(() => { window.hostEvents = []; });
  await press('ArrowDown'); await target('main');
  await press('ArrowLeft');
  await press('Enter');
  assert(await page.locator(W + '[data-ref=count]').textContent() === '1 selected', 'parent boundary keeps the current target, never body');
  await press('Tab'); await press('Enter'); // remove boundary selection
  await press('ArrowRight'); await target('heading');
  await press('ArrowLeft'); await target('main');
  await press('ArrowDown'); await target('heading');
  await press('ArrowDown'); await target('form');
  await press('ArrowRight'); await target('input');
  await press('Space');
  assert(await focused('popText'), 'Space selects an input without focusing it');
  await page.locator(W + '[data-ref=popText]').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, composed: true })));
  assert(await focused('popText'), 'IME confirmation does not send a comment');
  await page.keyboard.type('Input needs a label');
  await press('Shift+Enter');
  await page.keyboard.type('Second line');
  await press('Escape');
  assert(await focused('keyboardPicker'), 'comment Escape returns to picker');
  await press('ArrowDown'); await target('submit');
  await press('Enter');
  await page.locator(W + '[data-ref=popText]').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, composed: true })));
  assert(await focused('popText'), 'held Enter does not send the selection');
  await press('Tab');
  assert(await actionFocused('pop-remove'), 'Tab reaches popover actions');
  await press('Tab');
  await press('Enter'); // Add more
  assert(await focused('keyboardPicker'), 'Add more returns focus to picker');
  await press('ArrowDown'); await target('sensitive');
  assert(!(await page.locator(W + '[data-ref=pickAnnouncement]').textContent()).includes('PRIVATE'), 'announcement omits sensitive text');
  await press('ArrowDown'); await target('last');
  assert(await page.evaluate(() => window.scrollY > 0), 'offscreen target scrolls into view');
  await press('ArrowUp'); await target('sensitive');
  // Revalidate stale targets at selection time; removed elements must not enter a report.
  await page.locator('[data-testid=sensitive]').evaluate(el => el.remove());
  await press('Enter');
  assert(await focused('keyboardPicker'), 'removed target is not selected');
  assert(await page.locator(W + '[data-ref=count]').textContent() === '2 selected', 'only requested live elements selected');
  await press('Shift+Tab');
  assert(await actionFocused('done'), 'Shift+Tab wraps to Done, not host forms');
  await press('Tab');
  assert(await focused('keyboardPicker'), 'Tab wraps back to picker');
  assert(await page.locator('[data-testid=input]').inputValue() === 'unchanged', 'host input remains unchanged');
  assert((await page.evaluate(() => window.hostEvents)).length === 0, 'picking neither focuses, activates nor sends keydowns to host');
  await page.screenshot({ path: OUT + `${lazy ? 'lazy' : 'eager'}-picker.png` });
  await press('Escape');
  assert(await focused('text'), 'picker Escape opens review');
  await page.locator(W + '[data-action=send]').focus();
  await press('Enter');
  await page.waitForFunction(() => window.submitted.length === 1);
  const payload = await page.evaluate(() => window.submitted[0]);
  assert(payload.selections.map(s => s.selector).join('|') === '[data-testid="input"]|[data-testid="submit"]', 'keyboard selections reach transport');
  assert(payload.selections[0].note === 'Input needs a label\nSecond line', 'multiline comment preserved');
  assert(await focused('pillPick'), 'send restores trigger focus');
  await press('Enter');
  const icon = await page.locator('[data-testid=icon]').boundingBox();
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
  assert(await page.locator(W + '[data-ref=keyboardHelp]').isHidden(), 'pointer movement hides visual help');
  assert(await page.locator(W + '[data-ref=pickAnnouncement]').evaluate(el => !el.closest('[hidden]')), 'live region remains rendered after pointer movement');
  await press('ArrowLeft'); await target('form');
  await page.locator(W + '[data-ref=keyboardPicker]').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, composed: true })));
  assert(await page.locator(W + '[data-ref=count]').textContent() === '0 selected', 'held Enter does not create another selection');
  await press('Tab'); // cancel (no capturer)
  await press('Enter');
  assert(await focused('pillPick'), 'Cancel returns to trigger');
  await page.locator(W + '[data-ref=pillOpen]').focus(); await press('Enter');
  await page.locator(W + '[data-ref=panel] [data-action=pick]').focus(); await press('Enter');
  await press('Tab'); await press('Enter');
  assert(await focused('text'), 'Cancel from panel returns to editor');
  await press('Escape');
  assert(await focused('pillOpen'), 'closing review restores original opener');
  // Public API with hidden trigger returns focus to the host's original control.
  await page.evaluate(() => window.widget.destroy());
  await page.evaluate(async widgetPath => {
    const { mountWidget } = await import(widgetPath);
    window.widget = mountWidget({ client: window.client, hideTrigger: true });
    document.querySelector('[data-testid=input]').focus();
    window.widget.startPicking();
  }, '/@fs' + new URL('../packages/widget/src/index.ts', import.meta.url).pathname);
  await page.locator(W + '[data-ref=keyboardPicker]').waitFor();
  await page.evaluate(() => window.widget.close());
  assert(await page.locator('[data-testid=input]').evaluate(el => el === document.activeElement), 'API close restores host focus with hidden trigger');
  await page.evaluate(() => { window.widget.startPicking(); document.querySelector('[data-testid=submit]').focus(); window.widget.close(); });
  assert(await page.locator('[data-testid=submit]').evaluate(el => el === document.activeElement), 'closing does not steal focus after returning to the host');
  await page.evaluate(() => { document.querySelector('[data-testid=input]').focus(); window.widget.startPicking(); window.widget.destroy(); window.client.destroy(); });
  assert(await page.locator('[data-testid=input]').evaluate(el => el === document.activeElement), 'destroy restores external focus');
}
// Keyboard masking uses the same document-space mask path, with no page activation.
await page.goto(BASE_URL + '/keyboard-fixture.html');
await page.evaluate(async ({ corePath, widgetPath }) => {
  const { createLightback } = await import(corePath);
  const { mountWidget } = await import(widgetPath);
  window.submitted = [];
  window.client = createLightback({ persistence: false, send: async p => { window.submitted.push(p); } });
  window.widget = mountWidget({ client: window.client, autoScreenshot: false, screenshot: async ({ area }) => { const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height; return new Promise(resolve => canvas.toBlob(resolve)); } });
}, { corePath: '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname,
  widgetPath: '/@fs' + new URL('../packages/widget/src/index.ts', import.meta.url).pathname });
await page.locator(W + '[data-ref=pillPick]').focus(); await press('Enter');
await press('ArrowDown'); await press('ArrowRight');
await press('Tab'); await press('Enter'); // Hide area
assert(await page.locator(W + '[data-ref=maskMode]').getAttribute('aria-pressed') === 'true', 'keyboard toggles masking');
await press('Shift+Tab'); await press('Space');
assert(await page.locator(W + '[data-ref=mask]').count() === 1, 'keyboard masks highlighted element');
assert(await page.locator(W + '[data-ref=count]').textContent() === '0 selected', 'masking adds no selection');
await press('Escape');
await page.keyboard.type('Masked heading');
await page.locator(W + '[data-ref=shotBtn]').click();
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').src.startsWith('blob:'));
await page.locator(W + '[data-action=send]').focus(); await press('Enter');
await page.waitForFunction(() => window.submitted.length === 1);
assert(await page.evaluate(() => window.submitted[0].masks?.some(mask => mask.reason === 'reporter')), 'keyboard mask reaches payload');
await page.evaluate(() => { window.widget.destroy(); window.client.destroy(); });
// Captures must hold their measured scroll position even when the capturer hides focus.
for (const omitsWidget of [false, true]) {
  await page.goto(BASE_URL + '/keyboard-fixture.html');
  await page.evaluate(async ({ corePath, widgetPath, capturePath, omitsWidget }) => {
    const { createLightback } = await import(corePath);
    const { mountWidget } = await import(widgetPath);
    const { OMITS_WIDGET } = await import(capturePath);
    window.captureStarted = 0;
    window.hostPrintable = 0;
    document.addEventListener('keypress', () => { window.hostPrintable++; });
    window.hostKeys = 0;
    document.addEventListener('keydown', () => { window.hostKeys++; }, true);
    const screenshot = async ({ area }) => {
      window.captureStarted++;
      await new Promise(resolve => { window.releaseCapture = resolve; });
      const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height;
      return new Promise(resolve => canvas.toBlob(resolve));
    };
    if (omitsWidget) screenshot[OMITS_WIDGET] = true;
    window.client = createLightback({ persistence: false });
    window.widget = mountWidget({ client: window.client, screenshot, screenshotArea: 'viewport' });
    window.widget.startPicking();
  }, { omitsWidget, corePath: '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname,
    widgetPath: '/@fs' + new URL('../packages/widget/src/index.ts', import.meta.url).pathname,
    capturePath: '/@fs' + new URL('../packages/widget/src/capture.ts', import.meta.url).pathname });
  await page.waitForFunction(() => window.captureStarted);
  for (const key of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'Enter', 'Tab']) await press(key);
  assert(await page.evaluate(() => window.scrollY === 0 && window.hostKeys === 0), `capture preserves scroll and suppresses host keys (omitsWidget=${omitsWidget})`);
  assert(await page.locator(W + '[data-ref=count]').textContent() === '0 selected', 'capture defers keyboard selection');
  assert(await page.locator(W + '[data-ref=pickAnnouncement]').evaluate(el => !el.closest('[hidden]') && getComputedStyle(el).visibility === 'visible'), 'capture keeps live region in accessibility tree');
  await page.evaluate(() => window.releaseCapture());
  await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').src.startsWith('blob:'));
  await press('ArrowDown'); await target('main');
  for (const id of ['heading', 'form', 'input', 'submit', 'sensitive', 'last']) { await press('ArrowDown'); await target(id); }
  await press('Enter');
  await page.waitForFunction(() => window.captureStarted === 2);
  assert(await focused('popText'), 'viewport recapture preserves comment focus');
  if (!omitsWidget) assert(await page.locator(W + '[data-action=sel-remove]').first().evaluate(el => getComputedStyle(el).pointerEvents === 'none'), 'transparent capture disables invisible pin buttons');
  await page.keyboard.type('Typed during a viewport recapture');
  assert(await page.locator(W + '[data-ref=popText]').inputValue() === 'Typed during a viewport recapture', 'custom capture retains every typed character');
  assert(await page.evaluate(() => window.hostPrintable === 0), 'typing during capture does not reach host shortcuts');
  await page.evaluate(() => window.releaseCapture());
  await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('.lb-thumb'));
  assert(await focused('popText'), 'comment stays focused after capture completes');
  await page.evaluate(() => { window.widget.destroy(); window.client.destroy(); });
}
await finish();
