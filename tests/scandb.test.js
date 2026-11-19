// База на «телефоне» (fake-indexeddb): переход со старой версии базы и быстрая серия сканов.
// Каждый файл тестов node запускает отдельно, база в памяти — своя у этого файла. Данные выдуманные.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from '../site/vendor/idb.js';

const OLD_STORES = ['purchases', 'clients', 'items', 'events', 'docs', 'photos', 'meta'];
const at = '2026-11-10T10:00:00.000Z';
const rec = (x) => ({ createdAt: at, updatedAt: at, rev: 1, deviceId: 'old', ...x });

// База версии 1 — как у пользователя до сканера: открытая «Ноябрь» с товарами и «Декабрь».
async function makeOldBase() {
  const d = await openDB('pdd-zakupki', 1, { upgrade(x) { for (const s of OLD_STORES) x.createObjectStore(s, { keyPath: 'id' }); } });
  const purchase = (id, name) => rec({ id, name, startDate: '2026-11-10', endDate: null, rateMicro: 450000, archived: false, clientIds: ['k', 'i'], sessions: [], deleted: false });
  const item = (id, purchaseId, clientId, track, seq) => rec({ id, purchaseId, clientId, name: id, track, status: 5, qty: 1, paidFen: 1000, seq, deleted: false });
  const tx = d.transaction(OLD_STORES, 'readwrite');
  tx.objectStore('purchases').put(purchase('nov', 'Закупка ноябрь'));
  tx.objectStore('purchases').put(purchase('dec', 'Закупка декабрь'));
  tx.objectStore('clients').put(rec({ id: 'k', name: 'Катя', deleted: false }));
  tx.objectStore('clients').put(rec({ id: 'i', name: 'Илона', deleted: false }));
  const novItems = [
    ['пижама', 'k', 'JT0000000000002'], ['носки', 'k', 'JT0000000000002'], ['шарф', 'i', 'JT0000000000002'],
    ['кружка', 'k', 'YT0000000000001'], ['варежки', 'i', 'SF0000000000003'], ['плед', 'i', '777400000000004'],
  ];
  novItems.forEach(([id, c, t], n) => tx.objectStore('items').put(item(id, 'nov', c, t, n + 1)));
  tx.objectStore('items').put(item('кроссовки', 'dec', 'k', 'YT0000000000009', 1));
  tx.objectStore('events').put({ id: 'e1', at, deviceId: 'old', entity: 'item', entityId: 'пижама', action: 'update', changes: { status: [4, 5] } });
  tx.objectStore('meta').put({ id: 'device', value: 'old' });
  tx.objectStore('meta').put({ id: 'settings', activePurchaseId: 'nov', lastBackupAt: null, qtyFixDone: at });
  await tx.done;
  d.close();
}

await makeOldBase();
const S = await import('../site/src/store.js');
const db = await import('../site/src/db.js');
const { arrivalLists } = await import('../site/src/arrivals.js');

test('переход базы с версии 1 на 2: старые данные целы, появился журнал сканов', async () => {
  await S.load();
  const d = await db.db();
  assert.equal(d.version, 2);
  assert.ok(d.objectStoreNames.contains('scans'));
  assert.deepEqual([...d.transaction('scans').store.indexNames], ['purchaseId']);
  assert.equal(S.state.purchases.size, 2);
  assert.equal(S.state.items.size, 7);
  assert.equal(S.state.events.filter((e) => e.id === 'e1').length, 1);
  assert.equal(S.state.items.get('пижама').status, 5);
  assert.equal(S.activePurchase().name, 'Закупка ноябрь');
});

test('быстрая серия сканов: каждая отметка записана один раз, ничего не потеряно', async () => {
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push('JT0000000000002'); // три товара под одним треком
  for (let i = 0; i < 8; i++) codes.push('YT0000000000001');
  for (let i = 0; i < 5; i++) codes.push('YT0000000000009'); // из закупки «Декабрь»
  for (let i = 0; i < 5; i++) codes.push('QQ0000000000777'); // нет нигде
  codes.push('SF0000000000003');
  // Всё сразу, не дожидаясь записи, и посреди серии — ручная правка товара той же закупки.
  const runs = codes.map((c) => S.scanCode('nov', c, S.lookupTrack(c)));
  const edit = S.saveItem({ ...S.state.items.get('плед'), note: 'коробка мятая' });
  const results = await Promise.all(runs);
  await edit;

  const count = (r) => results.filter((x) => x.result === r).length;
  assert.deepEqual([count('found'), count('repeat'), count('other'), count('unknown')], [3, 18, 5, 5]);
  assert.equal(results[0].result, 'found');
  assert.equal(results[0].items.length, 3);

  // В памяти и в базе одно и то же; у каждого товара ровно одно событие «отсканирован».
  const stored = new Map((await db.getAll('items')).map((x) => [x.id, x]));
  for (const id of ['пижама', 'носки', 'шарф', 'кружка', 'варежки']) {
    assert.equal(stored.get(id).status, 6, id);
    assert.equal(S.state.items.get(id).status, 6, id);
    const ev = (await db.getAll('events')).filter((e) => e.entityId === id && e.action === 'scan');
    assert.equal(ev.length, 1, id);
  }
  assert.equal(stored.get('плед').note, 'коробка мятая'); // правка посреди серии записана
  assert.equal(stored.get('плед').status, 5); // не сканировали
  assert.equal(stored.get('кроссовки').status, 5); // чужая закупка не отмечается
  const scans = await db.scansOf('nov');
  assert.equal(scans.length, codes.length);
  assert.equal(new Set(scans.map((x) => x.id)).size, codes.length);

  const l = arrivalLists(S.itemsOf('nov'));
  assert.equal(`${l.done} из ${l.total}`, '5 из 6');
});

test('«Нет в списке» и ручная отмена: журнал читается из базы, статус возвращается', async () => {
  await S.loadScans('nov');
  const { missingCodes } = await import('../site/src/arrivals.js');
  const miss = missingCodes(S.scansOf('nov'));
  assert.deepEqual(miss.map((x) => [x.code, x.count, x.result]).sort(), [['QQ0000000000777', 5, 'unknown'], ['YT0000000000009', 5, 'other']]);
  assert.deepEqual(miss.find((x) => x.result === 'other').otherPids, ['dec']);
  await S.dismissMissing('nov', 'QQ0000000000777');
  assert.deepEqual(missingCodes(S.scansOf('nov')).map((x) => x.code), ['YT0000000000009']);

  await S.setArrived('кружка', false);
  assert.equal(S.state.items.get('кружка').status, 5);
  await S.setArrived('кружка', true);
  assert.equal(S.state.items.get('кружка').status, 6);
});

test('закрытую закупку сканировать нельзя', async () => {
  await S.archivePurchase('dec', true);
  await assert.rejects(S.scanCode('dec', 'YT0000000000009', 'YT0000000000009'), /закрыта/);
  // и её треки больше не «другая закупка», а «нет в списке»
  assert.equal(S.lookupTrack('YT0000000000009'), null);
});
