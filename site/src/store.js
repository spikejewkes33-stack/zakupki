// Состояние приложения в памяти + запись в IndexedDB + история изменений.
// Все изменения идут через commit(): запись помечается версией и устройством, в журнал пишется, что поменялось.
import * as db from './db.js';
import { diff, todayLocal, ITEM_FIELDS, PURCHASE_FIELDS, CLIENT_FIELDS } from './model.js';
import { startSession as startS, finishSession as finishS } from './order.js';
import { pairId } from './opis.js';
import { DEFAULT_ROUNDING } from './money.js';

export const APP_ID = 'pdd-zakupki';
export const BACKUP_VERSION = 1;
const FIELDS = { purchases: PURCHASE_FIELDS, clients: CLIENT_FIELDS, items: ITEM_FIELDS };
const ENTITY = { purchases: 'purchase', clients: 'client', items: 'item' };

export const state = {
  ready: false,
  purchases: new Map(),
  clients: new Map(),
  items: new Map(),
  events: [],
  docs: [],
  settings: { id: 'settings', activePurchaseId: null, lastBackupAt: null },
  deviceId: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let version = 0;
export const getVersion = () => version;
function notify() {
  version += 1;
  for (const fn of listeners) fn(version);
}

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export async function load() {
  const [purchases, clients, items, events, docs, meta] = await Promise.all(
    ['purchases', 'clients', 'items', 'events', 'docs', 'meta'].map((s) => db.getAll(s)),
  );
  state.purchases = new Map(purchases.map((x) => [x.id, x]));
  state.clients = new Map(clients.map((x) => [x.id, x]));
  state.items = new Map(items.map((x) => [x.id, x]));
  state.events = events.sort((a, b) => a.at.localeCompare(b.at));
  state.docs = docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const m = new Map(meta.map((x) => [x.id, x]));
  state.settings = m.get('settings') || state.settings;
  let device = m.get('device');
  if (!device) {
    device = { id: 'device', value: uuid() };
    await db.put('meta', device);
  }
  state.deviceId = device.value;
  state.ready = true;
  notify();
}

// Записать изменение одной сущности (и, по желанию, ещё несколько записей той же транзакцией).
async function commit(store, before, patch, action, note) {
  const at = nowIso();
  const after = {
    ...(before || { id: uuid(), createdAt: at, rev: 0 }),
    ...patch,
    updatedAt: at,
    rev: (before?.rev || 0) + 1,
    deviceId: state.deviceId,
  };
  const changes = diff(before, after, FIELDS[store]);
  if (before && Object.keys(changes).length === 0) return before;
  const event = { id: uuid(), at, deviceId: state.deviceId, entity: ENTITY[store], entityId: after.id, action, changes, note: note || '' };
  await db.putMany([[store, after], ['events', event]]);
  state[store].set(after.id, after);
  state.events.push(event);
  notify();
  return after;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch, id: 'settings' };
  await db.put('meta', state.settings);
  notify();
}

// ——— Закупки ———
export async function createPurchase({ name, startDate, rateMicro, rounding }) {
  const p = await commit('purchases', null, {
    name, startDate, endDate: null, rateMicro, rounding: rounding || DEFAULT_ROUNDING,
    archived: false, clientIds: [], sessions: [], opis: { merges: [], rejected: [], edits: {} }, deleted: false,
  }, 'create');
  if (!state.settings.activePurchaseId) await saveSettings({ activePurchaseId: p.id });
  return p;
}
export const updatePurchase = (id, patch, action = 'update') => commit('purchases', state.purchases.get(id), patch, action);

export async function archivePurchase(id, archived) {
  const p = state.purchases.get(id);
  await commit('purchases', p, {
    archived,
    endDate: archived ? p.endDate || todayLocal() : p.endDate,
    sessions: archived ? finishS(p, nowIso()) : p.sessions,
  }, archived ? 'archive' : 'unarchive');
  if (archived && state.settings.activePurchaseId === id) {
    const next = [...state.purchases.values()].find((x) => !x.archived && !x.deleted);
    await saveSettings({ activePurchaseId: next?.id || null });
  }
}

export async function addClientToPurchase(pid, cid) {
  const p = state.purchases.get(pid);
  if (p.clientIds.includes(cid)) return p;
  return commit('purchases', p, { clientIds: [...p.clientIds, cid] }, 'add-client');
}

export async function removeClientFromPurchase(pid, cid) {
  const p = state.purchases.get(pid);
  return commit('purchases', p, { clientIds: p.clientIds.filter((x) => x !== cid) }, 'remove-client');
}

// Порядок оформления: «Оформляю клиента» и «Завершить заказы клиента».
export async function startOrdering(pid, cid) {
  const p = await addClientToPurchase(pid, cid);
  return commit('purchases', p, { sessions: startS(p, cid, nowIso(), uuid()) }, 'start-client');
}
export async function finishOrdering(pid) {
  const p = state.purchases.get(pid);
  return commit('purchases', p, { sessions: finishS(p, nowIso()) }, 'finish-client');
}

