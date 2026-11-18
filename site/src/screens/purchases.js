// Главная, список закупок, форма закупки, экран закупки.
import { html, useState, Header, Stat, Empty, Search, ItemRow, ClientPicker, CopiedSheet, copyText, go, dateRu, timeRu, toast } from '../ui.js';
import { parcelsText } from '../parcels.js';

function GlobalSearch() {
  const [q, setQ] = useState('');
  const found = q.trim().length >= 2
    ? [...S.state.items.values()].filter((it) => !it.deleted && matchItem(it, q, S.clientName(it.clientId))).slice(0, 50)
    : [];
  return html`<div class="global-search">
    <${Search} value=${q} onInput=${setQ} placeholder="Найти во всех закупках: трек, номер заказа, товар, клиент" />
    ${q.trim().length >= 2 && html`<div class="list">${found.map((it) => html`<${ItemRow} item=${it} showClient=${true} showPurchase=${true} />`)}</div>
      ${!found.length && html`<${Empty}>Ничего не найдено</${Empty}>`}`}
  </div>`;
}
import * as S from '../store.js';
import { totals, cargoTotals, matchItem, STATUSES, sortItems, allItemsList, todayLocal as today } from '../model.js';
import { fmtByn, fmtCny, formatRate, parseRate, ROUNDING_STEPS, ROUNDING_MODES, DEFAULT_ROUNDING } from '../money.js';
import { openSession, clientsInOrder } from '../order.js';

const roundingLabel = (r = DEFAULT_ROUNDING) =>
  `${ROUNDING_STEPS.find((x) => x.kop === r.stepKop)?.label || ''}, ${ROUNDING_MODES.find((x) => x.id === r.mode)?.label || ''}`;

function PurchaseStats({ p }) {
  const t = totals(S.itemsOf(p.id), S.purchaseById);
  return html`<div class="stats">
    <${Stat} label="товаров" value=${t.count} />
    <${Stat} label="клиентов" value=${clientsInOrder(p).length} />
    <${Stat} label="ждут отправки" value=${t.waiting} />
    <${Stat} label="с треком" value=${t.withTrack} />
    <${Stat} label="отправлено" value=${t.shipped} />
    <${Stat} label="без трека" value=${t.noTrack} />
    <${Stat} label="сумма, ¥" value=${fmtCny(t.fen).replace(' ¥', '')} />
    <${Stat} label="сумма, BYN" value=${fmtByn(t.kop).replace(' BYN', '')} tone="accent" />
  </div>
  <p class="muted small">Всего штук: ${t.qty}</p>
  ${t.noPrice > 0 && html`<p class="warn-text small">Без цены: ${t.noPrice} — они не вошли в суммы.</p>`}`;
}

// Разбивка активной закупки по карго (есть, только если карго заведены): штуки, отправлено, сумма.
// Считается теми же totals(), что и плитки выше, поэтому «Итого» совпадает с «сумма, ¥/BYN».
function CargoCards({ p }) {
  const cargos = S.cargoList();
  if (!cargos.length) return null;
  const { groups, all } = cargoTotals(S.itemsOf(p.id), { cargos, cargoOf: (id) => S.state.clients.get(id)?.cargoId || '', purchaseById: S.purchaseById });
  const card = (icon, name, t, tone = '') => html`<div class="cargo-card ${tone}">
    <div class="cargo-card-h"><span class="cargo-ico" aria-hidden="true">${icon}</span><b>${name}</b></div>
    <div class="small">Всего штук: <b>${t.qty}</b></div>
    <div class="small">Отправлено: <b>${t.shippedQty}</b></div>
    <div class="cargo-sum">${fmtCny(t.fen)}</div>
    <div class="cargo-sum accent-text">${fmtByn(t.kop)}</div>
    ${t.noPrice > 0 && html`<div class="warn-text small">без цены: ${t.noPrice}</div>`}
  </div>`;
  return html`<section class="cargo-cards" aria-label="По карго">
    ${groups.map((g) => (g.cargo ? card('📦', g.cargo.name, g.t) : card('❔', 'Без карго', g.t, 'none')))}
    ${card('🧮', 'Итого', all, 'total')}
  </section>`;
}

