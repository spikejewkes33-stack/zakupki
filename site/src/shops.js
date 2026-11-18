// Из какого приложения снимок: PDD, 1688, Poizon (得物) или Taobao (淘宝/天猫).
// Путь у всех один: Кнопка действия → снимок → текст в файл «Команды» → «Забрать».
// Разборщики 1688, Poizon и Taobao пока заготовки: образцов их экранов ещё нет, вид экранов не додумываем.
// Когда придут снимки: положить текст в tests/fixtures/<shop>-*.txt, дописать parse() ниже и снять test.todo.

export const SHOPS = {
  pdd: { name: 'PDD' },
  '1688': { name: '1688' },
  poizon: { name: 'Poizon (得物)' },
  taobao: { name: 'Taobao' },
};

// Названия приложений, которые бывают в тексте снимка. Это догадка, а не проверка на образцах:
// на экране заказа названия приложения может и не быть — тогда снимок идёт в разбор PDD, как раньше.
const BRAND = [
  // «1688» отдельным числом, не часть цены и не часть длинного номера
  ['1688', /(?<![\d￥¥.,])1688(?![\d.,])|阿里巴巴|alibaba/i],
  ['poizon', /得物|poizon|dewu/i],
  ['taobao', /淘宝|天猫|taobao|tmall/i],
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
const notYet = (shop) => () => ({
  kind: 'unknown',
  shop,
  doubts: [`снимок из ${SHOPS[shop].name} — такие снимки пока не разбираются, добавьте товар вручную`],
});

// Разборщики других приложений. Должны вернуть то же, что разбор PDD:
// { kind: 'order', nameCn, variant, qty, paidFen, orderNo, … } или { kind: 'logistics', track, carrier, orderNo, … }.
export const PARSERS = {
  '1688': notYet('1688'),
  poizon: notYet('poizon'),
  taobao: notYet('taobao'),
};
