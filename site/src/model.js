// Данные и правила: статусы, итоги закупки и клиента, проверки перед сохранением, защита от дублей.
import { itemMoney, parseCents, priceWarning } from './money.js';

export const STATUSES = [
  { id: 1, label: 'Заказ оформлен', short: 'Оформлен' },
  { id: 2, label: 'Ожидает отправки продавцом', short: 'Ждёт отправки' },
  { id: 3, label: 'Продавец отправил товар', short: 'Отправлен' },
  { id: 4, label: 'Трек-номер получен', short: 'Есть трек' },
  { id: 5, label: 'Товар в пути', short: 'В пути' },
  { id: 6, label: 'Товар прибыл на склад', short: 'На складе' },
];
export const TRACK_STATUS = 4;
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || '—';
export const statusShort = (id) => STATUSES.find((s) => s.id === id)?.short || '—';

// Сегодняшняя дата по часам телефона (а не по Гринвичу): «2026-11-15».
export function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Название для показа: русское, а если его ещё нет — из PDD.
export const itemTitle = (it) => it.name || it.nameCn || '(без названия)';

const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

// Поля карточки товара (ТЗ п. 5). Обязательны только название и клиент.
export function emptyItem(purchaseId, clientId) {
  return {
    purchaseId,
    clientId: clientId || '',
    name: '',
    nameCn: '',
    variant: '',
    paidFen: null,
    photoId: null,
    url: '',
    orderDate: todayLocal(),
    pddOrderNo: '',
    color: '',
    size: '',
    kit: '',
    qty: 1,
    unitFen: null,
    status: 1,
    track: '',
    carrier: '',
    note: '',
  };
}

// Проверка формы. form — строки из полей ввода. Возвращает { item, errors, warnings }.
export function validateItem(form, allItems, selfId) {
  const errors = {};
  const warnings = [];
  const name = String(form.name || '').trim();
  const nameCn = String(form.nameCn || '').trim();
  if (!name && !nameCn) errors.name = 'Нужно название товара';
  if (!form.clientId) errors.clientId = 'Нужно выбрать клиента';
  const qty = Number(String(form.qty ?? '1').trim() || 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) errors.qty = 'Количество — целое число от 1';
  const unitFen = typeof form.unitFen === 'number' || form.unitFen === null ? form.unitFen : parseCents(form.unitFen);
  if (Number.isNaN(unitFen)) errors.unitFen = priceWarning(unitFen);
  else if (priceWarning(unitFen)) warnings.push(priceWarning(unitFen));
  // «Оплачено всего» (实付) — если указано, сумма строки берётся из него, цена за штуку = сумма / количество.
  const paidFen = typeof form.paidFen === 'number' || form.paidFen == null ? (form.paidFen ?? null) : parseCents(form.paidFen);
  if (Number.isNaN(paidFen)) errors.paidFen = 'Сумма записана неверно: только цифры и запятая, до 2 знаков.';

  const item = {
    ...form,
    name,
    nameCn,
    variant: String(form.variant || '').trim(),
    qty: errors.qty ? 1 : qty,
    unitFen: Number.isNaN(unitFen) ? null : unitFen,
    paidFen: Number.isNaN(paidFen) ? null : paidFen,
    pddOrderNo: String(form.pddOrderNo || '').trim(),
    track: String(form.track || '').replace(/\s+/g, '').toUpperCase(),
    carrier: String(form.carrier || '').trim(),
    url: String(form.url || '').trim(),
    status: Number(form.status) || 1,
  };
  // Появился трек — статус «Трек-номер получен», если стоял более ранний.
  if (item.track && item.status < TRACK_STATUS) item.status = TRACK_STATUS;

  warnings.push(...duplicateWarnings(item, allItems, selfId));
  return { item, errors, warnings };
}

