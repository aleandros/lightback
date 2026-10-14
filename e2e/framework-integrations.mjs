import { readFile } from 'node:fs/promises';
import { launch, W } from './lib.mjs';
import { startFrameworkFixture } from '../packages/source/test/framework-server.mjs';

const { page, assert, finish, OUT } = await launch('framework-integrations');
try {
  for (const framework of ['vue', 'svelte']) {
    const server = await startFrameworkFixture(framework);
    const hydrationErrors = [];
    const listen = (message) => { if (/hydration|mismatch/i.test(message.text())) hydrationErrors.push(message.text()); };
    page.on('console', listen);
    try {
      assert(!server.html.includes('lightback-widget'), `${framework}: SSR has no widget DOM`);
      await page.goto(server.url);
      await page.waitForFunction(() => window.fixture && document.querySelector('[data-ref=widget-ready]')?.textContent === 'ready');
      assert(await page.evaluate(() => window.fixture.original === document.querySelector('[data-testid=target]')), `${framework}: hydration reuses server DOM`);
      assert(hydrationErrors.length === 0, `${framework}: no hydration mismatches`);
      assert(await page.locator('lightback-widget').count() === 1, `${framework}: exactly one widget`);
      assert(await page.locator(W + '[data-ref=panel]').count() === 0, `${framework}: editor stays lazy`);
      for (const [testid, filename] of [['heading','App'],['target','Child'],['svg','App']]) {
        const code = await readFile(new URL(`../packages/source/test/frameworks/${framework}/${filename}.${framework}`, import.meta.url), 'utf8');
        const offset = code.indexOf(`<${testid === 'heading' ? 'h1' : testid === 'svg' ? 'circle' : 'button'} data-testid="${testid}"`);
        const before = code.slice(0,offset).split('\n');
        const expected = `${framework}/${filename}.${framework}:${before.length}:${before.at(-1).length+1}`;
        assert(await page.locator(`[data-testid=${testid}]`).getAttribute('data-source') === expected, `${framework}: exact original ${testid} coordinates (${expected})`);
      }
      assert(await page.locator('[data-testid=manual]').getAttribute('data-source') === `manual.${framework}:2:3`, `${framework}: manual stamp retained`);
      let releaseDownload;
      const released = new Promise(resolve => { releaseDownload = resolve; });
      const started = page.waitForRequest(request => request.url().includes('lightback-ui'));
      const intercept = async route => { await released; await route.continue(); };
      await page.route('**/*lightback-ui*.js*', intercept);
      await page.locator('[data-action=fixture-open]').click();
      await started;
      await page.evaluate(() => window.fixture.unmount());
      const response = page.waitForResponse(response => response.url().includes('lightback-ui'));
      releaseDownload();
      await (await response).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(await page.locator('lightback-widget').count() === 0, `${framework}: unmount during download prevents late UI`);
      await page.unroute('**/*lightback-ui*.js*',intercept);
      await page.evaluate(() => window.fixture.remount());
      await page.waitForFunction(() => document.querySelector('[data-ref=widget-ready]')?.textContent === 'ready');
      await page.evaluate(() => window.fixture.mountSecond());
      await page.locator('#second [data-testid=target]').click();
      assert(await page.evaluate(() => window.fixture.secondPayload().breadcrumbs.some(b => b.message === 'clicked')), `${framework}: descendants use their own provider client`);
      assert(await page.evaluate(() => !window.fixture.client.buildPayload({text:''}).breadcrumbs.some(b => b.message === 'clicked')), `${framework}: independent provider roots do not leak context`);
      await page.evaluate(() => window.fixture.removeSecond());
      await page.evaluate(() => window.fixture.update({route:'updated'}));
      await page.waitForFunction(() => window.fixture.client.buildPayload({text:''}).context.route === 'updated');
      await page.locator('[data-action=fixture-open]').click();
      await page.locator(W + '[data-ref=panel]').waitFor({state:'visible'});
      await page.locator(W + '[data-ref=panel] [data-action=pick]').click();
      await page.locator('[data-testid=target]').click();
      await page.locator(W + '[data-ref=popText]').fill('Framework source test');
      // Open the panel so sending is immediate, and exercise the real transport boundary.
      await page.keyboard.press('Escape');
      await page.locator(W + '[data-action=done]').click();
      await page.locator(W + '[data-action=send]').click();
      await page.waitForFunction(() => window.fixture.reports.length === 1);
      const report = await page.evaluate(() => window.fixture.reports[0]);
      assert(report.payload.selections[0].source.file === `${framework}/Child.${framework}`, `${framework}: source arrives in sent payload`);
      assert(report.prompt.includes(`${framework}/Child.${framework}:`), `${framework}: source arrives in model prompt`);
      assert(report.payload.context.route === 'updated' && report.payload.context.retained, `${framework}: context updates merge`);
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.evaluate(() => window.fixture.unmount());
        assert(await page.locator('lightback-widget').count() === 0, `${framework}: teardown ${cycle} removes widget`);
        await page.evaluate(() => window.fixture.update({route:'after-unmount'}));
        assert(await page.evaluate(() => window.fixture.client.buildPayload({text:''}).context.route) !== 'after-unmount', `${framework}: context subscription disposed`);
        await page.evaluate(() => window.fixture.remount());
        await page.waitForFunction(() => document.querySelector('[data-ref=widget-ready]')?.textContent === 'ready');
        assert(await page.locator('lightback-widget').count() === 1, `${framework}: remount ${cycle} creates one widget`);
      }
      await page.evaluate(() => window.fixture.unmount());
      await page.evaluate(() => window.fixture.remount(false));
      await page.waitForSelector('[data-ref=widget-ready]');
      assert(await page.locator('lightback-widget').count() === 0, `${framework}: widget false`);
      await page.evaluate(() => window.fixture.update({route:'headless'}));
      await page.waitForFunction(() => window.fixture.client.buildPayload({text:''}).context.route === 'headless');
      await page.evaluate(() => { window.fixture.client.addBreadcrumb('client still alive'); });
      assert(await page.evaluate(() => window.fixture.client.buildPayload({text:''}).breadcrumbs.some(b => b.message === 'client still alive')), `${framework}: integration never destroys caller client`);
      await page.evaluate(async () => { await window.fixture.unmount(); window.fixture.client.destroy(); });
    } catch (error) {
      await page.screenshot({path: `${OUT}/${framework}-failure.png`});
      throw error;
    } finally { page.off('console',listen); await server.close(); }
  }
} finally { await finish(); }
