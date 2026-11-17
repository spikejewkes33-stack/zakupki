// Карточка товара: создание, правка, перенос другому клиенту, фото, история изменений.
import { html, useState, useEffect, Header, Empty, ClientPicker, go, dateRu, timeRu, toast } from '../ui.js';
import * as S from '../store.js';
import { emptyItem, validateItem, STATUSES, statusLabel, FIELD_LABELS } from '../model.js';
import { centsToInput, fmtCny, fmtByn, formatRate, itemMoney } from '../money.js';

// Сжать фото до 1000 px по длинной стороне (JPEG), чтобы сотни фото помещались в телефоне.
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('не открылась картинка'));
      i.src = url;
    });
    const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    if (!blob) throw new Error('не удалось сжать');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Photo({ id }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    if (id) S.getPhoto(id).then((p) => p && setUrl((u = URL.createObjectURL(p.blob))));
    return () => u && URL.revokeObjectURL(u);
  }, [id]);
  return url ? html`<img class="photo" src=${url} alt="Фото товара" />` : null;
}

export function formatChange(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'unitFen') return fmtCny(v);
  if (field === 'status') return statusLabel(v);
  if (field === 'clientId') return S.clientName(v);
  if (field === 'photoId') return 'фото';
  if (field === 'rateMicro') return formatRate(v);
  if (field === 'deleted' || field === 'archived') return v ? 'да' : 'нет';
  if (typeof v === 'object') return '…';
  return String(v);
}

const ACTIONS = { import: 'Из «Команды» (PDD)', create: 'Создан', update: 'Изменён', move: 'Перенесён другому клиенту', delete: 'Удалён', restore: 'Восстановлен' };

export function History({ id }) {
  const ev = S.eventsFor(id);
  if (!ev.length) return null;
  return html`<section class="card">
    <div class="eyebrow">История изменений</div>
    <ul class="history">${ev.map((e) => html`<li>
      <div class="muted small">${timeRu(e.at)} · ${ACTIONS[e.action] || e.action}</div>
      ${e.action !== 'create' && Object.entries(e.changes).map(([f, [a, b]]) => html`<div class="small">${FIELD_LABELS[f] || f}: ${formatChange(f, a)} → <b>${formatChange(f, b)}</b></div>`)}
    </li>`)}</ul>
  </section>`;
}

