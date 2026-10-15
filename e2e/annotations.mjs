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
  if (name === 'annotation-add') {
    if (!await page.evaluate(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=annotationPrecise]').open)) await ref('annotationPreciseToggle').click();
  }
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
assert(await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.activeElement.dataset.ref==='annotationPreciseToggle'),'keyboard focus wraps within the empty editor');
await draw(.1,.15,.65,.7);await count(1);
let layer=await shapes();
assert(Math.abs(layer[0].x1-.1)<.01&&Math.abs(layer[0].y2-.7)<.01,'scaled pointer draw uses normalized image coordinates on a scrolled viewport');
await action('annotation-arrow');await draw(.8,.8,.4,.3);await count(2);
assert((await shapes())[1].x2 < (await shapes())[1].x1,'arrow direction is preserved');
assert(await page.locator(W+'[data-action=annotation-delete]').isDisabled(),'Remove requires a visibly selected mark');
// Select, move and resize directly without entering coordinates.
await page.locator(W+'[data-action=annotation-select]').focus();await page.keyboard.press('Enter');
assert(await page.locator(W+'[data-action=annotation-select]').getAttribute('aria-pressed')==='true' && await page.locator(W+'[data-action=annotation-arrow]').getAttribute('aria-pressed')==='false','tool buttons expose the active tool to keyboard and assistive technology');
await draw(.25,.3,.3,.35);
assert(Math.abs((await shapes())[0].x1-.15)<.01,'Select drags an existing rectangle instead of drawing another');
await action('annotation-undo');
await draw(.6,.55,.65,.6);
assert(Math.abs((await shapes())[1].x1-.85)<.01,'Select moves an arrow by its shaft');
await draw(.45,.35,.3,.25);
assert(Math.abs((await shapes())[1].x2-.3)<.01 && Math.abs((await shapes())[1].y2-.25)<.01,'dragging the endpoint handle resizes the arrow');
await action('annotation-undo');await action('annotation-undo');
const beforeCancel=JSON.stringify(await shapes());
const canvasBox=await ref('annotationCanvas').boundingBox();
await page.mouse.move(canvasBox.x+canvasBox.width*.6,canvasBox.y+canvasBox.height*.55);await page.mouse.down();
await page.mouse.move(canvasBox.x+canvasBox.width*.7,canvasBox.y+canvasBox.height*.65);await page.keyboard.press('Escape');await page.mouse.up();
assert(JSON.stringify(await shapes())===beforeCancel && await ref('annotationEditor').isVisible(),'Escape cancels a move without changing the draft or closing the editor');
await draw(.6,.55,1,1);
const bounded=(await shapes())[1];
assert(Math.abs(bounded.x1-1)<.01 && Math.abs(bounded.y1-1)<.01 && Math.abs((bounded.x1-bounded.x2)-.4)<.01,'moving to an edge clamps the whole mark without changing its size');
await action('annotation-undo');
// All geometry operations also have native keyboard controls, tucked away by default.
assert(!await ref('annotationX1').isVisible(),'coordinate fields are hidden until precise editing is requested');
await ref('annotationPreciseToggle').focus();await page.keyboard.press('Enter');
await ref('annotationX1').fill('75');await ref('annotationY1').fill('85');
await page.locator(W+'[data-action=annotation-apply]').focus();await page.keyboard.press('Enter');
assert((await shapes())[1].x1===.75,'keyboard applies editable endpoints');
await action('annotation-undo');assert((await shapes())[1].x1>.79,'undo restores prior geometry');
await action('annotation-delete');await count(1);assert(await page.locator(W+'[data-action=annotation-delete]').isDisabled(),'Remove clears the selection instead of selecting another mark');await action('annotation-undo');await count(2);
await page.locator(W+'[data-action=annotation-reset]').focus();await page.keyboard.press('Enter');await count(0);
assert(await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.activeElement.dataset.action==='annotation-select'),'Reset keeps keyboard focus in the editor when it disables itself');
await action('annotation-undo');await count(2);
await page.screenshot({path:OUT+'editor.png'});
await action('annotation-close');
assert(await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.activeElement.dataset.action==='annotate-shot'),'Done returns focus to the image editor button');
// Wait for the final PNG, then use its bytes as the send contract.
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').complete);
let preview=await imageData('[data-ref=shotImg]');assert(preview.orange>100,'preview contains rasterized rectangles and arrows at 2x');
await action('annotate-crop');await readyEditor();await action('annotation-rectangle');
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
// Adding selections after recovery must keep the annotated screenshot, even though crops use fresh pixels.
await page.locator(W+'[data-ref=text]:enabled').waitFor();
const preserved = await imageData('[data-ref=shotImg]');
await page.click(W+'[data-ref=panel] [data-action=pick]');await action('done');
await page.waitForFunction(()=>document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').complete);
assert((await shapes()).length===2,'adding selections preserves recovered screenshot marks');
await action('annotate-shot');await readyEditor();await count(2);
assert((await shapes('selection-1.png')).length===1,'crop layer recovers independently');
await action('annotation-reset');await count(0);await action('annotation-undo');await count(2);await action('annotation-close');
preview=await imageData('[data-ref=shotImg]');const cropPreview=await imageData('.lb-thumb');
assert(JSON.stringify(preview.bytes)===JSON.stringify(preserved.bytes),'automatic pick capture does not replace the annotated screenshot');
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
// The toolbar and canvas remain usable on a narrow screen, including expanded precision controls.
await page.setViewportSize({width:390,height:844});
await action('shot');await ref('annotateShot').waitFor();await action('annotate-shot');await readyEditor();
await action('annotation-rectangle');await draw(.1,.1,.6,.6);await action('annotation-select');
await draw(.6,.6,.8,.7);
assert(Math.abs((await shapes())[0].x2-.8)<.01 && Math.abs((await shapes())[0].y2-.7)<.01,'rectangle handles resize correctly on a narrow screen');
await draw(.95,.95,.95,.95);
assert(await page.locator(W+'[data-action=annotation-delete]').isDisabled(),'clicking empty canvas deselects without deleting or creating a shape');
const editorBounds=await ref('annotationEditor').boundingBox();
assert(editorBounds.x>=0 && editorBounds.x+editorBounds.width<=390,'editor fits the narrow viewport');
await ref('annotationPreciseToggle').click();
await ref('annotationList').selectOption('0');await ref('annotationX1').fill('15');await action('annotation-apply');
await action('annotation-undo');
assert(Math.abs((await shapes())[0].x1-.1)<.01,'toolbar stays clickable after expanding precision controls on mobile');
await ref('annotationPreciseToggle').click();
await action('annotation-arrow');await draw(.2,.2,.6,.6);
await action('annotation-rectangle');await draw(.05,.05,.85,.85);
await action('annotation-select');await draw(.4,.4,.45,.4);
assert(Math.abs((await shapes())[1].x1-.25)<.01,'an arrow remains selectable inside a newer enclosing rectangle');
await action('annotation-rectangle');await draw(.2,.9,.21,.91);await action('annotation-select');await draw(.205,.905,.305,.905);
assert((await shapes())[3].x1>.28 && Math.abs((await shapes())[3].x2-(await shapes())[3].x1-.01)<.01,'tiny marks can be moved without their overlapping handles hijacking the drag');
const smallCanvas=await ref('annotationCanvas').boundingBox();
const end=.1+26/smallCanvas.width, middle=.1+10/smallCanvas.width;
await action('annotation-arrow');await draw(.1,.9,end,.9);await action('annotation-select');await draw(middle,.9,middle+.1,.9);
assert((await shapes())[4].x1>.19 && Math.abs(((await shapes())[4].x2-(await shapes())[4].x1)*smallCanvas.width-26)<1,'small marks above the tiny cutoff retain a usable move area');
await page.screenshot({path:OUT+'mobile-editor.png'});
await action('annotation-close');
await finish();
