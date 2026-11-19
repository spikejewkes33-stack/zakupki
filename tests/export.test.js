import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { formatCents } from '../site/src/money.js';
import { pdfDefinition, kriLayout, formSize, fillWorksheet, LETTER_TEXT, DEFAULT_FROM } from '../site/src/export.js';

// Только выдуманные данные.
const letter = {
  senderName: 'Петров Пётр Петрович', senderPhone: '+375000000001', cargoNo: 'AB0000-0000-1', weight: '12,5', places: '2',
  fromAddr: DEFAULT_FROM, toAddr: 'г. Тестовск, ул. Примерная, 1', recipientName: 'Сидорова Анна Ивановна', recipientPhone: '+375000000002',
};
const doc = {
  title: 'Закупка от 14.11.2026', createdAt: '2026-11-15T10:00:00.000Z', mode: 'both', letter,
  rows: [{ n: 1, name: 'Шарф', qty: 6, unit: 'шт.', totalKop: 4500, avgKop: 750 }, { n: 2, name: 'Сейф', qty: 1, unit: 'шт.', totalKop: 3200, avgKop: 3200 }],
  totalKop: 7700, totalQty: 7,
};
const CJK = /[⺀-⿿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

test('форма KRI: письмо с данными отправителя, груза и получателя, таблица по образцу', () => {
  const k = kriLayout(doc);
  assert.equal(k.title, 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО');
  assert.equal(k.sender.join(''), 'Я, Петров Пётр Петрович, к.т. +375000000001');
  assert.equal(k.cargo.join(''), 'отправляю груз AB0000-0000-1, весом 12,5 кг., мест: 2');
  assert.equal(k.from.join(''), 'из: РФ, МКАД, 19-й километр, вл20с1, Москва');
  assert.equal(k.to.join(''), 'по адресу: Республика Беларусь, г. Тестовск, ул. Примерная, 1');
  assert.equal(k.recipient.join(''), 'для получателя: Сидорова Анна Ивановна, к.т. +375000000002');
  assert.equal(k.text, LETTER_TEXT);
  assert.deepEqual(k.head, ['№', 'Наименование товара', 'Кол-во единиц', 'Единицы измерения', 'Стоимость в бел. руб']);
  assert.deepEqual(k.rows[0], [1, 'Шарф', 6, 'шт.', 4500]);
  assert.equal(k.rows.length, 28); // бланк на 28 позиций, пустые строки с номерами
  assert.deepEqual(k.rows[27], [28, '', '', '', null]);
  assert.equal(k.sheet, '1-28 позиций');
});

test('бланк: до 28 позиций, до 74, больше — по числу позиций', () => {
  assert.deepEqual(formSize(1), { rows: 28, sheet: '1-28 позиций' });
  assert.deepEqual(formSize(29), { rows: 74, sheet: '29-74 позиций' });
  assert.deepEqual(formSize(80), { rows: 80, sheet: '80 позиций' });
});

test('пустые поля письма не ломают файл: на их месте черта для ручки', () => {
  const k = kriLayout({ ...doc, letter: undefined });
  assert.match(k.sender.join(''), /^Я, _+, к\.т\. _+$/);
  assert.equal(k.from.join(''), `из: ${DEFAULT_FROM}`);
});

test('в описи нет иероглифов: строка с китайским названием не выгружается', () => {
  assert.throws(() => kriLayout({ ...doc, rows: [{ n: 1, name: '软尺', qty: 1, unit: 'шт.', totalKop: 100 }] }), /русского названия/);
  assert.ok(!CJK.test(JSON.stringify(pdfDefinition(doc))));
});

test('PDF: шапка письма, таблица с рамками, суммы с запятой', () => {
  const d = pdfDefinition(doc);
  const text = JSON.stringify(d);
  assert.ok(text.includes('СОПРОВОДИТЕЛЬНОЕ ПИСЬМО') && text.includes('Опись:'));
  const body = d.content.find((c) => c.table).table.body;
  assert.equal(body.length, 1 + 28 + 1); // шапка, бланк на 28, «Итого»
  assert.equal(body[29][1].text, 'Итого');
  assert.equal(body[29][4].text, '77,00');
  assert.equal(body[1][1].text, 'Шарф');
  assert.equal(body[1][4].text, '45,00');
  assert.equal(body[3][1].text, '');
});

test('Excel (ExcelJS): объединённые ячейки письма, рамки таблицы, суммы числами', async () => {
  const ExcelJS = createRequire(import.meta.url)('exceljs');
  const wb = new ExcelJS.Workbook();
  const k = kriLayout(doc);
  const ws = wb.addWorksheet(k.sheet);
  fillWorksheet(ws, k);
  assert.equal(ws.getCell('A1').value, 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО');
  assert.ok(ws.getCell('A1').isMerged && ws.getCell('E1').isMerged);
  assert.equal(ws.getCell('A2').value.richText.map((r) => r.text).join(''), 'Я, Петров Пётр Петрович, к.т. +375000000001');
  assert.equal(ws.getCell('A9').value, '№');
  assert.equal(ws.getCell('E9').value, 'Стоимость в бел. руб');
  assert.equal(ws.getCell('B10').value, 'Шарф');
  assert.equal(ws.getCell('E10').value, 45);
  assert.equal(ws.getCell('A37').value, 28);
  assert.equal(ws.getCell('B37').border.bottom.style, 'thin');
  // файл действительно пишется и читается обратно
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  const s = back.getWorksheet('1-28 позиций');
  assert.equal(s.getCell('B11').value, 'Сейф');
  let all = '';
  s.eachRow((r) => r.eachCell((c) => { all += JSON.stringify(c.value); }));
  assert.ok(!CJK.test(all));
});

// Опись на 115 позиций, как у пользователя 19.11: под последней строкой — «Итого» с числами (выдуманные данные).
const big = (() => {
  const rows = Array.from({ length: 115 }, (_, i) => ({ n: i + 1, name: `Товар ${i + 1}`, qty: (i % 3) + 1, unit: 'шт.', totalKop: 101 + i * 37 }));
  return { ...doc, rows, totalKop: rows.reduce((s, r) => s + r.totalKop, 0), totalQty: rows.reduce((s, r) => s + r.qty, 0) };
})();

test('итог описи = сумма строк = «Итого» на экране описи', () => {
  for (const d of [doc, big]) {
    const k = kriLayout(d);
    assert.deepEqual(k.total, { qty: d.totalQty, kop: d.totalKop });
  }
});

test('Excel: после последней позиции строка «Итого» в рамке, числа записаны в файл (их видно в просмотре iPhone)', async () => {
  const req = createRequire(import.meta.url);
  const ExcelJS = req('exceljs');
  const JSZip = req('jszip');
  for (const [d, totalAt] of [[big, 125], [doc, 38]]) { // 115 позиций: строки 10–124; бланк на 28: строки 10–37
    const wb = new ExcelJS.Workbook();
    const k = kriLayout(d);
    fillWorksheet(wb.addWorksheet(k.sheet), k);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf);
    const s = back.worksheets[0];
    assert.equal(s.getCell(`B${totalAt}`).value, 'Итого');
    assert.equal(s.getCell(`B${totalAt}`).border.bottom.style, 'thin');
    assert.equal(s.getCell(`E${totalAt}`).border.right.style, 'thin');
    assert.equal(s.getCell(`E${totalAt}`).value.result, d.totalKop / 100);
    assert.equal(s.getCell(`C${totalAt}`).value.result, d.totalQty);
    assert.equal(s.getCell(`B${totalAt + 1}`).value, null); // ниже ничего нет
    // в самом файле у формулы есть готовое значение <v> — Quick Look показывает его
    const xml = await (await JSZip.loadAsync(buf)).file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(xml.includes(`<f>SUM(E10:E${totalAt - 1})</f><v>${d.totalKop / 100}</v>`), 'у суммы нет записанного значения');
    assert.ok(xml.includes(`<f>SUM(C10:C${totalAt - 1})</f><v>${d.totalQty}</v>`), 'у количества нет записанного значения');
    assert.equal(s.pageSetup.printArea, `A1:E${totalAt}`);
  }
});

test('PDF: последняя строка таблицы — «Итого» с количеством и суммой', () => {
  const body = pdfDefinition(big).content.find((c) => c.table).table.body;
  assert.equal(body.length, 1 + 115 + 1);
  const last = body[body.length - 1];
  assert.equal(last[1].text, 'Итого');
  assert.equal(last[2].text, String(big.totalQty));
  assert.equal(last[4].text, formatCents(big.totalKop)); // «2 541,50», как на экране описи
});
