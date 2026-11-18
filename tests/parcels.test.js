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

test('текст для «Посылок»: закупка, клиенты, товары по очереди с треком, нумерация сквозная', () => {
  const r = parcelsText('Закупка от 18.11.2026', items, ctx);
  assert.equal(r.text, [
    'Закуп Закупка от 18.11.2026',
    'Борис',
    '1. Носки детские (5 пар) JT100000000001',
    '2. Сантиметр портновский JT100000000001',
    'Айтен',
    '3. Пижама арт 4658000000001',
    '4. Шарф YT1234567890123',
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
    { recipient: 'Айтен', n: '3', name: 'Пижама арт', track: '4658000000001' },
    { recipient: 'Айтен', n: '4', name: 'Шарф', track: 'YT1234567890123' },
  ]);
});

test('длинное имя клиента обрезается до 60 знаков и остаётся именем, а не мусором', () => {
  const long = 'Очень-очень длинное имя клиента с припиской про доставку и подъезд';
  const r = parcelsText('Закупка', [it('a', 'c1', '2026-11-10T10:00:00Z', { name: 'Шарф', track: 'YT1234567890123' })], { clientName: () => long });
  const p = parseNote(r.text);
  assert.equal(p.items[0].recipient, long.slice(0, 60).trim());
  assert.ok(!/[一-鿿]/.test(r.text));
});

// Пример для пользователя: 3 клиента в двух карго, копирование по карго (выдуманные товары и треки).
const cargoItems = [
  it('k1', 'm1', '2026-11-10T10:00:00Z', { name: 'Шарф', track: 'YT0000000000001' }),
  it('k2', 'm1', '2026-11-10T11:00:00Z', { name: 'Носки детские', kit: '5 пар', track: 'JT0000000000002' }),
  it('k3', 'm2', '2026-11-11T10:00:00Z', { name: 'Пижама', track: '4658000000003' }),
  it('k4', 'm2', '2026-11-11T11:00:00Z', { name: 'Кружка', track: '777400000000004' }),
  it('k5', 'm2', '2026-11-12T10:00:00Z', { name: 'Варежки' }), // без трека
  it('k6', 'm3', '2026-11-12T11:00:00Z', { name: 'Кроссовки', track: 'SF0000000000006' }),
];
const cargoNames = { m1: 'Айтэн', m2: 'Катя', m3: 'Илона' };
const cargoOf = { m1: 'Карго 1', m2: 'Карго 1', m3: 'Карго 2' };
const forCargo = (cg) => parcelsText('Закупка от 18.11.2026', cargoItems.filter((x) => cargoOf[x.clientId] === cg),
  { clientName: (id) => cargoNames[id], clientOrder: ['m1', 'm2', 'm3'].filter((id) => cargoOf[id] === cg) });

test('копирование по карго: свои клиенты, нумерация сквозная с 1 внутри текста, «Посылки» его читают', () => {
  const one = forCargo('Карго 1');
  assert.equal(one.text, [
    'Закуп Закупка от 18.11.2026',
    'Айтэн',
    '1. Шарф YT0000000000001',
    '2. Носки детские (5 пар) JT0000000000002',
    'Катя',
    '3. Пижама 4658000000003',
    '4. Кружка 777400000000004',
    '',
  ].join('\n'));
  assert.deepEqual(one.noTrack.map((x) => x.id), ['k5']);
  const two = forCargo('Карго 2');
  assert.equal(two.text, 'Закуп Закупка от 18.11.2026\nИлона\n1. Кроссовки SF0000000000006\n');
  for (const r of [one, two]) {
    const p = parseNote(r.text);
    assert.deepEqual(p.skipped, []);
    assert.deepEqual(p.items.map((x) => x.n), p.items.map((_, i) => String(i + 1)));
  }
  assert.deepEqual(parseNote(one.text).items.map(({ recipient, name, track }) => [recipient, name, track]), [
    ['Айтэн', 'Шарф', 'YT0000000000001'], ['Айтэн', 'Носки детские (5 пар)', 'JT0000000000002'],
    ['Катя', 'Пижама', '4658000000003'], ['Катя', 'Кружка', '777400000000004'],
  ]);
});
