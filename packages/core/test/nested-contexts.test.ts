import { afterEach, describe, expect, it } from 'vitest';
import { describeElement, uniqueSelector, elementContext } from '../src/inspect';
import { composedContains, composedParent, toTopRect } from '../src/dom';
import { commonAncestor } from '../src/region';
import { isSensitive, containsSensitive } from '../src/sensitive';
import { isRecoveredSelection } from '../src/recovery-redact';

afterEach(() => { document.body.innerHTML = ''; });
function fixture() {
  document.body.innerHTML = '<div id="host"><span id="slotted" slot="private">secret</span></div>';
  const host = document.querySelector('#host')!;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<button>First</button><button>Second</button><slot name="private" data-lightback-sensitive></slot><iframe id="frame"></iframe>';
  return { host, root, slot: document.querySelector('#slotted')!, first: root.querySelector('button')!, second: root.querySelectorAll('button')[1]! };
}

describe('nested DOM inspection', () => {
  it('makes CSS selectors unique in their own root and records a separate path', () => {
    const { first, second } = fixture();
    expect(uniqueSelector(first)).toBe('button:nth-of-type(1)');
    expect(uniqueSelector(second)).toBe('button:nth-of-type(2)');
    expect(elementContext(first)).toEqual([{ kind: 'shadow', selector: '#host' }]);
    expect(describeElement(first).context).toEqual([{ kind: 'shadow', selector: '#host' }]);
  });
  it('uses composed ancestry for regions and for privacy inherited through slots', () => {
    const { host, first, second, slot, root } = fixture();
    expect(composedContains(host, first)).toBe(true);
    expect(commonAncestor([first, second])).toBe(host);
    expect(composedParent(slot)).toBe(root.querySelector('slot'));
    expect(isSensitive(slot)).toBe(true);
    expect(describeElement(slot)).toMatchObject({ sensitive: true, text: '', attrs: {} });
    expect(describeElement(host).text).not.toContain('secret');
    expect(containsSensitive(host)).toBe(true);
    host.setAttribute('data-lightback-sensitive', '');
    expect(isSensitive(first)).toBe(true);
  });
  it('withholds bare text assigned to a sensitive slot', () => {
    document.body.innerHTML = '<div id="host">RAW SECRET</div>';
    const host = document.querySelector('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<slot data-lightback-sensitive></slot>';
    expect(describeElement(host).text).toBe('');
    expect(describeElement(host).html).not.toContain('RAW SECRET');
  });
  it('withholds frame form values and srcdoc HTML across realms', () => {
    document.body.innerHTML = '<iframe id="frame" srcdoc="SECRET"></iframe>';
    const frame = document.querySelector('iframe')!;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<textarea>PRIVATE INPUT</textarea><select><option>PRIVATE OPTION</option></select>';
    expect(describeElement(doc.querySelector('textarea')!).text).toBe('');
    expect(describeElement(doc.body).html).not.toContain('PRIVATE');
    expect(describeElement(frame).html).not.toContain('SECRET');
    expect(elementContext(doc.querySelector('textarea')!)).toEqual([{ kind: 'frame', selector: '#frame' }]);
    frame.setAttribute('data-lightback-sensitive', '');
    expect(isSensitive(doc.body)).toBe(true);
  });
  it('copies DOMRect prototype getters without losing coordinates', () => {
    const rect = new DOMRect(10, 20, 30, 40);
    expect(toTopRect(rect, document)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
  it('rejects corrupt recovered root paths before prompt rendering', () => {
    const { first } = fixture();
    const selection = describeElement(first);
    expect(isRecoveredSelection(selection)).toBe(true);
    expect(isRecoveredSelection({ ...selection, context: 'bad' })).toBe(false);
    expect(isRecoveredSelection({ ...selection, context: [{ kind: 'frame', selector: 2 }] })).toBe(false);
  });
});
