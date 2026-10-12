import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { Draft } from '../src/client';
import type { ElementSelection } from '../src/types';

export function setupStorage() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(1_800_000_000_000);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Blob', NodeBlob);
  sessionStorage.clear();
}
export function cleanupStorage() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}
export const noCapture = { console: false, errors: false, network: false, breadcrumbs: false };
export const draft = (text = ''): Draft => ({ text, selections: [], attachments: [] });
export function selection(id: string): ElementSelection {
  return {
    id, kind: 'element', selector: `#target-${id}`, tag: 'button', classes: [], text: 'Target', attrs: {},
    rect: { x: 1, y: 2, width: 30, height: 40 }, docRect: { x: 1, y: 2, width: 30, height: 40 },
    framework: null, components: [], chain: [],
  };
}
/** Inspect the durable boundary, without calling the production serializer or validator. */
export async function storedRecord(update?: (record: any) => any): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lightback-recovery', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', update ? 'readwrite' : 'readonly');
      const store = tx.objectStore('sessions');
      const key = sessionStorage.getItem('lightback:session:default');
      if (!key) { resolve(undefined); return; }
      const request = store.get(key);
      let value: unknown;
      request.onsuccess = () => { value = request.result; if (update) store.put(update(value), key); };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
