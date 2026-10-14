import { launch } from './lib.mjs';
import { startReact19Fixture } from '../packages/source/test/dev-server.mjs';

const { page, assert, finish } = await launch('react-19-source');
let server;
try {
  server = await startReact19Fixture();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForSelector('[data-testid=button]');
  const result = await page.evaluate(() => {
    const button = document.querySelector('[data-testid=button]');
    const badge = document.querySelector('[data-testid=badge]');
    const inspect = (element) => window.fixture.describeElement(element);
    const original = inspect(button);
    const jsx = inspect(badge);
    button.setAttribute('data-source', 'manual/Button.tsx:12:5');
    const stamped = inspect(button);
    return { version: window.fixture.version, original, jsx, stamped };
  });
  assert(result.version.startsWith('19.'), `fixture runs React ${result.version}`);
  const { original, jsx, stamped } = result;
  assert(original.framework === 'react', 'detects React 19');
  assert(!original.attrs['data-source'], 'development fixture has no build-time stamps');
  assert(original.source?.file.endsWith('/App.tsx') && original.source.line > 0 && original.source.column > 0,
    `TSX host source comes from the React 19 stack: ${JSON.stringify(original.source)}`);
  assert(jsx.source?.file.endsWith('/Badge.jsx') && jsx.source.line > 0 && jsx.source.column > 0,
    `JSX host source comes from the React 19 stack: ${JSON.stringify(jsx.source)}`);
  assert(JSON.stringify(original.components) === JSON.stringify(['App']), 'TSX component chain');
  assert(JSON.stringify(jsx.components) === JSON.stringify(['Badge', 'App']), 'nested JSX component chain');
  assert(jsx.chain[0]?.source?.file.endsWith('/App.tsx') && jsx.chain[1]?.source?.file.endsWith('/development.tsx'),
    `component call sites come from their own stacks: ${JSON.stringify(jsx.chain)}`);
  assert(original.props?.label === 'React 19', 'nearest component props survive inspection');
  assert(JSON.stringify(stamped.source) === JSON.stringify({ file: 'manual/Button.tsx', line: 12, column: 5 }), 'explicit source wins over debug stack');
  assert(JSON.stringify(stamped.chain) === JSON.stringify(original.chain), 'explicit source preserves component call sites');
} finally {
  await server?.close();
  await finish();
}
