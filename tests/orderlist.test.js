// Список заказов (несколько товаров, номера заказа нет), трек по названию с подтверждением,
// лента событий логистики и чат с продавцом. Тексты — модель по скриншотам 18.11 (предположение).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyAny, buildPlan, splitBlocks, BLOCK_MARK } from '../site/src/pddimport.js';
import { sameGoods } from '../site/src/ocr.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const block = (time, name) => `${BLOCK_MARK}\n${time}\n${fx(name)}\n`;
const P = { id: 'p1', name: 'Тест', sessions: [], clientIds: [] };
const ctx = (items = [], pending = []) => ({ items, purchases: new Map([['p1', P]]), activePurchaseId: 'p1', importedIds: new Set(), pending });

test('список заказов: два товара, цена за штуку, ×N, сумма = 总实付 − доставка', () => {
  const r = classifyAny(lines(fx('taobao-spisok-ru.txt')));
  assert.equal(r.kind, 'orderList');
  assert.equal(r.items.length, 2);
  const [a, b] = r.items;
  assert.equal(a.nameCn, '甜酷机能风仿狐狸毛皮草加绒加');
  assert.equal(a.variant, '颜色:棕色--26016 尺码:L');
  assert.equal(a.qty, 2);
  assert.equal(a.priceFen, 22800);
  assert.equal(a.shipFen, 500);
  assert.equal(a.totalFen, 45777);
  assert.equal(a.paidFen, 45277);
  assert.equal(b.variant, 'цвет:черный серый Размер:M');
  assert.equal(b.qty, 1);
  assert.equal(b.paidFen, 24723);
  assert.ok(b.machineRu);
});

test('список заказов в сводке: две карточки, машинный русский перевод в название не попадает', () => {
  const plan = buildPlan(splitBlocks(block('2026-11-18T11:43:00+03:00', 'taobao-spisok-ru.txt')), ctx());
  assert.equal(plan.newItems.length, 2);
  assert.notEqual(plan.newItems[0].key, plan.newItems[1].key);
  assert.equal(plan.newItems[1].name, '');
  assert.ok(plan.newItems[1].doubts.some((d) => /машинный перевод/.test(d)));
  assert.ok(plan.newItems.every((n) => !n.track && !n.pddOrderNo));
});

test('логистика: трек только после названия службы; телефоны из ленты событий — не трек и не номер заказа', () => {
  const r = classifyAny(lines(fx('taobao-logistika-lenta.txt')));
  assert.equal(r.kind, 'logistics');
  assert.equal(r.track, '432100000000003');
  assert.equal(r.orderNo, '3300000000000000003');
  assert.equal(r.status, 6);
  assert.deepEqual(r.goods, [{ nameCn: '甜酷机能风仿狐狸毛皮草加绒加厚保暖棉', variant: '颜色:棕色--26016; 尺码:L', qty: 2 }]);
});

test('список + логистика в одном файле: трек предлагается по названию, но не записывается без галочки', () => {
  const file = block('2026-11-18T11:43:00+03:00', 'taobao-spisok-ru.txt') + block('2026-11-18T11:43:30+03:00', 'taobao-logistika-lenta.txt');
  const plan = buildPlan(splitBlocks(file), ctx());
  const [jacket, other] = plan.newItems;
  assert.equal(jacket.track, ''); // молча не склеиваем
  assert.equal(jacket.trackGuess.track, '432100000000003');
  assert.equal(jacket.trackGuess.orderNo, '3300000000000000003');
  assert.equal(other.trackGuess, undefined);
  assert.equal(plan.pending.length, 0);
});

test('логистика позже, товар со списка уже записан: трек по названию — в «Треки к товарам» без галочки', () => {
  const item = { id: 'i1', purchaseId: 'p1', clientId: 'c1', nameCn: '甜酷机能风仿狐狸毛皮草加绒加', variant: '颜色:棕色--26016 尺码:L', qty: 2, status: 1, track: '', pddOrderNo: '' };
  const plan = buildPlan(splitBlocks(block('2026-11-18T12:00:00+03:00', 'taobao-logistika-lenta.txt')), ctx([item]));
  assert.equal(plan.tracks.length, 1);
  assert.equal(plan.tracks[0].itemId, 'i1');
  assert.equal(plan.tracks[0].byName, true);
  assert.equal(plan.tracks[0].skip, true);
  assert.equal(plan.tracks[0].patch.track, '432100000000003');
  assert.equal(plan.tracks[0].patch.pddOrderNo, '3300000000000000003');
});

test('другой вариант или количество — трек по названию не предлагается, ждёт карточку', () => {
  const item = { id: 'i1', purchaseId: 'p1', clientId: 'c1', nameCn: '甜酷机能风仿狐狸毛皮草加绒加', variant: '颜色:黑色 尺码:L', qty: 2, status: 1, track: '', pddOrderNo: '' };
  const plan = buildPlan(splitBlocks(block('2026-11-18T12:00:00+03:00', 'taobao-logistika-lenta.txt')), ctx([item]));
  assert.equal(plan.tracks.length, 0);
  assert.equal(plan.pending.length, 1);
  assert.ok(!sameGoods({ nameCn: '甜酷机能风', qty: 1 }, { nameCn: '甜酷机能风仿', qty: 1 })); // слишком короткое начало
});

test('повторный снимок того же списка не задваивает товары: повторы без галочки', () => {
  const file = block('2026-11-18T11:43:00+03:00', 'taobao-spisok-ru.txt') + block('2026-11-18T11:50:00+03:00', 'taobao-spisok-ru.txt').replace('11:43\n', '11:50\n');
  const plan = buildPlan(splitBlocks(file), ctx());
  assert.equal(plan.newItems.filter((n) => !n.skip).length, 2);
  assert.equal(plan.newItems.filter((n) => n.skip).length, 2); // повторы видны, но без галочки
  assert.match(plan.newItems[2].doubts[0], /уже забирали/);
});

test('два одинаковых заказа на одном снимке списка — два товара, оба добавляются', () => {
  const card = fx('taobao-spisok-ru.txt').split('某某县某某服装店')[0].split('搜索我的订单')[1];
  const file = `${BLOCK_MARK}\n2026-11-18T11:43:00+03:00\n${card}${card}`;
  const plan = buildPlan(splitBlocks(file), ctx());
  assert.equal(plan.newItems.length, 2);
  assert.ok(plan.newItems.every((n) => !n.skip));
});

test('чат с продавцом — не заказ: пропускается с понятной причиной, цена из чата не берётся', () => {
  const plan = buildPlan(splitBlocks(block('2026-11-18T11:44:00+03:00', 'taobao-chat.txt')), ctx());
  assert.equal(plan.newItems.length, 0);
  assert.equal(plan.unknown.length, 1);
  assert.match(plan.unknown[0].doubts[0], /чата/);
});

test('«尺码» (размер) в варианте не делает из куртки «Линейку»; 皮草 — «Шуба»', async () => {
  const { ruName } = await import('../site/src/names.js');
  assert.equal(ruName('甜酷机能风仿狐狸毛皮草加绒加', '颜色:棕色--26016 尺码:L'), 'Шуба');
  assert.equal(ruName('某某新款上衣', '尺码:L'), 'Одежда');
  assert.equal(ruName('', '颜色:棕色 尺码:L'), '');
});