// Порядок оформления: кто сейчас оформляется и кнопка «Завершить заказы клиента».
export function OrderingPanel({ p }) {
  const [pick, setPick] = useState(false);
  if (p.archived) return null;
  const open = openSession(p);
  const count = open ? S.itemsOf(p.id).filter((x) => x.clientId === open.clientId).length : 0;
  const start = async (c) => {
    setPick(false);
    await S.startOrdering(p.id, c.id);
    toast(`Оформляю: ${c.name}`);
  };
  const finish = async () => {
    await S.finishOrdering(p.id);
    toast('Граница поставлена. Выберите следующего клиента.');
    setPick(true);
  };
  return html`<section class="card ordering ${open ? 'on' : ''}">
    ${open
      ? html`<div class="ordering-now">Сейчас оформляю: <b>${S.clientName(open.clientId)}</b> · ${count} тов. · с ${timeRu(open.startedAt)}</div>
        <div class="btn-row">
          <a class="btn primary" href=${`#/item/new?p=${p.id}&c=${open.clientId}`}>+ Товар</a>
          <button class="btn" onClick=${finish}>Завершить заказы клиента</button>
        </div>`
      : html`<div class="ordering-now">Начните оформление: выберите клиента, потом оформляйте его товары на Pinduoduo.</div>
        <button class="btn primary block" onClick=${() => setPick(true)}>Начать оформление клиента</button>`}
    ${pick && html`<${ClientPicker} title="Кого оформляем?" onPick=${start} onClose=${() => setPick(false)} />`}
  </section>`;
}

function BackupReminder() {
  const last = S.state.settings.lastBackupAt;
  if (S.state.items.size === 0) return null;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  if (days !== null && days < 3) return null;
  return html`<a class="card warn" href="#/settings">
    ${days === null ? 'Резервная копия ещё не делалась.' : `Резервная копия не делалась ${days} дн.`} Данные лежат только в этом телефоне — сохраните копию.
  </a>`;
}

