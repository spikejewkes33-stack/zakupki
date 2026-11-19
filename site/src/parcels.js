// Текст для приложения «Посылки» (сканер треков) и для карго: закупка → клиент → «N. Товар ТРЕК».
// Это формат заметок пользователя («Закуп нояб 9», имя получателя, «4. Штаны 9840471421968»).
// Формат — тот, что понимает parseNote из «Посылок» (apps/parcel-scanner/code/web/site/src/parse.js):
//   Закуп <название закупки>
//   <Имя клиента>
//   1. <Русское название> <ТРЕК>
// Трек — последнее слово строки. В названии и имени клиента не должно быть слов, похожих на трек,
// иначе «Посылки» примут их за трек: такие слова убираются.
import { itemLabel } from './opis.js';

// Как в «Посылках»: 8–30 латинских букв и цифр, из них не меньше 6 цифр.
export const looksLikeTrack = (v) => /^[A-Z0-9]{8,30}$/.test(v) && (v.match(/\d/g) || []).length >= 6;
const core = (word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toUpperCase();
const noTrackWords = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w && !looksLikeTrack(core(w))).join(' ');
const normTrack = (t) => String(t || '').replace(/\s+/g, '').toUpperCase();

// items — товары одной закупки; ctx: clientName(id), clientOrder (id клиентов по порядку оформления).
// Возвращает { text, copied, noTrack: [товары без трека или с треком, который «Посылки» не узнают] }.
export function parcelsText(purchaseName, items, { clientName = () => '', clientOrder = [] } = {}) {
  const live = items.filter((it) => !it.deleted);
  const withTrack = live.filter((it) => looksLikeTrack(normTrack(it.track)));
  const noTrack = live.filter((it) => !withTrack.includes(it));
  const added = (it) => String(it.createdAt || it.orderDate || '');
  const byTime = [...withTrack].sort((a, b) => added(a).localeCompare(added(b)) || (a.seq ?? 0) - (b.seq ?? 0));
  const clients = [...new Set([...clientOrder, ...byTime.map((it) => it.clientId)])].filter((c) => byTime.some((it) => it.clientId === c));
  const out = [`Закуп ${noTrackWords(purchaseName) || 'без названия'}`];
  // Нумерация сквозная по всему тексту: 1–5 у первого клиента, 6–10 у второго и т. д. (просьба пользователя 18.11).
  let n = 0;
  for (const c of clients) {
    out.push(noTrackWords(clientName(c)).slice(0, 60).trim() || 'Клиент');
    for (const it of byTime.filter((x) => x.clientId === c)) {
      n += 1;
      out.push(`${n}. ${noTrackWords(itemLabel(it)) || 'Без названия'} ${normTrack(it.track)}`);
    }
  }
  return { text: `${out.join('\n')}\n`, copied: withTrack.length, noTrack };
}

// Копирование одного карго: пары «закупка + клиент» этого карго. Каждая закупка — свой блок «Закуп …»
// со сквозной нумерацией с 1; товары разных закупок не смешиваются.
// pairs — [{ purchaseId, clientId, items }] в нужном порядке закупок; ctx: purchaseById, clientName, clientOrder(p).
export function cargoText(pairs, { purchaseById, clientName, clientOrder = () => [] }) {
  const pids = [...new Set(pairs.map((x) => x.purchaseId))];
  const parts = pids.map((pid) => {
    const p = purchaseById(pid);
    const mine = pairs.filter((x) => x.purchaseId === pid);
    const ids = new Set(mine.map((x) => x.clientId));
    return parcelsText(p?.name || '', mine.flatMap((x) => x.items), { clientName, clientOrder: clientOrder(p).filter((id) => ids.has(id)) });
  }).filter((r) => r.copied);
  return {
    text: parts.map((r) => r.text).join('\n'),
    copied: parts.reduce((s, r) => s + r.copied, 0),
    noTrack: pids.flatMap((pid) => parcelsText('', pairs.filter((x) => x.purchaseId === pid).flatMap((x) => x.items)).noTrack),
  };
}
