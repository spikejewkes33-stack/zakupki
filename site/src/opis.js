// Опись: объединение похожих товаров закупки в строки без имён клиентов, треков и номеров заказов.
// Товары в базе не меняются: опись — это вид поверх них.
import { itemMoney, averageKop } from './money.js';

const STOP = new Set(['и', 'с', 'со', 'для', 'на', 'в', 'во', 'из', 'по', 'от', 'к', 'шт', 'штук', 'штука', 'штуки', 'the', 'a']);
const VOWELS = 'аеиоуыэюя';
// Окончания прилагательных и существительных, от длинных к коротким.
const ENDINGS = [
  'ями', 'ами', 'ими', 'ыми', 'ого', 'его', 'ому', 'ему',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ую', 'юю', 'ых', 'их', 'ым', 'им', 'ом', 'ем',
  'ах', 'ях', 'ов', 'ев', 'ей', 'ам', 'ям', 'ою', 'ею',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
];

// Грубая основа русского слова: «носочки», «носки», «носок» → «носк»; «детские», «детский» → «детск».
export function stem(word) {
  let w = word;
  if (/\d/.test(w) || w.length <= 3) return w;
  for (const e of ENDINGS) {
    if (w.endsWith(e) && w.length - e.length >= 3) {
      w = w.slice(0, -e.length);
      break;
    }
  }
  // уменьшительное -очк-/-ечк- → -к- («носочк» → «носк», «платочк» → «платк»)
  w = w.replace(/([^аеиоуыэюя])[оеё]ч(к)$/, '$1$2');
  // беглая гласная: «носок» → «носк», «платок» → «платк»
  if (w.length >= 5) w = w.replace(/([^аеиоуыэюя])[оеё]к$/, '$1к');
  w = w.replace(/([^аеиоуыэюя])[оеё]ч(к)$/, '$1$2');
  return w;
}

