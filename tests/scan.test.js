import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackIndex, lookupTrack, scanOutcome, arrivalLists, arrivalTimes, statusBeforeArrival, missingCodes, receivedFixList } from '../site/src/arrivals.js';
import { ScanFilter } from '../site/src/scan/scanfilter.js';
import { looksLikeTrack } from '../site/src/parcels.js';

// Только выдуманные данные. Две открытые закупки и одна закрытая.
const P = {
  nov: { id: 'nov', name: 'Закупка ноябрь', archived: false },
  dec: { id: 'dec', name: 'Закупка декабрь', archived: false },
  old: { id: 'old', name: 'Закупка октябрь', archived: true },
};
const it = (id, purchaseId, track, status = 4, extra = {}) => ({ id, purchaseId, clientId: 'c', name: id, track, status, ...extra });
const items = [
  it('шарф', 'nov', 'YT0000000000001'),
  it('пижама-1', 'nov', 'JT0000000000002'), // один трек — три товара одной посылки
  it('пижама-2', 'nov', 'JT0000000000002'),
  it('носки', 'nov', 'JT0000000000002'),
  it('кружка', 'nov', '777400000000004', 7), // уже отсканирована
  it('плед', 'nov', 'SF0000000000010', 6), // на складе по списку склада, но ещё не отсканирован
  it('без трека', 'nov', ''),
  it('удалён', 'nov', 'YT0000000000099', 4, { deleted: true }),
  it('варежки', 'dec', 'SF0000000000005'),
  it('архивный', 'old', 'YT0000000000006'),
];
const index = trackIndex(items, (id) => P[id]);

test('один трек — все товары посылки отмечаются разом', () => {
  const r = scanOutcome('JT0000000000002', index, 'nov');
  assert.equal(r.result, 'found');
  assert.deepEqual(r.fresh.map((x) => x.id), ['пижама-1', 'пижама-2', 'носки']);
});

test('повтор: все товары трека уже отсканированы — жёлтый, ничего не меняется', () => {
  const r = scanOutcome('777400000000004', index, 'nov');
  assert.equal(r.result, 'repeat');
  assert.deepEqual(r.fresh, []);
});

test('код из другой открытой закупки — «не из этой закупки», в ней ничего не отмечается', () => {
  const r = scanOutcome('SF0000000000005', index, 'nov');
  assert.equal(r.result, 'other');
  assert.deepEqual(r.otherPids, ['dec']);
  assert.deepEqual(r.fresh, []);
  // в своей закупке тот же код — зелёный
  assert.equal(scanOutcome('SF0000000000005', index, 'dec').result, 'found');
});

test('закрытая закупка и удалённые товары в сверке не участвуют — «нет в списке»', () => {
  assert.equal(lookupTrack('YT0000000000006', index), null);
  assert.equal(lookupTrack('YT0000000000099', index), null);
  assert.equal(scanOutcome(null, index, 'nov').result, 'unknown');
});

test('штрихкод с добавками и кириллица в треке находят трек', () => {
  assert.equal(lookupTrack('*JT0000000000002*01', index), 'JT0000000000002');
  assert.equal(lookupTrack('ҮТ0000000000001'.replace('Ү', 'У'), index), 'YT0000000000001');
});

test('«На складе» и «Приехал» — разные шаги: товар со склада сканер отмечает как приехавший', () => {
  const r = scanOutcome('SF0000000000010', index, 'nov');
  assert.equal(r.result, 'found');
  assert.deepEqual(r.fresh.map((x) => x.id), ['плед']);
});

test('списки закупки: приехали, не отсканированы, без трека; «X из Y» по живым карточкам', () => {
  const l = arrivalLists(items.filter((x) => x.purchaseId === 'nov'));
  assert.equal(`${l.done} из ${l.total}`, '1 из 7');
  assert.deepEqual(l.arrived.map((x) => x.id), ['кружка']);
  assert.deepEqual(l.waiting.map((x) => x.id), ['шарф', 'пижама-1', 'пижама-2', 'носки', 'плед']);
  assert.deepEqual(l.noTrack.map((x) => x.id), ['без трека']);
});

test('ручное «не приехал» возвращает статус, который был до отметки', () => {
  const events = [
    { entity: 'item', entityId: 'шарф', at: '2026-11-20T09:00:00Z', changes: { status: [4, 5] } },
    { entity: 'item', entityId: 'шарф', at: '2026-11-20T09:30:00Z', changes: { status: [5, 6] } },
    { entity: 'item', entityId: 'шарф', at: '2026-11-20T10:00:00Z', changes: { status: [6, 7] } },
  ];
  assert.equal(statusBeforeArrival({ id: 'шарф', status: 7, track: 'x' }, events), 6); // назад в «На складе»
  assert.equal(statusBeforeArrival({ id: 'новый', status: 7, track: 'x' }, events), 4);
  assert.equal(statusBeforeArrival({ id: 'новый', status: 7, track: '' }, events), 1);
  assert.equal(arrivalTimes(events).get('шарф'), '2026-11-20T10:00:00Z');
});

test('«Нет в списке»: по коду, сколько раз, откуда; убранные не показываются', () => {
  const s = (code, result, at, extra = {}) => ({ code, result, at, otherPids: [], ...extra });
  const list = missingCodes([
    s('YT0000000000001', 'found', '1'),
    s('ZZ1234567890', 'unknown', '2'),
    s('ZZ1234567890', 'unknown', '4'),
    s('SF0000000000005', 'other', '3', { otherPids: ['dec'] }),
    s('AA1234567890', 'unknown', '5', { dismissed: true }),
  ]);
  assert.deepEqual(list.map((x) => [x.code, x.count, x.result]), [['ZZ1234567890', 2, 'unknown'], ['SF0000000000005', 1, 'other']]);
  assert.deepEqual(list[1].otherPids, ['dec']);
});

test('фильтр кадров: код в кадре срабатывает один раз, чужой код — красный после задержки', () => {
  const f = new ScanFilter({ holdMs: 1500, unknownDelayMs: 700 });
  const look = (c) => lookupTrack(c, index);
  assert.deepEqual(f.feed(['JT0000000000002'], 0, look).map((e) => e.type), ['match']);
  assert.deepEqual(f.feed(['JT0000000000002'], 100, look), []);
  assert.deepEqual(f.feed(['QQ0000000000777'], 200, look), []);
  assert.deepEqual(f.feed(['QQ0000000000777'], 950, look).map((e) => e.type), ['unknown']);
});

test('правило «похоже на трек» одно на «Скопировать список» и сканер', () => {
  assert.equal(looksLikeTrack('JT0000000000002'), true);
  assert.equal(looksLikeTrack('ШАРФ'), false);
});

test('переход на два шага: уже отсканированные товары со статусом «На складе» становятся «Приехал»', () => {
  const list = [
    { id: 'a', status: 6 }, // сканировали (повтор) — станет «Приехал»
    { id: 'b', status: 6 }, // только по списку склада — остаётся
    { id: 'c', status: 7 }, // уже «Приехал»
    { id: 'd', status: 6, deleted: true },
  ];
  const scans = [
    { result: 'repeat', itemIds: ['a', 'c'] },
    { result: 'other', itemIds: ['b'] }, // скан из чужой закупки не считается
    { result: 'found', itemIds: ['d'] },
  ];
  assert.deepEqual(receivedFixList(list, scans).map((x) => x.id), ['a']);
});
