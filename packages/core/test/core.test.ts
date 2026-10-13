import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RingBuffer } from '../src/ring';
import { redactString, redactUrl, DEFAULT_REDACT } from '../src/redact';
import { uniqueSelector, componentChain, describeElement } from '../src/inspect';
import { createLightback } from '../src/client';
import { toPromptContext } from '../src/prompt';
import type { Attachment } from '../src/types';

describe('RingBuffer', () => {
  it('keeps only the newest items', () => {
    const b = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => b.push(n));
    expect(b.toArray()).toEqual([3, 4, 5]);
  });
});

describe('redact', () => {
  it('masks JWTs and url params', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
    expect(redactString(`Bearer ${jwt}`, DEFAULT_REDACT)).toBe('Bearer [redacted]');
    expect(redactUrl('https://x.test/a?token=abc&q=1', DEFAULT_REDACT)).toBe('https://x.test/a?token=%5Bredacted%5D&q=1');
  });
});

describe('inspect', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <ul class="list">
          <li class="row"><button>One</button></li>
          <li class="row"><button data-testid="two">Two</button></li>
          <li class="row"><button>Three</button></li>
        </ul>
      </div>`;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers data-testid, then id, then a structural path', () => {
    const two = document.querySelector('[data-testid=two]')!;
    expect(uniqueSelector(two)).toBe('[data-testid="two"]');
    const three = document.querySelectorAll('button')[2]!;
    const sel = uniqueSelector(three);
    expect(document.querySelector(sel)).toBe(three);
    expect(sel).toContain('nth-of-type(3)');
  });

  it('anchors structural paths on an ancestor data-testid or id', () => {
    document.body.innerHTML = `
      <section><div><span>x</span><span>y</span></div></section>
      <section data-testid="stats"><div><span>a</span><span>b</span></div></section>`;
    const b = document.querySelectorAll('span')[3]!;
    expect(uniqueSelector(b)).toBe('[data-testid="stats"] > div > span:nth-of-type(2)');
    expect(document.querySelector(uniqueSelector(b))).toBe(b);
  });

  it('walks a React fiber chain when present', () => {
    const btn = document.querySelector('button')!;
    function InvoiceRow() {}
    const Table = { displayName: 'InvoiceTable' };
    const fiber = { type: 'button', return: { type: InvoiceRow, return: { type: Table, return: { type: Symbol('fragment'), return: null } } } };
    (btn as unknown as Record<string, unknown>)['__reactFiber$abc'] = fiber;
    expect(componentChain(btn)).toEqual({ framework: 'react', components: ['InvoiceRow', 'InvoiceTable'] });
    const d = describeElement(btn);
    expect(d.text).toBe('One');
    expect(d.components[0]).toBe('InvoiceRow');
  });
});

describe('client', () => {
  it('captures console and errors, builds a payload, and renders a prompt', async () => {
    const sent: unknown[] = [];
    const client = createLightback({
      send: async (p) => {
        sent.push(p);
      },
      context: { user: { id: 'u1' } },
    });
    console.warn('careful', { a: 1 });
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
    const payload = await client.send({ text: 'The save button does nothing' });
    client.destroy();

    expect(payload).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(payload!.console.at(-1)).toMatchObject({ level: 'warn', message: 'careful {"a":1}' });
    expect(payload!.errors[0]).toMatchObject({ kind: 'error', message: 'boom' });
    expect(payload!.context).toEqual({ user: { id: 'u1' } });

    const md = toPromptContext(payload!);
    expect(md).toContain('## Errors (1)');
    expect(md).toContain('The save button does nothing');
  });

  it('reports the document area each image shows, and drops malformed areas', async () => {
    const sent: Attachment[][] = [];
    const client = createLightback({ persistence: false, send: async (_p, attachments) => { sent.push(attachments); } });
    const blob = new Blob(['png'], { type: 'image/png' });
    const area = { x: 0, y: 1500, width: 1280, height: 860 };
    const payload = await client.send({
      text: 'scrolled',
      attachments: [
        { name: 'screenshot.png', type: 'image/png', size: 3, blob, area: { ...area, extra: 'x' } as never },
        { name: 'selection-1.png', type: 'image/png', size: 3, blob, area: { x: 1, y: 2, width: Infinity, height: 4 } },
        { name: 'selection-2.png', type: 'image/png', size: 3, blob, area: { x: 1, y: 2, width: 0, height: 4 } },
      ],
    });
    client.destroy();
    expect(payload!.attachments.map((a) => a.area)).toEqual([area, undefined, undefined]);
    expect(sent[0]!.map((a) => a.area)).toEqual([area, undefined, undefined]);
    expect(toPromptContext(payload!)).toContain('screenshot.png (image/png, 3 bytes, shows document area x=0 y=1500 1280×860)');
  });

  it('mute() pauses console and network capture', async () => {
    const client = createLightback({ send: async () => {} });
    const before = client.stats();
    await client.mute(async () => {
      console.log('hidden');
      await fetch('data:text/plain,x').catch(() => {});
    });
    console.log('visible');
    const after = client.stats();
    expect(after.console).toBe(before.console + 1);
    expect(after.network).toBe(before.network);
    client.destroy();
  });

  it('lets beforeSend veto', async () => {
    const client = createLightback({ send: async () => {}, beforeSend: () => null });
    expect(await client.send({ text: 'x' })).toBeNull();
    client.destroy();
  });
});

describe('props and source', () => {
  it('snapshots props safely', async () => {
    const { snapshotProps, frameworkInfo } = await import('../src/inspect');
    const snap = snapshotProps({
      invoice: { id: 'INV-1', total: 12, nested: { deep: { deeper: 1 } } },
      onClick: () => {},
      children: 'x',
      el: { $$typeof: Symbol('react.element') },
      list: Array.from({ length: 12 }, (_, i) => i),
      long: 'a'.repeat(300),
    });
    expect(snap).toMatchObject({ invoice: { id: 'INV-1', total: 12, nested: { deep: '[object]' } }, onClick: '[fn onClick]', el: '[element]' });
    expect(snap).not.toHaveProperty('children');
    expect((snap.list as unknown[]).length).toBe(11);
    expect((snap.long as string).length).toBe(201);

    document.body.innerHTML = '<button data-source="src/Row.tsx:12:5">x</button>';
    const btn = document.querySelector('button')!;
    function Row() {}
    (btn as unknown as Record<string, unknown>)['__reactFiber$x'] = {
      type: 'button',
      _debugSource: { fileName: '/app/src/Row.tsx', lineNumber: 40, columnNumber: 9 },
      return: { type: Row, memoizedProps: { id: 'r1', onSelect: () => {} }, _debugSource: { fileName: '/app/src/Table.tsx', lineNumber: 8 }, return: null },
    };
    const info = frameworkInfo(btn);
    expect(info.source).toEqual({ file: 'src/Row.tsx', line: 12, column: 5 });
    expect(info.chain).toEqual([{ name: 'Row', source: { file: '/app/src/Table.tsx', line: 8, column: undefined } }]);
    expect(info.props).toEqual({ id: 'r1', onSelect: '[fn onSelect]' });
    btn.removeAttribute('data-source');
    expect(frameworkInfo(btn).source).toEqual({ file: '/app/src/Row.tsx', line: 40, column: 9 });

    document.body.innerHTML = '<div data-source="src/Plain.tsx:3"></div>';
    expect(frameworkInfo(document.querySelector('div')!).source).toEqual({ file: 'src/Plain.tsx', line: 3, column: undefined });
  });
});

describe('describeRegion', () => {
  it('finds the common container and the visible children, ignoring what is behind a modal', async () => {
    const { describeRegion } = await import('../src/region');
    document.body.innerHTML = `
      <main id="page"><button id="behind">Behind</button></main>
      <div id="overlay"><div id="modal" role="dialog">
        <h2 id="title">Export</h2>
        <label id="lbl"><span id="lbl-text">Format</span><select id="fmt"></select></label>
        <button id="ok">OK</button>
      </div></div>`;
    const rects: Record<string, [number, number, number, number]> = {
      page: [0, 0, 800, 600], behind: [100, 100, 80, 30],
      overlay: [0, 0, 800, 600], modal: [200, 100, 400, 300], title: [220, 120, 100, 30],
      lbl: [220, 160, 200, 30], 'lbl-text': [220, 160, 60, 30], fmt: [290, 160, 100, 30], ok: [220, 300, 60, 30],
    };
    for (const [id, [x, y, w, h]] of Object.entries(rects)) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON() {} }) as DOMRect;
    }
    const inside = (id: string, x: number, y: number) => {
      const [rx, ry, rw, rh] = rects[id]!;
      return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
    };
    // Topmost element at a point: modal contents, then modal, then overlay (which covers "behind").
    const hitTest = (x: number, y: number) => {
      for (const id of ['title', 'lbl-text', 'fmt', 'ok', 'modal', 'overlay']) if (inside(id, x, y)) return document.getElementById(id);
      return null;
    };
    // Drag over the title + label area, well inside the modal, overlapping the hidden "behind" button.
    const sel = describeRegion({ x: 90, y: 90, width: 400, height: 110 }, { hitTest });
    expect(sel).not.toBeNull();
    expect(sel!.kind).toBe('region');
    expect(sel!.selector).toBe('#modal');
    const children = sel!.region!.children.map((c) => c.selector);
    expect(children).toEqual(['#title', '#lbl']);
    expect(children).not.toContain('#behind');
  });
});
