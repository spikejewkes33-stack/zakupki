// КОПИЯ из «Посылок»: apps/parcel-scanner/code/web/site/src/parse.js (коммит b86f1a2, 18.11.2026).
// Нужна только тестам: текст «Скопировать для Посылок» должен разбираться так же, как в «Посылках».
// Разбор текста заметки: «закупка → получатели → строки "N. Товар ТРЕК"».
// Трек всегда хранится строкой: ведущие нули и буквы не теряются.

// Кириллические буквы, похожие на латинские (на случай, если трек набран вручную).
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

// Маркеры чек-листа и списков в начале строки: «- [ ]», «- [x]», «◦», «•», «☐», «✅» и т. п.
const MARKER_RE = /^\s*(?:[-*+]\s*)?(?:\[([ xX])\]|[◦•▪☐☑✓✔✅])?\s*/u;
const CHECKED_RE = /^\s*(?:[-*+]\s*)?(?:\[[xX]\]|[☑✓✔✅])/u;
const NUMBER_RE = /^(\d{1,4})[.)]?(?:\s+|$)/;

// Приводит текст кода к виду для сравнения: заглавные A–Z и 0–9, без пробелов.
export function normalizeTrack(raw) {
  const upper = String(raw).toUpperCase().replace(/[\s ]/g, '');
  return upper.replace(/[А-ЯЁ]/g, (ch) => LOOKALIKE[ch] ?? ch);
}

// Похоже ли слово на трек-номер: 8–30 латинских букв и цифр, из них не меньше 6 цифр.
export function looksLikeTrack(value) {
  if (!/^[A-Z0-9]{8,30}$/.test(value)) return false;
  return (value.match(/\d/g) || []).length >= 6;
}

// Ищет трек в строке справа налево. Возвращает { track, index } или null.
function findTrack(tokens) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const cleaned = normalizeTrack(tokens[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    if (looksLikeTrack(cleaned)) return { track: cleaned, index: i };
  }
  return null;
}

/**
 * Разбирает текст заметки.
 * @returns {{ title: string, items: Array<{recipient:string, n:string, name:string, track:string, checked:boolean, line:string}>, skipped: string[] }}
 */
export function parseNote(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ').trim());
  const nonEmpty = lines.filter(Boolean);
  const items = [];
  const skipped = [];
  let title = '';
  let recipient = '';

  // Заголовок закупки: первая строка без трека, если за ней тоже строка без трека (имя получателя).
  const hasTrack = (line) => findTrack(line.replace(MARKER_RE, '').split(/\s+/)) !== null;
  let start = 0;
  if (nonEmpty.length > 1 && !hasTrack(nonEmpty[0]) && !hasTrack(nonEmpty[1])) {
    title = nonEmpty[0].replace(MARKER_RE, '');
    start = 1;
  }

  for (const line of nonEmpty.slice(start)) {
    const checked = CHECKED_RE.test(line);
    const body = line.replace(MARKER_RE, '');
    const tokens = body.split(/\s+/).filter(Boolean);
    const found = findTrack(tokens);
    if (!found) {
      // Строка без трека: имя получателя (короткая) или что-то непонятное.
      if (body.length <= 60) recipient = body;
      else skipped.push(line);
      continue;
    }
    const rest = tokens.filter((_, i) => i !== found.index).join(' ');
    const num = rest.match(NUMBER_RE);
    items.push({
      recipient,
      n: num ? num[1] : '',
      name: (num ? rest.slice(num[0].length) : rest).trim(),
      track: found.track,
      checked,
      line,
    });
  }
  return { title, items, skipped };
}
