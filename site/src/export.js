// Опись в форме перевозчика KRI («Опись товаров для личного пользования»): сопроводительное письмо + таблица.
// PDF — pdfmake (шрифт Roboto с кириллицей), Excel — ExcelJS (рамки, объединённые ячейки). Библиотеки грузятся при первом нажатии.
import { formatCents } from './money.js';
import { hasCjk } from './names.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`Не загрузилось: ${src}`));
      document.head.append(s);
    });
  }
  return loaded[src];
}

export const DEFAULT_FROM = 'РФ, МКАД, 19-й километр, вл20с1, Москва';
export const LETTER_TEXT = 'К данному сопроводительному письму прилагаю опись груза, подтверждающую, что все товары в данном грузе являются '
  + 'товарами для личного пользования, не требуют таможенного декларирования, и не являются запрещёнными к ввозу и перевозке '
  + 'на территории Республики Беларусь и территории государств-членов ЕАЭС.';
export const HEAD = ['№', 'Наименование товара', 'Кол-во единиц', 'Единицы измерения', 'Стоимость в бел. руб'];
const BLANK = '__________';

// Сколько строк в таблице: как в образце — бланк на 28 или на 74 позиции, больше — по числу позиций.
export function formSize(n) {
  if (n <= 28) return { rows: 28, sheet: '1-28 позиций' };
  if (n <= 74) return { rows: 74, sheet: '29-74 позиций' };
  return { rows: n, sheet: `${n} позиций` };
}

// Общий макет для PDF и Excel (без библиотек — проверяется тестом).
// Части строк письма: [обычный текст, жирный текст, обычный, …] — жирным то, что вписывает пользователь.
export function kriLayout(doc) {
  const L = doc.letter || {};
  const v = (x) => String(x ?? '').trim() || BLANK;
  const size = formSize(doc.rows.length);
  const rows = doc.rows.map((r, i) => {
    if (!r.name || hasCjk(r.name)) throw new Error('В описи есть строка без русского названия');
    return [i + 1, r.name, r.qty, r.unit || 'шт.', r.totalKop];
  });
  for (let i = rows.length; i < size.rows; i++) rows.push([i + 1, '', '', '', null]);
  return {
    sheet: size.sheet,
    title: 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО',
    sender: ['Я, ', v(L.senderName), ', к.т. ', v(L.senderPhone)],
    cargo: ['отправляю груз ', v(L.cargoNo), ', весом ', `${v(L.weight)} кг.`, ', мест: ', v(L.places)],
    from: ['из: ', v(L.fromAddr || DEFAULT_FROM)],
    to: ['по адресу: Республика Беларусь, ', v(L.toAddr)],
    recipient: ['для получателя: ', v(L.recipientName), ', к.т. ', v(L.recipientPhone)],
    text: LETTER_TEXT,
    head: HEAD,
    rows,
    totalKop: doc.totalKop,
  };
}

const runs = (parts) => parts.map((t, i) => ({ text: t, bold: i % 2 === 1 }));

export function pdfDefinition(doc) {
  const k = kriLayout(doc);
  const line = (parts) => ({ text: runs(parts), margin: [0, 0, 0, 3] });
  const body = [
    k.head.map((t) => ({ text: t, fontSize: 9 })),
    ...k.rows.map(([n, name, qty, unit, kop]) => [
      { text: String(n), alignment: 'right' },
      { text: name },
      { text: String(qty), alignment: 'right' },
      { text: unit },
      { text: kop == null ? '' : formatCents(kop), alignment: 'right' },
    ]),
  ];
  return {
    info: { title: `Опись — ${doc.title}` },
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 30],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content: [
      { text: k.title, alignment: 'center', margin: [0, 0, 0, 6] },
      line(k.sender),
      line(k.cargo),
      line(k.from),
      line(k.to),
      line(k.recipient),
      { text: k.text, margin: [0, 2, 0, 8] },
      { text: 'Опись:', margin: [24, 0, 0, 2] },
      { table: { headerRows: 1, widths: [22, '*', 60, 62, 70], body }, layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 1, paddingBottom: () => 1 } },
    ],
  };
}

