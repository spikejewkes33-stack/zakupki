// «Забрать» из «Команды»: выбрать файл PDD.txt (или вставить текст) → сводка → поправить → применить.
import { html, useState, Header, Empty, ClientPicker, go, timeRu, toast } from '../ui.js';
import * as S from '../store.js';
import { splitBlocks, buildPlan } from '../pddimport.js';
import { centsToInput, parseCents, fmtCny, fmtByn, itemMoney } from '../money.js';
import { statusLabel, itemTitle } from '../model.js';

function makePlan(text) {
  const blocks = splitBlocks(text);
  const plan = buildPlan(blocks, {
    items: [...S.state.items.values()],
    purchases: S.state.purchases,
    activePurchaseId: S.activePurchase()?.id || null,
    importedIds: new Set(S.state.importInfo.blockIds),
    pending: S.state.importInfo.pending,
    translations: S.state.importInfo.translations,
  });
  return { blocks: blocks.length, ...plan };
}

function NewItemCard({ n, update, multiPurchase }) {
  const [pick, setPick] = useState(false);
  const p = S.purchaseById(n.purchaseId);
  const m = itemMoney({ qty: n.qty, paidFen: n.paidFen }, p);
  return html`<div class=${`card import-item ${n.skip ? 'off' : ''}`}>
    <label class="check"><input type="checkbox" checked=${!n.skip} onChange=${(e) => update({ skip: !e.target.checked })} /> Добавить</label>
    <div class="muted small">${n.time ? timeRu(n.time) : 'время нажатия неизвестно'}${multiPurchase && p ? ` · ${p.name}` : ''} · заказ ${n.pddOrderNo || '—'}</div>
    <button class=${`btn block left ${n.clientId ? '' : 'warn-btn'}`} onClick=${() => setPick(true)}>
      ${n.clientId ? `${S.clientName(n.clientId)}${n.clientBy === 'time' ? ' · по времени' : ''}` : 'Выбрать клиента'}
    </button>
    <div class="cn">${n.nameCn || '(название не распознано)'}</div>
    ${n.variant && html`<div class="muted small">Вариант: ${n.variant}</div>`}
    <label class="small">Название по-русски (для описи)
      <input value=${n.name} onInput=${(e) => update({ name: e.target.value })} placeholder="можно позже" /></label>
    <div class="grid2">
      <label class="small">Количество<input inputmode="numeric" value=${n.qty} onInput=${(e) => update({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
      <label class="small">Оплачено (实付), ¥<input inputmode="decimal" value=${centsToInput(n.paidFen)}
        onChange=${(e) => { const v = parseCents(e.target.value); update({ paidFen: Number.isNaN(v) ? n.paidFen : v }); }} /></label>
    </div>
    <div class="small">${fmtCny(m.totalFen)} → ${fmtByn(m.totalKop)}${n.qty > 1 ? ` · за 1 шт ≈ ${fmtCny(m.unitFen)}` : ''}</div>
    ${n.track && html`<div class="small">Трек: <span class="mono">${n.track}</span> · ${n.carrier} · ${statusLabel(n.status)}</div>`}
    ${n.doubts.length > 0 && html`<div class="warn-text small">Проверьте: ${n.doubts.join('; ')}</div>`}
    ${pick && html`<${ClientPicker} title="Чей товар?" onClose=${() => setPick(false)} onPick=${(c) => { setPick(false); update({ clientId: c.id, clientBy: 'hand' }); }} />`}
  </div>`;
}

