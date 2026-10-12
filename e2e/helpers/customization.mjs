// Run as part of pill-pins-crops so the same customization checks reach every CI engine.
export async function checkCustomization(page, assert, baseURL) {
  await page.goto(baseURL + '/');
  await page.waitForSelector('lightback-widget');
  const corePath = '/@fs' + new URL('../../packages/core/src/index.ts', import.meta.url).pathname;
  const widgetPath = '/@fs' + new URL('../../packages/widget/src/index.ts', import.meta.url).pathname;
  await page.evaluate(async ({ corePath, widgetPath }) => {
    const { createLightback } = await import(corePath);
    const { mountWidget } = await import(widgetPath);
    const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false }, send: async () => {} });
    const widget = mountWidget({ client, hideTrigger: true, theme: 'light', strings: {
      countSelected: (n) => `${n} elegidos`, done: (n) => `Listo (${n})`,
      areaIn: (name) => `Área de ${name}`, send: 'Enviar', summarySelections: (n) => `${n} selecciones`,
      removeSelection: 'Quitar selección', noComment: 'Sin comentario',
    } });
    widget.element.dataset.ref = 'customWidget';
    const button = document.createElement('button');
    button.dataset.action = 'customPick'; button.setAttribute('data-lightback-ignore', '');
    button.textContent = 'Pick'; button.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647';
    button.onclick = () => widget.startPicking(); document.body.append(button);
    const style = document.createElement('style');
    style.textContent = 'lightback-widget[data-ref=customWidget]::part(panel) { border-radius: 23px; }';
    document.head.append(style);
  }, { corePath, widgetPath });
  const root = 'lightback-widget[data-ref=customWidget]';
  const q = (selector) => page.locator(`${root} >> ${selector}`);
  const bg = () => page.locator(root).evaluate((host) => getComputedStyle(host).getPropertyValue('--lb-bg').trim());
  await page.emulateMedia({ colorScheme: 'dark' });
  assert(await bg() === '#ffffff', 'forced light ignores dark system preference');
  await page.locator(root).evaluate((host) => { host.dataset.theme = 'dark'; });
  await page.emulateMedia({ colorScheme: 'light' });
  assert(await bg() === '#111827', 'forced dark ignores light system preference');
  await page.locator(root).evaluate((host) => { host.dataset.theme = 'auto'; });
  assert(await bg() === '#ffffff', 'auto uses light system preference');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert(await bg() === '#111827', 'auto responds to system preference changes');
  assert(await q('[data-ref=pill]').isHidden(), 'custom trigger starts with hidden pill');
  await page.click('[data-action=customPick]');
  await q('[data-action=done]').waitFor({ state: 'visible' });
  const target = await page.locator('[data-testid=stat-overdue]').boundingBox();
  await page.mouse.click(target.x + 8, target.y + 8);
  assert(await q('[data-ref=count]').textContent() === '1 elegidos', 'translated dynamic count');
  assert(await q('[data-action=pop-send]').textContent() === 'Enviar', 'translated popover send');
  assert(await q('[data-action=sel-remove]').first().getAttribute('aria-label') === 'Quitar selección', 'translated dynamic remove label');
  await q('[data-action=pop-send]').click();
  assert((await q('[data-ref=pendingSummary]').textContent()).includes('1 selecciones'), 'translated pending summary');
  await q('[data-action=pending-cancel]').click();
  assert(await q('[data-ref=pill]').isHidden(), 'pending cancellation keeps custom trigger hidden');
  await page.click('[data-action=customPick]');
  await q('[data-action=done]').waitFor({ state: 'visible' });
  await q('[data-action=done]').click();
  assert(await q('[data-ref=panel]').evaluate((panel) => getComputedStyle(panel).borderRadius) === '23px', 'host stylesheet can customize panel part');
  await q('[data-action=discard]').click();
  assert(await q('[data-ref=pill]').isHidden(), 'discard keeps custom trigger hidden');
}
