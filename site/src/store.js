// Состояние приложения в памяти + запись в IndexedDB + история изменений.
// Все изменения идут через commit(): запись помечается версией и устройством, в журнал пишется, что поменялось.
import * as db from './db.js';
import { diff, todayLocal, ITEM_FIELDS, PURCHASE_FIELDS, CLIENT_FIELDS, cargoIn, cargoMigration, qtyFixList } from './model.js';
import { startSession as startS, finishSession as finishS } from './order.js';
import { pairId } from './opis.js';
import { DEFAULT_ROUNDING } from './money.js';
import { emptyItem } from './model.js';
import { ARRIVED, isArrived, receivedFixList, trackIndex, lookupTrack as findTrack, scanOutcome, statusBeforeArrival } from './arrivals.js';
import { normalizeTrack } from './scan/track.js';

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
  // «Забрать» из «Команды»: разобранные блоки, треки без карточки, запомненные переводы названий.
  importInfo: { id: 'import', blockIds: [], pending: [], translations: {} },
  // Журнал сканирований на складе: id закупки → записи. Читается из базы по требованию (loadScans).
  scans: new Map(),
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

// UUID: crypto.randomUUID есть только по https (и с iOS 15.4); запасной вариант — из случайных байтов.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
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
  state.scans = new Map();
  const m = new Map(meta.map((x) => [x.id, x]));
  state.settings = m.get('settings') || state.settings;
  state.importInfo = { id: 'import', blockIds: [], pending: [], translations: {}, ...(m.get('import') || {}) };
  let device = m.get('device');
  if (!device) {
    device = { id: 'device', value: uuid() };
    await db.put('meta', device);
  }
  state.deviceId = device.value;
  await migrateCargo();
  await migrateQty();
  await migrateReceived();
  state.ready = true;
  notify();
}

// Один раз: карточки со снимка «59 × 1,00 ¥» → «1 × 59 ¥» (см. qtyFixList). В истории товара видно
// «Количество: 59 → 1» с пометкой «исправлено автоматически». Флаг в настройках — повторно не запускается.
async function migrateQty() {
  if (state.settings.qtyFixDone) return;
  const list = qtyFixList([...state.items.values()], state.events);
  for (const it of list) await commit('items', it.id, { qty: 1 }, 'qty-fix');
  await saveSettings({ qtyFixDone: new Date().toISOString(), qtyFixCount: list.length });
}

// Один раз: сканы, сделанные, когда скан ставил «На складе», переводятся в «Приехал» (см. receivedFixList).
async function migrateReceived() {
  if (state.settings.receivedFixDone) return;
  const list = receivedFixList([...state.items.values()], await db.getAll('scans'));
  for (const it of list) await commit('items', it.id, { status: ARRIVED }, 'scan');
  await saveSettings({ receivedFixDone: new Date().toISOString(), receivedFixCount: list.length });
}

// Старые данные: карго клиента → во все его закупки, где карго ещё нет (см. cargoMigration).
// Идёт и после восстановления старой копии (load вызывается заново).
async function migrateCargo() {
  const m = cargoMigration([...state.purchases.values()], [...state.clients.values()], [...state.items.values()]);
  for (const p of m.purchases) await commit('purchases', p.id, { cargoByClient: p.cargoByClient }, 'cargo-migrate');
  for (const c of m.clients) await commit('clients', c.id, { cargoId: c.cargoId, cargoIdBefore: c.cargoIdBefore }, 'cargo-migrate');
}

// Все изменения идут по очереди: быстрые нажатия подряд не затирают друг друга.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

