// Разбор файла «Команды» iPhone: каждое нажатие Кнопки действия дописывает блок
//   ===PDD===
//   <дата и время нажатия>
//   <текст, распознанный со скриншота PDD>
// Экран заказа (订单详情) → карточка товара; экран логистики (查看物流) → трек к карточке по номеру заказа.
// Ничего не додумывается: что не распознано — показывается пользователю.
import { clientForTime } from './order.js';
import { ruName, nameFromTranslation } from './names.js';
import { detectShop, PARSERS } from './shops.js';
import { fixNumbers, carrierLabel, toFen, MONEY, logisticsStatus, sameGoods, qtyIsPrice, guardQty } from './ocr.js';

export { carrierLabel };

export const BLOCK_MARK = '===PDD===';

// Короткий устойчивый отпечаток блока (FNV-1a): повторный «Забрать» того же файла узнаёт уже разобранное.
export function blockId(time, text) {
  let h = 0x811c9dc5;
  const s = `${time || ''}\n${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `b${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}

// Дата нажатия: ISO 8601 из «Форматировать дату» или «17.11.2026, 14:05:33».
export function parseTime(line) {
  const s = String(line || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).toISOString();
  return null;
}

// Метка ищется в любом месте строки: если в «Команде» выключили «Новую строку», блоки не слипаются.
// Время нажатия (ISO 8601 из «Форматировать дату») тоже начинает новый блок: если строку ===PDD===
// забыли вписать в «Команду» (так было у пользователя 17.11), снимки всё равно разделятся.
const ISO_STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g;
export function splitBlocks(fileText) {
  const marked = String(fileText || '').replace(/\r\n?/g, '\n').replace(ISO_STAMP, (m) => `\n${BLOCK_MARK}\n${m}\n`);
  const parts = marked.split(BLOCK_MARK).slice(1);
  return parts.map((part) => {
    const raw = part.split('\n');
    let i = 0;
    while (i < raw.length && !raw[i].trim()) i++;
    const time = parseTime(raw[i]);
    let body = (time ? raw.slice(i + 1) : raw.slice(i)).map((l) => l.trim()).filter(Boolean);
    // Уменьшенный снимок экрана от «Команды»: строка «IMG:» и Base64 (может быть разбит на строки).
    let image = '';
    const at = body.findIndex((l) => /^IMG:/i.test(l));
    if (at >= 0) {
      image = body.slice(at).join('').replace(/^IMG:/i, '').replace(/[^A-Za-z0-9+/=]/g, '');
      body = body.slice(0, at);
    }
    // Перевод экрана от «Перевести текст» (Apple, без интернета): строка «RU:» и дальше до «IMG:».
    let ru = [];
    const ri = body.findIndex((l) => /^RU:/i.test(l));
    if (ri >= 0) {
      ru = body.slice(ri).map((l, k) => (k === 0 ? l.replace(/^RU:\s*/i, '') : l)).filter(Boolean);
      body = body.slice(0, ri);
    }
    const text = body.join('\n');
    return { id: blockId(time, text), time, lines: body, text, image, ru };
  }).filter((b) => b.lines.length);
}

// Что за текст выбрали или вставили: понятные сообщения вместо «ничего не произошло».
//  'blocks'   — есть снимки «Команды» (===PDD===);
//  'nomarker' — текст снимка PDD без метки: «Команда» пробная или в «Тексте» нет строки ===PDD===;
//  'empty'    — пусто; 'foreign' — не похоже на снимки PDD.
export function diagnoseText(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  ISO_STAMP.lastIndex = 0;
  if (t.includes(BLOCK_MARK) || ISO_STAMP.test(t)) return splitBlocks(t).length ? 'blocks' : 'empty';
  if (/实付|订单|快递|速递|物流|[一-龥]{4,}/.test(t)) return 'nomarker';
  return 'foreign';
}
// Текст без метки разбираем как один снимок (время нажатия неизвестно — клиента выберет пользователь).
export const asSingleBlock = (text) => `${BLOCK_MARK}\n${String(text || '').trim()}\n`;

// ——— Шаблоны ———
const ORDER_NO = /(\d{6}-\d{10,20})/;
const PRICE_LINE = /^(?:券后|到手价|大促价)?\s*[￥¥]\s*\d+(?:[.,]\s?\d{1,2})?$/;
// «×3», «x3», «×l» (буква l вместо 1); бывает в одной строке с ценой: «￥19.9 ×3».
const QTY_ANY = /(?:^|\s)[×xX✕*]\s*([\dlI|]{1,4})$/;
const qtyOf = (line) => {
  const m = QTY_ANY.exec(line);
  return m ? Number(m[1].replace(/[lI|]/g, '1')) || 1 : null;
};
const isQtyLine = (l) => qtyOf(l) != null && /^(?:[￥¥]\s*[\d.,\s]+)?\s*[×xX✕*]/.test(l);
const STOP_BEFORE = /展开|号码保护|收货地址|签收|送达|快件|\d{3}\*{3,4}\d{4}|^\d{1,2}:\d{2}|^LTE|^5G|^4G|[省市区县镇村路街道].{0,12}(?:…|\.\.)$/;
const END_ITEM = /7天无理由|分享商品|联系商家|申请退款|退货包运费|极速退款|假一赔|晚发必赔|退款/;
const SHOP_HINT = /店$|旗舰|专营|官方|工厂|商行|百货|超市|小铺|好物|批发|自营/;
const CARRIER = /((?:[一-龥]{2,8}?(?:快递|速递|快运|物流|速运|邮政|特快))|EMS)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9 ]{6,40}[A-Za-z0-9])/;


