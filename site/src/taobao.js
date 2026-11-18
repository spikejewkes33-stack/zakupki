// Снимки Taobao (淘宝) и 1688: экраны у них от одного Alibaba и почти одинаковые, поэтому разбор один
// и идёт по полям (订单编号, служба + трек, 含运费/总实付, 实付价/实付款, 包裹商品明细), а не по приложению.
// Какое это приложение — только подпись в сообщениях (app), на разбор не влияет.
// Видели (скриншоты пользователя 18.11.2026, модель текста — tests/fixtures/taobao-*.txt, предположение):
//   Taobao — экран деталей заказа (платье); 1688 — список заказов на русском и экран логистики (куртка).
// Логистику Taobao не видели: считаем, что она как у 1688 (тот же движок) — проверить на первом снимке.
// Экран заказа: магазин, название, вариант, «x1», цена, «实付价 ¥47» (сумма товара — берём её, а не 商品总价),
// 运费 (доставка по Китаю), «实付款» (всё вместе), номер заказа в строке «订单信息».
// Экран логистики: «韵达快递 4321…» (без двоеточия), «订单编号: 3316…», во всплывающем окне — состав посылки.
import { carrierLabel, logisticsStatus, longOrderNo, yuanIn, qtyIn, cutTitle } from './ocr.js';

const NOISE = /^\d{1,2}:\d{2}$|^(?:3G|4G|5G|LTE)\b|^(?:交易成功|卖家已发货|等待卖家发货|等待买家付款|交易关闭|待收货|待发货|已发货|退款成功)$/;
const ITEM_END = /实付价|极速退款|7天无理由|闲鱼转卖|加入购物车|申请售后|商品总价|备注$/;
const VARIANT = /[;；]|颜色|尺码|规格|分类|[:：]/;
// Перевозчик и трек в одной строке: «韵达快递 4321…», «中通快递：7000…». Не телефон курьера («电联快递员：…»).
const CARRIER = /((?:[一-龥]{2,8}?(?:快递|速递|快运|物流|速运|邮政|特快))|EMS)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9 ]{6,40}[A-Za-z0-9])/;

export function parseTaobao(lines, app = 'taobao') {
  const r = parseAny(lines);
  return { ...r, app, doubts: r.kind === 'unknown' ? [`снимок ${app === '1688' ? '1688' : 'Taobao/1688'}: ${r.doubts[0]}`] : r.doubts };
}
function parseAny(lines) {
  if (lines.some((l) => /总实付/.test(l))) return parseOrderList(lines);
  if (lines.some((l) => /实付价|商品总价|价格明细/.test(l))) return parseOrder(lines);
  if (lines.some((l) => CARRIER.test(l))) return parseLogistics(lines);
  return { kind: 'unknown', doubts: ['не экран заказа, не список заказов и не экран логистики'] };
}

