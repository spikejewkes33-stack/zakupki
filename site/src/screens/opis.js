// Опись закупки: объединение похожих, правка, исключение, PDF и Excel.
import { html, useState, Header, Empty, Sheet, FileReady, go, toast } from '../ui.js';
import * as S from '../store.js';
import { buildOpis, exportRows } from '../opis.js';
import { fmtByn, formatCents } from '../money.js';
import { pdfBlob, xlsxBlob, fileName } from '../export.js';

const MODES = [
  { id: 'total', label: 'Сумма' },
  { id: 'unit', label: 'Цена за ед.' },
  { id: 'both', label: 'Обе' },
];

export async function makeFile(doc, kind) {
  const blob = kind === 'pdf' ? await pdfBlob(doc) : await xlsxBlob(doc);
  return { blob, name: fileName(doc, kind === 'pdf' ? 'pdf' : 'xlsx') };
}

function RowSheet({ p, row, rows, ro, onClose }) {
  const [f, setF] = useState({ name: row.name, qty: String(row.qty), unit: row.unit });
  const [mergeWith, setMergeWith] = useState('');
  const save = async () => {
    const qty = Number(f.qty);
    if (!Number.isInteger(qty) || qty < 1) return toast('Количество — целое число от 1');
    await S.opisEdit(p.id, row.keys, {
      name: f.name.trim() && f.name.trim() !== row.autoName ? f.name.trim() : null,
      qty: qty !== row.countedQty ? qty : null,
      unit: f.unit.trim() && f.unit.trim() !== 'шт.' ? f.unit.trim() : null,
    });
    onClose();
    return undefined;
  };
  return html`<${Sheet} title="Строка описи" onClose=${onClose}>
    <fieldset class="form" disabled=${ro}>
      <label>Название в описи<input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
      <div class="grid2">
        <label>Количество<input inputmode="numeric" value=${f.qty} onInput=${(e) => setF({ ...f, qty: e.target.value })} /></label>
        <label>Единица<input value=${f.unit} onInput=${(e) => setF({ ...f, unit: e.target.value })} placeholder="шт., пар" /></label>
      </div>
      <p class="muted small">По товарам: ${row.countedQty} шт. на ${fmtByn(row.totalKop)}. Сумма берётся из реальных цен; при правке количества меняется цена за единицу.</p>
      <button class="btn primary block" onClick=${save}>Сохранить</button>
      <div class="btn-row">
        <button class="btn" onClick=${async () => { await S.opisEdit(p.id, row.keys, { excluded: !row.excluded }); onClose(); }}>${row.excluded ? 'Вернуть в опись' : 'Исключить из описи'}</button>
        ${row.edited && html`<button class="btn" onClick=${async () => { await S.opisEdit(p.id, row.keys, { name: null, qty: null, unit: null }); onClose(); }}>Сбросить правки</button>`}
        ${row.merged && html`<button class="btn" onClick=${async () => { await S.opisSplit(p.id, row.keys); onClose(); }}>Разъединить</button>`}
      </div>
      <label>Объединить с другой строкой
        <select value=${mergeWith} onChange=${(e) => setMergeWith(e.target.value)}>
          <option value="">— выбрать —</option>
          ${rows.filter((r) => r.key !== row.key).map((r) => html`<option value=${r.key}>${r.name} (${r.qty})</option>`)}
        </select>
      </label>
      ${mergeWith && html`<button class="btn block" onClick=${async () => { await S.opisMerge(p.id, row.key, mergeWith); onClose(); }}>Объединить</button>`}
    </fieldset>
    <div class="eyebrow">Из каких названий собрана строка</div>
    <ul class="small">${row.sourceNames.map((n) => html`<li>${n}</li>`)}</ul>
  </${Sheet}>`;
}