function findOrderNo(lines) {
  const fixed = lines.map(fixNumbers);
  let no = '';
  for (const l of fixed) if (/订单(?:编)?号/.test(l) && ORDER_NO.test(l)) { no = ORDER_NO.exec(l)[1]; break; }
  if (!no) for (const l of fixed) if (ORDER_NO.test(l)) { no = ORDER_NO.exec(l)[1]; break; }
  return no;
}
// Номер заказа PDD: 6 цифр даты, дефис, 15 цифр. Другая длина — вероятно, распознано с ошибкой.
const orderNoDoubt = (no) => (no && !/^\d{6}-\d{15}$/.test(no) ? `номер заказа ${no} необычной длины — сверьте` : '');


// Подписи таблицы на экране заказа: если после «已购规格» сразу идёт такая подпись — значения в этой строке нет.
const TABLE_LABEL = /^(?:该规格|已购|合计|店铺|商品|实付|共优惠|订单|支付|物流公司|快递单号|下单|拼单|发货|关联|优惠|运费)/;

// «Метка：значение» в одной строке или значение следующей строкой (Live Text читает таблицу по-разному).
function labelValue(lines, label) {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return '';
  const same = lines[i].replace(label, '').replace(/^[\s:：]+/, '').replace(/[|｜].*$/, '').trim();
  if (same) return same;
  const next = (lines[i + 1] || '').replace(/[|｜].*$/, '').trim();
  if (/[:：]/.test(next) || TABLE_LABEL.test(next)) return '';
  return next;
}

