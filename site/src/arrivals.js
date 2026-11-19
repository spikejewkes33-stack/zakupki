// Склад: что значит «приехал», сверка отсканированного трека с закупкой, списки «Приехали / Ожидаются / Нет в списке».
// «Приехал» — это статус 6 «Товар прибыл на склад»: отдельного поля нет, поэтому плитки, итоги и опись
// считают так же, как сканер. Когда и откуда пришёл статус, видно в истории товара (действие 'scan').
import { findTrackInCode } from './scan/match.js';
import { normalizeTrack } from './scan/track.js';
import { TRACK_STATUS } from './model.js';

export const ARRIVED = 6;
export const isArrived = (it) => it.status >= ARRIVED;
const isOpen = (p) => !!p && !p.archived && !p.deleted;

// Треки товаров всех открытых закупок: трек → товары (один трек бывает у нескольких товаров одной посылки).
export function trackIndex(items, purchaseById) {
  const index = new Map();
  for (const it of items) {
    if (it.deleted || !it.track || !isOpen(purchaseById(it.purchaseId))) continue;
    const t = normalizeTrack(it.track);
    if (!index.has(t)) index.set(t, []);
    index.get(t).push(it);
  }
  return index;
}

// Трек из открытых закупок для текста штрихкода (точно или «трек внутри кода с добавками») или null.
export const lookupTrack = (code, index) => findTrackInCode(code, index)?.track ?? null;

// Что делает скан трека в закупке pid. Отмечается только эта закупка:
// - 'found'  — есть неотмеченные товары с этим треком, все они станут «На складе» (fresh);
// - 'repeat' — все товары с этим треком уже на складе;
// - 'other'  — трека нет в этой закупке, но он есть в другой открытой: ничего не отмечается;
// - 'unknown' — трека нет ни в одной открытой закупке.
export function scanOutcome(track, index, pid) {
  const all = (track && index.get(track)) || [];
  const mine = all.filter((it) => it.purchaseId === pid);
  if (!mine.length) {
    if (!all.length) return { result: 'unknown', items: [], fresh: [], otherPids: [] };
    return { result: 'other', items: all, fresh: [], otherPids: [...new Set(all.map((it) => it.purchaseId))] };
  }
  const fresh = mine.filter((it) => !isArrived(it));
  return { result: fresh.length ? 'found' : 'repeat', items: mine, fresh, otherPids: [] };
}

// Последнее событие, которое поставило товару «На складе»: itemId → время (ISO).
export function arrivalTimes(events) {
  const at = new Map();
  for (const e of events) {
    const st = e.entity === 'item' && e.changes?.status;
    if (st && st[1] >= ARRIVED && !(st[0] >= ARRIVED)) at.set(e.entityId, e.at);
  }
  return at;
}

// Статус до отметки «приехал» — к нему возвращает ручное «не приехал». Нет в истории — «Трек получен» или «Оформлен».
export function statusBeforeArrival(item, events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const st = e.entity === 'item' && e.entityId === item.id && e.changes?.status;
    if (st && st[1] >= ARRIVED && st[0] != null && st[0] < ARRIVED) return st[0];
  }
  return item.track ? TRACK_STATUS : 1;
}

// Прогресс и списки одной закупки. Всего — все живые карточки, в том числе без трека: они тоже ждут.
export function arrivalLists(items) {
  const live = items.filter((it) => !it.deleted);
  const arrived = live.filter(isArrived);
  const waiting = live.filter((it) => !isArrived(it));
  return {
    total: live.length,
    done: arrived.length,
    arrived,
    waiting: waiting.filter((it) => it.track),
    noTrack: waiting.filter((it) => !it.track),
  };
}

// «Нет в списке»: коды, отсканированные в закупке и не найденные в ней. По коду — сколько раз, когда последний раз,
// и (для 'other') в каких открытых закупках он есть. Убранные кнопкой «Убрать» (dismissed) не показываются.
export function missingCodes(scans) {
  const by = new Map();
  for (const s of scans) {
    if (s.dismissed || (s.result !== 'unknown' && s.result !== 'other')) continue;
    const e = by.get(s.code) || { code: s.code, count: 0, firstAt: s.at, lastAt: s.at, result: s.result, otherPids: [] };
    e.count += 1;
    if (s.at >= e.lastAt) {
      e.lastAt = s.at;
      e.result = s.result;
      e.otherPids = s.otherPids || [];
    }
    by.set(s.code, e);
  }
  return [...by.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