export async function pdfBlob(doc) {
  await loadScript('vendor/pdfmake.min.js');
  await loadScript('vendor/vfs_fonts.js');
  return new Promise((res) => window.pdfMake.createPdf(pdfDefinition(doc)).getBlob(res));
}

// Excel по образцу: шапка письма в объединённых ячейках A:E, таблица с тонкими рамками, Times New Roman.
export function fillWorksheet(ws, k) {
  const font = { name: 'Times New Roman', size: 10 };
  const thin = { style: 'thin' };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  ws.columns = [{ width: 5 }, { width: 46 }, { width: 11 }, { width: 11 }, { width: 12 }];
  const rich = (parts) => ({ richText: parts.map((t, i) => ({ text: t, font: { ...font, bold: i % 2 === 1 } })) });
  const wide = (r, value, extra = {}) => {
    ws.mergeCells(r, 1, r, 5);
    const c = ws.getCell(r, 1);
    c.value = value;
    c.font = font;
    c.alignment = { vertical: 'middle', wrapText: true, ...extra };
    for (let col = 1; col <= 5; col++) ws.getCell(r, col).border = box;
  };
  wide(1, k.title, { horizontal: 'center' });
  wide(2, rich(k.sender));
  // «отправляю груз …, весом» | «123 кг.,» | «мест:» | «2» — как в образце
  ws.mergeCells(3, 1, 3, 2);
  ws.getCell(3, 1).value = rich([k.cargo[0], k.cargo[1], `${k.cargo[2].replace(/^,\s*/, ', ')}`]);
  ws.getCell(3, 3).value = rich(['', k.cargo[3]]);
  ws.getCell(3, 4).value = 'мест:';
  ws.getCell(3, 5).value = rich(['', k.cargo[5]]);
  ws.getCell(3, 5).alignment = { horizontal: 'right' };
  for (let col = 1; col <= 5; col++) {
    ws.getCell(3, col).border = box;
    if (!ws.getCell(3, col).font) ws.getCell(3, col).font = font;
  }
  ws.getCell(3, 4).font = font;
  wide(4, rich(k.from));
  wide(5, rich(k.to));
  wide(6, rich(k.recipient));
  wide(7, k.text, { horizontal: 'justify', vertical: 'top' });
  ws.getRow(7).height = 58;
  ws.getCell(8, 2).value = 'Опись:';
  ws.getCell(8, 2).font = font;
  const head = ws.getRow(9);
  k.head.forEach((t, i) => {
    const c = head.getCell(i + 1);
    c.value = t;
    c.font = font;
    c.border = box;
    c.alignment = { vertical: 'top', wrapText: true };
  });
  head.height = 28;
  k.rows.forEach(([n, name, qty, unit, kop], i) => {
    const row = ws.getRow(10 + i);
    [n, name, qty === '' ? null : qty, unit || null, kop == null ? null : kop / 100].forEach((val, j) => {
      const c = row.getCell(j + 1);
      c.value = val;
      c.font = font;
      c.border = box;
      if (j === 0) c.alignment = { horizontal: 'right' };
      if (j === 4) c.numFmt = '0.00';
    });
  });
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
}

export async function xlsxBlob(doc) {
  await loadScript('vendor/exceljs.min.js');
  const k = kriLayout(doc);
  const wb = new window.ExcelJS.Workbook();
  fillWorksheet(wb.addWorksheet(k.sheet), k);
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const dateRu = (iso) => new Date(iso).toLocaleDateString('ru-RU');
export function fileName(doc, ext) {
  const safe = doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Закупка';
  return `Опись ${safe} ${dateRu(doc.createdAt).replace(/\./g, '-')}.${ext}`;
}

// На телефоне — меню «Поделиться» (сохранить в Файлы, отправить в Telegram); на компьютере — скачивание.
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
