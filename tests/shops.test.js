import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { detectShop } from '../site/src/shops.js';
import { classifyAny, buildPlan, splitBlocks, BLOCK_MARK } from '../site/src/pddimport.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const OTHER = /^(?:taobao|poizon|1688)-/;
const empty = (purchases = new Map(), activePurchaseId = null) => ({ items: [], purchases, activePurchaseId, importedIds: new Set(), pending: [] });

test('все снимки PDD из образцов по-прежнему узнаются как PDD', () => {
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url)).filter((n) => n.endsWith('.txt') && !OTHER.test(n))) {
    assert.equal(detectShop(lines(fx(f))), 'pdd', f);
  }
});

test('образцы Taobao и Poizon узнаются', () => {
  assert.equal(detectShop(lines(fx('taobao-zakaz.txt'))), 'taobao');
  assert.equal(detectShop(lines(fx('taobao-logistika.txt'))), 'taobao');
  assert.equal(detectShop(lines(fx('poizon-zakaz.txt'))), 'poizon');
  assert.equal(detectShop(lines(fx('poizon-zakaz-stolbcy.txt'))), 'poizon');
  // список заказов на русском и логистика куртки — 1688 (пользователь, 18.11); логистика у Taobao и 1688 одна — подпись taobao
  assert.equal(detectShop(lines(fx('taobao-spisok-ru.txt'))), '1688');
  assert.equal(detectShop(lines(fx('taobao-logistika-lenta.txt'))), 'taobao');
  // без названия приложения: Poizon по «交易编号» + «快递单号», Taobao по «支付宝交易号»
  assert.equal(detectShop(['交易编号', '570000000000000000000000001', '快递单号', 'SF1000000000001']), 'poizon');
  assert.equal(detectShop(['支付宝交易号', '2026110600000000000000000001']), 'taobao');
});

test('номер заказа PDD главнее слов «天猫» или «1688» в ленте рекомендаций', () => {
  assert.equal(detectShop(['订单编号：261115-500000000000005', '天猫同款 保温杯']), 'pdd');
  assert.equal(detectShop(['订单编号：261115-500000000000005', '1688源头工厂']), 'pdd');
});

test('другие приложения узнаются по названию', () => {
  assert.equal(detectShop(['得物', '订单详情']), 'poizon');
  assert.equal(detectShop(['淘宝', '订单详情']), 'taobao');
  assert.equal(detectShop(['阿里巴巴', '采购单']), '1688');
  assert.equal(detectShop(['1688']), '1688');
  assert.equal(detectShop(['￥1688.00']), 'pdd');
  assert.equal(detectShop(['订单号 2516880000000001']), 'pdd');
});

test('Taobao, экран заказа: название, вариант, x1, 实付价 (не 商品总价), номер из «订单信息», доставка отдельно', () => {
  const r = classifyAny(lines(fx('taobao-zakaz.txt')));
  assert.equal(r.kind, 'order');
  assert.equal(r.app, 'taobao');
  assert.equal(r.shop, 'Happy Shopping Shack');
  assert.equal(r.nameCn, 'Sleeveless Striped Beach Dr');
  assert.equal(r.variant, '粉色;M');
  assert.equal(r.qty, 1);
  assert.equal(r.paidFen, 4700);
  assert.equal(r.priceFen, 5500);
  assert.equal(r.orderNo, '3300000000000000002'); // не 支付宝交易号
  assert.equal(r.track, '');
  assert.ok(r.doubts.some((d) => /доставка по Китаю 12/.test(d)));
});

test('Taobao, экран логистики: трек без двоеточия, номер заказа, не телефон курьера', () => {
  const r = classifyAny(lines(fx('taobao-logistika.txt')));
  assert.equal(r.kind, 'logistics');
  assert.equal(r.track, '432100000000001');
  assert.equal(r.carrier, '韵达快递 (Yunda)');
  assert.equal(r.orderNo, '3300000000000000001');
  assert.equal(r.status, 6);
});

for (const f of ['poizon-zakaz.txt', 'poizon-zakaz-stolbcy.txt']) {
  test(`Poizon (${f}): товар, сумма, трек СФ, номер заказа; не 交易编号, не продавец, не лента «你可能还喜欢»`, () => {
    const r = classifyAny(lines(fx(f)));
    assert.equal(r.kind, 'order');
    assert.equal(r.app, 'poizon');
    assert.equal(r.nameCn, 'Nike ZOOM VOMERO ROAM 经典舒适 迈柔透气 休');
    assert.equal(r.variant, '青灰色 44');
    assert.equal(r.qty, 1);
    assert.equal(r.paidFen, 61200);
    assert.equal(r.track, 'SF1000000000001');
    assert.equal(r.carrier, '顺丰速运 (SF)');
    assert.equal(r.orderNo, '110000000000000001');
    assert.equal(r.status, 6);
    assert.deepEqual(r.doubts, []);
  });
}

test('Taobao: заказ и логистика одного заказа связываются по номеру заказа, как у PDD', () => {
  const order = lines(fx('taobao-zakaz.txt')).join('\n');
  const logi = lines(fx('taobao-logistika.txt')).join('\n').replace('3300000000000000001', '3300000000000000002');
  const file = `${BLOCK_MARK}\n2026-11-18T10:00:00+03:00\n${order}\n${BLOCK_MARK}\n2026-11-18T10:01:00+03:00\n${logi}\n`;
  const p = { id: 'p1', name: 'Тест', sessions: [], clientIds: [] };
  const plan = buildPlan(splitBlocks(file), empty(new Map([['p1', p]]), 'p1'));
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].pddOrderNo, '3300000000000000002');
  assert.equal(plan.newItems[0].track, '432100000000001');
  assert.equal(plan.newItems[0].paidFen, 4700);
  assert.equal(plan.newItems[0].shop, 'Happy Shopping Shack');
  assert.equal(plan.pending.length, 0);
});

test('Poizon: из ленты рекомендаций не появляется лишних товаров', () => {
  const file = `${BLOCK_MARK}\n2026-11-18T10:00:00+03:00\n${fx('poizon-zakaz.txt')}\n`;
  const plan = buildPlan(splitBlocks(file), empty());
  assert.equal(plan.newItems.length, 1);
  assert.equal(plan.newItems[0].paidFen, 61200);
  assert.ok(!/Air Max|PUMA/.test(JSON.stringify(plan.newItems)));
});

test('PDD: имя магазина в карточке не затирается названием приложения', () => {
  const file = `${BLOCK_MARK}\n2026-11-18T10:00:00+03:00\n${fx('zakaz-detali.txt')}\n`;
  const plan = buildPlan(splitBlocks(file), empty());
  assert.equal(plan.newItems[0].shop, '小熊饼干童装店');
});

test('непонятный снимок 1688 не теряется: в «Не понял» с понятной причиной', () => {
  const file = `${BLOCK_MARK}\n2026-11-18T10:00:00+03:00\n阿里巴巴\n订单详情\n`;
  const plan = buildPlan(splitBlocks(file), empty());
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.unknown.length, 1);
  assert.match(plan.unknown[0].doubts[0], /1688/);
});

// Заготовки: снять .todo, когда придут снимки (текст положить в tests/fixtures/).
test.todo('1688: экран деталей заказа (видели только список и логистику)');
test.todo('Taobao: экран логистики (сейчас считаем, что как у 1688) и список заказов');
test.todo('Taobao, 1688, Poizon: сверить с настоящим текстом из «Команды» (сейчас модель по скриншотам)');
