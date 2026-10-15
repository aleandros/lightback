// Real raster coverage: edits, scale/scroll, masks, recovery, discard and exact sent PNGs.
import { launch, W, BASE_URL } from './lib.mjs';
const { page, OUT, assert, finish } = await launch('annotations');
const core = '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname;
const widget = '/@fs' + new URL('../packages/widget/src/ui.ts', import.meta.url).pathname;
const fixture = `<!doctype html><html><body style="margin:0;height:2400px">
<div id="target" style="position:absolute;top:1000px;left:200px;width:300px;height:200px">Target
<div data-lightback-sensitive style="position:absolute;left:110px;top:70px;width:60px;height:50px">Secret</div></div>
<script type="module">
import {createLightback} from ${JSON.stringify(core)};
import {mountWidget} from ${JSON.stringify(widget)};
window.sent=[];
window.client=createLightback({persistence:{attachments:true},send:async(payload,attachments)=>{
 if(window.failSend) throw new Error('retry me'); window.sent.push({payload,attachments});
}});
window.widget=mountWidget({client,screenshotArea:'viewport',screenshot:async({area})=>{
 const c=document.createElement('canvas'); c.width=area.width*2; c.height=area.height*2;
 const x=c.getContext('2d'); x.fillStyle='#123456';x.fillRect(0,0,c.width,c.height);
 return new Promise(r=>c.toBlob(r,'image/png'));
}});
await client.ready;window.ready=true;
</script></body></html>`;
await page.context().route('**/annotations-fixture.html', (route) => route.fulfill({contentType:'text/html',body:fixture}));
const load = async () => { await page.goto(BASE_URL + '/annotations-fixture.html'); await page.waitForFunction(() => window.ready); };
const action = async (name) => {
  await page.click(W + `[data-action=${name}]`);
  if (name === 'annotation-close') await ref('annotationEditor').waitFor({state:'hidden'});
};
const ref = (name) => page.locator(W + `[data-ref=${name}]`);
const shapes = (name = 'screenshot.png') => page.evaluate((name) => client.getDraft()?.imageAnnotations?.find((l) => l.attachment === name)?.shapes ?? [], name);
const readyEditor = () => page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=annotationCanvas]').width > 1);
const count = (n) => page.waitForFunction((n) => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=annotationList]').options.length === n, n);
async function imageData(selector) {
  return page.evaluate(async (selector) => {
    const img=document.querySelector('lightback-widget').shadowRoot.querySelector(selector);
    const b=await (await fetch(img.src)).blob();
    const bytes=Array.from(new Uint8Array(await b.arrayBuffer()));
    const bitmap=await createImageBitmap(b); const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
    const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    let orange=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===234&&pixels[i+1]===88&&pixels[i+2]===12)orange++;
    return {bytes,orange,width:c.width,height:c.height};
  }, selector);
}
async function draw(x1,y1,x2,y2) {
  const b=await ref('annotationCanvas').boundingBox();
  await page.mouse.move(b.x+b.width*x1,b.y+b.height*y1);await page.mouse.down();
  await page.mouse.move(b.x+b.width*x2,b.y+b.height*y2,{steps:5});await page.mouse.up();
}
await load();
await page.evaluate(() => window.scrollTo(0,900));
await ref('pillPick').click();await page.click('#target',{position:{x:15,y:15}});await action('done');
await page.locator(W+'[data-action=annotate-crop]').waitFor();
await action('annotate-shot');await readyEditor();
await page.locator(W+'[data-action=annotation-close]').focus();await page.keyboard.press('Shift+Tab');
assert(await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.activeElement.dataset.action==='annotation-add'),'keyboard focus wraps within the empty editor');
await draw(.1,.15,.65,.7);await count(1);
let layer=await shapes();
assert(Math.abs(layer[0].x1-.1)<.01&&Math.abs(layer[0].y2-.7)<.01,'scaled pointer draw uses normalized image coordinates on a scrolled viewport');
await ref('annotationKind').selectOption('arrow');await draw(.8,.8,.4,.3);await count(2);
assert((await shapes())[1].x2 < (await shapes())[1].x1,'arrow direction is preserved');
// All geometry operations also have native keyboard controls.
await ref('annotationX1').fill('75');await ref('annotationY1').fill('85');
await page.locator(W+'[data-action=annotation-apply]').focus();await page.keyboard.press('Enter');
assert((await shapes())[1].x1===.75,'keyboard applies editable endpoints');
await action('annotation-undo');assert((await shapes())[1].x1>.79,'undo restores prior geometry');
await action('annotation-delete');await count(1);await action('annotation-undo');await count(2);
await action('annotation-reset');await count(0);await action('annotation-undo');await count(2);
await page.screenshot({path:OUT+'editor.png'});
await action('annotation-close');
assert(await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.activeElement.dataset.action==='annotate-shot'),'Done returns focus to the image editor button');
// Wait for the final PNG, then use its bytes as the send contract.
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').complete);
let preview=await imageData('[data-ref=shotImg]');assert(preview.orange>100,'preview contains rasterized rectangles and arrows at 2x');
await action('annotate-crop');await readyEditor();await ref('annotationKind').selectOption('rectangle');
await action('annotation-add');await count(1);
// Reset must keep the sensitive pixels and original selection outline.
await action('annotation-reset');await count(0);await action('annotation-close');
const mask=await page.evaluate(async()=>{
 const img=document.querySelector('lightback-widget').shadowRoot.querySelector('.lb-thumb');
 const bitmap=await createImageBitmap(await(await fetch(img.src)).blob());
 const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);
 return Array.from(x.getImageData((16+140)*2,(16+95)*2,1,1).data).slice(0,3).join(',');
});assert(mask==='17,24,39','reset preserves opaque masks inside a crop');
await action('annotate-crop');await readyEditor();await action('annotation-add');await action('annotation-close');
await ref('text').fill('Annotations survive reload');
await page.evaluate(()=>client.flushPersistence());await load();await ref('pillOpen').click();
await action('annotate-shot');await readyEditor();await count(2);
assert((await shapes('selection-1.png')).length===1,'crop layer recovers independently');
await action('annotation-reset');await count(0);await action('annotation-undo');await count(2);await action('annotation-close');
preview=await imageData('[data-ref=shotImg]');const cropPreview=await imageData('.lb-thumb');
assert(preview.width===2560&&preview.height===1720&&cropPreview.width===664,'bitmap dimensions and crop geometry survive editing/recovery');
await page.evaluate(()=>window.failSend=true);await action('send');
await page.waitForFunction(()=>document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=status]').textContent.includes('retry me'));
assert((await shapes()).length===2,'failed send retains editable draft');
await page.evaluate(()=>window.failSend=false);await action('send');await page.waitForFunction(()=>sent.length===1);
const sentImages=await page.evaluate(async()=>Promise.all(sent[0].attachments.map(async a=>({name:a.name,bytes:Array.from(new Uint8Array(await a.blob.arrayBuffer()))}))));
assert(JSON.stringify(sentImages.find(a=>a.name==='screenshot.png').bytes)===JSON.stringify(preview.bytes),'sent screenshot is byte-for-byte identical to preview');
assert(JSON.stringify(sentImages.find(a=>a.name==='selection-1.png').bytes)===JSON.stringify(cropPreview.bytes),'sent crop is byte-for-byte identical to preview');
assert(await page.evaluate(()=>sent[0].payload.version===1&&!('imageAnnotations' in sent[0].payload)&&client.getDraft()===null),'send keeps payload v1 and clears recovery');
// Fresh image replacement and discard cannot revive old vector layers.
await ref('pillOpen').click();await action('shot');await ref('annotateShot').waitFor();
await action('annotate-shot');await readyEditor();await action('annotation-add');await action('annotation-close');
const old=await ref('shotImg').getAttribute('src');await action('shot');
await page.waitForFunction(old=>document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').src!==old,old);
assert((await shapes()).length===0,'retaking clears marks tied to the previous capture');
await action('annotate-shot');await readyEditor();await action('annotation-add');await action('annotation-close');await action('discard');
await page.evaluate(()=>client.flushPersistence());await load();await ref('pillOpen').click();
assert(await ref('shot').isHidden()&&(await shapes()).length===0,'discard and reload remove the image and its edits');
await finish();