// Название без «展开», имени магазина, цены и «…» (Live Text склеивает их с названием).
function cleanTitle(t) {
  let s = String(t || '').replace(/\s+/g, '');
  s = s.replace(/^.*?展[开升][（(〈<"“]*/, '');
  s = s.replace(/^.{0,24}?(?:潜力好店|品牌好店|旗舰店|专营店|官方店|专卖店|好店|小店|店铺)[>〉》]?/, '');
  s = s.replace(/官方旗舰|双?11\.11|双十一|秒杀|爆款|网红|同款|包邮|正品|新款|20\d\d款?/g, '');
  s = s.replace(/[*¥￥]\d+(?:\.\d+)?/g, '').replace(/[×xX✕]\d{1,3}/g, '');
  s = s.split(/…|\.\.\./)[0];
  return s.trim();
}

// Экран заказа: название, вариант, 实付, ×N, номер заказа.
export function parseOrder(lines) {
  const doubts = [];
  const orderNo = findOrderNo(lines);
  const paidIdx = lines.findIndex((l) => /实付/.test(l));
  let paidFen = null;
  if (paidIdx >= 0) {
    const m = new RegExp(`实付[^\\d￥¥]{0,6}[￥¥]?\\s*${MONEY}`).exec(lines[paidIdx])
      || new RegExp(`^[￥¥]?\\s*${MONEY}`).exec(lines[paidIdx + 1] || '')
      || new RegExp(`^[￥¥]\\s*${MONEY}$`).exec(lines[paidIdx - 1] || '');
    if (m) paidFen = toFen(m[1]);
  }
  if (paidFen == null) doubts.push('нет суммы «实付»');
  const limit = paidIdx >= 0 ? paidIdx : lines.length;

  // Количество «×N» до строки 实付; цена «¥28.9» рядом с ним — цена до скидки, её не берём.
  // «X59» / «×59», где 59 ¥ — сумма заказа, это цена «¥59», прочитанная Live Text как «X»: не количество.
  const qtyIdx = [];
  let misreadPrice = null;
  for (let i = 0; i < limit; i++) {
    if (!isQtyLine(lines[i])) continue;
    if (qtyIsPrice(qtyOf(lines[i]), paidFen)) misreadPrice = i;
    else qtyIdx.push(i);
  }
  const qi = qtyIdx.length ? qtyIdx[qtyIdx.length - 1] : -1;
  let qty = 1;
  if (qi >= 0) qty = qtyOf(lines[qi]);
  else doubts.push('не нашёл количество «×N», поставил 1');
  if (qtyIdx.length > 1) doubts.push('похоже, в заказе несколько товаров — проверьте название, количество и сумму');

  let pi = misreadPrice ?? -1;
  const anchor = qi >= 0 ? qi : limit;
  for (let i = anchor; i >= Math.max(0, anchor - 4); i--) if (PRICE_LINE.test(lines[i]) || (i === qi && /[￥¥]/.test(lines[i]))) { pi = i; break; }
  let priceFen = null;
  if (pi >= 0) {
    const m = new RegExp(`[￥¥]\\s*${MONEY}`).exec(lines[pi]);
    if (m) priceFen = toFen(m[1]);
    else if (pi === misreadPrice) priceFen = qtyOf(lines[pi]) * 100;
  }
  // Сверка: оплачено не больше цены × количество и не меньше её десятой части (скидки бывают, но не в 10 раз).
  if (paidFen != null && priceFen) {
    const full = priceFen * qty;
    if (paidFen > full * 1.05 || paidFen < full / 10) doubts.push(`оплачено ${paidFen / 100} ¥ при цене ${priceFen / 100} ¥ × ${qty} — проверьте сумму`);
  }

  // Начало блока товара: после строки адреса/доставки («展开», телефон со звёздочками).
  const from = pi >= 0 ? Math.min(pi, anchor) : anchor;
  let start = 0;
  // «展开（магазин название…» в одной строке (Live Text склеил): строку берём, лишнее срежет cleanTitle.
  let glued = false;
  for (let i = from - 1; i >= 0; i--) {
    if (!STOP_BEFORE.test(lines[i])) continue;
    glued = /展开.{4,}/.test(lines[i]);
    start = glued ? i : i + 1;
    break;
  }
  const headIdx = [];
  for (let i = start; i < anchor; i++) if (!PRICE_LINE.test(lines[i]) && !isQtyLine(lines[i]) && !END_ITEM.test(lines[i])) headIdx.push(i);
  const head = headIdx.map((i) => lines[i]);
  let shop = '';
  let titleLines = head;
  let titleIdx = headIdx;
  if (!glued && (head.length >= 3 || (head.length === 2 && SHOP_HINT.test(head[0])))) {
    shop = head[0];
    titleLines = head.slice(1);
    titleIdx = headIdx.slice(1);
  }
  const nameCn = cleanTitle(titleLines.join(''));
  if (!nameCn) doubts.push('не нашёл название');

  // Вариант: строки после «×N» до «7天无理由…».
  let variant = '';
  if (qi >= 0) {
    const out = [];
    for (let i = qi + 1; i < limit && out.length < 3; i++) {
      if (END_ITEM.test(lines[i]) || /^共优惠|^实付|^商品总价|^运费/.test(lines[i])) break;
      if (!PRICE_LINE.test(lines[i])) out.push(lines[i]);
    }
    variant = out.join(' ');
  }
  const spec = labelValue(lines, /^已购规格/);
  if (spec) variant = spec;
  // «已购数量» — само поле количества заказа: главнее «×N» (тот бывает ценой, прочитанной как «X»).
  let qtySure = false;
  const bought = labelValue(lines, /^已购数量/);
  if (/^\d{1,4}$/.test(bought) && Number(bought) > 0) {
    if (qi >= 0 && Number(bought) !== qty) doubts.push(`на снимке «×${qty}» и «已购数量 ${bought}» — взял ${bought}, проверьте количество`);
    qty = Number(bought);
    qtySure = true;
    const k = doubts.indexOf('не нашёл количество «×N», поставил 1');
    if (k >= 0) doubts.splice(k, 1);
  }
  // Когда продавец уже отправил, на экране заказа есть «物流公司» и «快递单号» — трек сразу.
  const carrierCn = (labelValue(lines, /^物流公司/).match(/[\u4e00-\u9fa5A-Za-z]{2,12}/) || [''])[0];
  const trackRaw = labelValue(lines, /^(?:快递单号|运单号|物流单号)/);
  const track = ((trackRaw.match(/[A-Za-z0-9][A-Za-z0-9 ]{6,40}[A-Za-z0-9]/) || [''])[0]).replace(/\s+/g, '').toUpperCase();
  if (!orderNo) doubts.push('нет номера заказа (订单号) — прокрутите экран, чтобы он был виден, и снимите ещё раз; без него трек не привяжется');
  const nd = orderNoDoubt(orderNo);
  if (nd) doubts.push(nd);
  const st = track ? logisticsStatus(lines) : { status: 1, statusWord: '' };
  return { kind: 'order', orderNo, nameCn, shop, variant, qty, qtySure, paidFen, priceFen, titleIdx, track: track.length >= 8 ? track : '',
    carrier: carrierCn ? carrierLabel(carrierCn) : '', status: track ? Math.max(4, st.status) : 1, doubts };
}


// Экран логистики: перевозчик и трек («韵达快递：4658…»), номер заказа («订单编号：…»).
// Не трек: телефон курьера («快递员：…», «联系快递：138…», «电话»).
export function parseLogistics(lines) {
  let carrier = '';
  let track = '';
  for (const l of lines) {
    const m = CARRIER.exec(l);
    if (!m || /电话|快递员|联系|客服/.test(l.slice(0, m.index + m[1].length))) continue;
    const tr = m[2].replace(/\s+/g, '').toUpperCase();
    if (tr.length < 8) continue;
    carrier = m[1];
    track = tr;
    break;
  }
  if (!track) {
    const c = lines.find((l) => /^物流公司[:：]/.test(l));
    const n = lines.find((l) => /^(?:物流|运)单号[:：]/.test(l));
    if (n) {
      track = ((/[:：]\s*([A-Za-z0-9][A-Za-z0-9 ]{6,40}[A-Za-z0-9])/.exec(n) || [])[1] || '').replace(/\s+/g, '').toUpperCase();
      carrier = c ? c.replace(/^物流公司[:：]\s*/, '') : '';
    }
  }
  const orderNo = findOrderNo(lines);
  const doubts = [];
  if (!orderNo) doubts.push('нет номера заказа — привяжу по треку, если он уже есть в карточке');
  const nd = orderNoDoubt(orderNo);
  if (nd) doubts.push(nd);
  return { kind: 'logistics', carrier: carrier ? carrierLabel(carrier) : '', track, orderNo, ...logisticsStatus(lines), doubts };
}

export function classify(lines) {
  const t = lines.join('\n');
  // Экран заказа узнаём по «实付»: даже если на нём мелькнёт строка перевозчика, это заказ.
  if (/实付|订单号.*\n?[\s\S]*已购数量/.test(t)) return parseOrder(lines);
  const hasTrack = lines.some((l) => CARRIER.test(l)) || /物流单号[:：]/.test(t);
  if (hasTrack) return parseLogistics(lines);
  if (/订单号/.test(t) && lines.some(isQtyLine)) return parseOrder(lines);
  return { kind: 'unknown', doubts: ['не похоже ни на экран заказа, ни на экран логистики — возможно, снимок попал на переход между экранами'] };
}

// Снимок любого приложения: PDD разбирается как раньше, 1688 / Poizon / Taobao — своим разборщиком (shops.js).
export function classifyAny(lines) {
  // Чат с продавцом («请确认收货地址», «你可能想咨询该订单») — не заказ: цены там другие, пропускаем.
  if (lines.some((l) => /请确认收货地址|你可能想咨询/.test(l))) return { kind: 'unknown', app: '', doubts: ['это снимок чата с продавцом, не заказа — пропускаю'] };
  const shop = detectShop(lines);
  const r = shop !== 'pdd' ? PARSERS[shop](lines) : { ...classify(lines), app: shop };
  // Страховка для всех магазинов: количество, равное сумме в юанях, — это цена.
  if (r.kind === 'orderList') return { ...r, items: r.items.map(guardQty) };
  return r.kind === 'order' ? guardQty(r) : r;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

// План: что добавить, что обновить, что не понято. Чистая функция — проверяется тестами.
// ctx: { items, purchases (Map), activePurchaseId, importedIds (Set), pending (массив треков без карточки), translations }
export function buildPlan(blocks, ctx) {
  const plan = { newItems: [], updates: [], tracks: [], pending: [], unknown: [], skipped: 0 };
  const live = ctx.items.filter((x) => !x.deleted);
  const byOrder = (no) => live.find((x) => no && norm(x.pddOrderNo) === norm(no));
  const byTrack = (tr) => live.filter((x) => tr && norm(x.track) === norm(tr));
  const open = [...ctx.purchases.values()].filter((p) => !p.archived && !p.deleted);
  const seenBlocks = new Set();

  // Клиент по времени нажатия. Если время попало в сессии нескольких закупок (в старой забыли «Завершить»),
  // главнее активная закупка, затем — сессия, начатая позже.
  const whereAndWho = (time) => {
    const hits = [];
    for (const p of open) {
      const c = time ? clientForTime(p.sessions, time) : null;
      if (c) {
        const s = [...(p.sessions || [])].reverse().find((x) => x.clientId === c && Date.parse(x.startedAt) <= Date.parse(time));
        hits.push({ purchaseId: p.id, clientId: c, by: 'time', start: s ? Date.parse(s.startedAt) : 0, active: p.id === ctx.activePurchaseId });
      }
    }
    hits.sort((a, b) => b.active - a.active || b.start - a.start);
    if (hits.length) return { ...hits[0], doubt: hits.length > 1 ? 'время подходит к нескольким закупкам — проверьте клиента' : '' };
    return { purchaseId: ctx.activePurchaseId || open[0]?.id || null, clientId: null, by: 'none', doubt: '' };
  };

  const parsed = [];
  for (const b of blocks) {
    if (ctx.importedIds.has(b.id) || seenBlocks.has(b.id)) {
      plan.skipped += 1;
      continue;
    }
    seenBlocks.add(b.id);
    const r = classifyAny(b.lines);
    // Список заказов: каждый товар — как отдельный заказ без номера (ключ карточки — блок + номер товара).
    if (r.kind === 'orderList') r.items.forEach((x, k) => parsed.push({ block: b, key: `${b.id}:${k}`, r: { kind: 'order', fromList: true, orderNo: '', track: '', carrier: '', status: 1, ...x } }));
    else parsed.push({ block: b, key: b.id, r });
  }

  // 1. Экраны заказа → новые карточки или дополнение существующих.
  for (const { block, key, r } of parsed) {
    if (r.kind !== 'order') continue;
    if (!r.orderNo && !r.nameCn) {
      plan.unknown.push({ blockId: block.id, time: block.time, preview: block.lines.slice(0, 6), doubts: r.doubts });
      continue;
    }
    const remembered = ctx.translations?.[r.nameCn] || '';
    const fromDict = remembered ? '' : ruName(r.nameCn, r.variant);
    // Название уже по-русски от самого приложения (машинный перевод) — переводить нечего, пусть впишут.
    const fromMt = remembered || fromDict || r.machineRu ? '' : nameFromTranslation(block.ru, block.lines.length, r.titleIdx);
    const ru = remembered || fromDict || fromMt;
    // Товар со списка заказов (без номера), похожий на уже забранный (тот же товар, вариант и количество):
    // скорее всего, тот же список сняли ещё раз. Показываем без галочки — вдруг это второй такой же заказ.
    // Внутри одного снимка одинаковые карточки — разные заказы, их не трогаем.
    const seenGoods = r.fromList && (live.some((x) => !x.pddOrderNo && sameGoods(x, r))
      || plan.newItems.some((n) => n.blockId !== block.id && !n.pddOrderNo && sameGoods(n, r)));
    const exist = byOrder(r.orderNo);
    if (exist) {
      // Карточка уже есть (сделана вручную или прошлым снимком) — дополняем только пустые поля.
      const patch = {};
      if (!exist.nameCn && r.nameCn) patch.nameCn = r.nameCn;
      if (!exist.name && ru) patch.name = ru;
      if (!exist.variant && r.variant) patch.variant = r.variant;
      if (exist.paidFen == null && exist.unitFen == null && r.paidFen != null) patch.paidFen = r.paidFen;
      if (r.track && norm(exist.track) !== norm(r.track) && !exist.track) patch.track = r.track;
      if (r.track && !exist.carrier && r.carrier) patch.carrier = r.carrier;
      if (r.track && (exist.status || 1) < r.status) patch.status = r.status;
      const wantPhoto = !exist.photoId && !!block.image;
      plan.updates.push({ blockId: block.id, itemId: exist.id, patch, image: wantPhoto ? block.image : '', what: Object.keys(patch).length || wantPhoto ? 'дополню карточку' : 'уже есть' });
      continue;
    }
    // Без номера заказа дубль узнаём по тому же названию и сумме с разницей во времени до 2 минут (двойное нажатие).
    const near = (n) => n.blockId !== block.id && !r.orderNo && !n.pddOrderNo && n.nameCn === r.nameCn && n.paidFen === r.paidFen
      && Math.abs(Date.parse(n.time || 0) - Date.parse(block.time || 0)) <= 120000;
    const dup = plan.newItems.find((n) => (r.orderNo && n.pddOrderNo === r.orderNo) || near(n));
    if (dup) {
      dup.extraBlocks = [...(dup.extraBlocks || []), block.id];
      // второй снимок того же заказа — запасной для фото (если на первом фото не нашлось)
      if (block.image) dup.moreImages = [...(dup.moreImages || []), block.image];
      if (!dup.image && block.image) dup.image = block.image;
      plan.skipped += 1;
      continue;
    }
    const w = whereAndWho(block.time);
    plan.newItems.push({
      key, blockId: block.id, time: block.time, purchaseId: w.purchaseId, clientId: w.clientId, clientBy: w.by,
      nameCn: r.nameCn, name: ru, nameAuto: !remembered && !!ru, nameFrom: remembered ? 'memory' : fromDict ? 'dict' : fromMt ? 'mt' : '', variant: r.variant, shop: r.shop,
      qty: r.qty, paidFen: r.paidFen, pddOrderNo: r.orderNo, doubts: w.doubt ? [...r.doubts, w.doubt] : r.doubts,
      track: r.track || '', carrier: r.carrier || '', status: r.status || 1, image: block.image || '',
      ...(seenGoods ? { skip: true } : {}),
    });
    if (seenGoods) plan.newItems[plan.newItems.length - 1].doubts = ['похоже, этот товар уже забирали со списка заказов — не добавляю; поставьте галочку «Добавить», если это другой заказ', ...plan.newItems[plan.newItems.length - 1].doubts];
  }

  // 2. Экраны логистики → трек к карточке (новой из этого же файла или существующей), иначе — ждать карточку.
  const attach = (t) => {
    const n = plan.newItems.find((x) => t.orderNo && x.pddOrderNo === t.orderNo);
    if (n) {
      Object.assign(n, { track: t.track, carrier: t.carrier, status: Math.max(n.status, t.status), extraBlocks: [...(n.extraBlocks || []), t.blockId] });
      return { newKey: n.key };
    }
    if (t.orderNo && byOrder(t.orderNo)) return attachExisting(t);
    // Номер заказа не совпал ни с одной карточкой, но на экране логистики есть состав посылки:
    // ищем товар без номера заказа и без трека (со списка заказов) по названию, варианту и количеству.
    // Только предложение: трек запишется, если пользователь поставит галочку.
    const g = t.goods?.length === 1 ? t.goods[0] : null;
    if (g) {
      const nn = plan.newItems.filter((x) => !x.pddOrderNo && !x.track && !x.trackGuess && sameGoods(x, g));
      if (nn.length === 1) {
        nn[0].trackGuess = { ...t };
        return { newKey: nn[0].key, guess: true };
      }
      const ex = live.filter((x) => !x.pddOrderNo && !x.track && sameGoods(x, g));
      if (ex.length === 1 && !plan.tracks.some((x) => x.itemId === ex[0].id)) {
        const patch = { track: t.track };
        if (t.carrier) patch.carrier = t.carrier;
        if ((ex[0].status || 1) < t.status) patch.status = t.status;
        if (t.orderNo) patch.pddOrderNo = t.orderNo;
        plan.tracks.push({ ...t, itemId: ex[0].id, patch, replaces: '', byName: true, skip: true });
        return { trackBlockId: t.blockId };
      }
    }
    return t.orderNo ? null : attachExisting(t);
  };
  const attachExisting = (t) => {
    // Без номера заказа (страница «поделиться») — по треку: все товары этой посылки.
    if (!t.orderNo) {
      const all = byTrack(t.track);
      for (const ex of all) {
        const patch = {};
        if (!ex.carrier && t.carrier) patch.carrier = t.carrier;
        if ((ex.status || 1) < t.status) patch.status = t.status;
        plan.tracks.push({ ...t, itemId: ex.id, patch, replaces: '' });
      }
      return all.length ? { trackBlockId: t.blockId } : null;
    }
    const ex = byOrder(t.orderNo);
    if (ex) {
      const patch = {};
      const replaces = ex.track && norm(ex.track) !== norm(t.track) ? ex.track : '';
      if (norm(ex.track) !== norm(t.track)) patch.track = t.track;
      if (!ex.carrier && t.carrier) patch.carrier = t.carrier;
      if ((ex.status || 1) < t.status) patch.status = t.status;
      // Заказ пришёл второй посылкой: в карточке один трек (ТЗ), прежний не теряем — пишем в заметку.
      if (replaces) patch.note = `${ex.note ? `${ex.note}\n` : ''}Прежний трек: ${ex.track}${ex.carrier ? ` (${ex.carrier})` : ''}`;
      plan.tracks.push({ ...t, itemId: ex.id, patch, replaces });
      return { trackBlockId: t.blockId };
    }
    return null;
  };
  for (const { block, r } of parsed) {
    if (r.kind === 'unknown') {
      plan.unknown.push({ blockId: block.id, time: block.time, preview: block.lines.slice(0, 6), doubts: r.doubts });
      continue;
    }
    if (r.kind !== 'logistics') continue;
    if (!r.track) {
      plan.unknown.push({ blockId: block.id, time: block.time, preview: block.lines.slice(0, 6), doubts: ['экран логистики без трека'] });
      continue;
    }
    const t = { blockId: block.id, time: block.time, orderNo: r.orderNo, track: r.track, carrier: r.carrier, status: r.status, statusWord: r.statusWord, ...(r.goods?.length ? { goods: r.goods } : {}) };
    if (!attach(t)) plan.pending.push(t);
  }
  // 3. Треки, ждавшие карточку с прошлых раз.
  plan.pendingResolved = [];
  for (const t of ctx.pending || []) {
    if (plan.pending.some((x) => x.orderNo === t.orderNo && x.track === t.track)) continue;
    const via = attach(t);
    if (via) plan.pendingResolved.push({ ...t, via });
  }
  return plan;
}

// Цена из 实付: за единицу = сумма / количество (может быть дробной в фэнях — храним сумму целиком).
export function unitFromPaid(paidFen, qty) {
  if (paidFen == null) return null;
  return Math.round(paidFen / (qty || 1));
}
