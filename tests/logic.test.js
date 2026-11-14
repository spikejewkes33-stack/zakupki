import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCents, parseRate, cnyToByn, itemMoney, averageKop, formatCents, formatRate } from '../site/src/money.js';
import { buildOpis, exportRows, groupKey, isDoubtfulPair, pairId } from '../site/src/opis.js';
import { startSession, finishSession, clientForTime, openSession, clientsInOrder } from '../site/src/order.js';
import { validateItem, totals, duplicateWarnings } from '../site/src/model.js';

const P = (o = {}) => ({ id: 'p1', rateMicro: 450000, rounding: { stepKop: 1, mode: 'math' }, ...o });
const it = (name, qty, unitFen, extra = {}) => ({ id: `${name}-${qty}-${unitFen}-${Math.random()}`, purchaseId: 'p1', name, qty, unitFen, status: 1, ...extra });

test('ввод денег и курса без потери копеек', () => {
  assert.equal(parseCents('12,5'), 1250);
  assert.equal(parseCents('0.1'), 10);
  assert.equal(parseCents('1 234,56'), 123456);
  assert.equal(parseCents(''), null);
  assert.ok(Number.isNaN(parseCents('12,345')));
  assert.ok(Number.isNaN(parseCents('abc')));
  assert.equal(parseRate('0,4512'), 451200);
  assert.equal(parseRate('0.453217'), 453217);
  assert.ok(Number.isNaN(parseRate('0')));
  assert.equal(formatCents(123456), '1 234,56');
  assert.equal(formatRate(451200), '0,4512');
});

test('0,1 + 0,2 не даёт ошибку плавающей точки: сумма 1000 товаров по 0,10 ¥', () => {
  const items = Array.from({ length: 1000 }, () => it('Значок', 1, 10));
  const t = totals(items, () => P({ rateMicro: 1_000_000 }));
  assert.equal(t.fen, 100_00); // ровно 100,00 ¥
  assert.equal(t.kop, 100_00);
});

test('курс и округление: до копейки, 5 коп, 10 коп, рубля; вверх и вниз', () => {
  // 12,34 ¥ × 0,4512 = 5,567808 BYN
  assert.equal(cnyToByn(1234, 451200), 557);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 1, mode: 'down' }), 556);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 5, mode: 'math' }), 555);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 10, mode: 'math' }), 560);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 100, mode: 'math' }), 600);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 100, mode: 'down' }), 500);
  assert.equal(cnyToByn(1234, 451200, { stepKop: 5, mode: 'up' }), 560);
  // ровно половина копейки — вверх: 1 ¥ × 0,005 = 0,005 BYN → 0,01
  assert.equal(cnyToByn(100, 5000), 1);
  // целое значение без округления не сдвигается режимом «вверх»
  assert.equal(cnyToByn(1000, 500000, { stepKop: 1, mode: 'up' }), 500);
});

test('у каждого товара своя цена; сумма = цена за единицу × количество; юани не теряются при смене курса', () => {
  const a = it('Шарф', 3, 1990);
  const m1 = itemMoney(a, P());
  assert.deepEqual(m1, { qty: 3, unitFen: 1990, totalFen: 5970, unitKop: 896, totalKop: 2688 });
  const m2 = itemMoney(a, P({ rateMicro: 500000 }));
  assert.equal(m2.unitFen, 1990);
  assert.equal(m2.totalFen, 5970);
  assert.equal(m2.unitKop, 995);
  assert.equal(itemMoney(it('Без цены', 2, null), P()).totalKop, null);
});

