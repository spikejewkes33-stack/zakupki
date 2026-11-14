import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfDefinition, sheetRows, columns } from '../site/src/export.js';

const doc = {
  title: 'Закупка от 14.11.2026', createdAt: '2026-11-15T10:00:00.000Z', mode: 'both',
  rows: [{ n: 1, name: 'Шарф', qty: 6, unit: 'шт.', totalKop: 4500, avgKop: 750 }, { n: 2, name: 'Сейф', qty: 1, unit: 'шт.', totalKop: 3200, avgKop: 3200 }],
  totalKop: 7700, totalQty: 7,
};

test('колонки описи: сумма, цена за единицу или обе', () => {
  assert.deepEqual(columns('total').map((c) => c.key), ['n', 'name', 'qty', 'unit', 'totalKop']);
  assert.deepEqual(columns('unit').map((c) => c.key), ['n', 'name', 'qty', 'unit', 'avgKop']);
  assert.deepEqual(columns('both').map((c) => c.key), ['n', 'name', 'qty', 'unit', 'avgKop', 'totalKop']);
});

test('PDF: заголовок, строки и итог в рублях с запятой', () => {
  const d = pdfDefinition(doc);
  const text = JSON.stringify(d);
  assert.ok(text.includes('ОПИСЬ ТОВАРОВ'));
  const body = d.content[2].table.body;
  assert.equal(body.length, 4); // шапка + 2 строки + итог
  assert.equal(body[1][5].text, '45,00');
  assert.equal(body[3][5].text, '77,00');
  assert.equal(body[3][2].text, '7');
});

test('Excel: суммы числами с двумя знаками, итог в последней строке', () => {
  const { rows } = sheetRows(doc);
  assert.deepEqual(rows[4], [1, 'Шарф', 6, 'шт.', 7.5, 45]);
  assert.deepEqual(rows.at(-1), ['', 'Итого', 7, '', '', 77]);
  const unit = sheetRows({ ...doc, mode: 'unit' }).rows;
  assert.deepEqual(unit.at(-1), ['', 'Итого, BYN', '', '', 77]);
});
