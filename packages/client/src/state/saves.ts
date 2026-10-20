// Saved games in the browser's IndexedDB, plus exporting and importing save
// files. Saves are plain JSON (see SaveGame in the sim); this only stores them.
import type { SaveGame } from '@tow/sim';

export interface SaveRecord {
  /** 'autosave' for the rolling autosave, otherwise a generated id. */
  id: string;
  name: string;
  /** Real time it was saved (ms since epoch); client-side only, never seen by the sim. */
  savedAt: number;
  scenarioName: string;
  tick: number;
  save: SaveGame;
}

const DB = 'theater-of-war';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open saved games'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('saved games are unavailable'));
    });
  } finally {
    db.close();
  }
}

export async function listSaves(): Promise<SaveRecord[]> {
  const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.sort((a, b) => (a.id === 'autosave' ? -1 : b.id === 'autosave' ? 1 : b.savedAt - a.savedAt));
}

export async function putSave(record: SaveRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(record));
}

export async function deleteSave(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Offer a save as a .json file download. */
export function downloadSave(save: SaveGame, name: string): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'theater-of-war'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a chosen file as JSON. */
export async function readSaveFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} is not a save file (it isn't JSON)`);
  }
}
