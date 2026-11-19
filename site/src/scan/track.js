// Трек-номер: как сравнивать и что похоже на трек. Перенесено из «Посылок» (parse.js), правила те же,
// чтобы список из «📋 Скопировать список» и сканер понимали треки одинаково.

// Кириллические буквы, похожие на латинские (на случай, если трек набран вручную).
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

// Приводит текст кода к виду для сравнения: заглавные A–Z и 0–9, без пробелов.
export function normalizeTrack(raw) {
  const upper = String(raw).toUpperCase().replace(/[\s ]/g, '');
  return upper.replace(/[А-ЯЁ]/g, (ch) => LOOKALIKE[ch] ?? ch);
}

// Похоже ли слово на трек-номер: 8–30 латинских букв и цифр, из них не меньше 6 цифр.
export function looksLikeTrack(value) {
  if (!/^[A-Z0-9]{8,30}$/.test(value)) return false;
  return (value.match(/\d/g) || []).length >= 6;
}
