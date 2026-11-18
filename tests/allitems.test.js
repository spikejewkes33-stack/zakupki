import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allItemsList, clientHue } from '../site/src/model.js';

// Только выдуманные данные.
const names = { c1: 'Анна', c2: 'Борис', c3: 'Вера' };
const ctx = { clientName: (id) => names[id] || '', clientOrder: ['c2', 'c1'] };
const it = (id, clientId, createdAt, extra = {}) => ({ id, clientId, createdAt, orderDate: createdAt.slice(0, 10), name: `Товар ${id}`, status: 1, ...extra });
const items = [
  it('a', 'c1', '2026-11-10T10:00:00Z', { seq: 1, name: 'Шарф' }),
  it('b', 'c2', '2026-11-11T10:00:00Z', { seq: 1, track: 'YT123' }),
  it('c', 'c1', '2026-11-12T10:00:00Z', { seq: 2 }),
  it('d', 'c3', '2026-11-09T10:00:00Z', { seq: 1 }),
  it('e', 'c2', '2026-11-13T10:00:00Z', { seq: 2, deleted: true }),
];
const ids = (l) => l.map((x) => x.id).join('');

test('все товары: по клиентам в порядке оформления, удалённые не показываются', () => {
  assert.equal(ids(allItemsList(items, {}, ctx)), 'bacd');
});

test('все товары: по времени добавления', () => {
  assert.equal(ids(allItemsList(items, { sort: 'new' }, ctx)), 'cbad');
  assert.equal(ids(allItemsList(items, { sort: 'old' }, ctx)), 'dabc');
});

test('все товары: фильтр по клиенту и поиск (по имени клиента и треку)', () => {
  assert.equal(ids(allItemsList(items, { clientId: 'c1' }, ctx)), 'ac');
  assert.equal(ids(allItemsList(items, { q: 'вера' }, ctx)), 'd');
  assert.equal(ids(allItemsList(items, { q: 'yt123' }, ctx)), 'b');
  assert.equal(ids(allItemsList(items, { q: 'шарф', clientId: 'c2' }, ctx)), '');
});

test('все товары: это вид, а не копия — те же объекты, исходный массив не меняется', () => {
  const before = ids(items);
  const l = allItemsList(items, { sort: 'new' }, ctx);
  assert.equal(ids(items), before);
  assert.ok(l.every((x) => items.includes(x)));
});

test('цвет метки клиента постоянный', () => {
  assert.equal(clientHue('c1'), clientHue('c1'));
  assert.ok(clientHue('c1') >= 0 && clientHue('c1') < 360);
});
