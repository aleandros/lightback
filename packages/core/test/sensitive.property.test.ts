import fc from 'fast-check';
import { afterEach, expect, it } from 'vitest';
import { createLightback } from '../src/client';
import { toPromptContext } from '../src/prompt';
import { propertyParameters } from '../../../test/property';
import { noCapture } from './property-fixtures';

/** A generated tree; `mark` makes the node sensitive by attribute or by a configured selector. */
interface Node { tag: 'div' | 'span' | 'p' | 'section' | 'button'; mark: 'none' | 'attr' | 'selector'; label: boolean; children: Node[] }

const node: fc.Memo<Node> = fc.memo((depth) => fc.record({
  tag: fc.constantFrom('div', 'span', 'p', 'section', 'button'),
  mark: fc.constantFrom('none', 'none', 'attr', 'selector'),
  label: fc.boolean(),
  children: depth > 1 ? fc.array(node(depth - 1), { maxLength: 3 }) : fc.constant([]),
}));

afterEach(() => { document.body.innerHTML = ''; });

/** Render with independent bookkeeping: every node inside a marked subtree carries a unique secret token. */
function render(tree: Node, parent: Element, inherited: boolean, model: Map<Element, boolean>, counter: { n: number }) {
  const el = document.createElement(tree.tag);
  const hidden = inherited || tree.mark !== 'none';
  if (tree.mark === 'attr') el.setAttribute('data-lightback-sensitive', '');
  if (tree.mark === 'selector') el.className = 'vault';
  const token = `${hidden ? 'SECRET' : 'public'}${counter.n++}x`;
  el.id = `n${counter.n}`;
  if (tree.label) el.setAttribute('aria-label', token);
  el.setAttribute('data-value', token);
  el.append(`${token} `);
  model.set(el, hidden);
  parent.appendChild(el);
  for (const child of tree.children) render(child, el, hidden, model, counter);
}

it('never reports text, attributes or HTML from sensitive subtrees, for any pick in any generated tree', () => {
  fc.assert(fc.property(fc.array(node(4), { minLength: 1, maxLength: 3 }), (trees) => {
    document.body.innerHTML = '';
    const model = new Map<Element, boolean>();
    const counter = { n: 0 };
    for (const tree of trees) render(tree, document.body, false, model, counter);
    const client = createLightback({ persistence: false, capture: { ...noCapture, breadcrumbs: true }, privacy: { selectors: ['.vault'] } });
    try {
      for (const [el, hidden] of model) {
        const desc = client.describeElement(el);
        expect(Boolean(desc.sensitive)).toBe(hidden);
        expect(client.isSensitive(el)).toBe(hidden);
        (el as HTMLElement).click();
        const payload = client.buildPayload({ text: '', selections: [desc] });
        expect(JSON.stringify(payload)).not.toContain('SECRET');
        expect(toPromptContext(payload)).not.toContain('SECRET');
        // Withholding is targeted: a visible element keeps its own text.
        if (!hidden) expect(desc.text).toContain(el.firstChild!.textContent!.trim());
      }
      const region = client.describeRegion({ x: 0, y: 0, width: 50, height: 50 }, { hitTest: (x) => [...model.keys()][x % model.size] ?? null });
      expect(JSON.stringify(region)).not.toContain('SECRET');
    } finally { client.destroy(); }
  }), propertyParameters());
});
