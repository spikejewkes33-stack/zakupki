// Снимки Poizon (得物): всё на одном экране заказа — бренд, название, вариант, цена, «实付款»,
// «快递单号 SF…» (трек), «订单编号 1102…» (номер заказа).
// Не трек и не номер: «交易编号» (номер платежа), «商家信息 PBDR…» (продавец).
// Ниже «你可能还喜欢这些» — чужие товары с ценами: их отрезаем.
// Сделано по скриншоту пользователя 18.11.2026 (модель текста — tests/fixtures/poizon-*.txt).
import { logisticsStatus, longOrderNo, yuanIn, qtyIn, cutTitle, carrierByTrack } from './ocr.js';

const FEED = /你可能还喜欢|发现更多|猜你喜欢|为你推荐/;
const NOISE = /^\d{1,2}:\d{2}$|^(?:3G|4G|5G|LTE)\b|^得物|^卡片$|差价补偿|^立即申请$|^我要售后$|^想要$|包邮|已签收|待发货|待收货|运输中|已发货|交易成功|^[<>]$/;

export function parsePoizon(allLines) {
  const cut = allLines.findIndex((l) => FEED.test(l));
  const lines = cut < 0 ? allLines : allLines.slice(0, cut);
  const doubts = [];
  const paidAt = lines.findIndex((l) => /实付款/.test(l));
  if (paidAt < 0) return { kind: 'unknown', app: 'poizon', doubts: ['снимок Poizon без «实付款» — снимите экран заказа целиком'] };

  // Товар — строки до «实付款»: бренд, название (самая длинная строка), вариант («青灰色 44»), цена.
  const block = [];
  for (let i = 0; i < paidAt; i++) if (!NOISE.test(lines[i])) block.push(i);
  let priceFen = null;
  const text = [];
  for (const i of block) {
    if (/^[￥¥]\s*\d/.test(lines[i].trim())) priceFen = yuanIn(lines[i]);
    else {
      if (priceFen == null && yuanIn(lines[i]) != null) priceFen = yuanIn(lines[i]);
      text.push(i);
    }
  }
  const qtyLine = text.find((i) => qtyIn(lines[i]) != null && /^[×xX✕]/.test(lines[i].trim()));
  const qty = qtyLine != null ? qtyIn(lines[qtyLine]) : 1;
  const rest = text.filter((i) => i !== qtyLine);
  const ti = rest.reduce((best, i) => (best < 0 || cutTitle(lines[i]).length > cutTitle(lines[best]).length ? i : best), -1);
  const pos = rest.indexOf(ti);
  const brandI = pos > 0 && cutTitle(lines[rest[pos - 1]]).length <= 24 ? rest[pos - 1] : -1;
  const variantI = pos >= 0 && pos + 1 < rest.length && lines[rest[pos + 1]].length <= 24 ? rest[pos + 1] : -1;
  const titleIdx = [brandI, ti].filter((i) => i >= 0);
  const nameCn = cutTitle(titleIdx.map((i) => lines[i]).join(' '));
  if (!nameCn) doubts.push('не нашёл название');
  const variant = variantI >= 0 ? lines[variantI].trim() : '';

  // «实付款» и сумма: в той же строке или первая строка с ¥ ниже (таблица бывает прочитана по столбцам).
  let paidFen = yuanIn(lines[paidAt]);
  for (let i = paidAt + 1; paidFen == null && i < lines.length; i++) paidFen = yuanIn(lines[i]);
  if (paidFen == null) doubts.push('нет суммы «实付款»');

  // Трек: после подписи «快递单号» или слово вида «SF1234…» (буквы службы и цифры).
  const ti2 = lines.findIndex((l) => /快递单号|运单号/.test(l));
  const word = (l) => (String(l || '').match(/\b([A-Z]{2,4}\d{10,16}|\d{12,16})\b/) || [])[1] || '';
  let track = ti2 >= 0 ? word(lines[ti2]) || word(lines[ti2 + 1]) : '';
  if (!track) track = (lines.map((l) => (/商家|PBDR/.test(l) ? '' : (l.match(/\b((?:SF|JT|YT|JD[A-Z]?|DPK)\d{10,16})\b/) || [])[1] || '')).find(Boolean)) || '';
  const orderNo = longOrderNo(lines);
  if (!orderNo) doubts.push('нет номера заказа (订单编号) — прокрутите экран, чтобы он был виден, и снимите ещё раз');
  const st = track ? logisticsStatus(lines) : { status: 1 };
  return {
    kind: 'order', app: 'poizon', orderNo, nameCn, shop: '', variant, qty, paidFen, priceFen, titleIdx,
    track, carrier: track ? carrierByTrack(track) : '', status: track ? Math.max(4, st.status) : 1, doubts,
  };
}
