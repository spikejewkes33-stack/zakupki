// Общее для разбора текста со снимков любого приложения (PDD, Taobao, Poizon): числа, деньги, перевозчики, статус.

// Распознавание может вставить пробел или длинное тире в номер: «261116 — 3000 0000…». Чиним перед поиском.
export function fixNumbers(line) {
  return String(line)
    .replace(/[—–－‐‑]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/(\d)\s+(?=\d)/g, '$1');
}

export const CARRIER_LAT = [
  ['中通', 'ZTO'], ['韵达', 'Yunda'], ['极兔', 'J&T'], ['申通', 'STO'], ['圆通', 'YTO'], ['顺丰', 'SF'],
  ['邮政', 'China Post'], ['EMS', 'EMS'], ['京东', 'JD'], ['德邦', 'Deppon'], ['百世', 'Best'], ['丹鸟', 'Danniao'],
];
export function carrierLabel(cn) {
  const hit = CARRIER_LAT.find(([k]) => cn.includes(k));
  return hit ? `${cn} (${hit[1]})` : cn;
}

// «45.6», «45. 6», «1,299.00», «45,6» → фэни.
export const toFen = (s) => {
  let t = String(s).replace(/\s+/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const [i, f = ''] = t.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0').slice(0, 2));
};
export const MONEY = '(\\d+(?:,\\d{3})*(?:[.,]\\s?\\d{1,2})?)';

// Статус по словам на экране логистики (до ленты рекомендаций).
export function logisticsStatus(lines) {
  const t = lines.join('\n');
  if (/已签收/.test(t)) return { status: 6, statusWord: '已签收' };
  const m = /派件中|派送中|运输中|正在发往|已到达|待取件/.exec(t);
  if (m) return { status: 5, statusWord: m[0] };
  if (/已揽收|已发货/.test(t)) return { status: 4, statusWord: '已揽收' };
  return { status: 4, statusWord: '' };
}

// Номер заказа без дефиса (Taobao, Poizon): 16–20 цифр подряд. Номера платежа длиннее
// (交易编号 у Poizon — 27 цифр, 支付宝交易号 у Taobao — 28), их не берём и по подписи, и по длине.
const NOT_ORDER = /交易编号|交易号|商家信息|快递|速递|物流|运单号|电话|手机/;
export function longOrderNo(lines) {
  const runs = (l) => (fixNumbers(l).match(/\d+/g) || []).filter((d) => d.length >= 16 && d.length <= 20);
  const labeled = lines.find((l) => /订单编号|订单号|订单信息/.test(l) && runs(l).length);
  if (labeled) return runs(labeled)[0];
  // подпись и номер прочитаны в разных строках (таблица по столбцам)
  for (const l of lines) if (!NOT_ORDER.test(l) && runs(l).length) return runs(l)[0];
  return '';
}

// Сумма «¥612», «¥ 47.5», «-¥8» в строке → фэни (без знака), иначе null.
export function yuanIn(line) {
  const m = new RegExp(`[￥¥]\s*${MONEY}`).exec(String(line || ''));
  return m ? toFen(m[1]) : null;
}

// Количество «x2», «×2» отдельной строкой или в конце строки.
export function qtyIn(line) {
  const m = /(?:^|\s)[×xX✕]\s*(\d{1,4})$/.exec(String(line || '').trim());
  return m ? Number(m[1]) : null;
}

// Название без цены, «…» и хвоста после обрезки.
export const cutTitle = (s) => String(s || '').replace(/[￥¥]\s*\d+(?:[.,]\d+)?/g, '').split(/…|\.\.\./)[0].replace(/\s+/g, ' ').trim();

// Перевозчик по началу трека (когда на экране только трек, например у Poizon «SF5161…»).
const TRACK_PREFIX = [[/^SF\d/, '顺丰速运'], [/^JT\d/, '极兔速递'], [/^YT\d/, '圆通速递'], [/^JD/, '京东快递'], [/^DPK/, '德邦快递']];
export function carrierByTrack(track) {
  const hit = TRACK_PREFIX.find(([re]) => re.test(track));
  return hit ? carrierLabel(hit[1]) : '';
}

// Тот же ли это товар (когда номера заказа нет: список заказов ↔ состав посылки на экране логистики).
// Названия обрезаны «…» в разных местах — одно должно быть началом другого (не короче 6 знаков);
// варианты сравниваются без пробелов и знаков («颜色:棕色--26016 尺码:L» = «颜色:棕色--26016; 尺码:L»);
// количество должно совпасть. Это догадка — пользователь подтверждает её галочкой.
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function sameGoods(a, b) {
  const x = squash(a.nameCn);
  const y = squash(b.nameCn);
  if (Math.min(x.length, y.length) < 6 || !(x.startsWith(y) || y.startsWith(x))) return false;
  const va = squash(a.variant);
  const vb = squash(b.variant);
  if (va && vb && va !== vb) return false;
  return (a.qty || 1) === (b.qty || 1);
}