export function tokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)([a-zа-я])/g, '$1 $2')
    .replace(/([a-zа-я])(\d)/g, '$1 $2')
    .split(/[^a-zа-я0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

// Ключ автоматического объединения: одинаковый набор основ слов в любом порядке.
export function groupKey(name) {
  const t = [...new Set(tokens(name))].sort();
  return t.join(' ');
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
function similarWord(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const p = commonPrefix(a, b);
  return p >= 4 && p >= Math.min(a.length, b.length) - 0 && Math.abs(a.length - b.length) <= 3;
}

// Сомнительная пара групп: показываем пользователю на подтверждение.
// Да — если слова попарно похожи (шарф / шарфик), или одно название — это другое плюс одно слово без цифр.
export function isDoubtfulPair(keyA, keyB) {
  if (keyA === keyB || !keyA || !keyB) return false;
  if (keyA.startsWith('cn:') || keyB.startsWith('cn:')) return false; // китайские — без догадок
  const a = keyA.split(' ');
  const b = keyB.split(' ');
  const digitsA = a.filter((t) => /\d/.test(t)).sort().join(' ');
  const digitsB = b.filter((t) => /\d/.test(t)).sort().join(' ');
  if (digitsA !== digitsB) return false; // разные размеры, объёмы, количество в наборе
  if (a.length === b.length) {
    const used = new Set();
    return a.every((x) => {
      const j = b.findIndex((y, k) => !used.has(k) && similarWord(x, y));
      if (j < 0) return false;
      used.add(j);
      return true;
    });
  }
  const [small, big] = a.length < b.length ? [a, b] : [b, a];
  if (big.length - small.length !== 1) return false;
  return small.every((x) => big.some((y) => similarWord(x, y)));
}

export const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Объединение по решениям пользователя (система непересекающихся множеств).
function unionFind(keys, merges) {
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k) => {
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  for (const [a, b] of merges || []) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  return find;
}

// Название товара для описи: с комплектацией, если она указана («Носки (5 пар)»).
// Если русского названия ещё нет — берётся название из PDD (по-китайски), строка помечается «нет русского».
export function itemLabel(it) {
  const name = String(it.name || it.nameCn || '').trim().replace(/\s+/g, ' ');
  const kit = String(it.kit || '').trim();
  return kit ? `${name} (${kit})` : name;
}
// Комплектация учитывается при объединении: «Носки» и «Носки» с комплектацией «5 пар» — разные строки.
// Китайские названия словами не разбить — объединяются только полностью одинаковые.
export const itemKey = (it) => (!it.name && it.nameCn ? `cn:${itemLabel(it)}` : groupKey(itemLabel(it)) || '(без названия)');

function niceName(items) {
  const count = new Map();
  for (const it of items) {
    const n = itemLabel(it);
    count.set(n, (count.get(n) || 0) + (it.qty || 1));
  }
  const best = [...count.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0];
  return best.charAt(0).toUpperCase() + best.slice(1);
}

// Главная функция описи.
// items — товары закупки (удалённые пропускаются); purchase.opis = { merges, rejected, edits }.
// Строки содержат только название, количество, единицу и суммы. Никаких клиентов, треков, номеров заказов.
export function buildOpis(items, purchase) {
  const opis = purchase?.opis || {};
  const live = items.filter((it) => !it.deleted);
  const byKey = new Map();
  for (const it of live) {
    const k = itemKey(it);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(it);
  }
  const find = unionFind([...byKey.keys()], opis.merges);
  const groups = new Map();
  for (const [k, its] of byKey) {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, { keys: [], items: [] });
    const g = groups.get(root);
    g.keys.push(k);
    g.items.push(...its);
  }

  const edits = opis.edits || {};
  const rows = [];
  for (const [root, g] of groups) {
    g.keys.sort();
    const edit = Object.assign({}, ...g.keys.map((k) => edits[k] || {}));
    // Правка количества и исключение действуют только для того состава строки, при котором их сделали.
    // Добавился товар, строку объединили или разъединили — они перестают действовать, строка помечается.
    const ids = g.items.map((it) => it.id).sort();
    const sameSet = Array.isArray(edit.itemIds) && edit.itemIds.length === ids.length && [...edit.itemIds].sort().every((x, i) => x === ids[i]);
    const stale = !sameSet && !!(edit.qty || edit.excluded);
    let totalKop = 0;
    let qty = 0;
    let noPrice = 0;
    let zero = 0;
    for (const it of g.items) {
      const m = itemMoney(it, purchase);
      qty += m.qty;
      if (m.totalKop == null) noPrice += m.qty;
      else totalKop += m.totalKop;
      if (m.zero) zero += m.qty;
    }
    const finalQty = sameSet && edit.qty > 0 ? edit.qty : qty;
    rows.push({
      key: root,
      keys: g.keys,
      itemIds: g.items.map((it) => it.id),
      sourceNames: [...new Set(g.items.map(itemLabel))],
      autoName: niceName(g.items),
      name: edit.name?.trim() || niceName(g.items),
      qty: finalQty,
      countedQty: qty,
      unit: edit.unit?.trim() || 'шт.',
      totalKop,
      avgKop: averageKop(totalKop, finalQty),
      noPrice,
      zero,
      stale,
      noRu: g.items.filter((it) => !it.name).length,
      excluded: sameSet && !!edit.excluded,
      edited: !!(edit.name || (sameSet && edit.qty) || edit.unit),
      merged: g.keys.length > 1,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  let n = 0;
  for (const r of rows) r.n = r.excluded ? null : ++n;

  const included = rows.filter((r) => !r.excluded);
  const totalKop = included.reduce((s, r) => s + r.totalKop, 0);
  const totalQty = included.reduce((s, r) => s + r.qty, 0);
  const noPrice = included.reduce((s, r) => s + r.noPrice, 0);
  const zero = included.reduce((s, r) => s + r.zero, 0);
  const noRu = included.filter((r) => r.noRu > 0).length;

  // Предложения объединить (при сомнении — спрашиваем пользователя).
  const rejected = new Set(opis.rejected || []);
  const suggestions = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i];
      const B = rows[j];
      const hit = A.keys.some((ka) => B.keys.some((kb) => isDoubtfulPair(ka, kb)));
      if (hit && !rejected.has(pairId(A.key, B.key))) suggestions.push({ a: A, b: B, id: pairId(A.key, B.key) });
    }
  }
  return { rows, totalKop, totalQty, noPrice, zero, noRu, suggestions };
}

// Строки для экспорта (PDF, Excel): только то, что разрешено в описи.
export function exportRows(opisResult) {
  return opisResult.rows
    .filter((r) => !r.excluded)
    .map((r) => ({ n: r.n, name: r.name, qty: r.qty, unit: r.unit, totalKop: r.totalKop, avgKop: r.avgKop }));
}

// В описи запрещены имена клиентов, треки и номера заказов (ТЗ п. 10). Названия товаров пишет человек,
// поэтому проверяем: нет ли в названии строки имени клиента или длинного номера.
export function privacyWarnings(rows, clientNames) {
  const names = clientNames
    .map((n) => String(n || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я]+/).filter((w) => w.length >= 3))
    .flat();
  const out = [];
  for (const r of rows) {
    if (r.excluded) continue;
    const words = String(r.name).toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/);
    // Имя в любом падеже: «Маша», «Маши», «Машей» — общее начало без последней буквы имени.
    const who = names.find((n) => words.some((w) => w === n || (n.length >= 4 && w.length >= n.length - 1 && w.length - n.length <= 2 && w.startsWith(n.slice(0, -1)))));
    if (who) out.push({ key: r.key, name: r.name, reason: `похоже на имя клиента («${who}»)` });
    else if (/\d{8,}|[A-Za-z]{2}\d{8,}/.test(r.name.replace(/[\s-]/g, ''))) out.push({ key: r.key, name: r.name, reason: 'похоже на трек или номер заказа' });
  }
  return out;
}
