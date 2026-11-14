// Клиенты: список и карточка клиента со всеми закупками.
import { html, useState, Header, Empty, Search, ItemRow, Stat, go, dateRu, toast } from '../ui.js';
import * as S from '../store.js';
import { totals, matchItem, sortItems } from '../model.js';
import { fmtByn } from '../money.js';

export function ClientList() {
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const items = [...S.state.items.values()].filter((x) => !x.deleted);
  const list = [...S.state.clients.values()]
    .filter((c) => !c.deleted && c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (S.findClientByName(name)) return toast('Такой клиент уже есть');
    const c = await S.createClient({ name });
    setName('');
    go(`/client/${c.id}`);
    return undefined;
  };
  return html`<${Header} title="Клиенты" />
  <main>
    <form class="inline-form" onSubmit=${add}>
      <input placeholder="Имя нового клиента" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn primary" type="submit">Добавить</button>
    </form>
    <${Search} value=${q} onInput=${setQ} placeholder="Найти клиента" />
    <div class="list">
      ${list.map((c) => {
        const its = items.filter((x) => x.clientId === c.id);
        const t = totals(its, S.purchaseById);
        const np = new Set(its.map((x) => x.purchaseId)).size;
        return html`<a class="row" href=${`#/client/${c.id}`}>
          <div class="row-main"><div class="row-title">${c.name}</div><div class="row-sub">${t.count} товаров · закупок: ${np}</div></div>
          <div class="row-side"><div class="row-money">${fmtByn(t.kop)}</div></div>
        </a>`;
      })}
    </div>
    ${!list.length && html`<${Empty}>${q ? 'Не найдено' : 'Клиентов пока нет'}</${Empty}>`}
  </main>`;
}

export function ClientCard({ id }) {
  const c = S.state.clients.get(id);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: c?.name || '', contact: c?.contact || '', note: c?.note || '' });
  if (!c) return html`<${Header} title="Клиент" back="/clients" /><main><${Empty}>Клиент не найден</${Empty}></main>`;
  const items = [...S.state.items.values()].filter((x) => !x.deleted && x.clientId === id);
  const t = totals(items, S.purchaseById);
  const byPurchase = [...new Set(items.map((x) => x.purchaseId))]
    .map((pid) => S.purchaseById(pid))
    .filter(Boolean)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const found = q.trim() ? sortItems(items.filter((it) => matchItem(it, q)), 'dateDesc') : [];
  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const other = S.findClientByName(f.name);
    if (other && other.id !== id) return toast('Клиент с таким именем уже есть');
    await S.updateClient(id, { name: f.name.trim(), contact: f.contact.trim(), note: f.note.trim() });
    setEdit(false);
    return undefined;
  };
  return html`<${Header} title=${c.name} back=${true} right=${html`<button class="icon-btn" aria-label="Изменить" onClick=${() => setEdit(!edit)}>✎</button>`} />
  <main>
    ${edit
      ? html`<form class="form card" onSubmit=${save}>
          <label>Имя<input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Контакт (телефон, Telegram)<input value=${f.contact} onInput=${(e) => setF({ ...f, contact: e.target.value })} /></label>
          <label>Заметка<textarea rows="2" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })}></textarea></label>
          <button class="btn primary block" type="submit">Сохранить</button>
        </form>`
      : (c.contact || c.note) && html`<section class="card small">${c.contact && html`<div>${c.contact}</div>`}${c.note && html`<div class="muted">${c.note}</div>`}</section>`}
    <section class="card">
      <div class="stats three">
        <${Stat} label="товаров всего" value=${t.count} />
        <${Stat} label="закупок" value=${byPurchase.length} />
        <${Stat} label="сумма, BYN" value=${fmtByn(t.kop).replace(' BYN', '')} tone="accent" />
      </div>
      <p class="muted small">Сумма — по курсу каждой закупки.</p>
    </section>
    <${Search} value=${q} onInput=${setQ} placeholder="Поиск по товарам клиента" />
    ${q.trim()
      ? html`<div class="list">${found.map((it) => html`<${ItemRow} item=${it} />`)}</div>${!found.length && html`<${Empty}>Не найдено</${Empty}>`}`
      : html`<h3>Закупки клиента</h3>
        <div class="list">${byPurchase.map((p) => {
          const tt = totals(items.filter((x) => x.purchaseId === p.id), S.purchaseById);
          return html`<a class="row" href=${`#/p/${p.id}/c/${id}`}>
            <div class="row-main"><div class="row-title">${p.name}${p.archived ? ' · архив' : ''}</div><div class="row-sub">${dateRu(p.startDate)} · ${tt.count} товаров</div></div>
            <div class="row-side"><div class="row-money">${fmtByn(tt.kop)}</div></div>
          </a>`;
        })}</div>
        ${!byPurchase.length && html`<${Empty}>Товаров у клиента пока нет</${Empty}>`}`}
  </main>`;
}