test('опись объединяет шарфы разных клиентов в одну строку и считает реальную сумму', () => {
  const items = [
    it('Шарф', 2, 2000, { clientId: 'Максим', track: 'YT1', pddOrderNo: '261113-1' }),
    it('шарф', 3, 3000, { clientId: 'Айтен', track: 'YT2', pddOrderNo: '261113-2' }),
    it('Шарфы', 1, 1000, { clientId: 'Ксения' }),
    it('Сейф', 1, 7000, { clientId: 'Максим' }),
  ];
  const o = buildOpis(items, P());
  const scarf = o.rows.find((r) => r.name === 'Шарф');
  assert.equal(scarf.qty, 6);
  // 20×0,45=9,00 ×2 + 30×0,45=13,50 ×3 + 10×0,45=4,50 = 18+40,5+4,5 = 63,00
  assert.equal(scarf.totalKop, 6300);
  assert.equal(scarf.avgKop, 1050);
  assert.equal(o.totalKop, 6300 + 3150);
  assert.equal(o.rows.length, 2);
});

test('в экспорт описи не попадают имена клиентов, треки и номера заказов', () => {
  const items = [it('Шарф', 2, 2000, { clientId: 'Максим', track: 'YT0719739925067', pddOrderNo: '261113-143539596913933', carrier: '申通快递' })];
  const rows = exportRows(buildOpis(items, P()));
  const text = JSON.stringify(rows);
  for (const bad of ['Максим', 'YT0719739925067', '261113-143539596913933', '申通快递', 'clientId', 'track']) assert.ok(!text.includes(bad), bad);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['avgKop', 'n', 'name', 'qty', 'totalKop', 'unit']);
});

test('похожие названия: «Детские носки» = «Носки детские» = «Детские носочки» = «носок детский»', () => {
  const k = groupKey('Детские носки');
  assert.equal(groupKey('Носки детские'), k);
  assert.equal(groupKey('Детские носочки'), k);
  assert.equal(groupKey('носок детский'), k);
  assert.equal(groupKey('Игрушка'), groupKey('игрушки'));
});

test('разные товары с общим словом не объединяются и не предлагаются', () => {
  assert.notEqual(groupKey('Носки детские'), groupKey('Носки женские'));
  assert.equal(isDoubtfulPair(groupKey('Носки детские'), groupKey('Носки женские')), false);
  assert.notEqual(groupKey('Сейф 30 см'), groupKey('Сейф 50 см'));
  assert.equal(isDoubtfulPair(groupKey('Сейф 30 см'), groupKey('Сейф 50 см')), false);
  assert.equal(isDoubtfulPair(groupKey('Чехол для телефона'), groupKey('Чехол для подушки')), false);
  assert.notEqual(groupKey('Носки 3 пары'), groupKey('Носки 5 пар'));
});

test('при сомнении опись предлагает объединение, а не объединяет сама', () => {
  const items = [it('Шарф', 1, 1000), it('Шарфик', 2, 1000), it('Шарф тёплый', 1, 1000), it('Сейф', 1, 1000)];
  const o = buildOpis(items, P());
  assert.equal(o.rows.length, 4);
  const ids = o.suggestions.map((s) => [s.a.name, s.b.name].sort().join(' + '));
  assert.ok(ids.includes('Шарф + Шарфик'), ids.join('; '));
  assert.ok(ids.includes('Шарф + Шарф тёплый'), ids.join('; '));
  assert.ok(!ids.some((x) => x.includes('Сейф')));
});

test('подтверждённое объединение, отказ, правка названия и количества, исключение и пересчёт итога', () => {
  const items = [it('Шарф', 1, 2000), it('Шарфик', 2, 2000), it('Сейф', 1, 10000)];
  const kA = groupKey('Шарф');
  const kB = groupKey('Шарфик');
  let o = buildOpis(items, P({ opis: { merges: [[kA, kB]] } }));
  const merged = o.rows.find((r) => r.merged);
  assert.equal(merged.qty, 3);
  assert.equal(merged.totalKop, 2700);
  assert.equal(o.suggestions.length, 0);

  o = buildOpis(items, P({ opis: { rejected: [pairId(kA, kB)] } }));
  assert.equal(o.rows.length, 3);
  assert.equal(o.suggestions.length, 0);

  o = buildOpis(items, P({ opis: { merges: [[kA, kB]], edits: { [kA]: { name: 'Шарф женский', qty: 4, unit: 'шт.' }, [groupKey('Сейф')]: { excluded: true } } } }));
  const r = o.rows.find((x) => x.name === 'Шарф женский');
  assert.equal(r.qty, 4);
  assert.equal(r.totalKop, 2700); // сумма реальная, меняется только количество
  assert.equal(r.avgKop, 675);
  assert.equal(o.totalKop, 2700); // сейф исключён
  assert.equal(exportRows(o).length, 1);
  assert.equal(exportRows(o)[0].n, 1);
});