export function Home() {
  const p = S.activePurchase();
  const open = [...S.state.purchases.values()].filter((x) => !x.archived && !x.deleted);
  return html`<${Header} title="Закупки" right=${html`<a class="icon-btn" href="#/settings" aria-label="Данные и копии">⚙︎</a>`} />
  <main>
    <${BackupReminder} />
    <${GlobalSearch} />
    ${!p
      ? html`<section class="card">
          <h2>Нет активной закупки</h2>
          <p class="muted">Создайте закупку: название, дата и курс юаня.</p>
          <a class="btn primary block" href="#/purchase/new">+ Новая закупка</a>
        </section>`
      : html`<section class="card">
          <a class="card-link" href=${`#/p/${p.id}`}>
            <div class="eyebrow">Активная закупка</div>
            <h2>${p.name}</h2>
            <div class="muted small">${dateRu(p.startDate)} · 1 ¥ = ${formatRate(p.rateMicro)} BYN</div>
          </a>
          <${PurchaseStats} p=${p} />
          <div class="btn-row">
            <a class="btn" href=${`#/p/${p.id}`}>Клиенты закупки</a>
            <a class="btn" href=${`#/p/${p.id}/all`}>Все товары</a>
            <a class="btn" href=${`#/opis/${p.id}`}>Опись</a>
          </div>
        </section>
        <${CargoCards} p=${p} />
        <section class="card take">
          <div><b>Сделали снимки Кнопкой действия?</b> Сами в приложение они не попадают — нажмите:</div>
          <a class="btn primary block big" href="#/import">📥 Забрать из PDD</a>
          <div class="muted small">${S.state.importInfo.lastImportAt ? `Последний раз забирали: ${timeRu(S.state.importInfo.lastImportAt)}` : 'Ещё не забирали ни разу.'}${S.state.importInfo.pending.length ? ` · треков ждут карточку: ${S.state.importInfo.pending.length}` : ''}</div>
          <a class="help-link" href="#/help">Как настроить «Команду» на iPhone</a>
        </section>
        <${OrderingPanel} p=${p} />`}
    ${open.length > 1 && html`<section class="card">
      <div class="eyebrow">Другие открытые закупки</div>
      ${open.filter((x) => x.id !== p?.id).map((x) => html`<div class="row">
        <a class="row-main" href=${`#/p/${x.id}`}><div class="row-title">${x.name}</div></a>
        <button class="btn small" onClick=${() => S.saveSettings({ activePurchaseId: x.id })}>Сделать активной</button>
      </div>`)}
    </section>`}
  </main>`;
}

export function PurchaseList() {
  const [q, setQ] = useState('');
  const list = [...S.state.purchases.values()]
    .filter((x) => !x.archived && !x.deleted && x.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return html`<${Header} title="Закупки" right=${html`<a class="icon-btn" href="#/purchase/new" aria-label="Новая закупка">＋</a>`} />
  <main>
    <a class="btn primary block" href="#/purchase/new">+ Новая закупка</a>
    <${Search} value=${q} onInput=${setQ} placeholder="Найти закупку" />
    <div class="list">
      ${list.map((p) => html`<${PurchaseRow} p=${p} />`)}
    </div>
    ${!list.length && html`<${Empty}>Открытых закупок нет. Завершённые — во вкладке «История».</${Empty}>`}
  </main>`;
}

export function PurchaseRow({ p }) {
  const t = totals(S.itemsOf(p.id), S.purchaseById);
  const active = S.state.settings.activePurchaseId === p.id;
  return html`<a class="row" href=${`#/p/${p.id}`}>
    <div class="row-main">
      <div class="row-title">${p.name} ${active && html`<span class="chip s4">активная</span>`}</div>
      <div class="row-sub">${dateRu(p.startDate)}${p.endDate ? ` — ${dateRu(p.endDate)}` : ''} · ${clientsInOrder(p).length} клиентов · ${t.count} товаров</div>
    </div>
    <div class="row-side"><div class="row-money">${fmtByn(t.kop)}</div></div>
  </a>`;
}

export function PurchaseForm({ id }) {
  const p = id ? S.purchaseById(id) : null;
  const [f, setF] = useState(() => ({
    name: p?.name || `Закупка от ${new Date().toLocaleDateString('ru-RU')}`,
    startDate: p?.startDate || today(),
    endDate: p?.endDate || '',
    rate: p ? formatRate(p.rateMicro) : '',
    stepKop: p?.rounding?.stepKop || 1,
    mode: p?.rounding?.mode || 'math',
  }));
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const rateMicro = parseRate(f.rate);
    if (!f.name.trim()) return setErr('Нужно название');
    if (rateMicro == null || Number.isNaN(rateMicro)) return setErr('Курс: число больше нуля, например 0,4512');
    if (rateMicro > 5_000_000) return setErr('Курс больше 5 BYN за 1 ¥ — похоже, это курс за 10 ¥. Разделите на 10.');
    const data = { name: f.name.trim(), startDate: f.startDate, rateMicro, rounding: { stepKop: Number(f.stepKop), mode: f.mode } };
    if (p) {
      if (p.rateMicro !== rateMicro && !confirm('Курс изменится — все суммы в BYN этой закупки и опись пересчитаются. Цены в юанях останутся. Продолжить?')) return undefined;
      await S.updatePurchase(p.id, { ...data, endDate: f.endDate || null });
      toast('Сохранено');
      go(`/p/${p.id}`);
    } else {
      const np = await S.createPurchase(data);
      go(`/p/${np.id}`);
    }
    return undefined;
  };
  return html`<${Header} title=${p ? 'Закупка' : 'Новая закупка'} back=${true} />
  <main>
    <form class="form card" onSubmit=${save}>
      <label>Название<input value=${f.name} onInput=${set('name')} required /></label>
      <label>Дата закупки<input type="date" value=${f.startDate} onInput=${set('startDate')} /></label>
      ${p && html`<label>Дата завершения<input type="date" value=${f.endDate} onInput=${set('endDate')} /></label>`}
      <label>Курс: сколько BYN за 1 ¥
        <input inputmode="decimal" placeholder="например 0,4512" value=${f.rate} onInput=${set('rate')} />
        <span class="hint">Нацбанк пишет курс за 10 юаней — разделите на 10. Можно поставить свой курс.</span>
      </label>
      <label>Округление цены в BYN
        <select value=${f.stepKop} onChange=${set('stepKop')}>${ROUNDING_STEPS.map((r) => html`<option value=${r.kop}>${r.label}</option>`)}</select>
      </label>
      ${Number(f.stepKop) >= 10 && html`<p class="hint">Округляется сумма строки товара (цена × количество). Очень дешёвые товары могут округлиться до 0 — приложение это покажет.</p>`}
      <label>Как округлять
        <select value=${f.mode} onChange=${set('mode')}>${ROUNDING_MODES.map((r) => html`<option value=${r.id}>${r.label}</option>`)}</select>
      </label>
      ${err && html`<p class="error">${err}</p>`}
      <button class="btn primary block" type="submit">${p ? 'Сохранить' : 'Создать закупку'}</button>
    </form>
  </main>`;
}

export function PurchaseScreen({ id }) {
  const p = S.purchaseById(id);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pick, setPick] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  if (!p) return html`<${Header} title="Закупка" back="/purchases" /><main><${Empty}>Закупка не найдена</${Empty}></main>`;
  const items = S.itemsOf(p.id);
  const deleted = S.itemsOf(p.id, { withDeleted: true }).filter((x) => x.deleted);
  const ro = p.archived;
  const filtering = q.trim() || status;
  const found = filtering
    ? sortItems(items.filter((it) => matchItem(it, q, S.clientName(it.clientId)) && (!status || (status === 'notrack' ? !it.track : it.status === Number(status)))), 'order')
    : [];
  const active = S.state.settings.activePurchaseId === p.id;
  return html`<${Header} title=${p.name} back=${ro ? '/history' : '/purchases'}
    right=${!ro && html`<a class="icon-btn" href=${`#/p/${p.id}/edit`} aria-label="Изменить закупку">✎</a>`} />
  <main>
    ${ro && html`<div class="card info">Закупка в архиве: только просмотр. Чтобы изменить, верните её из архива внизу.</div>`}
    <section class="card">
      <div class="muted small">${dateRu(p.startDate)}${p.endDate ? ` — ${dateRu(p.endDate)}` : ''} · 1 ¥ = ${formatRate(p.rateMicro)} BYN · ${roundingLabel(p.rounding)}</div>
      <${PurchaseStats} p=${p} />
      <div class="btn-row">
        <a class="btn" href=${`#/p/${p.id}/all`}>Все товары</a>
        <a class="btn" href=${`#/opis/${p.id}`}>Опись</a>
        ${!ro && !active && html`<button class="btn" onClick=${() => S.saveSettings({ activePurchaseId: p.id })}>Сделать активной</button>`}
      </div>
    </section>
    <${OrderingPanel} p=${p} />

    <div class="filters">
      <${Search} value=${q} onInput=${setQ} placeholder="Товар, трек, номер заказа, клиент" />
      <select value=${status} onChange=${(e) => setStatus(e.target.value)} aria-label="Фильтр по статусу">
        <option value="">Все статусы</option>
        <option value="notrack">Без трека</option>
        ${STATUSES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
      </select>
    </div>
    ${filtering
      ? html`<div class="list">${found.map((it) => html`<${ItemRow} item=${it} showClient=${true} />`)}</div>
        ${!found.length && html`<${Empty}>Ничего не найдено</${Empty}>`}`
      : html`<h3>Клиенты</h3>
        <div class="list">
          ${clientsInOrder(p).map((cid) => {
            const its = items.filter((x) => x.clientId === cid);
            const t = totals(its, S.purchaseById);
            return html`<a class="row" href=${`#/p/${p.id}/c/${cid}`}>
              <div class="row-main"><div class="row-title">${S.clientName(cid)}</div>
                <div class="row-sub">${t.count} тов. · ждут отправки ${t.waiting} · без трека ${t.noTrack}</div></div>
              <div class="row-side"><div class="row-money">${fmtByn(t.kop)}</div><div class="muted small">${fmtCny(t.fen)}</div></div>
            </a>`;
          })}
        </div>
        ${!clientsInOrder(p).length && html`<${Empty}>Клиентов пока нет</${Empty}>`}
        ${!ro && html`<button class="btn block" onClick=${() => setPick(true)}>+ Добавить клиента в закупку</button>`}`}

    ${p.sessions?.length > 0 && html`<section class="card">
      <button class="linkish" onClick=${() => setShowOrder(!showOrder)}>${showOrder ? '▾' : '▸'} Порядок оформления (${p.sessions.length})</button>
      ${showOrder && html`<ol class="sessions">${p.sessions.map((s) => html`<li><b>${S.clientName(s.clientId)}</b> · ${timeRu(s.startedAt)} — ${s.endedAt ? timeRu(s.endedAt) : 'сейчас'}</li>`)}</ol>
        <p class="muted small">По этим границам заказы Pinduoduo будут разложены по клиентам, когда появится импорт заказов.</p>`}
    </section>`}

    ${deleted.length > 0 && html`<section class="card">
      <div class="eyebrow">Удалённые товары (${deleted.length})</div>
      ${deleted.map((it) => html`<div class="row"><div class="row-main"><div class="row-title">${it.name || it.nameCn}</div><div class="row-sub">${S.clientName(it.clientId)}</div></div>
        ${!ro && html`<button class="btn small" onClick=${() => S.restoreItem(it.id)}>Вернуть</button>`}</div>`)}
    </section>`}

    <button class="btn block ${ro ? 'primary' : ''}" onClick=${async () => {
      if (!ro && !confirm('Перенести закупку в архив? Она останется в «Истории», её можно будет вернуть.')) return;
      await S.archivePurchase(p.id, !ro);
      toast(ro ? 'Закупка снова открыта' : 'Закупка в архиве');
    }}>${ro ? 'Вернуть из архива' : 'Завершить закупку (в архив)'}</button>
    ${pick && html`<${ClientPicker} title="Добавить клиента" excludeIds=${p.clientIds} onClose=${() => setPick(false)}
      onPick=${async (c) => { setPick(false); await S.addClientToPurchase(p.id, c.id); }} />`}
  </main>`;
}

// Клиент внутри закупки: его товары, сортировка, поиск, итог.
export function PurchaseClient({ pid, cid }) {
  const p = S.purchaseById(pid);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('order');
  const [status, setStatus] = useState('');
  if (!p) return html`<${Header} title="Закупка" back="/purchases" /><main><${Empty}>Не найдено</${Empty}></main>`;
  const all = S.itemsOf(pid).filter((x) => x.clientId === cid);
  const list = sortItems(all.filter((it) => matchItem(it, q) && (!status || (status === 'notrack' ? !it.track : it.status === Number(status)))), sort);
  const t = totals(all, S.purchaseById);
  const open = openSession(p);
  return html`<${Header} title=${S.clientName(cid)} back=${`/p/${pid}`} />
  <main>
    <section class="card">
      <div class="muted small">${p.name}</div>
      <div class="stats three">
        <${Stat} label="товаров" value=${t.count} />
        <${Stat} label="сумма, ¥" value=${fmtCny(t.fen).replace(' ¥', '')} />
        <${Stat} label="сумма, BYN" value=${fmtByn(t.kop).replace(' BYN', '')} tone="accent" />
      </div>
      ${t.noPrice > 0 && html`<p class="warn-text small">Без цены: ${t.noPrice}</p>`}
      <div class="btn-row">
        ${!p.archived && html`<a class="btn primary" href=${`#/item/new?p=${pid}&c=${cid}`}>+ Товар</a>`}
        ${!p.archived && (open?.clientId === cid
          ? html`<button class="btn" onClick=${async () => { await S.finishOrdering(pid); toast('Граница поставлена'); go(`/p/${pid}`); }}>Завершить заказы клиента</button>`
          : html`<button class="btn" onClick=${async () => { await S.startOrdering(pid, cid); toast('Оформляю этого клиента'); }}>Оформлять этого клиента</button>`)}
        <a class="btn" href=${`#/client/${cid}`}>Карточка клиента</a>
        ${!p.archived && all.length === 0 && open?.clientId !== cid && html`<button class="btn danger" onClick=${async () => {
          await S.removeClientFromPurchase(pid, cid);
          toast('Клиент убран из закупки');
          go(`/p/${pid}`);
        }}>Убрать из закупки</button>`}
      </div>
    </section>
    <div class="filters">
      <${Search} value=${q} onInput=${setQ} placeholder="Поиск товара" />
      <select value=${sort} onChange=${(e) => setSort(e.target.value)} aria-label="Сортировка">
        <option value="order">По порядку оформления</option>
        <option value="dateDesc">Сначала новые</option>
        <option value="status">По статусу</option>
        <option value="name">По названию</option>
      </select>
      <select value=${status} onChange=${(e) => setStatus(e.target.value)} aria-label="Фильтр по статусу">
        <option value="">Все статусы</option>
        <option value="notrack">Без трека</option>
        ${STATUSES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
      </select>
    </div>
    <div class="list">${list.map((it) => html`<${ItemRow} item=${it} />`)}</div>
    ${!list.length && html`<${Empty}>${all.length ? 'Ничего не найдено' : 'Товаров пока нет'}</${Empty}>`}
  </main>`;
}

// Все товары всех клиентов закупки одним списком: у каждого товара подписан клиент.
// Это вид поверх тех же товаров: нажатие открывает карточку товара, правка видна везде.
export function PurchaseAllItems({ id }) {
  const p = S.purchaseById(id);
  const [q, setQ] = useState('');
  const [cid, setCid] = useState('');
  const [sort, setSort] = useState('client');
  const [copied, setCopied] = useState(null);
  if (!p) return html`<${Header} title="Все товары" back="/purchases" /><main><${Empty}>Закупка не найдена</${Empty}></main>`;
  const items = S.itemsOf(p.id);
  const order = clientsInOrder(p);
  const withItems = [...new Set([...order, ...items.map((x) => x.clientId)])].filter((c) => items.some((x) => x.clientId === c));
  const list = allItemsList(items, { q, clientId: cid, sort }, { clientName: S.clientName, clientOrder: order });
  const t = totals(list, S.purchaseById);
  // Для «Посылок»: все товары закупки (или выбранного клиента) по очереди, с треком.
  const copyForParcels = async () => {
    const r = parcelsText(p.name, cid ? items.filter((x) => x.clientId === cid) : items, { clientName: S.clientName, clientOrder: order });
    setCopied({ ...r, ok: r.copied ? await copyText(r.text) : true });
  };
  return html`<${Header} title="Все товары" back=${`/p/${p.id}`} />
  <main>
    <div class="muted small">${p.name} · ${items.length} тов. · ${withItems.length} клиентов</div>
    <div class="filters">
      <${Search} value=${q} onInput=${setQ} placeholder="Товар, трек, номер заказа, клиент" />
      <select value=${cid} onChange=${(e) => setCid(e.target.value)} aria-label="Клиент">
        <option value="">Все клиенты</option>
        ${withItems.map((c) => html`<option value=${c}>${S.clientName(c)} (${items.filter((x) => x.clientId === c).length})</option>`)}
      </select>
      <select value=${sort} onChange=${(e) => setSort(e.target.value)} aria-label="Сортировка">
        <option value="client">По клиентам</option>
        <option value="new">Сначала новые</option>
        <option value="old">Сначала старые</option>
      </select>
    </div>
    <button class="btn block" disabled=${!items.length} onClick=${copyForParcels}>📋 Скопировать для «Посылок»${cid ? `: ${S.clientName(cid)}` : ''}</button>
    ${(q.trim() || cid) && html`<p class="muted small">Найдено: ${t.count} · ${fmtByn(t.kop)}</p>`}
    <div class="list">${list.map((it, i) => html`<${ItemRow} item=${it} clientTag=${true} num=${i + 1} />`)}</div>
    ${!list.length && html`<${Empty}>${items.length ? 'Ничего не найдено' : 'Товаров пока нет'}</${Empty}>`}
    ${copied && html`<${CopiedSheet} r=${copied} title="Для «Посылок»" hint="Откройте «Посылки» и вставьте." onClose=${() => setCopied(null)} />`}
  </main>`;
}

export { roundingLabel };
