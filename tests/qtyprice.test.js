import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAny } from '../site/src/pddimport.js';
import { guardQty } from '../site/src/ocr.js';
import { qtyMixedWithPrice, qtyFixList } from '../site/src/model.js';
import { itemMoney } from '../site/src/money.js';

// Ошибка 20.11: «Сапоги мужские 59 × 1,00 ¥» вместо «1 × 59 ¥». Цена без копеек «¥59» в Live Text
// прочиталась как «X59» — строка похожа на количество «×N». Данные выдуманные, вид строк — как у PDD.
const head = ['2026-11-17T16:05:10+03:00', '已签收', '李 138****0000', '号码保护中', '某某路某某工业区…', '展开', '某某鞋业', '潜力好店', '男士加绒保暖雪地靴高帮棉鞋'];
const table = ['黑色 42码', '7天无理由退货', '分享商品', '联系商家', '申请退款', '实付：¥59（免运费）', '已购规格', '黑色 42码', '该规格拼单价', '¥59'];
const tail = ['订单号：261111-800000000000008 | 复制', '物流公司：中通快递', '快递单号：79150000000001 | 复制'];
const order = (priceAndQty, bought = ['已购数量', '1']) => [...head, ...priceAndQty, ...table, ...bought, ...tail];

for (const [name, lines] of [
  ['«X59», потом «×1»', ['X59', '×1']],
  ['«×1», потом «X59»', ['×1', 'X59']],
  ['только «X59» («×1» не распознан)', ['X59']],
  ['«x59» строчной', ['x59']],
  ['«×59» (¥ прочитан как ×)', ['×1', '×59']],
]) {
  test(`цена «¥59», прочитанная как количество: ${name} → 1 шт. за 59 ¥`, () => {
    const r = classifyAny(order(lines));
    assert.equal(r.kind, 'order');
    assert.equal(r.qty, 1);
    assert.equal(r.paidFen, 5900);
    assert.equal(r.priceFen, 5900);
    assert.equal(itemMoney({ qty: r.qty, paidFen: r.paidFen }).unitFen, 5900);
  });
}

test('без «已购数量» и без «×1»: «X59» при сумме 59 ¥ — тоже не количество', () => {
  const r = classifyAny(order(['X59'], []));
  assert.equal(r.qty, 1);
});

test('настоящее количество не трогается: «×2», 已购数量 2, сумма 59 ¥', () => {
  const r = classifyAny(order(['¥29.5', '×2'], ['已购数量', '2']));
  assert.equal(r.qty, 2);
  assert.equal(r.paidFen, 5900);
});

test('«已购数量» — поле количества — главнее «×N»; расхождение помечается', () => {
  const r = classifyAny(order(['¥59', '×3'], ['已购数量', '1']));
  assert.equal(r.qty, 1);
  assert.ok(r.doubts.some((d) => /×3.*已购数量 1/.test(d)));
});

test('страховка для любого магазина: количество, равное сумме в юанях, — 1 шт. и просьба проверить', () => {
  const r = guardQty({ kind: 'order', qty: 65, paidFen: 6500, priceFen: null, doubts: [] });
  assert.equal(r.qty, 1);
  assert.equal(r.priceFen, 6500);
  assert.match(r.doubts[0], /проверьте количество/);
  assert.equal(guardQty({ qty: 3, paidFen: 6500, doubts: [] }).qty, 3);
});

test('миграция: чинятся только карточки со снимка «N × 1,00 ¥», которые никто не правил руками', () => {
  const imp = (id, qty, paidFen, extra = {}) => ({ id, qty, paidFen, unitFen: null, importBlockId: `b${id}`, ...extra });
  const items = [
    imp('boots', 59, 5900), // сапоги — чинится
    imp('jacket', 65, 6500), // куртка — чинится
    imp('ok', 1, 5135), // нормальная
    imp('three', 3, 4200), // настоящие 3 шт.
    imp('gone', 59, 5900, { deleted: true }), // удалена
    imp('hand', 50, 5000), // наклейки: количество поставили руками в карточке — не трогаем
    { id: 'manual', qty: 40, paidFen: 4000, unitFen: null }, // «+ Товар» — не со снимка
    imp('unit', 2, null, { unitFen: 100 }), // цену за штуку ввели руками
  ];
  const events = [
    { entity: 'item', entityId: 'boots', action: 'import', changes: { qty: [null, 59] } },
    { entity: 'item', entityId: 'hand', action: 'update', changes: { qty: [1, 50] } },
  ];
  assert.deepEqual(qtyFixList(items, events).map((x) => x.id), ['boots', 'jacket']);
  // после починки (qty 1) ничего больше не находится — повторный прогон ничего не меняет
  const fixed = items.map((x) => (['boots', 'jacket'].includes(x.id) ? { ...x, qty: 1 } : x));
  assert.deepEqual(qtyFixList(fixed, events), []);
  // итог: 1 × 59 ¥, сумма та же
  assert.equal(itemMoney({ qty: 1, paidFen: 5900 }).unitFen, 5900);
  assert.equal(qtyMixedWithPrice(items[0]), true);
});
