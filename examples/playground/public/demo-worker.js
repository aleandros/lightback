// Only simulates the demo's API. No caching or interception of docs, assets, or other sites.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data === 'lightback:claim') event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const api = new URL('api/', self.registration.scope);
  if (url.origin !== api.origin || !url.pathname.startsWith(api.pathname)) return;
  const route = url.pathname.slice(api.pathname.length);
  event.respondWith((async () => {
    let status = 200;
    let body;
    switch (route) {
      case 'invoices': body = { invoices: [{ id: 'INV-1042', total: 1280 }, { id: 'INV-1043', total: 90 }] }; break;
      case 'fail': status = 500; body = { error: 'Internal Server Error', detail: 'payments service unavailable (simulated)' }; break;
      case 'notfound': status = 404; body = { error: 'Not found' }; break;
      case 'slow':
        await new Promise((resolve) => setTimeout(resolve, 1500));
        body = { ok: true, slow: true }; break;
      case 'echo': body = { echoed: await event.request.text() }; break;
      default: status = 404; body = { error: 'No demo route' };
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  })());
});