function parseOrder(lines) {
  const doubts = [];
  const end = lines.findIndex((l) => ITEM_END.test(l));
  const block = [];
  for (let i = 0; i < (end < 0 ? lines.length : end); i++) if (!NOISE.test(lines[i])) block.push(i);
  let qty = null;
  let priceFen = null;
  const text = [];
  for (const i of block) {
    const l = lines[i];
    const q = qtyIn(l);
    if (q != null && /^[×xX✕]/.test(l.trim())) qty = q;
    else if (/^[￥¥]\s*\d/.test(l.trim())) priceFen = yuanIn(l);
    else {
      if (priceFen == null && yuanIn(l) != null) priceFen = yuanIn(l);
      text.push(i);
    }
  }
  if (qty == null) {
    qty = 1;
    doubts.push('не нашёл количество «x N», поставил 1');
  }
  const variantIdx = text.filter((i) => VARIANT.test(lines[i]) && lines[i].length <= 40);
  const named = text.filter((i) => !variantIdx.includes(i));
  // Магазин — первая строка, если строк две и больше; название — остальные.
  const shop = named.length >= 2 ? lines[named[0]].replace(/^[企>\s]+|[>\s]+$/g, '') : '';
  const titleIdx = named.length >= 2 ? named.slice(1) : named;
  const nameCn = cutTitle(titleIdx.map((i) => lines[i]).join(' '));
  if (!nameCn) doubts.push('не нашёл название');
  const variant = variantIdx.map((i) => lines[i]).join(' ');

  // Сумма товара: «实付价 ¥47» (в той же строке или следующей). Нет — «实付款» всего заказа.
  const at = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) return null;
    return yuanIn(lines[i].replace(/^.*?(?=[￥¥])/, '')) ?? yuanIn(lines[i + 1]);
  };
  let paidFen = at(/实付价/);
  const shipFen = at(/^运费/);
  if (paidFen == null) {
    paidFen = at(/实付款/);
    if (paidFen != null) doubts.push('нет «实付价» — взял «实付款» всего заказа, в нём может быть доставка');
    else doubts.push('нет суммы «实付价»');
  }
  if (shipFen) doubts.push(`доставка по Китаю ${shipFen / 100} ¥ (运费) в сумму товара не вошла`);
  if (qty > 1) doubts.push('проверьте сумму: «实付价» — за все штуки или за одну (видели только заказ на 1 шт.)');
  const orderNo = longOrderNo(lines);
  if (!orderNo) doubts.push('нет номера заказа — раскройте «订单信息» и снимите ещё раз; без него трек не привяжется');
  return { kind: 'order', orderNo, nameCn, shop, variant, qty, paidFen, priceFen, titleIdx, track: '', carrier: '', status: 1, doubts };
}

function parseLogistics(lines) {
  let carrier = '';
  let track = '';
  for (const l of lines) {
    const m = CARRIER.exec(l);
    // Трек — номер сразу после названия службы в начале строки («韵达快递 4321…»).
    // Лента событий («【某某市】… 快递员 … 电话：…») начинается иначе — оттуда ничего не берём.
    if (!m || m.index > 3 || /电话|快递员|电联|联系|客服/.test(l.slice(0, m.index + m[1].length))) continue;
    const tr = m[2].replace(/\s+/g, '').toUpperCase();
    if (tr.length < 8 || !/\d{6}/.test(tr)) continue;
    carrier = m[1];
    track = tr;
    break;
  }
  const orderNo = longOrderNo(lines);
  const doubts = [];
  if (!orderNo) doubts.push('нет номера заказа — привяжу по треку, если он уже есть в карточке');
  return { kind: 'logistics', carrier: carrier ? carrierLabel(carrier) : '', track, orderNo, goods: packageGoods(lines), ...logisticsStatus(lines), doubts };
}

// Состав посылки во всплывающем окне «包裹商品明细»: название, вариант, «x2». Нужен, когда номера заказа
// в приложении нет (товар пришёл со списка заказов) — тогда трек предлагается по названию, с подтверждением.
function packageGoods(lines) {
  const from = lines.findIndex((l) => /包裹商品明细/.test(l));
  if (from < 0) return [];
  const goods = [];
  for (const l of lines.slice(from + 1)) {
    if (/^关闭$|^Закрыть$/.test(l)) break;
    const q = qtyIn(l);
    const cur = goods[goods.length - 1];
    if (q != null && /^[×xX✕]/.test(l.trim())) {
      if (cur) cur.qty = q;
    } else if (cur && !cur.variant && VARIANT.test(l)) cur.variant = l.trim();
    else goods.push({ nameCn: cutTitle(l), variant: '', qty: 1 });
  }
  return goods.filter((g) => g.nameCn);
}