// Изменение одной сущности без записи: новая версия и событие для журнала. null — изменений нет.
// Вызывать только внутри очереди (serial), со свежими данными.
function prepare(store, id, makePatch, action) {
  const before = id ? state[store].get(id) : null;
  if (id && !before) throw new Error('Запись не найдена');
  const patch = typeof makePatch === 'function' ? makePatch(before) : makePatch;
  if (!patch) return null;
  const at = nowIso();
  const after = {
    ...(before || { id: uuid(), createdAt: at, rev: 0 }),
    ...patch,
    updatedAt: at,
    rev: (before?.rev || 0) + 1,
    deviceId: state.deviceId,
  };
  const changes = diff(before, after, FIELDS[store]);
  if (before && Object.keys(changes).length === 0) return null;
  const event = { id: uuid(), at, deviceId: state.deviceId, entity: ENTITY[store], entityId: after.id, action, changes };
  return { store, after, event };
}
const toWrite = (c) => [[c.store, c.after], ['events', c.event]];
function apply(c) {
  state[c.store].set(c.after.id, c.after);
  state.events.push(c.event);
}

// Записать изменение одной сущности. makePatch(before) вызывается уже в очереди, со свежими данными;
// вернул null — изменений нет.
function commit(store, id, makePatch, action) {
  return serial(async () => {
    const c = prepare(store, id, makePatch, action);
    if (!c) return id ? state[store].get(id) : null;
    await db.putMany(toWrite(c));
    apply(c);
    notify();
    return c.after;
  });
}

