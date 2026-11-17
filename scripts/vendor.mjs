// Кладёт библиотеки рядом с приложением (без сборки и без внешних CDN — работает без интернета).
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nm = `${root}node_modules/`;
const out = `${root}site/vendor/`;
mkdirSync(out, { recursive: true });
const files = [
  ['htm/preact/standalone.module.js', 'preact-htm.js'], // Preact + htm: экраны без сборки
  ['idb/build/index.js', 'idb.js'], // удобная обёртка IndexedDB
  ['pdfmake/build/pdfmake.min.js', 'pdfmake.min.js'], // PDF
  ['pdfmake/build/vfs_fonts.js', 'vfs_fonts.js'], // шрифт Roboto с кириллицей
  ['xlsx/dist/xlsx.mini.min.js', 'xlsx.mini.min.js'], // прежний Excel (SheetJS), больше не используется
  ['exceljs/dist/exceljs.min.js', 'exceljs.min.js'], // Excel с рамками и объединёнными ячейками (форма описи KRI)
];
for (const [from, to] of files) copyFileSync(nm + from, out + to);
console.log(`vendor: скопировано ${files.length} файлов`);
