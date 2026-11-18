// Из какого приложения снимок: PDD, 1688, Poizon (得物) или Taobao (淘宝/天猫).
// Путь у всех один: Кнопка действия → снимок → текст в файл «Команды» → «Забрать».
// Taobao и Poizon разбираются по скриншотам пользователя 18.11.2026 (модель текста — tests/fixtures/).
// 1688 — заготовка: образцов ещё нет, вид экранов не додумываем.
import { parseTaobao } from './taobao.js';
import { parsePoizon } from './poizon.js';

export const SHOPS = {
  pdd: { name: 'PDD' },
  '1688': { name: '1688' },
  poizon: { name: 'Poizon (得物)' },
  taobao: { name: 'Taobao' },
};

// Приметы приложений в тексте снимка. Проверено на образцах PDD (все узнаются как PDD)
// и на одном-двух снимках Taobao и Poizon; остальное — предположение.
const BRAND = [
  // «1688» отдельным числом, не часть цены и не часть длинного номера
  ['1688', /(?<![\d￥¥.,])1688(?![\d.,])|阿里巴巴|alibaba/i],
  // Poizon: название в строке состояния («得物App»), «交易编号» вместе с «快递单号», «认证直发», «买贵补偿»
  ['poizon', /得物|poizon|dewu|认证直发|买贵补偿|交易编号[\s\S]*快递单号|快递单号[\s\S]*交易编号/i],
  // Taobao: «支付宝交易号», «闲鱼转卖», «实付价», «价格明细», «包裹商品明细», «查看更多包裹»
  ['taobao', /淘宝|天猫|taobao|tmall|支付宝交易号|闲鱼转卖|实付价|价格明细|包裹商品明细|查看更多包裹/i],
];

// Номер заказа PDD: 6 цифр даты, дефис, длинный хвост. Есть он — это точно PDD, даже если рядом
// в ленте рекомендаций мелькнуло «天猫» или «1688».
const PDD_ORDER = /\d{6}\s*[-—–]\s*\d{10,20}/;

export function detectShop(lines) {
  const t = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  if (PDD_ORDER.test(t) || /拼多多|pinduoduo/i.test(t)) return 'pdd';
  for (const [shop, re] of BRAND) if (re.test(t)) return shop;
  return 'pdd';
}

// Заготовка разборщика: честно говорит, что такие снимки ещё не разбираются.
const notYet = (app) => () => ({
  kind: 'unknown',
  app,
  doubts: [`снимок из ${SHOPS[app].name} — такие снимки пока не разбираются, добавьте товар вручную`],
});

// Разборщики других приложений. Возвращают то же, что разбор PDD:
// { kind: 'order', nameCn, variant, qty, paidFen, orderNo, … } или { kind: 'logistics', track, carrier, orderNo, … }.
export const PARSERS = {
  '1688': notYet('1688'),
  poizon: parsePoizon,
  taobao: parseTaobao,
};
