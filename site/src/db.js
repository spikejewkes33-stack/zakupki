// Хранилище в телефоне (IndexedDB). Каждая запись готова к будущей синхронизации с сервером:
// id (UUID), createdAt, updatedAt, rev (счётчик правок), deviceId, deleted (пометка вместо удаления).
import { openDB } from '../vendor/idb.js';

export const STORES = ['purchases', 'clients', 'items', 'events', 'docs', 'photos', 'meta'];

let dbp = null;
export function db() {
  if (!dbp) {
    dbp = openDB('pdd-zakupki', 1, {
      upgrade(d) {
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export async function getAll(store) {
  return (await db()).getAll(store);
}
export async function put(store, value) {
  return (await db()).put(store, value);
}
export async function get(store, id) {
  return (await db()).get(store, id);
}

// Несколько записей одной транзакцией: или всё, или ничего.
export async function putMany(entries) {
  const d = await db();
  const names = [...new Set(entries.map((e) => e[0]))];
  const tx = d.transaction(names, 'readwrite');
  for (const [store, value] of entries) tx.objectStore(store).put(value);
  await tx.done;
}

// Полная замена данных (восстановление из резервной копии) одной транзакцией.
export async function replaceAll(data) {
  const d = await db();
  const tx = d.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    await os.clear();
    for (const v of data[s] || []) await os.put(v);
  }
  await tx.done;
}
