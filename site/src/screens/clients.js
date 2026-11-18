// Клиенты: список (с разделением по карго) и карточка клиента со всеми закупками.
import { html, useState, Header, Empty, Search, ItemRow, Stat, Sheet, CopiedSheet, copyText, go, dateRu, toast } from '../ui.js';
import * as S from '../store.js';
import { totals, matchItem, sortItems } from '../model.js';
import { fmtByn } from '../money.js';
import { clientsInOrder } from '../order.js';
import { parcelsText } from '../parcels.js';

// Список карго: добавить, переименовать, удалить (клиенты удалённого карго становятся «без карго»).
function CargoSheet({ onClose }) {
  const [name, setName] = useState('');
  const [names, setNames] = useState(() => Object.fromEntries(S.cargoList().map((c) => [c.id, c.name])));
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const c = await S.addCargo(name);
    setNames({ ...names, [c.id]: c.name });
    setName('');
  };
  const rename = async (c) => {
    const v = String(names[c.id] || '').trim();
    if (!v || v === c.name) return;
    await S.renameCargo(c.id, v);
    toast('Переименовано');
  };
  const del = async (c) => {
    const n = [...S.state.clients.values()].filter((x) => !x.deleted && x.cargoId === c.id).length;
    if (!confirm(`Удалить карго «${c.name}»?${n ? ` Его клиенты (${n}) станут «без карго», сами клиенты останутся.` : ''}`)) return;
    await S.deleteCargo(c.id);
  };
  return html`<${Sheet} title="Карго" onClose=${onClose}>
    ${S.cargoList().map((c) => html`<div class="cargo-edit" key=${c.id}>
      <input value=${names[c.id] ?? c.name} onInput=${(e) => setNames({ ...names, [c.id]: e.target.value })}
        onBlur=${() => rename(c)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} aria-label="Название карго" />
      <button class="btn small danger" onClick=${() => del(c)}>Удалить</button>
    </div>`)}
    ${!S.cargoList().length && html`<p class="muted small">Карго пока нет. Добавьте, например, «Карго 1» и «Карго 2», потом выберите карго в строке каждого клиента.</p>`}
    <form class="inline-form" onSubmit=${add}>
      <input placeholder="Новое карго" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn primary" type="submit">Добавить</button>
    </form>
  </${Sheet}>`;
}

export function ClientList() {
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [cargo, setCargo] = useState(''); // '' — все, 'none' — без карго, иначе id карго
  const [manage, setManage] = useState(false);
  const [copied, setCopied] = useState(null);
  const cargos = S.cargoList();
  const items = [...S.state.items.values()].filter((x) => !x.deleted);
  const list = [...S.state.clients.values()]
    .filter((c) => !c.deleted && c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const known = (c) => cargos.some((x) => x.id === c.cargoId);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (S.findClientByName(name)) return toast('Такой клиент уже есть');
    const c = await S.createClient({ name, cargoId: cargo && cargo !== 'none' ? cargo : '' });
    setName('');
    go(`/client/${c.id}`);
    return undefined;
  };
  // Скопировать клиентов карго с товарами активной закупки: обычный текст для мессенджера.
  const copyCargo = async (cg) => {
    const p = S.activePurchase();
    if (!p) return toast('Нет активной закупки — сделайте закупку активной на главной');
    const ids = new Set([...S.state.clients.values()].filter((c) => !c.deleted && c.cargoId === cg.id).map((c) => c.id));
    const r = parcelsText(p.name, S.itemsOf(p.id).filter((x) => ids.has(x.clientId)), { clientName: S.clientName, clientOrder: clientsInOrder(p).filter((id) => ids.has(id)) });
    if (!r.copied && !r.noTrack.length) return toast(`У клиентов «${cg.name}» нет товаров в закупке «${p.name}»`);
    setCopied({ ...r, ok: r.copied ? await copyText(r.text) : true, title: `Для карго «${cg.name}»`, hint: `Закупка «${p.name}». Вставьте в мессенджер.` });
    return undefined;
  };
  const row = (c) => {
    const its = items.filter((x) => x.clientId === c.id);
    const t = totals(its, S.purchaseById);
    const np = new Set(its.map((x) => x.purchaseId)).size;
    return html`<div class="row client-row" key=${c.id}>
      <a class="row-main" href=${`#/client/${c.id}`}><div class="row-title">${c.name}</div><div class="row-sub">${t.count} товаров · закупок: ${np} · ${fmtByn(t.kop)}</div></a>
      ${cargos.length > 0 && html`<select value=${known(c) ? c.cargoId : ''} aria-label=${`Карго клиента ${c.name}`}
        onChange=${(e) => S.updateClient(c.id, { cargoId: e.target.value })}>
        <option value="">без карго</option>
        ${cargos.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
      </select>`}
    </div>`;
  };
  // Группы: каждое карго, потом «без карго». Фильтр оставляет одну группу.
  const groups = cargos.length
    ? [...cargos.map((x) => ({ cargo: x, clients: list.filter((c) => c.cargoId === x.id) })), { cargo: null, clients: list.filter((c) => !known(c)) }]
      .filter((g) => (cargo === '' ? true : cargo === 'none' ? !g.cargo : g.cargo?.id === cargo))
      .filter((g) => g.clients.length || g.cargo)
    : [{ cargo: null, clients: list, plain: true }];
  return html`<${Header} title="Клиенты" />
  <main>
    <form class="inline-form" onSubmit=${add}>
      <input placeholder="Имя нового клиента" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn primary" type="submit">Добавить</button>
    </form>
    <div class="filters">
      <${Search} value=${q} onInput=${setQ} placeholder="Найти клиента" />
      ${cargos.length > 0 && html`<select value=${cargo} onChange=${(e) => setCargo(e.target.value)} aria-label="Карго">
        <option value="">Все карго</option>
        ${cargos.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
        <option value="none">Без карго</option>
      </select>`}
    </div>
    <button class="btn block" onClick=${() => setManage(true)}>${cargos.length ? 'Карго: добавить, переименовать, удалить' : '+ Разделить клиентов по карго'}</button>
    ${groups.map((g) => html`${!g.plain && html`<div class="cargo-head">
        <h3>${g.cargo ? g.cargo.name : 'Без карго'} · ${g.clients.length}</h3>
        ${g.cargo && html`<button class="btn small" onClick=${() => copyCargo(g.cargo)}>📋 Скопировать</button>`}
      </div>`}
      <div class="list">${g.clients.map(row)}</div>
      ${!g.plain && !g.clients.length && html`<p class="muted small">Клиентов нет — выберите это карго в строке клиента.</p>`}`)}
    ${!list.length && html`<${Empty}>${q ? 'Не найдено' : 'Клиентов пока нет'}</${Empty}>`}
    ${manage && html`<${CargoSheet} onClose=${() => setManage(false)} />`}
    ${copied && html`<${CopiedSheet} r=${copied} title=${copied.title} hint=${copied.hint} onClose=${() => setCopied(null)} />`}
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