// Защита от дублей: один заказ Pinduoduo и один трек — у одной карточки.
export function duplicateWarnings(item, allItems, selfId) {
  const out = [];
  const others = allItems.filter((x) => x.id !== selfId && !x.deleted);
  if (item.pddOrderNo) {
    const d = others.find((x) => norm(x.pddOrderNo) === norm(item.pddOrderNo));
    if (d) out.push(`Номер заказа ${item.pddOrderNo} уже есть у товара «${itemTitle(d)}». Один заказ — одна карточка.`);
  }
  if (item.track) {
    const d = others.find((x) => norm(x.track) === norm(item.track));
    if (d) out.push(`Трек ${item.track} уже есть у товара «${itemTitle(d)}». Один товар — один трек.`);
  }
  return out;
}

// Итоги по набору товаров (закупка или клиент в закупке). purchaseById — для курса каждого товара.
export function totals(items, purchaseById) {
  const t = { count: 0, qty: 0, fen: 0, kop: 0, noPrice: 0, waiting: 0, shipped: 0, withTrack: 0, noTrack: 0 };
  for (const it of items) {
    if (it.deleted) continue;
    const m = itemMoney(it, purchaseById(it.purchaseId));
    t.count += 1;
    t.qty += m.qty;
    if (m.totalFen == null) t.noPrice += 1;
    else t.fen += m.totalFen;
    if (m.totalKop != null) t.kop += m.totalKop;
    if (it.status <= 2) t.waiting += 1;
    if (it.status >= 3) t.shipped += 1;
    if (it.track) t.withTrack += 1;
    else t.noTrack += 1;
  }
  return t;
}

// Поиск по товару: название, цвет, размер, комплектация, номер заказа, трек, имя клиента.
export function matchItem(it, query, clientName) {
  const q = String(query || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return true;
  const hay = [it.name, it.nameCn, it.variant, it.color, it.size, it.kit, it.pddOrderNo, it.track, it.carrier, it.note, clientName]
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е');
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function sortItems(items, by) {
  const arr = [...items];
  if (by === 'status') arr.sort((a, b) => a.status - b.status || (a.seq ?? 0) - (b.seq ?? 0));
  else if (by === 'dateDesc') arr.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)) || (b.seq ?? 0) - (a.seq ?? 0));
  else if (by === 'name') arr.sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), 'ru'));
  else arr.sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || (a.seq ?? 0) - (b.seq ?? 0));
  return arr;
}

// Что изменилось (для истории изменений).
export function diff(before, after, fields) {
  const ch = {};
  for (const f of fields) {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) ch[f] = [a, b];
  }
  return ch;
}

export const ITEM_FIELDS = ['name', 'nameCn', 'variant', 'paidFen', 'clientId', 'photoId', 'url', 'orderDate', 'pddOrderNo', 'color', 'size', 'kit', 'qty', 'unitFen', 'status', 'track', 'carrier', 'note', 'deleted'];
export const PURCHASE_FIELDS = ['name', 'startDate', 'endDate', 'rateMicro', 'rounding', 'archived', 'clientIds', 'sessions', 'opis', 'deleted'];
export const CLIENT_FIELDS = ['name', 'contact', 'note', 'deleted'];

export const FIELD_LABELS = {
  name: 'Название', nameCn: 'Название из PDD', variant: 'Вариант', paidFen: 'Оплачено ¥', clientId: 'Клиент', photoId: 'Фото', url: 'Ссылка', orderDate: 'Дата заказа', pddOrderNo: 'Номер заказа',
  color: 'Цвет', size: 'Размер', kit: 'Комплектация', qty: 'Количество', unitFen: 'Цена ¥', status: 'Статус', track: 'Трек',
  carrier: 'Перевозчик', note: 'Заметка', deleted: 'Удалён', startDate: 'Дата закупки', endDate: 'Дата завершения',
  rateMicro: 'Курс', rounding: 'Округление', archived: 'В архиве', clientIds: 'Клиенты', sessions: 'Порядок оформления',
  opis: 'Опись', contact: 'Контакт',
};