// Список заказов (вкладки «待收货 / Доставка» и т. п.): несколько заказов на одном снимке, номера заказа нет.
// Интерфейс бывает китайский или русский (снимок 18.11: кнопки по-русски, итоги по-китайски).
// Карточка заказа кончается строкой «含运费¥5.00 总实付 ¥457.77»: 总实付 — итог с доставкой,
// сумма товара = итог − доставка; «¥228.00» — цена за штуку, «×2» — количество.
// Такой список на русском видели у 1688 (18.11); у Taobao, вероятно, такой же.
const LIST_NOISE = /^\d{1,2}:\d{2}$|^(?:3G|4G|5G|LTE)\b|搜索我的订单|正在加载|Ожидает отправки|Возврат\/обмен|^(?:Доставка|Отправлено|Ожидает|待收货|待发货|已发货|卖家已发货|交易成功|待付款|退款中)$|Возврат товара|退货包运费|运费险|^Больше$|^更多$|Проверить|Повтор|Подтверд|получе|查看物流|再买一单|确认收货|延长收货|加入购物车|评价/;
const SHOP_LINE = /[>〉]\s*$|店铺?$|旗舰|专营|商行|工厂|Shop|Store/i;
function parseOrderList(lines) {
  const cards = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/总实付/.test(lines[i])) continue;
    // итог в той же строке или следующей
    let end = i;
    if (yuanIn(lines[i].replace(/^.*总实付/, '')) == null && yuanIn(lines[i + 1]) != null) end = i + 1;
    cards.push(listCard(lines, start, i, end));
    start = end + 1;
    i = end;
  }
  const items = cards.filter((c) => c.nameCn || c.paidFen != null);
  if (!items.length) return { kind: 'unknown', doubts: ['список заказов, но ни одного товара не разобрал'] };
  return { kind: 'orderList', items, doubts: [] };
}
function listCard(lines, from, totalAt, end) {
  const idx = [];
  for (let i = from; i < totalAt; i++) if (!LIST_NOISE.test(lines[i])) idx.push(i);
  let priceFen = null;
  let qty = null;
  const text = [];
  for (const i of idx) {
    const l = lines[i].trim();
    const q = qtyIn(l);
    if (q != null) {
      qty = q;
      const rest = l.replace(/\s*[×xX✕]\s*\d{1,4}$/, '');
      if (rest && !/^[￥¥]/.test(rest)) text.push({ i, t: rest });
      else if (rest) priceFen = priceFen ?? yuanIn(rest);
    } else if (/^[￥¥]\s*\d/.test(l)) priceFen = priceFen ?? yuanIn(l);
    else {
      if (priceFen == null && yuanIn(l) != null) priceFen = yuanIn(l);
      text.push({ i, t: l });
    }
  }
  const shopAt = text.findIndex((x) => SHOP_LINE.test(x.t));
  const shop = shopAt >= 0 ? text[shopAt].t.replace(/[>〉\s]+$/, '') : '';
  const rest = text.filter((_, k) => k !== shopAt);
  const variantAt = rest.findIndex((x, k) => k > 0 && VARIANT.test(x.t));
  const title = rest.find((_, k) => k !== variantAt);
  const variant = variantAt >= 0 ? rest[variantAt].t : '';
  const totalLine = lines.slice(totalAt, end + 1).join(' ');
  const shipM = /含运费\s*[￥¥]?\s*(\d+(?:[.,]\d{1,2})?)/.exec(totalLine);
  const shipFen = shipM ? yuanIn(`¥${shipM[1]}`) : null;
  const totalFen = yuanIn(totalLine.replace(/^.*总实付/, ''));
  const doubts = [];
  if (qty == null) {
    qty = 1;
    doubts.push('не нашёл количество «×N», поставил 1');
  }
  let paidFen = totalFen != null ? totalFen - (shipFen || 0) : null;
  if (paidFen == null) doubts.push('нет итога «总实付»');
  if (shipFen) doubts.push(`доставка по Китаю ${shipFen / 100} ¥ (含运费) в сумму товара не вошла`);
  const nameCn = title ? cutTitle(title.t) : '';
  // Название уже по-русски — это машинный перевод приложения («Готовая к отправке партия:»), в опись не годится.
  const machineRu = /[а-яё]/i.test(nameCn);
  if (machineRu) doubts.push('название — машинный перевод приложения, впишите своё');
  doubts.push('со списка заказов номера заказа нет — трек привяжется по названию, с вашим подтверждением');
  if (paidFen != null && paidFen < 0) paidFen = null;
  return { nameCn, machineRu, shop, variant, qty, paidFen, priceFen, shipFen, totalFen, titleIdx: title ? [title.i] : [], doubts };
}
