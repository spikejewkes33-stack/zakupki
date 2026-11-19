import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoMigration, cargoPairs, cargoIn, cargoTotals, totals } from '../site/src/model.js';
import { parcelsText, cargoText } from '../site/src/parcels.js';
import { parseNote } from './fixtures/posylki-parse.js';

// Только выдуманные данные. Айтэн в ноябрьской закупке едет «Карго 1», в декабрьской — «Карго 2».
const cargos = [{ id: 'g1', name: 'Карго 1' }, { id: 'g2', name: 'Карго 2' }];
const nov = { id: 'p1', name: 'Закупка ноябрь', rateMicro: 450000, clientIds: ['a', 'k'], cargoByClient: { a: 'g1', k: 'g1' } };
const dec = { id: 'p2', name: 'Закупка декабрь', rateMicro: 450000, clientIds: ['a', 'i'], cargoByClient: { a: 'g2', i: 'g2' } };
const byId = { p1: nov, p2: dec };
const names = { a: 'Айтэн', k: 'Катя', i: 'Илона' };
const it = (id, purchaseId, clientId, name, track, at) => ({ id, purchaseId, clientId, name, track, qty: 1, paidFen: 1000, status: 4, createdAt: at });
const items = [
  it('1', 'p1', 'a', 'Шарф', 'YT0000000000001', '2026-11-10T10:00:00Z'),
  it('2', 'p1', 'k', 'Пижама', 'JT0000000000002', '2026-11-10T11:00:00Z'),
  it('3', 'p2', 'a', 'Варежки', 'YT0000000000003', '2026-12-01T10:00:00Z'),
  it('4', 'p2', 'a', 'Кружка', '777400000000004', '2026-12-01T11:00:00Z'),
  it('5', 'p2', 'i', 'Кроссовки', 'SF0000000000005', '2026-12-02T10:00:00Z'),
];
const ctx = { purchaseById: (id) => byId[id], clientName: (id) => names[id], clientOrder: (p) => p.clientIds };

test('карго у пары «закупка + клиент»: Айтэн в обоих карго, в каждом только товары своей закупки', () => {
  const pairs = cargoPairs([nov, dec], items, cargos);
  const view = (g) => pairs.filter((x) => x.cargoId === g).map((x) => `${names[x.clientId]}/${x.purchaseId}: ${x.items.map((y) => y.name).join(', ')}`);
  assert.deepEqual(view('g1'), ['Айтэн/p1: Шарф', 'Катя/p1: Пижама']);
  assert.deepEqual(view('g2'), ['Айтэн/p2: Варежки, Кружка', 'Илона/p2: Кроссовки']);
});

test('копирование карго: в «Карго 2» только декабрьские товары Айтэн, нумерация с 1, «Посылки» читают', () => {
  const pairs = cargoPairs([nov, dec], items, cargos);
  const two = cargoText(pairs.filter((x) => x.cargoId === 'g2'), ctx);
  assert.equal(two.text, 'Закуп Закупка декабрь\nАйтэн\n1. Варежки YT0000000000003\n2. Кружка 777400000000004\nИлона\n3. Кроссовки SF0000000000005\n');
  assert.deepEqual(parseNote(two.text).skipped, []);
  const one = cargoText(pairs.filter((x) => x.cargoId === 'g1'), ctx);
  assert.equal(one.text, 'Закуп Закупка ноябрь\nАйтэн\n1. Шарф YT0000000000001\nКатя\n2. Пижама JT0000000000002\n');
});

test('«Скопировать список» закупки: только её товары, товары другой закупки не попадают', () => {
  const list = (p) => parcelsText(p.name, items.filter((x) => x.purchaseId === p.id), { clientName: ctx.clientName, clientOrder: p.clientIds }).text;
  assert.equal(list(nov), 'Закуп Закупка ноябрь\nАйтэн\n1. Шарф YT0000000000001\nКатя\n2. Пижама JT0000000000002\n');
  assert.equal(list(dec), 'Закуп Закупка декабрь\nАйтэн\n1. Варежки YT0000000000003\n2. Кружка 777400000000004\nИлона\n3. Кроссовки SF0000000000005\n');
});

test('главная: карточки карго закупки считаются по карго в этой закупке и сходятся с плитками', () => {
  const its = items.filter((x) => x.purchaseId === 'p2');
  const r = cargoTotals(its, { cargos, cargoOf: (cid) => cargoIn(dec, cid), purchaseById: (id) => byId[id] });
  assert.deepEqual(r.groups.map((g) => [g.cargo?.name, g.t.qty]), [['Карго 1', 0], ['Карго 2', 3]]);
  assert.equal(r.groups.reduce((s, g) => s + g.t.kop, 0), totals(its, (id) => byId[id]).kop);
});

test('старые данные: карго клиента проставляется во все его закупки, где карго ещё нет; ничего не теряется', () => {
  const purchases = [
    { id: 'p1', clientIds: ['a'], cargoByClient: {} },
    { id: 'p2', clientIds: [], cargoByClient: { a: 'g2' } }, // уже выставлено — не трогаем
    { id: 'p3', clientIds: [] }, // клиента нет в списке, но есть его товар
    { id: 'p4', clientIds: ['b'] }, // чужая закупка
  ];
  const clients = [{ id: 'a', cargoId: 'g1' }, { id: 'b', cargoId: '' }];
  const its = [{ id: 'x', purchaseId: 'p3', clientId: 'a' }];
  const m = cargoMigration(purchases, clients, its);
  assert.deepEqual(m.purchases, [{ id: 'p1', cargoByClient: { a: 'g1' } }, { id: 'p3', cargoByClient: { a: 'g1' } }]);
  assert.deepEqual(m.clients, [{ id: 'a', cargoId: '', cargoIdBefore: 'g1' }]);
  // второй прогон после переноса ничего не меняет
  const after = purchases.map((p) => ({ ...p, ...(m.purchases.find((x) => x.id === p.id) || {}) }));
  const again = cargoMigration(after, [{ id: 'a', cargoId: '', cargoIdBefore: 'g1' }, clients[1]], its);
  assert.deepEqual(again, { purchases: [], clients: [] });
});