export function OpisScreen({ id }) {
  const purchases = [...S.state.purchases.values()].filter((x) => !x.deleted).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const p = S.purchaseById(id) || S.activePurchase() || purchases[0];
  const mode = S.state.settings.opisMode || 'both';
  const [open, setOpen] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  if (!p) return html`<${Header} title="Опись" /><main><${Empty}>Закупок пока нет. <a href="#/purchase/new">Создать</a></${Empty}></main>`;
  const ro = p.archived;
  const o = buildOpis(S.itemsOf(p.id), p);
  const visible = o.rows.filter((r) => !r.excluded);
  const excluded = o.rows.filter((r) => r.excluded);
  const showUnit = mode !== 'total';
  const showTotal = mode !== 'unit';

  const exportAs = async (kind) => {
    setBusy(kind);
    try {
      const doc = await S.saveDoc({
        kind: 'opis', purchaseId: p.id, title: p.name, mode,
        rows: exportRows(o), totalKop: o.totalKop, totalQty: o.totalQty,
      });
      setFile(await makeFile(doc, kind));
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
    setBusy('');
  };

  return html`<${Header} title="Опись" />
  <main>
    <select class="block-select" value=${p.id} onChange=${(e) => go(`/opis/${e.target.value}`)} aria-label="Закупка">
      ${purchases.map((x) => html`<option value=${x.id}>${x.name}${x.archived ? ' (архив)' : ''}</option>`)}
    </select>
    <div class="seg" role="group" aria-label="Что показывать">
      ${MODES.map((m) => html`<button class=${mode === m.id ? 'on' : ''} onClick=${() => S.saveSettings({ opisMode: m.id })}>${m.label}</button>`)}
    </div>
    <p class="muted small">В опись не попадают имена клиентов, треки и номера заказов. Товары в базе не меняются.</p>

    ${!ro && o.suggestions.length > 0 && html`<section class="card warn">
      <div class="eyebrow">Похоже на одно и то же? (${o.suggestions.length})</div>
      ${o.suggestions.slice(0, 10).map((s) => html`<div class="suggest">
        <div>«${s.a.name}» (${s.a.qty}) и «${s.b.name}» (${s.b.qty})</div>
        <div class="btn-row">
          <button class="btn small primary" onClick=${() => S.opisMerge(p.id, s.a.key, s.b.key)}>Объединить</button>
          <button class="btn small" onClick=${() => S.opisReject(p.id, s.a.key, s.b.key)}>Нет, разные</button>
        </div>
      </div>`)}
    </section>`}
    ${o.noPrice > 0 && html`<div class="card warn">${o.noPrice} шт. без цены — их стоимость не посчитана. Укажите цены в товарах.</div>`}

    <section class="card opis">
      <div class="opis-head"><span>№</span><span>Наименование</span><span>Кол-во</span>${showUnit && html`<span>Цена</span>`}${showTotal && html`<span>Сумма</span>`}</div>
      ${visible.map((r) => html`<button class="opis-row" onClick=${() => setOpen(r.key)}>
        <span>${r.n}</span>
        <span>${r.name}${r.merged ? html` <span class="chip s3" title="объединено">∪</span>` : ''}${r.edited ? html` <span class="muted">✎</span>` : ''}</span>
        <span>${r.qty} ${r.unit}</span>
        ${showUnit && html`<span>${formatCents(r.avgKop)}</span>`}
        ${showTotal && html`<span>${formatCents(r.totalKop)}</span>`}
      </button>`)}
      ${!visible.length && html`<${Empty}>В закупке нет товаров</${Empty}>`}
      <div class="opis-total">Итого: ${o.totalQty} ед. · <b>${fmtByn(o.totalKop)}</b></div>
    </section>

    <div class="btn-row">
      <button class="btn primary" disabled=${!!busy || !visible.length} onClick=${() => exportAs('pdf')}>${busy === 'pdf' ? 'Готовлю…' : 'PDF'}</button>
      <button class="btn primary" disabled=${!!busy || !visible.length} onClick=${() => exportAs('xlsx')}>${busy === 'xlsx' ? 'Готовлю…' : 'Excel'}</button>
    </div>

    ${excluded.length > 0 && html`<section class="card">
      <div class="eyebrow">Исключены из описи (${excluded.length})</div>
      ${excluded.map((r) => html`<button class="opis-row off" onClick=${() => setOpen(r.key)}><span></span><span>${r.name}</span><span>${r.qty} ${r.unit}</span><span>${formatCents(r.totalKop)}</span></button>`)}
    </section>`}
    ${!ro && html`<button class="btn block" onClick=${() => confirm('Сбросить все объединения, правки и исключения описи этой закупки?') && S.opisReset(p.id)}>Сбросить все правки описи</button>`}

    ${open && o.rows.find((r) => r.key === open) && html`<${RowSheet} p=${p} ro=${ro} row=${o.rows.find((r) => r.key === open)} rows=${o.rows} onClose=${() => setOpen(null)} />`}
    ${file && html`<${FileReady} file=${file} onClose=${() => setFile(null)} />`}
  </main>`;
}