export function ImportScreen() {
  const [plan, setPlan] = useState(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (text) => {
    const pl = makePlan(text);
    if (!pl.blocks) return toast('В файле нет блоков «Команды» (строк ===PDD===)');
    setPlan(pl);
    return undefined;
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) load(await f.text());
  };
  const setNew = (i, patch) => setPlan({ ...plan, newItems: plan.newItems.map((n, k) => (k === i ? { ...n, ...patch } : n)) });

  if (!plan) {
    return html`<${Header} title="Забрать из PDD" back=${true} />
    <main>
      <section class="card">
        <p>Нажимайте Кнопку действия на экране заказа и на экране логистики в Pinduoduo. «Команда» копит текст в файле <b>PDD.txt</b> (iCloud Drive → Shortcuts).</p>
        <p>Здесь выберите этот файл — приложение само разложит товары по клиентам и привяжет треки. Перед записью покажет, что сделает.</p>
        <label class="btn primary block file-btn">Выбрать файл PDD.txt<input type="file" accept=".txt,text/plain" onChange=${onFile} /></label>
        <button class="linkish" onClick=${() => setShowPaste(!showPaste)}>${showPaste ? '▾' : '▸'} или вставить текст</button>
        ${showPaste && html`<textarea rows="6" value=${paste} onInput=${(e) => setPaste(e.target.value)} placeholder="===PDD===…"></textarea>
          <button class="btn block" onClick=${() => load(paste)}>Разобрать</button>`}
        <p class="muted small">Тот же файл можно забирать много раз: уже забранное не задвоится.</p>
      </section>
      ${S.state.importInfo.pending.length > 0 && html`<section class="card">
        <div class="eyebrow">Треки ждут карточку (${S.state.importInfo.pending.length})</div>
        ${S.state.importInfo.pending.map((t) => html`<div class="row"><div class="row-main"><div class="row-title mono">${t.track}</div>
          <div class="row-sub">заказ ${t.orderNo || '—'} · ${t.carrier}</div></div>
          <button class="btn small" onClick=${() => S.dropPending(t.blockId)}>Убрать</button></div>`)}
        <p class="muted small">Привяжутся сами, когда появится карточка с этим номером заказа (снимок экрана заказа).</p>
      </section>`}
    </main>`;
  }

  const active = plan.newItems.filter((n) => !n.skip);
  const noClient = active.filter((n) => !n.clientId || !n.purchaseId).length;
  const realTracks = plan.tracks.filter((t) => !t.skip && Object.keys(t.patch).length);
  const tracks = realTracks.length + active.filter((n) => n.track).length;
  const multiPurchase = new Set(plan.newItems.map((n) => n.purchaseId)).size > 1;
  // Нечего записывать — только если в файле нет ни одного нового понятного снимка.
  const nothing = !active.length && !plan.tracks.length && !plan.updates.length && !plan.pending.length && !(plan.pendingResolved || []).length;
  const onlySeen = !active.length && !realTracks.length && !plan.updates.some((u) => Object.keys(u.patch).length) && !plan.pending.length;

  const apply = async () => {
    setBusy(true);
    try {
      const r = await S.applyImport(plan);
      toast(`Готово: товаров ${r.created}, треков ${r.tracks}`);
      const pid = active[0]?.purchaseId || S.activePurchase()?.id;
      go(pid ? `/p/${pid}` : '/');
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
      setBusy(false);
    }
  };

  return html`<${Header} title="Забрать из PDD" back=${true} />
  <main>
    <section class="card">
      <div class="eyebrow">Что сделаю</div>
      <div>Новых товаров: <b>${active.length}</b>${noClient ? html` · <span class="warn-text">без клиента: ${noClient}</span>` : ''}</div>
      <div>Треков привяжу: <b>${tracks}</b></div>
      ${plan.updates.some((u) => Object.keys(u.patch).length) && html`<div>Дополню карточки: <b>${plan.updates.filter((u) => Object.keys(u.patch).length).length}</b></div>`}
      ${plan.pending.length > 0 && html`<div>Треков без карточки (подождут): <b>${plan.pending.length}</b></div>`}
      ${plan.unknown.length > 0 && html`<div class="warn-text">Не понял снимков: <b>${plan.unknown.length}</b></div>`}
      ${plan.skipped > 0 && html`<div class="muted">Уже забирали раньше: ${plan.skipped}</div>`}
      ${noClient > 0 && html`<button class="btn block" onClick=${() => setBulk(true)}>Назначить клиента всем без клиента</button>`}
      <button class="btn primary block" disabled=${busy || noClient > 0 || nothing} onClick=${apply}>${noClient ? 'Сначала выберите клиентов' : nothing ? 'Нечего добавлять' : onlySeen ? 'Отметить как забранное' : 'Записать'}</button>
      <button class="btn block" onClick=${() => setPlan(null)}>Отмена</button>
    </section>

    ${plan.newItems.length > 0 && html`<h3>Новые товары</h3>
      ${plan.newItems.map((n, i) => html`<${NewItemCard} key=${n.blockId} n=${n} multiPurchase=${multiPurchase} update=${(patch) => setNew(i, patch)} />`)}`}

    ${plan.tracks.length > 0 && html`<h3>Треки к товарам</h3>
      <div class="list">${plan.tracks.map((t, i) => {
        const it = S.state.items.get(t.itemId);
        return html`<label class="row check-row">
          <input type="checkbox" checked=${!t.skip} onChange=${(e) => setPlan({ ...plan, tracks: plan.tracks.map((x, k) => (k === i ? { ...x, skip: !e.target.checked } : x)) })} />
          <div class="row-main"><div class="row-title mono">${t.track}</div>
            <div class="row-sub">${itemTitle(it)} · ${S.clientName(it.clientId)} · ${t.carrier} · ${statusLabel(Math.max(it.status, t.status))}</div>
            ${t.replaces && html`<div class="warn-text small">Заменит трек ${t.replaces}</div>`}
            ${!Object.keys(t.patch).length && html`<div class="muted small">уже записан</div>`}</div>
        </label>`;
      })}</div>`}

    ${plan.pending.length > 0 && html`<h3>Треки без карточки</h3>
      <div class="list">${plan.pending.map((t) => html`<div class="row"><div class="row-main"><div class="row-title mono">${t.track}</div>
        <div class="row-sub">заказ ${t.orderNo || '—'} · ${t.carrier}. Привяжется, когда появится снимок экрана этого заказа.</div></div></div>`)}</div>`}

    ${plan.unknown.length > 0 && html`<h3>Не понял</h3>
      ${plan.unknown.map((u) => html`<div class="card small"><div class="muted">${u.time ? timeRu(u.time) : ''} · ${u.doubts.join('; ')}</div>
        <pre class="raw">${u.preview.join('\n')}</pre></div>`)}
      <p class="muted small">Эти снимки не записываются. Можно переснять экран заказа или логистики.</p>`}

    ${!plan.newItems.length && !plan.tracks.length && !plan.unknown.length && !plan.pending.length && html`<${Empty}>Новых снимков в файле нет — всё уже забрано.</${Empty}>`}
    ${bulk && html`<${ClientPicker} title="Клиент для всех без клиента" onClose=${() => setBulk(false)} onPick=${(c) => {
      setBulk(false);
      const pid = S.activePurchase()?.id;
      setPlan({ ...plan, newItems: plan.newItems.map((n) => (n.clientId ? n : { ...n, clientId: c.id, clientBy: 'hand', purchaseId: n.purchaseId || pid })) });
    }} />`}
  </main>`;
}
