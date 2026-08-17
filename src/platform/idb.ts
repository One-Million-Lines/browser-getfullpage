import {
  DB_NAME,
  DB_VERSION,
  STORE_META,
  STORE_RESULTS,
  STORE_SLICES,
} from '@/shared/constants';
import type { CaptureId, CaptureResult, CapturedSlice } from '@/shared/types';

/**
 * Transient, extension-owned IndexedDB for the current capture only (spec §7
 * data handling). Slices are written the moment they are captured so an MV3
 * service-worker restart cannot lose progress. Everything is deleted after
 * export/preview close and on next startup if an interrupted marker exists.
 */

interface SliceRow extends CapturedSlice {
  key: string;
}

interface ResultRow {
  captureId: CaptureId;
  meta: CaptureResult;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SLICES)) {
        const store = db.createObjectStore(STORE_SLICES, { keyPath: 'key' });
        store.createIndex('captureId', 'captureId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        db.createObjectStore(STORE_RESULTS, { keyPath: 'captureId' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/* --------------------------------- slices ---------------------------------- */

export async function putSlice(slice: CapturedSlice): Promise<void> {
  const row: SliceRow = { ...slice, key: `${slice.captureId}:${slice.index}` };
  await tx(STORE_SLICES, 'readwrite', (s) => s.put(row));
}

export async function getSlices(captureId: CaptureId): Promise<CapturedSlice[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SLICES, 'readonly');
    const index = t.objectStore(STORE_SLICES).index('captureId');
    const req = index.getAll(IDBKeyRange.only(captureId));
    req.onsuccess = () => {
      const rows = (req.result as SliceRow[]).sort((a, b) => a.index - b.index);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSlices(captureId: CaptureId): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE_SLICES, 'readwrite');
    const store = t.objectStore(STORE_SLICES);
    const index = store.index('captureId');
    const req = index.openKeyCursor(IDBKeyRange.only(captureId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/* --------------------------------- results --------------------------------- */

export async function putResult(captureId: CaptureId, blob: Blob, meta: CaptureResult): Promise<void> {
  const row: ResultRow = { captureId, blob, meta };
  await tx(STORE_RESULTS, 'readwrite', (s) => s.put(row));
}

export async function getResult(
  captureId: CaptureId,
): Promise<{ meta: CaptureResult; blob: Blob } | undefined> {
  const row = await tx<ResultRow | undefined>(STORE_RESULTS, 'readonly', (s) => s.get(captureId));
  return row ? { meta: row.meta, blob: row.blob } : undefined;
}

export async function deleteResult(captureId: CaptureId): Promise<void> {
  await tx(STORE_RESULTS, 'readwrite', (s) => s.delete(captureId));
}

/* -------------------------------- meta marker ------------------------------ */

export async function setMarker(captureId: CaptureId | null): Promise<void> {
  await tx(STORE_META, 'readwrite', (s) => s.put({ key: 'active', captureId }));
}

export async function getMarker(): Promise<CaptureId | null> {
  const row = await tx<{ key: string; captureId: CaptureId | null } | undefined>(
    STORE_META,
    'readonly',
    (s) => s.get('active'),
  );
  return row?.captureId ?? null;
}

/** Remove every transient artefact for a capture. */
export async function purgeCapture(captureId: CaptureId): Promise<void> {
  await Promise.all([clearSlices(captureId), deleteResult(captureId)]);
}

/** Wipe all transient slices and results (safety net at the start of a capture). */
export async function clearAllTransient(): Promise<void> {
  await tx(STORE_SLICES, 'readwrite', (s) => s.clear());
  await tx(STORE_RESULTS, 'readwrite', (s) => s.clear());
}