// ——— Опись: решения пользователя ———
function opisOf(p) {
  return { merges: [], rejected: [], edits: {}, ...(p.opis || {}) };
}
export async function opisMerge(pid, keyA, keyB) {
  const p = state.purchases.get(pid);
  const o = opisOf(p);
  return commit('purchases', p, { opis: { ...o, merges: [...o.merges, [keyA, keyB]] } }, 'opis-merge');
}
export async function opisReject(pid, keyA, keyB) {
  const p = state.purchases.get(pid);
  const o = opisOf(p);
  return commit('purchases', p, { opis: { ...o, rejected: [...o.rejected, pairId(keyA, keyB)] } }, 'opis-reject');
}
export async function opisSplit(pid, keys) {
  const p = state.purchases.get(pid);
  const o = opisOf(p);
  const set = new Set(keys);
  return commit('purchases', p, { opis: { ...o, merges: o.merges.filter(([a, b]) => !set.has(a) && !set.has(b)) } }, 'opis-split');
}
export async function opisEdit(pid, keys, patch) {
  const p = state.purchases.get(pid);
  const o = opisOf(p);
  const edits = { ...o.edits };
  const merged = Object.assign({}, ...keys.map((k) => edits[k] || {}), patch);
  for (const k of keys) delete edits[k];
  edits[keys[0]] = merged;
  return commit('purchases', p, { opis: { ...o, edits } }, 'opis-edit');
}
export async function opisReset(pid) {
  const p = state.purchases.get(pid);
  return commit('purchases', p, { opis: { merges: [], rejected: [], edits: {} } }, 'opis-reset');
}

// ——— Клиенты ———
export const createClient = ({ name, contact = '', note = '' }) =>
  commit('clients', null, { name: name.trim(), contact, note, deleted: false }, 'create');
export const updateClient = (id, patch) => commit('clients', state.clients.get(id), patch);

export function findClientByName(name) {
  const n = name.trim().toLowerCase();
  return [...state.clients.values()].find((c) => !c.deleted && c.name.trim().toLowerCase() === n) || null;
}

// ——— Товары ———
export async function saveItem(item) {
  const before = item.id ? state.items.get(item.id) : null;
  const patch = { ...item };
  delete patch.id;
  if (!before) {
    const same = [...state.items.values()].filter((x) => x.purchaseId === item.purchaseId);
    patch.seq = same.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
    patch.deleted = false;
    const p = state.purchases.get(item.purchaseId);
    if (p && !p.clientIds.includes(item.clientId)) await addClientToPurchase(p.id, item.clientId);
  }
  const action = before && before.clientId !== item.clientId ? 'move' : before ? 'update' : 'create';
  return commit('items', before, patch, action);
}
export const deleteItem = (id) => commit('items', state.items.get(id), { deleted: true }, 'delete');
export const restoreItem = (id) => commit('items', state.items.get(id), { deleted: false }, 'restore');
export const moveItem = (id, clientId) => commit('items', state.items.get(id), { clientId }, 'move');

// Фото: сжатая картинка хранится отдельно, в карточке — только её id.
export async function savePhoto(blob) {
  const id = uuid();
  await db.put('photos', { id, blob, createdAt: nowIso() });
  return id;
}
export const getPhoto = (id) => db.get('photos', id);

// ——— Документы (сохранённые описи) ———
export async function saveDoc(doc) {
  const d = { id: uuid(), createdAt: nowIso(), deviceId: state.deviceId, ...doc };
  await db.put('docs', d);
  state.docs.unshift(d);
  notify();
  return d;
}

// ——— Удобные выборки ———
export const purchaseById = (id) => state.purchases.get(id);
export const clientName = (id) => state.clients.get(id)?.name || '(клиент удалён)';
export function itemsOf(pid, { withDeleted = false } = {}) {
  return [...state.items.values()].filter((x) => x.purchaseId === pid && (withDeleted || !x.deleted));
}
export function activePurchase() {
  const p = state.purchases.get(state.settings.activePurchaseId);
  return p && !p.deleted ? p : null;
}
export function eventsFor(entityId) {
  return state.events.filter((e) => e.entityId === entityId).reverse();
}

// ——— Резервная копия ———
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

export async function makeBackup() {
  const photos = await db.getAll('photos');
  const data = {
    purchases: [...state.purchases.values()],
    clients: [...state.clients.values()],
    items: [...state.items.values()],
    events: state.events,
    docs: state.docs,
    photos: await Promise.all(photos.map(async (p) => ({ id: p.id, createdAt: p.createdAt, dataUrl: await blobToDataUrl(p.blob) }))),
  };
  return { app: APP_ID, version: BACKUP_VERSION, exportedAt: nowIso(), deviceId: state.deviceId, data };
}

export function checkBackup(json) {
  if (!json || json.app !== APP_ID || !json.data) return 'Это не файл копии «Закупок».';
  if (json.version > BACKUP_VERSION) return 'Копия сделана более новой версией приложения. Обновите приложение.';
  for (const k of ['purchases', 'clients', 'items']) if (!Array.isArray(json.data[k])) return `В копии нет раздела ${k}.`;
  return '';
}

export async function restoreBackup(json) {
  const err = checkBackup(json);
  if (err) throw new Error(err);
  const photos = await Promise.all((json.data.photos || []).map(async (p) => ({ id: p.id, createdAt: p.createdAt, blob: await dataUrlToBlob(p.dataUrl) })));
  const meta = [{ id: 'device', value: state.deviceId }, { ...state.settings, lastBackupAt: json.exportedAt }];
  await db.replaceAll({ ...json.data, photos, meta });
  await load();
}