export function ItemForm({ id, query }) {
  const existing = id ? S.state.items.get(id) : null;
  const pid = existing?.purchaseId || query.get('p') || S.activePurchase()?.id;
  const p = S.purchaseById(pid);
  const init = () => {
    const base = existing || emptyItem(pid, query.get('c') || '');
    return { ...base, nameCn: base.nameCn || '', variant: base.variant || '', qty: String(base.qty), unitFen: centsToInput(base.unitFen), paidFen: centsToInput(base.paidFen ?? null) };
  };
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState({});
  const [warn, setWarn] = useState([]);
  const [confirmed, setConfirmed] = useState('');
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(init());
    setErrors({});
    setWarn([]);
    setConfirmed('');
  }, [id, query.toString()]);

  if (!p) return html`<${Header} title="Товар" back=${true} /><main><${Empty}>Сначала создайте закупку. <a href="#/purchase/new">Создать</a></${Empty}></main>`;
  const ro = p.archived;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const preview = validateItem(f, [], existing?.id);
  const m = itemMoney(preview.item, p);

  const save = async (addMore) => {
    if (busy) return;
    const v = validateItem(f, [...S.state.items.values()], existing?.id);
    setErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    const key = v.warnings.join('|');
    if (v.warnings.length && confirmed !== key) {
      setWarn(v.warnings);
      setConfirmed(key);
      return;
    }
    if (existing && existing.clientId !== v.item.clientId
      && !confirm(`Перенести товар от «${S.clientName(existing.clientId)}» к «${S.clientName(v.item.clientId)}»?`)) return;
    setBusy(true);
    const saved = await S.saveItem({ ...v.item, id: existing?.id, purchaseId: pid });
    setBusy(false);
    toast(existing ? 'Сохранено' : 'Товар добавлен');
    if (addMore) go(`/item/new?p=${pid}&c=${saved.clientId}&n=${Date.now()}`);
    else if (existing) history.back();
    else go(`/p/${pid}/c/${saved.clientId}`);
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await shrinkPhoto(file);
      const photoId = await S.savePhoto(blob);
      setF({ ...f, photoId });
    } catch (err) {
      toast(`Фото не добавилось: ${err.message}`);
    }
  };

  return html`<${Header} title=${existing ? 'Товар' : 'Новый товар'} back=${true} />
  <main>
    ${ro && html`<div class="card info">Закупка в архиве: только просмотр.</div>`}
    <form class="form card" onSubmit=${(e) => { e.preventDefault(); save(false); }}>
      <fieldset disabled=${ro}>
      <div class="field">
        <span>Клиент *</span>
        <button type="button" class="btn block left" onClick=${() => setPick(true)}>${f.clientId ? S.clientName(f.clientId) : 'Выбрать клиента'}</button>
        ${errors.clientId && html`<span class="error">${errors.clientId}</span>`}
      </div>
      <label>Название по-русски (для описи)${f.nameCn ? '' : ' *'}<input value=${f.name} onInput=${set('name')} placeholder="например, Шарф" autocomplete="off" />
        ${errors.name && html`<span class="error">${errors.name}</span>`}
        ${f.nameCn && !f.name && html`<span class="hint warn-text">Нет русского названия — в описи будет предупреждение.</span>`}</label>
      ${(f.nameCn || existing?.importBlockId) && html`<label>Название из PDD<textarea rows="2" value=${f.nameCn} onInput=${set('nameCn')}></textarea></label>`}
      ${(f.variant || f.nameCn) && html`<label>Вариант из PDD<input value=${f.variant} onInput=${set('variant')} /></label>`}
      <div class="grid2">
        <label>Цвет<input value=${f.color} onInput=${set('color')} /></label>
        <label>Размер<input value=${f.size} onInput=${set('size')} /></label>
      </div>
      <label>Комплектация<input value=${f.kit} onInput=${set('kit')} /></label>
      <div class="grid2">
        <label>Количество<input inputmode="numeric" value=${f.qty} onInput=${set('qty')} />
          ${errors.qty && html`<span class="error">${errors.qty}</span>`}</label>
        <label>Цена за 1 шт, ¥<input inputmode="decimal" value=${f.paidFen ? centsToInput(m.unitFen) : f.unitFen} disabled=${!!f.paidFen} onInput=${set('unitFen')} placeholder="0,00" />
          ${errors.unitFen && html`<span class="error">${errors.unitFen}</span>`}</label>
      </div>
      <label>Оплачено всего (实付), ¥ — если заполнено, главнее цены за штуку
        <input inputmode="decimal" value=${f.paidFen} onInput=${set('paidFen')} placeholder="необязательно" />
        ${errors.paidFen && html`<span class="error">${errors.paidFen}</span>`}</label>
      <div class="money-box">
        <div>Итого: <b>${fmtCny(m.totalFen)}</b></div>
        <div>Курс закупки: 1 ¥ = ${formatRate(p.rateMicro)} BYN</div>
        <div>Итого: <b>${fmtByn(m.totalKop)}</b> · за 1 шт ≈ ${fmtByn(m.unitKop)}</div>
        ${m.zero && html`<div class="warn-text">При этом округлении товар стоит 0 BYN.</div>`}
      </div>
      <label>Статус<select value=${f.status} onChange=${set('status')}>${STATUSES.map((s) => html`<option value=${s.id}>${s.id}. ${s.label}</option>`)}</select></label>
      <div class="grid2">
        <label>Дата заказа<input type="date" value=${f.orderDate} onInput=${set('orderDate')} /></label>
        <label>Номер заказа PDD<input value=${f.pddOrderNo} onInput=${set('pddOrderNo')} placeholder="можно позже" autocomplete="off" /></label>
      </div>
      <div class="grid2">
        <label>Трек-номер<input value=${f.track} onInput=${set('track')} placeholder="появится после отправки" autocomplete="off" /></label>
        <label>Транспортная компания<input value=${f.carrier} onInput=${set('carrier')} /></label>
      </div>
      <label>Ссылка на Pinduoduo<input type="url" value=${f.url} onInput=${set('url')} placeholder="https://…" /></label>
      ${f.url && /^https?:\/\//.test(f.url) && html`<a class="small" href=${f.url} target="_blank" rel="noopener">Открыть ссылку</a>`}
      <div class="field"><span>Фото</span>
        <${Photo} id=${f.photoId} />
        <input type="file" accept="image/*" onChange=${onPhoto} />
        ${f.photoId && html`<button type="button" class="btn small" onClick=${() => setF({ ...f, photoId: null })}>Убрать фото</button>`}
      </div>
      <label>Заметка<textarea rows="2" value=${f.note} onInput=${set('note')}></textarea></label>
      <div class="muted small">Дата закупки: ${dateRu(p.startDate)} · ${p.name}</div>
      ${warn.length > 0 && html`<div class="card warn">${warn.map((w) => html`<div>${w}</div>`)}<div><b>Нажмите «Сохранить» ещё раз, если всё верно.</b></div></div>`}
      <div class="btn-row sticky-actions">
        <button class="btn primary" type="submit" disabled=${busy}>Сохранить</button>
        ${!existing && html`<button class="btn" type="button" disabled=${busy} onClick=${() => save(true)}>Сохранить и ещё</button>`}
      </div>
      </fieldset>
    </form>
    ${existing && !ro && html`<button class="btn block danger" onClick=${async () => {
      if (!existing.deleted && !confirm('Удалить товар? Его можно будет вернуть на экране закупки.')) return;
      await (existing.deleted ? S.restoreItem(existing.id) : S.deleteItem(existing.id));
      toast(existing.deleted ? 'Товар возвращён' : 'Товар удалён');
      if (!existing.deleted) history.back();
    }}>${existing.deleted ? 'Вернуть товар' : 'Удалить товар'}</button>`}
    ${existing && html`<${History} id=${existing.id} />`}
    ${pick && html`<${ClientPicker} title="Чей товар?" onClose=${() => setPick(false)} onPick=${(c) => { setPick(false); setF({ ...f, clientId: c.id }); }} />`}
  </main>`;
}
