import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parcelsText } from '../site/src/parcels.js';
import { parseNote } from './fixtures/posylki-parse.js';

// Только выдуманные данные.
const names = { c1: 'Айтен', c2: 'Борис 375291234567', c3: 'Вера' };
const ctx = { clientName: (id) => names[id], clientOrder: ['c2', 'c1', 'c3'] };
const it = (id, clientId, at, extra = {}) => ({ id, clientId, createdAt: at, status: 4, qty: 1, ...extra });
const items = [
  it('a', 'c1', '2026-11-10T10:00:00Z', { name: 'Шарф', track: 'YT1234567890123' }),
  it('b', 'c2', '2026-11-11T10:00:00Z', { name: 'Носки детские', kit: '5 пар', track: 'jt100000000001' }),
  it('c', 'c1', '2026-11-09T10:00:00Z', { name: 'Пижама арт 778899001', track: '4658000000001' }),
  it('d', 'c1', '2026-11-12T10:00:00Z', { name: 'Кружка' }), // без трека
  it('e', 'c2', '2026-11-12T10:00:00Z', { name: '', nameCn: '软尺', track: 'JT100000000001' }), // тот же трек, название по словарю
  it('f', 'c3', '2026-11-13T10:00:00Z', { name: 'Зонт', track: '123' }), // трек, который «Посылки» не узнают
  it('g', 'c3', '2026-11-13T11:00:00Z', { name: 'Удалён', track: 'YT9999999999999', deleted: true }),
];

test('текст для «Посылок»: закупка, клиенты, товары по очереди с треком', () => {
  const r = parcelsText('Закупка от 18.11.2026', items, ctx);
  assert.equal(r.text, [
    'Закуп Закупка от 18.11.2026',
    'Борис',
    '1. Носки детские (5 пар) JT100000000001',
    '2. Сантиметр портновский JT100000000001',
    'Айтен',
    '1. Пижама арт 4658000000001',
    '2. Шарф YT1234567890123',
    '',
  ].join('\n'));
  assert.equal(r.copied, 4);
  assert.deepEqual(r.noTrack.map((x) => x.id), ['d', 'f']);
});

test('«Посылки» разбирают этот текст так же: клиенты, номера, названия, треки', () => {
  const r = parcelsText('Закупка от 18.11.2026', items, ctx);
  const p = parseNote(r.text);
  assert.equal(p.title, 'Закуп Закупка от 18.11.2026');
  assert.deepEqual(p.skipped, []);
  assert.deepEqual(p.items.map(({ recipient, n, name, track }) => ({ recipient, n, name, track })), [
    { recipient: 'Борис', n: '1', name: 'Носки детские (5 пар)', track: 'JT100000000001' },
    { recipient: 'Борис', n: '2', name: 'Сантиметр портновский', track: 'JT100000000001' },
    { recipient: 'Айтен', n: '1', name: 'Пижама арт', track: '4658000000001' },
    { recipient: 'Айтен', n: '2', name: 'Шарф', track: 'YT1234567890123' },
  ]);
});

test('длинное имя клиента обрезается до 60 знаков и остаётся именем, а не мусором', () => {
  const long = 'Очень-очень длинное имя клиента с припиской про доставку и подъезд';
  const r = parcelsText('Закупка', [it('a', 'c1', '2026-11-10T10:00:00Z', { name: 'Шарф', track: 'YT1234567890123' })], { clientName: () => long });
  const p = parseNote(r.text);
  assert.equal(p.items[0].recipient, long.slice(0, 60).trim());
  assert.ok(!/[一-鿿]/.test(r.text));
});
