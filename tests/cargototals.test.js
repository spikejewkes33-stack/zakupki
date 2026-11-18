import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoTotals, totals } from '../site/src/model.js';

// Только выдуманные данные. Курс 0,4321 BYN за 1 ¥ — чтобы копейки округлялись у каждого товара.
const purchase = { id: 'p1', rateMicro: 432100 };
const purchaseById = () => purchase;
const cargos = [{ id: 'g1', name: 'Карго 1' }, { id: 'g2', name: 'Карго 2' }];
const cargoOfClient = { a: 'g1', b: 'g1', c: 'g2', d: '', e: 'gone' }; // d — без карго, e — карго удалено
const it = (id, clientId, extra) => ({ id, clientId, purchaseId: 'p1', qty: 1, status: 1, ...extra });
const items = [
  it('1', 'a', { paidFen: 12345, qty: 2, status: 4 }),
  it('2', 'a', { unitFen: 999, qty: 3, status: 2 }),
  it('3', 'b', { paidFen: 4700, status: 3 }),
  it('4', 'b', { status: 5 }), // без цены
  it('5', 'c', { paidFen: 61200, qty: 1, status: 6 }),
  it('6', 'c', { unitFen: 333, qty: 4, status: 1 }),
  it('7', 'd', { paidFen: 1001, qty: 2, status: 3 }),
  it('8', 'e', { unitFen: 777, status: 1 }),
  it('9', 'c', { paidFen: 50000, status: 4, deleted: true }),
];
const r = cargoTotals(items, { cargos, cargoOf: (id) => cargoOfClient[id], purchaseById });
const sum = (k) => r.groups.reduce((s, g) => s + g.t[k], 0);

test('карго на главной: две карго и «Без карго», в «Без карго» и клиент с удалённым карго', () => {
  assert.deepEqual(r.groups.map((g) => g.cargo?.name ?? 'Без карго'), ['Карго 1', 'Карго 2', 'Без карго']);
  const [g1, g2, none] = r.groups.map((g) => g.t);
  assert.deepEqual([g1.qty, g1.shippedQty, g1.fen, g1.noPrice], [7, 4, 12345 + 2997 + 4700, 1]);
  assert.deepEqual([g2.qty, g2.shippedQty, g2.fen], [5, 1, 61200 + 1332]);
  assert.deepEqual([none.qty, none.shippedQty, none.fen], [3, 2, 1001 + 777]);
});

test('карго на главной: сумма карточек = «Итого» = плитки активной закупки (¥, BYN, штуки, отправлено)', () => {
  const tiles = totals(items, purchaseById); // так считает PurchaseStats
  for (const k of ['qty', 'shippedQty', 'fen', 'kop', 'count', 'shipped', 'noPrice']) {
    assert.equal(sum(k), tiles[k], k);
    assert.equal(r.all[k], tiles[k], k);
  }
  // «отправлено» в штуках — те же статусы, что у плитки «отправлено» (с 3-го), но с количеством
  assert.equal(tiles.shipped, 5);
  assert.equal(tiles.shippedQty, 7);
});

test('карго на главной: «Без карго» нет, если у всех клиентов есть карго', () => {
  const only = cargoTotals(items.filter((x) => ['a', 'c'].includes(x.clientId)), { cargos, cargoOf: (id) => cargoOfClient[id], purchaseById });
  assert.deepEqual(only.groups.map((g) => g.cargo?.id ?? null), ['g1', 'g2']);
});
