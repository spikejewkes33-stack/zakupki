// Порядок оформления заказов в закупке и границы между клиентами.
// Сессия = «оформляю товары клиента X» с временем начала и конца (кнопка «Завершить заказы клиента»).
// По этим границам на этапе 3 заказы из истории Pinduoduo будут разложены по клиентам по времени оформления.

export function openSession(purchase) {
  return (purchase.sessions || []).find((s) => !s.endedAt) || null;
}

// Начать оформление клиента. Если открыта сессия другого клиента — она закрывается этим же моментом.
export function startSession(purchase, clientId, now, newId) {
  const sessions = [...(purchase.sessions || [])];
  const open = sessions.findIndex((s) => !s.endedAt);
  if (open >= 0) {
    if (sessions[open].clientId === clientId) return sessions;
    sessions[open] = { ...sessions[open], endedAt: now };
  }
  sessions.push({ id: newId, clientId, startedAt: now, endedAt: null });
  return sessions;
}

// Кнопка «Завершить заказы клиента»: фиксирует границу.
export function finishSession(purchase, now) {
  return (purchase.sessions || []).map((s) => (s.endedAt ? s : { ...s, endedAt: now }));
}

// Чей заказ, оформленный в момент t (ISO-строка)? Возвращает clientId или null, если вне всех сессий.
export function clientForTime(sessions, t) {
  const x = Date.parse(t);
  if (Number.isNaN(x)) return null;
  let hit = null;
  for (const s of sessions || []) {
    const a = Date.parse(s.startedAt);
    const b = s.endedAt ? Date.parse(s.endedAt) : Infinity;
    if (x >= a && x < b) hit = s.clientId; // при наложении — более поздняя сессия
  }
  return hit;
}

// Товары закупки в порядке оформления (по номеру в очереди).
export function inOrder(items) {
  return [...items].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

// Клиенты закупки в порядке оформления: сначала по первой сессии, затем добавленные без сессий.
export function clientsInOrder(purchase) {
  const seen = new Set();
  const out = [];
  for (const s of purchase.sessions || []) if (!seen.has(s.clientId)) seen.add(s.clientId) && out.push(s.clientId);
  for (const id of purchase.clientIds || []) if (!seen.has(id)) seen.add(id) && out.push(id);
  return out;
}
