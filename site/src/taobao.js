// Снимки Taobao (淘宝): экран заказа (交易成功 и т. п.) и экран логистики.
// Сделано по трём скриншотам пользователя 18.11.2026 (модель текста — tests/fixtures/taobao-*.txt).
// Экран заказа: магазин, название, вариант, «x1», цена, «实付价 ¥47» (сумма товара — берём её, а не 商品总价),
// 运费 (доставка по Китаю), «实付款» (всё вместе), номер заказа в строке «订单信息».
// Экран логистики: «韵达快递 4321…» (без двоеточия), «订单编号: 3316…», во всплывающем окне — состав посылки.
import { carrierLabel, logisticsStatus, longOrderNo, yuanIn, qtyIn, cutTitle } from './ocr.js';

const NOISE = /^\d{1,2}:\d{2}$|^(?:3G|4G|5G|LTE)\b|^(?:交易成功|卖家已发货|等待卖家发货|等待买家付款|交易关闭|待收货|待发货|已发货|退款成功)$/;
const ITEM_END = /实付价|极速退款|7天无理由|闲鱼转卖|加入购物车|申请售后|商品总价|备注$/;
const VARIANT = /[;；]|颜色|尺码|规格|分类|[:：]/;
// Перевозчик и трек в одной строке: «韵达快递 4321…», «中通快递：7000…». Не телефон курьера («电联快递员：…»).
const CARRIER = /((?:[一-龥]{2,8}?(?:快递|速递|快运|物流|速运|邮政|特快))|EMS)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9 ]{6,40}[A-Za-z0-9])/;

export function parseTaobao(lines) {
  if (lines.some((l) => /实付价|商品总价|价格明细/.test(l))) return parseOrder(lines);
  if (lines.some((l) => CARRIER.test(l))) return parseLogistics(lines);
  return { kind: 'unknown', app: 'taobao', doubts: ['снимок Taobao, но не экран заказа и не экран логистики'] };
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
  return { kind: 'order', app: 'taobao', orderNo, nameCn, shop, variant, qty, paidFen, priceFen, titleIdx, track: '', carrier: '', status: 1, doubts };
}

function parseLogistics(lines) {
  let carrier = '';
  let track = '';
  for (const l of lines) {
    const m = CARRIER.exec(l);
    if (!m || /电话|快递员|电联|联系|客服/.test(l.slice(0, m.index + m[1].length))) continue;
    const tr = m[2].replace(/\s+/g, '').toUpperCase();
    if (tr.length < 8 || !/\d{6}/.test(tr)) continue;
    carrier = m[1];
    track = tr;
    break;
  }
  const orderNo = longOrderNo(lines);
  const doubts = [];
  if (!orderNo) doubts.push('нет номера заказа — привяжу по треку, если он уже есть в карточке');
  return { kind: 'logistics', app: 'taobao', carrier: carrier ? carrierLabel(carrier) : '', track, orderNo, ...logisticsStatus(lines), doubts };
}
