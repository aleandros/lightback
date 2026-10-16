// Capture freshness, historical crops and asynchronous send/privacy boundaries, with real PNGs.
import { launch, W, BASE_URL } from './lib.mjs';
const { browser, page, OUT, assert, finish } = await launch('screenshot-refresh');
page.setDefaultTimeout(30_000);
const core = '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname;
const widget = '/@fs' + new URL('../packages/widget/src/ui.ts', import.meta.url).pathname;
const fixture = `<!doctype html><html><body style="margin:0;height:1800px">
<div id="target" style="position:absolute;left:100px;top:160px;width:200px;height:120px;background:rgb(220,30,40)">First</div>
<div id="second" style="position:absolute;left:420px;top:160px;width:200px;height:120px;background:rgb(30,180,60)">Second</div>
<div id="secret" data-lightback-sensitive style="position:absolute;left:140px;top:180px;width:30px;height:30px">Secret</div>
<script type="module">
import {createLightback} from ${JSON.stringify(core)};
import {mountWidget} from ${JSON.stringify(widget)};
window.sent=[];window.captures=0;window.hold=false;window.errors=[];
window.client=createLightback({persistence:false,send:async(payload,attachments)=>sent.push({payload,attachments})});
window.widget=mountWidget({client,sendDelay:0,screenshotArea:new URL(location.href).searchParams.get('area')||'viewport',onError:e=>errors.push(String(e)),screenshot:async({area})=>{
 window.captures++;
 const c=document.createElement('canvas');c.width=area.width;c.height=area.height;
 const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
 for(const id of ['target','second']) {const el=document.getElementById(id),r=el.getBoundingClientRect();ctx.fillStyle=getComputedStyle(el).backgroundColor;ctx.fillRect(r.x+scrollX-area.x,r.y+scrollY-area.y,r.width,r.height);}
 await fetch('/capture-probe');
 if(window.hold) await new Promise(r=>window.releaseCapture=r);
 return new Promise(r=>c.toBlob(r,'image/png'));
}});
await client.ready;window.ready=true;
</script></body></html>`;
await page.context().route('**/capture-probe', route => route.fulfill({ body: 'ok' }));
await page.context().route('**/refresh-fixture.html*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
const action = name => page.click(W + `[data-action=${name}]`);
const load = async (area = 'viewport') => { await page.goto(BASE_URL + '/refresh-fixture.html?area=' + area); await page.waitForFunction(() => window.ready); };
const cropReady = n => page.waitForFunction(n => client.getDraft()?.attachments.some(a => a.name === `selection-${n}.png`), n);
const shotReady = () => page.waitForFunction(() => client.getDraft()?.attachments.some(a => a.name === 'screenshot.png'));
const repeatTarget = async () => {
 // The first selection's pin owns pointer hits. Keyboard picking can select the same host element again.
 await page.locator(W + '[data-ref=keyboardPicker]').focus();
 await page.keyboard.press('Enter');
};
const pick = async (id, n) => {
 if (id === 'target' && n === 2) await repeatTarget();
 else await page.click('#' + id, { position: { x: 10, y: 90 } });
 await cropReady(n);await action('pop-more');
};
const samples = (sent = false) => page.evaluate(async sent => {
 const attachments=sent?window.sent[0].attachments:client.getDraft().attachments;
 return Promise.all(attachments.map(async a=>{
  const bitmap=await createImageBitmap(a.blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
  const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  const pixel=(x,y)=>Array.from(ctx.getImageData(x-a.area.x,y-a.area.y,1,1).data).slice(0,3).join(',');
  return {name:a.name,color:pixel(a.name==='selection-3.png'?440:120,240),secret:pixel(150,190),reporter:pixel(190,190)};
 }));
}, sent);
try {
for (const area of ['viewport', 'page']) {
 await load(area);await action('pick');await shotReady();await pick('target',1);
 assert(await page.evaluate(()=>captures)===1,`${area}: unchanged selection reuses the initial capture`);
 await page.evaluate(()=>{const el=document.getElementById('target');el.style.backgroundColor='rgb(40,70,220)';el.textContent='Changed';for(let i=0;i<20;i++)el.dataset.revision=String(i);});
 assert(await page.evaluate(()=>captures)===1,`${area}: mutation burst does not capture in the background`);
 await pick('target',2);await pick('second',3);
 assert(await page.evaluate(()=>captures)===2,`${area}: one refresh serves subsequent unchanged selections`);
 let images=await samples();
 assert(images.find(a=>a.name==='selection-1.png').color==='220,30,40'&&images.find(a=>a.name==='selection-2.png').color==='40,70,220',`${area}: old and new crops preserve their respective capture content`);
 assert(images.find(a=>a.name==='screenshot.png').color==='40,70,220',`${area}: unannotated screenshot updates to the latest capture`);
 assert(images.filter(a=>a.name!=='selection-3.png').every(a=>a.secret==='17,24,39'),`${area}: refreshed images retain sensitive masks`);
 // Mask the historical target after refresh: both red and blue crops must keep their unmasked pixels.
 await action('mask-mode');await page.mouse.move(80,175);await page.mouse.down();await page.mouse.move(320,205,{steps:10});await page.mouse.up();await action('mask-mode');
 await action('done');await action('send');await page.waitForFunction(()=>sent.length===1);
 images=await samples(true);
 assert(images.filter(a=>a.name!=='selection-3.png').every(a=>a.reporter==='17,24,39'),`${area}: reporter masks cover old and refreshed crop pixels`);
 assert(images.find(a=>a.name==='selection-1.png').color==='220,30,40'&&images.find(a=>a.name==='selection-2.png').color==='40,70,220',`${area}: masking and sending never substitute newer pixels into old crops`);
 assert(await page.evaluate(()=>!sent[0].payload.network.some(n=>n.url.includes('capture-probe'))),`${area}: refresh requests stay muted`);
}
// A refresh held by the capturer cannot be skipped by a fast Send.
await load();await action('pick');await shotReady();await pick('target',1);
await page.evaluate(()=>{hold=true;document.getElementById('target').style.backgroundColor='rgb(40,70,220)';});
await repeatTarget();await page.waitForFunction(()=>captures===2&&window.releaseCapture);
// Custom capturers temporarily hide the widget: dispatch through the documented UI hook while it is held.
await page.evaluate(()=>document.querySelector('lightback-widget').shadowRoot.querySelector('[data-action=pop-send]').click());
assert(await page.evaluate(()=>sent.length)===0,'send waits for the pending refreshed image');
await page.evaluate(()=>{hold=false;releaseCapture();});await page.waitForFunction(()=>sent.length===1);
assert((await samples(true)).find(a=>a.name==='selection-2.png').color==='40,70,220','fast send includes the refreshed crop');
// A mutation while a capture runs remains dirty for the next selection; discard cancels queued work.
await load();await page.evaluate(()=>hold=true);await action('pick');await page.waitForFunction(()=>window.releaseCapture);
await page.evaluate(()=>{document.getElementById('target').style.backgroundColor='rgb(40,70,220)';document.getElementById('target').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:110,clientY:250}));});
await page.evaluate(()=>{widget.open();document.querySelector('lightback-widget').shadowRoot.querySelector('[data-action=discard]').click();hold=false;releaseCapture();});
await page.waitForFunction(()=>!document.querySelector('lightback-widget').hasAttribute('data-capturing'));
assert(await page.evaluate(()=>captures===1&&client.getDraft()===null&&sent.length===0),'discard prevents a queued refresh and late draft resurrection');
await page.screenshot({path:OUT+'discarded.png'});
assert(await page.evaluate(()=>errors.length===0),'no capture errors');
await finish();
} catch (error) {
 await page.screenshot({path:OUT+'failure.png'}).catch(()=>{});
 await browser.close();
 throw error;
}