export function saveSettings(patch) {
  return serial(async () => {
    state.settings = { ...state.settings, ...patch, id: 'settings' };
    await db.put('meta', state.settings);
    notify();
  });
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
export const updatePurchase = (id, patch, action = 'update') => commit('purchases', id, patch, action);

export async function archivePurchase(id, archived) {
  await commit('purchases', id, (p) => ({
    archived,
    endDate: archived ? p.endDate || todayLocal() : p.endDate,
    sessions: archived ? finishS(p, nowIso()) : p.sessions,
  }), archived ? 'archive' : 'unarchive');
  if (archived && state.settings.activePurchaseId === id) {
    const next = [...state.purchases.values()].find((x) => !x.archived && !x.deleted);
    await saveSettings({ activePurchaseId: next?.id || null });
  }
}

const withClient = (p, cid) => (p.clientIds.includes(cid) ? p.clientIds : [...p.clientIds, cid]);

export const addClientToPurchase = (pid, cid) =>
  commit('purchases', pid, (p) => (p.clientIds.includes(cid) ? null : { clientIds: [...p.clientIds, cid] }), 'add-client');

// Убрать клиента из закупки можно, только если у него там нет товаров.
export const removeClientFromPurchase = (pid, cid) =>
  commit('purchases', pid, (p) => {
    if ([...state.items.values()].some((x) => x.purchaseId === pid && x.clientId === cid && !x.deleted)) throw new Error('У клиента есть товары в закупке');
    return { clientIds: p.clientIds.filter((x) => x !== cid) };
  }, 'remove-client');

// Порядок оформления: «Оформляю клиента» и «Завершить заказы клиента».
export async function startOrdering(pid, cid) {
  // Забытое «Завершить» в другой закупке закрываем этим же моментом: одно время — один клиент.
  for (const other of state.purchases.values()) {
    if (other.id !== pid && (other.sessions || []).some((s) => !s.endedAt)) await finishOrdering(other.id);
  }
  return commit('purchases', pid, (p) => ({ clientIds: withClient(p, cid), sessions: startS(p, cid, nowIso(), uuid()) }), 'start-client');
}
export const finishOrdering = (pid) => commit('purchases', pid, (p) => ({ sessions: finishS(p, nowIso()) }), 'finish-client');

// ——— Опись: решения пользователя ———
const opisOf = (p) => ({ merges: [], rejected: [], edits: {}, ...(p.opis || {}) });
const opisChange = (pid, fn, action) => commit('purchases', pid, (p) => ({ opis: fn(opisOf(p)) }), action);

export const opisMerge = (pid, keyA, keyB) => opisChange(pid, (o) => ({ ...o, merges: [...o.merges, [keyA, keyB]] }), 'opis-merge');
export const opisReject = (pid, keyA, keyB) => opisChange(pid, (o) => ({ ...o, rejected: [...o.rejected, pairId(keyA, keyB)] }), 'opis-reject');
export const opisSplit = (pid, keys) => opisChange(pid, (o) => {
  const set = new Set(keys);
  return { ...o, merges: o.merges.filter(([a, b]) => !set.has(a) && !set.has(b)) };
}, 'opis-split');
// itemIds — состав строки в момент правки: правка количества и исключение действуют только для него.
export const opisEdit = (pid, keys, itemIds, patch) => opisChange(pid, (o) => {
  const edits = { ...o.edits };
  const merged = Object.assign({}, ...keys.map((k) => edits[k] || {}), patch, { itemIds: [...itemIds] });
  for (const k of keys) delete edits[k];
  edits[keys[0]] = merged;
  return { ...o, edits };
}, 'opis-edit');
export const opisReset = (pid) => opisChange(pid, () => ({ merges: [], rejected: [], edits: {} }), 'opis-reset');

// ——— Клиенты ———
export const createClient = ({ name, contact = '', note = '' }) =>
  commit('clients', null, { name: name.trim(), contact, note, deleted: false }, 'create');

export const updateClient = (id, patch) => commit('clients', id, patch);

// Карго: список ведёт пользователь (добавить, переименовать, удалить). Список — в настройках (и в резервной копии),
// карго клиента — в закупке, для каждой пары «закупка + клиент» своё (p.cargoByClient).
export const cargoList = () => state.settings.cargos || [];
export const cargoName = (id) => cargoList().find((c) => c.id === id)?.name || '';
export async function addCargo(name) {
  const c = { id: uuid(), name: name.trim() };
  await saveSettings({ cargos: [...cargoList(), c] });
  return c;
}
export const renameCargo = (id, name) => saveSettings({ cargos: cargoList().map((c) => (c.id === id ? { ...c, name: name.trim() } : c)) });
export const cargoOf = (pid, cid) => cargoIn(state.purchases.get(pid), cid);
export const setCargo = (pid, cid, cargoId) => commit('purchases', pid, (p) => {
  const map = { ...(p.cargoByClient || {}) };
  if (cargoId) map[cid] = cargoId;
  else delete map[cid];
  return { cargoByClient: map };
}, 'cargo');
// Удаление карго: клиенты с ним во всех закупках становятся «без карго», сами клиенты и товары остаются.
export async function deleteCargo(id) {
  for (const p of state.purchases.values()) {
    if (Object.values(p.cargoByClient || {}).includes(id)) {
      await commit('purchases', p.id, (x) => ({ cargoByClient: Object.fromEntries(Object.entries(x.cargoByClient || {}).filter(([, v]) => v !== id)) }), 'cargo');
    }
  }
  await saveSettings({ cargos: cargoList().filter((c) => c.id !== id) });
}

export function findClientByName(name) {
  const n = name.trim().toLowerCase();
  return [...state.clients.values()].find((c) => !c.deleted && c.name.trim().toLowerCase() === n) || null;
}

// ——— Товары ———
// Клиент товара всегда есть в списке клиентов закупки (и при создании, и при переносе).
async function ensureClientInPurchase(pid, cid) {
  const p = state.purchases.get(pid);
  if (p && cid && !p.clientIds.includes(cid)) await addClientToPurchase(pid, cid);
}

export async function saveItem(item) {
  const before = item.id ? state.items.get(item.id) : null;
  if (item.nameCn && item.name && state.importInfo.translations[item.nameCn] !== item.name) {
    await saveImportInfo({ translations: { ...state.importInfo.translations, [item.nameCn]: item.name } });
  }
  await ensureClientInPurchase(item.purchaseId, item.clientId);
  const action = !before ? 'create' : before.clientId !== item.clientId ? 'move' : 'update';
  return commit('items', item.id || null, (cur) => {
    const patch = { ...item };
    delete patch.id;
    if (!cur) {
      const same = [...state.items.values()].filter((x) => x.purchaseId === item.purchaseId);
      patch.seq = same.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
      patch.deleted = false;
    }
    return patch;
  }, action);
}
export const deleteItem = (id) => commit('items', id, { deleted: true }, 'delete');
export const restoreItem = (id) => commit('items', id, { deleted: false }, 'restore');
export async function moveItem(id, clientId) {
  await ensureClientInPurchase(state.items.get(id).purchaseId, clientId);
  return commit('items', id, { clientId }, 'move');
}

// ——— «Забрать» из «Команды» iPhone ———
export function saveImportInfo(patch) {
  return serial(async () => {
    state.importInfo = { ...state.importInfo, ...patch, id: 'import' };
    await db.put('meta', state.importInfo);
    notify();
  });
}

// plan — из buildPlan (pddimport.js), уже поправленный пользователем на экране сводки.
export async function applyImport(plan) {
  const done = [];
  let created = 0;
  for (const n of plan.newItems) {
    if (n.skip) continue;
    const day = n.time ? new Date(Date.parse(n.time) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : todayLocal();
    const photoId = n.photoBlob ? await savePhoto(n.photoBlob) : null;
    await saveItem({
      ...emptyItem(n.purchaseId, n.clientId), photoId,
      name: n.name || '', nameCn: n.nameCn, variant: n.variant, qty: n.qty, paidFen: n.paidFen, unitFen: null,
      pddOrderNo: n.pddOrderNo, track: n.track, carrier: n.carrier, status: n.status, orderDate: day,
      note: '', importBlockId: n.blockId,
    });
    created += 1;
    done.push(n.blockId, ...(n.extraBlocks || []).filter((b) => !(plan.pendingResolved || []).some((t) => t.blockId === b)));
  }
  // Трек, предложенный по названию (список заказов ↔ логистика): принят — снимок логистики забран,
  // не принят — трек ждёт дальше, как трек без карточки.
  const guessPending = [];
  for (const n of plan.newItems) {
    const g = n.trackGuess;
    if (!g || (plan.pendingResolved || []).some((t) => t.blockId === g.blockId)) continue;
    if (!n.skip && n.track === g.track) done.push(g.blockId);
    else guessPending.push(g);
  }
  for (const u of plan.updates) {
    const patch = { ...u.patch };
    if (u.photoBlob) patch.photoId = await savePhoto(u.photoBlob);
    if (Object.keys(patch).length) await commit('items', u.itemId, patch, 'import');
    done.push(u.blockId);
  }
  for (const t of plan.tracks) {
    if (t.skip) continue;
    if (Object.keys(t.patch).length) await commit('items', t.itemId, t.patch, 'import');
    done.push(t.blockId);
  }
  for (const t of plan.pending) done.push(t.blockId);
  // Трек, ждавший карточку, убираем из «ждут» только если его действительно записали (галочки не сняты).
  const applied = (t) => (t.via?.newKey ? plan.newItems.some((n) => n.key === t.via.newKey && !n.skip && (!t.via.guess || n.track === t.track))
    : plan.tracks.some((x) => x.blockId === t.via?.trackBlockId && !x.skip));
  const resolved = new Set((plan.pendingResolved || []).filter(applied).map((t) => t.blockId));
  const pending = [...state.importInfo.pending.filter((t) => !resolved.has(t.blockId)), ...plan.pending, ...guessPending];
  await saveImportInfo({ blockIds: [...new Set([...state.importInfo.blockIds, ...done])], pending, lastImportAt: nowIso() });
  return { created, tracks: plan.tracks.filter((t) => !t.skip && Object.keys(t.patch).length).length + plan.newItems.filter((n) => !n.skip && n.track).length };
}

export const dropPending = (blockId) => saveImportInfo({ pending: state.importInfo.pending.filter((t) => t.blockId !== blockId) });

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

// ——— Склад: сканер ———
// Индекс треков открытых закупок пересобирается только после изменений (по номеру версии данных).
let indexCache = { version: -1, index: new Map() };
function openIndex() {
  if (indexCache.version !== version) indexCache = { version, index: trackIndex([...state.items.values()], purchaseById) };
  return indexCache.index;
}
// Трек из открытых закупок для текста штрихкода или null (для фильтра кадров сканера).
export const lookupTrack = (code) => findTrack(code, openIndex());
// Насколько чужой код похож на треки списка: те же буквы в начале (+2), та же длина (+1).
export function shapeScore(code) {
  const norm = normalizeTrack(code);
  const prefix = (t) => t.match(/^[A-Z]*/)[0];
  const tracks = [...openIndex().keys()];
  return (tracks.some((t) => prefix(t) === prefix(norm)) ? 2 : 0) + (tracks.some((t) => t.length === norm.length) ? 1 : 0);
}

// Скан посылки в закупке pid: track — трек из открытых закупок (lookupTrack) или null, если кода нет нигде.
// Товары этой закупки с треком получают «Приехал», в журнал 'scans' пишется запись — всё одной транзакцией.
// Сканы идут в общей очереди: быстрая серия не теряет и не задваивает отметки.
export function scanCode(pid, code, track) {
  return serial(async () => {
    const p = state.purchases.get(pid);
    if (!p || p.archived || p.deleted) throw new Error('Закупка закрыта: сканировать нельзя');
    const out = scanOutcome(track, trackIndex([...state.items.values()], purchaseById), pid);
    const changes = out.fresh.map((it) => prepare('items', it.id, { status: ARRIVED }, 'scan')).filter(Boolean);
    const rec = {
      id: uuid(), at: nowIso(), deviceId: state.deviceId, purchaseId: pid, code: normalizeTrack(code), track: track || null,
      result: out.result, itemIds: out.items.map((it) => it.id), otherPids: out.otherPids,
    };
    await db.putMany([...changes.flatMap(toWrite), ['scans', rec]]);
    changes.forEach(apply);
    state.scans.get(pid)?.push(rec);
    notify();
    return { ...out, items: out.items.map((it) => state.items.get(it.id)), rec };
  });
}

// Ручная отметка: «приехал» ставит «Приехал», «не приехал» возвращает статус, который был до отметки.
export const setArrived = (id, on) => commit('items', id, (it) => {
  if (on) return isArrived(it) ? null : { status: ARRIVED };
  return isArrived(it) ? { status: statusBeforeArrival(it, state.events) } : null;
}, on ? 'arrived' : 'unarrived');

// Журнал сканирований закупки — из базы, один раз за запуск.
export function loadScans(pid) {
  return serial(async () => {
    if (state.scans.has(pid)) return;
    const list = await db.scansOf(pid);
    state.scans.set(pid, list.sort((a, b) => a.at.localeCompare(b.at)));
    notify();
  });
}
export const scansOf = (pid) => state.scans.get(pid) || null;

// «Убрать» код из «Нет в списке»: записи журнала остаются, только помечаются.
export function dismissMissing(pid, code) {
  return serial(async () => {
    const list = state.scans.get(pid) || [];
    const marked = list.filter((r) => r.code === code && !r.dismissed).map((r) => ({ ...r, dismissed: true }));
    if (!marked.length) return;
    await db.putMany(marked.map((r) => ['scans', r]));
    state.scans.set(pid, list.map((r) => marked.find((m) => m.id === r.id) || r));
    notify();
  });
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
    scans: await db.getAll('scans'),
    cargos: cargoList(),
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
  // Страховка: текущие данные кладём рядом, их можно вернуть кнопкой «Вернуть данные до восстановления».
  const current = await makeBackup();
  const meta = [
    { id: 'device', value: state.deviceId },
    { ...state.settings, cargos: json.data.cargos || state.settings.cargos || [], lastBackupAt: json.exportedAt },
    { id: 'beforeRestore', at: nowIso(), json: JSON.stringify(current), counts: { purchases: current.data.purchases.length, items: current.data.items.length } },
  ];
  await serial(() => db.replaceAll({ ...json.data, photos, meta }));
  await load();
}

export const getBeforeRestore = () => db.get('meta', 'beforeRestore');
export async function undoRestore() {
  const saved = await getBeforeRestore();
  if (!saved) throw new Error('Нет сохранённых данных');
  await restoreBackup(JSON.parse(saved.json));
}
