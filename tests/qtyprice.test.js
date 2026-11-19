import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAny } from '../site/src/pddimport.js';
import { guardQty } from '../site/src/ocr.js';
import { qtyMixedWithPrice } from '../site/src/model.js';
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

test('уже сохранённые «59 × 1,00 ¥» находятся для подсказки, нормальные — нет', () => {
  assert.equal(qtyMixedWithPrice({ qty: 59, paidFen: 5900, unitFen: null }), true);
  assert.equal(qtyMixedWithPrice({ qty: 65, paidFen: 6500, unitFen: null }), true);
  assert.equal(qtyMixedWithPrice({ qty: 1, paidFen: 5135, unitFen: null }), false);
  assert.equal(qtyMixedWithPrice({ qty: 3, paidFen: 4200, unitFen: null }), false);
  assert.equal(qtyMixedWithPrice({ qty: 59, paidFen: 5900, unitFen: null, deleted: true }), false);
  assert.equal(qtyMixedWithPrice({ qty: 2, paidFen: null, unitFen: 100 }), false); // цену ввели руками
});
