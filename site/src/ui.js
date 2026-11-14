// Общие кусочки интерфейса.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import * as S from './store.js';
import { fmtByn, fmtCny, itemMoney } from './money.js';
import { statusShort } from './model.js';
import { saveFile } from './export.js';

export { html, useState, useEffect, useRef };
export const go = (path) => {
  location.hash = path;
};
export const dateRu = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('ru-RU') : '—');
export const timeRu = (d) => new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Header({ title, back, right }) {
  return html`<header class="top">
    ${back ? html`<button class="icon-btn" aria-label="Назад" onClick=${() => (typeof back === 'string' ? go(back) : history.back())}>‹</button>` : html`<span class="icon-gap"></span>`}
    <h1>${title}</h1>
    ${right || html`<span class="icon-gap"></span>`}
  </header>`;
}

export function Stat({ label, value, tone }) {
  return html`<div class="stat ${tone || ''}"><div class="stat-v">${value}</div><div class="stat-l">${label}</div></div>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

export function Search({ value, onInput, placeholder }) {
  return html`<input class="search" type="search" placeholder=${placeholder || 'Поиск'} value=${value} onInput=${(e) => onInput(e.target.value)} />`;
}

export function StatusChip({ status }) {
  return html`<span class="chip s${status}">${statusShort(status)}</span>`;
}

// Строка товара в списке.
export function ItemRow({ item, showClient, showPurchase }) {
  const p = S.purchaseById(item.purchaseId);
  const m = itemMoney(item, p);
  const variant = [item.color, item.size, item.kit].filter(Boolean).join(' · ');
  return html`<a class="row item-row" href=${`#/item/${item.id}`}>
    <div class="row-main">
      <div class="row-title">${item.name}${item.photoId ? html` <span class="muted" title="есть фото">📷</span>` : ''}</div>
      ${variant && html`<div class="row-sub">${variant}</div>`}
      ${showClient && html`<div class="row-sub">${S.clientName(item.clientId)}${showPurchase ? ` · ${p?.name || ''}` : ''}</div>`}
      <div class="row-sub">
        ${m.qty} × ${m.unitFen == null ? html`<span class="warn-text">цена не указана</span>` : fmtCny(m.unitFen)}
        ${item.track ? html` · <span class="mono">${item.track}</span>` : ''}
      </div>
    </div>
    <div class="row-side">
      <div class="row-money">${m.totalKop == null ? '—' : fmtByn(m.totalKop)}</div>
      <${StatusChip} status=${item.status} />
    </div>
  </a>`;
}

// Выбор клиента из списка (с поиском) или создание нового по имени.
export function ClientPicker({ title, onPick, onClose, excludeIds = [] }) {
  const [q, setQ] = useState('');
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);
  const all = [...S.state.clients.values()].filter((c) => !c.deleted && !excludeIds.includes(c.id));
  const ql = q.trim().toLowerCase();
  const list = all.filter((c) => c.name.toLowerCase().includes(ql)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const exact = all.find((c) => c.name.trim().toLowerCase() === ql);
  const create = async () => {
    const existing = S.findClientByName(q);
    onPick(existing || (await S.createClient({ name: q })));
  };
  return html`<${Sheet} title=${title || 'Клиент'} onClose=${onClose}>
    <input ref=${ref} class="search" placeholder="Имя клиента" value=${q} onInput=${(e) => setQ(e.target.value)}
      onKeyDown=${(e) => e.key === 'Enter' && q.trim() && (exact ? onPick(exact) : create())} />
    ${q.trim() && !exact && html`<button class="btn primary block" onClick=${create}>+ Новый клиент «${q.trim()}»</button>`}
    <div class="list">
      ${list.map((c) => html`<button class="row as-btn" onClick=${() => onPick(c)}><div class="row-title">${c.name}</div></button>`)}
      ${!list.length && !q && html`<${Empty}>Клиентов пока нет. Напишите имя выше.</${Empty}>`}
    </div>
  </${Sheet}>`;
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label=${title}>
      <div class="sheet-head"><b>${title}</b><button class="icon-btn" aria-label="Закрыть" onClick=${onClose}>✕</button></div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

let toastSet = null;
export function Toasts() {
  const [msg, setMsg] = useState('');
  toastSet = setMsg;
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(''), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? html`<div class="toast" role="status">${msg}</div>` : null;
}
export const toast = (m) => toastSet?.(m);

// Готовый файл: отдельная кнопка, чтобы меню «Поделиться» на iPhone открывалось прямо от нажатия.
export function FileReady({ file, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  return html`<${Sheet} title="Файл готов" onClose=${onClose}>
    <p class="mono small">${file.name}</p>
    <button class="btn primary block" disabled=${busy} onClick=${async () => {
      setBusy(true);
      const r = await saveFile(file.blob, file.name);
      setBusy(false);
      if (r !== 'cancelled') {
        onSaved?.();
        onClose();
      }
    }}>Сохранить или отправить</button>
    <p class="muted small">На iPhone откроется меню «Поделиться»: «Сохранить в Файлы», Telegram, почта.</p>
  </${Sheet}>`;
}
