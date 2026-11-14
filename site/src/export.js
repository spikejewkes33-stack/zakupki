// Опись в PDF (pdfmake, шрифт Roboto с кириллицей) и Excel (SheetJS). Библиотеки грузятся при первом нажатии.
import { formatCents } from './money.js';

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

// mode: 'total' — только сумма, 'unit' — только цена за единицу, 'both' — обе.
export function columns(mode) {
  const cols = [
    { key: 'n', title: '№' },
    { key: 'name', title: 'Наименование товара' },
    { key: 'qty', title: 'Кол-во' },
    { key: 'unit', title: 'Ед.' },
  ];
  if (mode !== 'total') cols.push({ key: 'avgKop', title: 'Цена за ед., BYN', money: true });
  if (mode !== 'unit') cols.push({ key: 'totalKop', title: 'Стоимость, BYN', money: true });
  return cols;
}

const dateRu = (iso) => new Date(iso).toLocaleDateString('ru-RU');

// Описание PDF-документа (без библиотек — проверяется тестом).
export function pdfDefinition(doc) {
  const cols = columns(doc.mode);
  const body = [
    cols.map((c) => ({ text: c.title, bold: true, fillColor: '#eeeeee' })),
    ...doc.rows.map((r) => cols.map((c) => ({
      text: c.money ? formatCents(r[c.key]) : String(r[c.key] ?? ''),
      alignment: c.money || c.key === 'qty' || c.key === 'n' ? 'right' : 'left',
    }))),
  ];
  const totalRow = cols.map((c, i) => {
    if (i === 1) return { text: 'Итого', bold: true };
    if (c.key === 'qty') return { text: String(doc.totalQty), bold: true, alignment: 'right' };
    if (c.key === 'totalKop') return { text: formatCents(doc.totalKop), bold: true, alignment: 'right' };
    return { text: '' };
  });
  body.push(totalRow);
  return {
    info: { title: `Опись — ${doc.title}` },
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content: [
      { text: 'ОПИСЬ ТОВАРОВ', fontSize: 16, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
      { text: `${doc.title} · сформирована ${dateRu(doc.createdAt)}`, alignment: 'center', color: '#555555', margin: [0, 0, 0, 12] },
      {
        table: { headerRows: 1, widths: cols.map((c) => (c.key === 'name' ? '*' : 'auto')), body },
        layout: 'lightHorizontalLines',
      },
      ...(doc.mode === 'unit' ? [{ text: `Итого: ${formatCents(doc.totalKop)} BYN`, bold: true, margin: [0, 10, 0, 0] }] : []),
    ],
  };
}

// Строки для Excel: числа — числами (суммы в рублях с 2 знаками), чтобы в Excel можно было считать.
export function sheetRows(doc) {
  const cols = columns(doc.mode);
  const rows = [['ОПИСЬ ТОВАРОВ'], [`${doc.title} · сформирована ${dateRu(doc.createdAt)}`], [], cols.map((c) => c.title)];
  for (const r of doc.rows) rows.push(cols.map((c) => (c.money ? r[c.key] / 100 : r[c.key])));
  rows.push(cols.map((c, i) => (i === 1 ? 'Итого' : c.key === 'qty' ? doc.totalQty : c.key === 'totalKop' ? doc.totalKop / 100 : '')));
  if (doc.mode === 'unit') rows.push(['', 'Итого, BYN', '', '', doc.totalKop / 100]);
  return { rows, cols };
}

export async function pdfBlob(doc) {
  await loadScript('vendor/pdfmake.min.js');
  await loadScript('vendor/vfs_fonts.js');
  return new Promise((res) => window.pdfMake.createPdf(pdfDefinition(doc)).getBlob(res));
}

export async function xlsxBlob(doc) {
  await loadScript('vendor/xlsx.mini.min.js');
  const X = window.XLSX;
  const { rows, cols } = sheetRows(doc);
  const ws = X.utils.aoa_to_sheet(rows);
  ws['!cols'] = cols.map((c) => ({ wch: c.key === 'name' ? 48 : c.money ? 16 : 8 }));
  const range = X.utils.decode_range(ws['!ref']);
  for (let R = 4; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const cell = ws[X.utils.encode_cell({ r: R, c: C })];
      if (cell && cols[C]?.money && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Опись');
  const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

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
