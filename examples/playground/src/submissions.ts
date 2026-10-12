import type { Attachment, FeedbackPayload } from '@lightback/core';
import { apiUrl, isDemo } from './mode';

export interface Submission {
  id: string;
  receivedAt: string;
  payload: FeedbackPayload;
  files: Record<string, string>;
}

const changed = () => window.dispatchEvent(new Event('lightback:submission'));

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lightback-demo', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('submissions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage is unavailable. Allow site storage to save demo reports.'));
    request.onblocked = () => reject(new Error('Close other demo tabs and try again.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openStore();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('submissions', mode);
    let result: T;
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onabort = () => {
      db.close();
      reject(new Error('Could not save or read demo reports. Clear the inbox or allow more browser storage, then retry.'));
    };
    try {
      run(transaction.objectStore('submissions'), (value) => { result = value; });
    } catch {
      transaction.abort();
    }
  });
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not save the screenshot. Please retry.'));
    reader.readAsDataURL(blob);
  });
}

export async function saveSubmission(payload: FeedbackPayload, attachments: Attachment[]): Promise<void> {
  const files = Object.fromEntries(await Promise.all(attachments.map(async (a) => [a.name, await dataUrl(a.blob)])));
  const entry: Submission = { id: payload.id, receivedAt: new Date().toISOString(), payload, files };
  await withStore<void>('readwrite', (store) => {
    store.put(entry);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result as Submission[]).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      for (const old of entries.slice(20)) store.delete(old.id);
    };
  });
  changed();
}

export async function listSubmissions(): Promise<Submission[]> {
  if (!isDemo) {
    const res = await fetch(apiUrl('feedback'));
    if (!res.ok) throw new Error('Could not load the inbox.');
    return res.json() as Promise<Submission[]>;
  }
  return withStore<Submission[]>('readonly', (store, result) => {
    const request = store.getAll();
    request.onsuccess = () => result((request.result as Submission[]).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
  });
}

export async function clearSubmissions(): Promise<void> {
  if (isDemo) await withStore<void>('readwrite', (store) => { store.clear(); });
  else {
    const res = await fetch(apiUrl('feedback'), { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not clear the inbox.');
  }
  changed();
}
