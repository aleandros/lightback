// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { frameworkInfo } from '../src/inspect';

describe('React 19 development stack formats', () => {
  it.each([
    ['Chromium', 'Error: react-stack-top-frame\n    at jsxDEV (http://localhost:5173/node_modules/react/jsx-dev-runtime.js:20:4)\n    at Row (http://localhost:5173/src/Row.tsx:12:5)', 'http://localhost:5173/src/Row.tsx'],
    ['Firefox/WebKit', 'jsxDEV@http://localhost:5173/node_modules/react/jsx-dev-runtime.js:20:4\nRow@http://localhost:5173/src/Row.tsx:12:5', 'http://localhost:5173/src/Row.tsx'],
    ['Windows', 'Error\n    at Row (C:\\app\\src\\Row.tsx:12:5)', 'C:\\app\\src\\Row.tsx'],
  ])('extracts the first application frame from %s', (_name, stack, file) => {
    const element = document.createElement('button');
    Object.assign(element, { __reactFiber$fixture: { type: 'button', return: null, _debugStack: { stack } } });
    expect(frameworkInfo(element).source).toEqual({ file, line: 12, column: 5 });
  });

  it.each([undefined, null, { stack: '' }, { stack: 'Error\nnot a frame' }, {
    stack: 'Error\n    at jsxDEV (http://localhost/node_modules/react/jsx-dev-runtime.js:20:4)',
  }])('leaves source absent when no usable debug frame exists (%j)', (_debugStack) => {
    const element = document.createElement('button');
    function Row() {}
    Object.assign(element, { __reactFiber$fixture: {
      type: 'button', _debugStack,
      return: { type: Row, _debugStack, memoizedProps: { label: 'Ready' }, return: null },
    } });
    expect(frameworkInfo(element)).toEqual({ framework: 'react', source: undefined,
      chain: [{ name: 'Row', source: undefined }], props: { label: 'Ready' } });
    element.setAttribute('data-source', 'src/Row.tsx:12:5');
    expect(frameworkInfo(element).source).toEqual({ file: 'src/Row.tsx', line: 12, column: 5 });
  });

  it('preserves React 18 debug-source precedence if both metadata forms exist', () => {
    const element = document.createElement('button');
    Object.assign(element, { __reactFiber$fixture: {
      type: 'button', return: null,
      _debugSource: { fileName: '/src/Row.tsx', lineNumber: 12, columnNumber: 5 },
      _debugStack: { stack: 'Error\n    at Row (/compiled/Row.js:90:10)' },
    } });
    expect(frameworkInfo(element).source).toEqual({ file: '/src/Row.tsx', line: 12, column: 5 });
  });
});