test('средняя цена за единицу = общая стоимость / количество', () => {
  assert.equal(averageKop(1000, 3), 333);
  assert.equal(averageKop(1001, 2), 501);
  assert.equal(averageKop(null, 2), null);
});

test('граница между клиентами: «Завершить заказы клиента» и разбор заказа по времени', () => {
  let p = { sessions: [] };
  p.sessions = startSession(p, 'Максим', '2026-11-14T10:00:00.000Z', 's1');
  assert.equal(openSession(p).clientId, 'Максим');
  p.sessions = finishSession(p, '2026-11-14T10:30:00.000Z');
  assert.equal(openSession(p), null);
  p.sessions = startSession(p, 'Айтен', '2026-11-14T10:31:00.000Z', 's2');
  // начать следующего, не нажав «Завершить», — прошлый закрывается автоматически
  p.sessions = startSession(p, 'Ксения', '2026-11-14T11:00:00.000Z', 's3');
  assert.equal(p.sessions[1].endedAt, '2026-11-14T11:00:00.000Z');
  assert.equal(clientForTime(p.sessions, '2026-11-14T10:10:00Z'), 'Максим');
  assert.equal(clientForTime(p.sessions, '2026-11-14T10:30:30Z'), null); // между клиентами
  assert.equal(clientForTime(p.sessions, '2026-11-14T10:45:00Z'), 'Айтен');
  assert.equal(clientForTime(p.sessions, '2026-11-14T11:00:00Z'), 'Ксения');
  assert.deepEqual(clientsInOrder({ ...p, clientIds: ['Лена', 'Максим'] }), ['Максим', 'Айтен', 'Ксения', 'Лена']);
});

test('карточка: обязательны только название и клиент; трек не обязателен и поднимает статус', () => {
  const v1 = validateItem({ name: '', clientId: '' }, [], null);
  assert.ok(v1.errors.name && v1.errors.clientId);
  const v2 = validateItem({ name: 'Шарф', clientId: 'c1', qty: '2', unitFen: '19,9', status: 1 }, [], null);
  assert.deepEqual(v2.errors, {});
  assert.equal(v2.item.unitFen, 1990);
  assert.equal(v2.item.track, '');
  const v3 = validateItem({ ...v2.item, track: ' 7774 6319 8487290 ' }, [], 'x');
  assert.equal(v3.item.track, '777463198487290');
  assert.equal(v3.item.status, 4);
  const v4 = validateItem({ name: 'Шарф', clientId: 'c1', unitFen: '12,345' }, [], null);
  assert.ok(v4.errors.unitFen);
});

test('защита от дублей: тот же номер заказа или трек у другой карточки', () => {
  const all = [{ id: 'a', name: 'Шарф', pddOrderNo: '261113-143539596913933', track: '777463198487290' }];
  assert.equal(duplicateWarnings({ pddOrderNo: '261113-143539596913933' }, all, 'b').length, 1);
  assert.equal(duplicateWarnings({ track: '777463198487290' }, all, 'b').length, 1);
  assert.equal(duplicateWarnings({ track: '777463198487290' }, all, 'a').length, 0); // сама себе не дубль
  assert.equal(duplicateWarnings({ track: '777463198487290' }, [{ ...all[0], deleted: true }], 'b').length, 0);
});
