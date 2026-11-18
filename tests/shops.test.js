import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { detectShop } from '../site/src/shops.js';
import { classifyAny, buildPlan, splitBlocks, BLOCK_MARK } from '../site/src/pddimport.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

test('все снимки PDD из образцов по-прежнему узнаются как PDD', () => {
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url)).filter((n) => n.endsWith('.txt'))) {
    assert.equal(detectShop(lines(fx(f))), 'pdd', f);
  }
});

test('номер заказа PDD главнее слов «天猫» или «1688» в ленте рекомендаций', () => {
  assert.equal(detectShop(['订单编号：261115-500000000000005', '天猫同款 保温杯']), 'pdd');
  assert.equal(detectShop(['订单编号：261115-500000000000005', '1688源头工厂']), 'pdd');
});

test('другие приложения узнаются по названию', () => {
  assert.equal(detectShop(['得物', '订单详情']), 'poizon');
  assert.equal(detectShop(['POIZON']), 'poizon');
  assert.equal(detectShop(['淘宝', '订单详情']), 'taobao');
  assert.equal(detectShop(['天猫超市']), 'taobao');
  assert.equal(detectShop(['阿里巴巴', '采购单']), '1688');
  assert.equal(detectShop(['1688']), '1688');
});

test('«1688» внутри цены или длинного номера не путает', () => {
  assert.equal(detectShop(['￥1688.00']), 'pdd');
  assert.equal(detectShop(['订单号 2516880000000001']), 'pdd');
});

test('снимок не PDD пока не разбирается, но и не теряется: в «Не понял» с понятной причиной', () => {
  const r = classifyAny(['淘宝', '订单详情', '实付款 ￥19.90']);
  assert.equal(r.kind, 'unknown');
  assert.equal(r.shop, 'taobao');
  assert.match(r.doubts[0], /Taobao/);
  const file = `${BLOCK_MARK}\n2026-11-18T10:00:00+03:00\n得物\n订单详情\n`;
  const plan = buildPlan(splitBlocks(file), { items: [], purchases: new Map(), activePurchaseId: null, importedIds: new Set(), pending: [] });
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.unknown.length, 1);
  assert.match(plan.unknown[0].doubts[0], /Poizon/);
});

// Заготовки: снять .todo, когда пользователь пришлёт снимки (текст положить в tests/fixtures/).
test.todo('1688: экран заказа (订单详情) → название, вариант, количество, сумма, номер заказа');
test.todo('1688: экран логистики → перевозчик и трек, номер заказа');
test.todo('Poizon (得物): экран заказа → название, размер, сумма, номер заказа');
test.todo('Poizon (得物): экран логистики → трек; отдельно — доставка от склада Poizon в Китае');
test.todo('Taobao: экран заказа → название, вариант, количество, 实付款, номер заказа');
test.todo('Taobao: экран логистики → перевозчик и трек, номер заказа');
