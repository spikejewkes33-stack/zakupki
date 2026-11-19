// Перенесено из «Посылок» (parcel-scanner b86f1a2) без изменений, кроме путей и ключей настроек.
// Сверка считанных штрихкодов со списком треков.
import { normalizeTrack, looksLikeTrack } from './track.js';

// Индекс: трек → номера позиций (один трек может стоять у нескольких товаров одной посылки).
export function buildIndex(items) {
  const index = new Map();
  items.forEach((item, i) => {
    const list = index.get(item.track);
    if (list) list.push(i);
    else index.set(item.track, [i]);
  });
  return index;
}

/**
 * Ищет трек из списка в тексте штрихкода.
 * Сначала точное совпадение, потом «трек из списка внутри кода» (для кодов с добавками).
 * @returns {{ track: string, exact: boolean } | null}
 */
export function findTrackInCode(code, index) {
  const norm = normalizeTrack(code);
  if (index.has(norm)) return { track: norm, exact: true };
  let best = null;
  for (const track of index.keys()) {
    if (track.length >= 10 && norm.includes(track) && (!best || track.length > best.length)) best = track;
  }
  return best ? { track: best, exact: false } : null;
}

// Можно ли считать код «чужим треком» (красный экран), а не служебным кодом наклейки.
export function isTrackLikeCode(code) {
  return looksLikeTrack(normalizeTrack(code));
}
