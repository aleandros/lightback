import { createServer } from 'node:http';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

// Real HTTP redirects verify final response URLs rather than mocked Response objects.
export async function checkRedirectPrivacy(page, assert, baseURL) {
  const foreign = await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    response.end('foreign-body');
  });
  let local;
  try {
    local = await serve((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/redirect') {
        response.writeHead(302, { location: url.searchParams.get('target') === 'foreign' ? foreign.origin + '/final' : '/final' });
        response.end();
      } else if (url.pathname === '/final') {
        response.writeHead(200, { 'content-type': 'text/plain' }); response.end('local-body');
      } else {
        response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Redirect privacy fixture</title>');
      }
    });
    await page.goto(local.origin);
    const corePath = baseURL + '/@fs' + new URL('../../packages/core/src/index.ts', import.meta.url).pathname;
    const result = await page.evaluate(async (corePath) => {
      const { createLightback } = await import(corePath);
      const client = createLightback({ persistence: false, capture: { console: false, errors: false, breadcrumbs: false, network: true, networkBodies: true } });
      const responses = [];
      try {
        for (const target of ['foreign', 'local']) {
          responses.push(await (await fetch('/redirect?target=' + target)).text());
          responses.push(await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/redirect?target=' + target);
            xhr.onload = () => resolve(xhr.responseText);
            xhr.onerror = () => reject(new Error('privacy fixture XHR failed'));
            xhr.send();
          }));
        }
        // Fetch's cloned body completes independently of the host's body reader.
        for (let attempt = 0; attempt < 100; attempt++) {
          if (client.buildPayload({}).network.filter((entry) => entry.responseBody === 'local-body').length === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { responses, network: client.buildPayload({}).network };
      } finally { client.destroy(); }
    }, corePath);
    assert(JSON.stringify(result.responses) === JSON.stringify(['foreign-body', 'foreign-body', 'local-body', 'local-body']), 'privacy instrumentation preserves native fetch and XHR responses');
    for (const kind of ['fetch', 'xhr']) {
      const redirected = result.network.find((entry) => entry.kind === kind && entry.url.includes('target=foreign'));
      assert(redirected && redirected.responseBody === undefined, `${kind} omits a same-origin request's cross-origin redirected body`);
      assert(result.network.find((entry) => entry.kind === kind && entry.url.includes('target=local'))?.responseBody === 'local-body', `${kind} retains a verified same-origin redirected body`);
    }
    assert(result.network.length === 4, 'all redirected requests retain network metadata');
  } finally {
    if (local) await close(local.server);
    await close(foreign.server);
  }
}
