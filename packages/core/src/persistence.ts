import type { Draft } from './client';
import type { AttachmentRef, Breadcrumb, ConsoleEntry, ErrorEntry, NetworkEntry, PersistenceOptions } from './types';
import { uid } from './format';

export interface RecoveryState {
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  network: NetworkEntry[];
  breadcrumbs: Breadcrumb[];
  draft: Draft | null;
}
interface StoredAttachment extends AttachmentRef { data: ArrayBuffer }
interface StoredState extends Omit<RecoveryState, 'draft'> {
  draft: (Omit<Draft, 'attachments'> & { attachments: StoredAttachment[] }) | null;
}
interface RecordV1 { version: 1; savedAt: number; expiresAt: number; state: StoredState }
const DB = 'lightback-recovery';
const STORE = 'sessions';
const MAX_AGE = 30 * 60 * 1000;

/** Best effort only: storage must never stop collection, editing or sending. */
export function createPersistence(
  options: false | PersistenceOptions | undefined,
  snapshot: () => RecoveryState,
  restore: (state: RecoveryState) => void,
) {
  const enabled = options !== false && typeof window !== 'undefined';
  let db: IDBDatabase | undefined;
  let key: string | undefined;
  let stopped = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let generation = 0;
  const binary = new WeakMap<Blob, Promise<ArrayBuffer>>();
  const maxAge = Math.max(1, Math.min((options && options.maxAge) || MAX_AGE, MAX_AGE));
  const maxBytes = Math.max(1, (options && options.maxBytes) || 5 * 1024 * 1024);
  const sessionKey = `lightback:session:${options && options.key || 'default'}`;

  function fail() {
    failed = true;
    // Invalidate the session immediately so an old snapshot cannot reappear after a failed write.
    try { if (key && sessionStorage.getItem(sessionKey) === key) sessionStorage.removeItem(sessionKey); } catch { /* denied */ }
    db?.close();
    db = undefined;
  }
  function transaction(action: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!db || !key || failed) return resolve();
      const tx = db.transaction(STORE, 'readwrite');
      const timeout = setTimeout(() => {
        try { tx.abort(); } catch { /* already finished */ }
        reject(new Error('Recovery transaction timed out'));
      }, 1500);
      tx.oncomplete = () => { clearTimeout(timeout); resolve(); };
      tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(tx.error); };
      try { action(tx.objectStore(STORE)); }
      catch (error) {
        clearTimeout(timeout);
        try { tx.abort(); } catch { /* already finished */ }
        reject(error);
      }
    });
  }
  const ready = (async () => {
    if (!enabled) return;
    // Clear can happen while open itself is pending, before a transaction exists.
    const epoch = generation;
    try {
      key = sessionStorage.getItem(sessionKey) || uid();
      sessionStorage.setItem(sessionKey, key);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        let abandoned = false;
        const timeout = setTimeout(() => { abandoned = true; reject(new Error('Storage open timed out')); }, 1000);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => {
          clearTimeout(timeout);
          if (abandoned) request.result.close(); else resolve(request.result);
        };
        request.onerror = request.onblocked = () => { clearTimeout(timeout); abandoned = true; reject(new Error('Recovery storage unavailable')); };
      });
      db = database;
      db.onversionchange = () => fail();
      await transaction((store) => {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const record = item.value as RecordV1;
          if (!valid(record) || (record.expiresAt <= Date.now() || (item.key === key && record.savedAt + maxAge <= Date.now()))) item.delete();
          else if (item.key === key && epoch === generation && !stopped) {
            try {
              const draft = record.state.draft;
              restore({ ...record.state, draft: draft && {
                ...draft,
                attachments: draft.attachments.filter((a) => a && typeof a.name === 'string' && typeof a.type === 'string' && a.data instanceof ArrayBuffer)
                  .map(({ data, ...ref }) => ({ ...ref, size: data.byteLength, blob: new Blob([data], { type: ref.type }) })),
              } });
            } catch { item.delete(); }
          }
          item.continue();
        };
      });
    } catch { fail(); }
  })();

  function valid(record: RecordV1): boolean {
    return record?.version === 1 && Number.isFinite(record.savedAt) && Number.isFinite(record.expiresAt) && !!record.state &&
      ['console', 'errors', 'network', 'breadcrumbs'].every((name) => Array.isArray(record.state[name as keyof RecoveryState])) &&
      (record.state.draft === null || (
        typeof record.state.draft?.text === 'string' && Array.isArray(record.state.draft.selections) && Array.isArray(record.state.draft.attachments)
      ));
  }
  function enqueue(action: () => Promise<void>): Promise<void> {
    queue = queue.then(() => ready).then(action).catch(fail);
    return queue;
  }
  function flush(): Promise<void> {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (failed || !enabled) return Promise.resolve();
    const epoch = generation;
    return enqueue(async () => {
      if (epoch !== generation || !db) return;
      const state = snapshot();
      const now = Date.now();
      const header = { version: 1 as const, savedAt: now, expiresAt: now + maxAge };
      let bytes = new Blob([JSON.stringify({ ...header, state: { ...state, draft: state.draft && { ...state.draft, attachments: [] } } })]).size;
      if (state.draft) {
        state.draft.attachments = state.draft.attachments.filter((attachment) => {
          const { blob, ...ref } = attachment;
          const size = blob.size + new Blob([JSON.stringify({ ...ref, data: {} })]).size + 1;
          if (!(options && options.attachments) || bytes + size > maxBytes) return false;
          bytes += size;
          return true;
        });
        const names = new Set(state.draft.attachments.map((attachment) => attachment.name));
        state.draft.selections.forEach((selection) => { if (!names.has(selection.crop ?? '')) delete selection.crop; });
      }
      // Binary buffers avoid native Blob persistence failures in some WebKit environments.
      // Only opted-in, size-bounded attachments are converted; no base64 or synchronous Web Storage.
      const stored: StoredState = { ...state, draft: state.draft && {
        ...state.draft,
        attachments: await Promise.all(state.draft.attachments.map(async ({ blob, ...ref }) => ({ ...ref, data: await encodeBlob(blob) }))),
      } };
      if (epoch !== generation) return;
      await transaction((store) => {
        const empty = !state.console.length && !state.errors.length && !state.network.length && !state.breadcrumbs.length &&
          (!state.draft || (!state.draft.text && !state.draft.selections.length && !state.draft.attachments.length));
        if (bytes > maxBytes || empty) store.delete(key!);
        else store.put({ ...header, state: stored } satisfies RecordV1, key!);
      });
    });
  }
  function encodeBlob(blob: Blob): Promise<ArrayBuffer> {
    let data = binary.get(blob);
    if (!data) {
      data = blob.arrayBuffer();
      binary.set(blob, data);
    }
    // Reuse bytes on later checkpoints and pagehide: WebKit may revoke the old document's Blob backing file during navigation.
    return data;
  }
  function schedule() {
    if (enabled && !stopped && !failed && !timer) timer = setTimeout(() => { void flush(); }, 100);
  }
  function clear() {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    return enqueue(() => transaction((store) => { store.delete(key!); }));
  }
  const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
  const onPageHide = () => { void flush(); };
  if (enabled) {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHide);
  }
  return {
    ready, schedule, flush, clear,
    destroy() {
      if (stopped) return;
      stopped = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onHide);
      }
      void flush().then(() => { db?.close(); db = undefined; });
    },
  };
}
