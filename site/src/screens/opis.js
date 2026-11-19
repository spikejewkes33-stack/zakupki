// Опись закупки: объединение похожих, правка, исключение, PDF и Excel.
import { html, useState, Header, Empty, Sheet, FileReady, QtyPriceFix, go, toast, usePhotoUrl } from '../ui.js';
import * as S from '../store.js';
import { buildOpis, exportRows, privacyWarnings } from '../opis.js';
import { fmtByn, formatCents } from '../money.js';
import { pdfBlob, xlsxBlob, fileName, DEFAULT_FROM } from '../export.js';
import { hasCjk } from '../names.js';

// Сопроводительное письмо (форма KRI). Отправитель, адреса и получатель запоминаются один раз,
// номер груза, вес и места — свои у каждой закупки. Хранится только на этом телефоне (localStorage).
const SENDER_KEYS = ['senderName', 'senderPhone', 'fromAddr', 'toAddr', 'recipientName', 'recipientPhone'];
const readLS = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || '{}') || {};
  } catch {
    return {};
  }
};
const writeLS = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    toast('Не удалось запомнить — память браузера недоступна');
  }
};
const cargoKey = (pid) => `opis-cargo-${pid}`;
function readLetter(pid) {
  const s = readLS('opis-sender');
  return { fromAddr: DEFAULT_FROM, ...s, ...readLS(cargoKey(pid)) };
}
const LETTER_FIELDS = [
  ['senderName', 'ФИО отправителя', 'Иванов Иван Иванович'],
  ['senderPhone', 'Телефон отправителя', '+375XXXXXXXXX'],
  ['fromAddr', 'Откуда (склад)', DEFAULT_FROM],
  ['toAddr', 'Адрес в Беларуси', 'г. Минск, ул. …, д. …, кв. …'],
  ['recipientName', 'ФИО получателя', 'Иванова Ивана Ивановича'],
  ['recipientPhone', 'Телефон получателя', '+375XXXXXXXXX'],
];
const CARGO_FIELDS = [
  ['cargoNo', 'Номер груза', 'AB1234-1234-2', 'text'],
  ['weight', 'Вес, кг', '123', 'decimal'],
  ['places', 'Мест', '2', 'numeric'],
];

function LetterCard({ pid, letter, onChange, ro }) {
  const set = (k, val) => {
    if (SENDER_KEYS.includes(k)) writeLS('opis-sender', { ...readLS('opis-sender'), [k]: val });
    else writeLS(cargoKey(pid), { ...readLS(cargoKey(pid)), [k]: val });
    onChange();
  };
  const senderEmpty = !letter.senderName || !letter.toAddr || !letter.recipientName;
  return html`<section class="card">
    <div class="eyebrow">Сопроводительное письмо (форма KRI)</div>
    <fieldset class="form" disabled=${ro}>
      <div class="grid3">
        ${CARGO_FIELDS.map(([k, label, ph, mode]) => html`<label class="small">${label}<input inputmode=${mode} value=${letter[k] || ''} placeholder=${ph} onInput=${(e) => set(k, e.target.value)} /></label>`)}
      </div>
      <details open=${senderEmpty}>
        <summary>Отправитель и получатель${senderEmpty ? '' : `: ${letter.senderName} → ${letter.recipientName}`}</summary>
        <p class="muted small">Запоминаются на этом телефоне, вписываются один раз.</p>
        ${LETTER_FIELDS.map(([k, label, ph]) => html`<label class="small">${label}<input value=${letter[k] || ''} placeholder=${ph} onInput=${(e) => set(k, e.target.value)} /></label>`)}
      </details>
    </fieldset>
  </section>`;
}

// Строка описи без русского названия: фото товара и поле прямо здесь. Название пишется в товары и запоминается.
function NeedName({ row }) {
  const first = row.itemIds.map((id) => S.state.items.get(id)).find((it) => it?.photoId);
  const url = usePhotoUrl(first?.photoId);
  const [val, setVal] = useState('');
  const save = async () => {
    const name = val.trim();
    if (!name) return toast('Впишите название по-русски');
    if (hasCjk(name)) return toast('Без иероглифов — только по-русски');
    for (const id of row.itemIds) {
      const it = S.state.items.get(id);
      if (it && (!String(it.name || '').trim() || hasCjk(it.name))) await S.saveItem({ ...it, name });
    }
    toast('Записал — такие же товары дальше назовутся сами');
    return undefined;
  };
  return html`<div class="need-name">
    ${url ? html`<img src=${url} alt="" />` : html`<span class="need-name-nophoto">нет фото</span>`}
    <input value=${val} placeholder="например, Сантиметр портновский" onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn primary small" onClick=${save}>OK</button>
  </div>`;
}

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
  const [ru, setRu] = useState('');
  // Русское название пишется в сами товары (и запоминается для таких же китайских названий в будущем).
  const setRussian = async () => {
    const name = ru.trim();
    if (!name) return;
    for (const id of row.itemIds) {
      const it = S.state.items.get(id);
      if (it && (!String(it.name || '').trim() || hasCjk(it.name))) await S.saveItem({ ...it, name });
    }
    toast('Русское название записано в товары');
    onClose();
  };
  const [mergeWith, setMergeWith] = useState('');
  const save = async () => {
    const qty = Number(f.qty);
    if (!Number.isInteger(qty) || qty < 1) return toast('Количество — целое число от 1');
    await S.opisEdit(p.id, row.keys, row.itemIds, {
      name: f.name.trim() && f.name.trim() !== row.autoName ? f.name.trim() : null,
      qty: qty !== row.countedQty ? qty : null,
      unit: f.unit.trim() && f.unit.trim() !== 'шт.' ? f.unit.trim() : null,
    });
    onClose();
    return undefined;
  };
  return html`<${Sheet} title="Строка описи" onClose=${onClose}>
    <fieldset class="form" disabled=${ro}>
      ${row.noRu > 0 && html`<div class="card warn">
        <div>У товаров этой строки нет русского названия — без него опись не выгрузится.</div>
        <label>Русское название для них<input value=${ru} onInput=${(e) => setRu(e.target.value)} placeholder="например, Пижама детская" /></label>
        <button class="btn primary block" onClick=${setRussian}>Записать в товары</button>
      </div>`}
      <label>Название в описи<input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
      <div class="grid2">
        <label>Количество<input inputmode="numeric" value=${f.qty} onInput=${(e) => setF({ ...f, qty: e.target.value })} /></label>
        <label>Единица<input value=${f.unit} onInput=${(e) => setF({ ...f, unit: e.target.value })} placeholder="шт., пар" /></label>
      </div>
      <p class="muted small">По товарам: ${row.countedQty} шт. на ${fmtByn(row.totalKop)}. Сумма берётся из реальных цен; при правке количества меняется цена за единицу.</p>
      <button class="btn primary block" onClick=${save}>Сохранить</button>
      <div class="btn-row">
        <button class="btn" onClick=${async () => { await S.opisEdit(p.id, row.keys, row.itemIds, { excluded: !row.excluded }); onClose(); }}>${row.excluded ? 'Вернуть в опись' : 'Исключить из описи'}</button>
        ${row.edited && html`<button class="btn" onClick=${async () => { await S.opisEdit(p.id, row.keys, row.itemIds, { name: null, qty: null, unit: null }); onClose(); }}>Сбросить правки</button>`}
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
  const [, bump] = useState(0);
  if (!p) return html`<${Header} title="Опись" /><main><${Empty}>Закупок пока нет. <a href="#/purchase/new">Создать</a></${Empty}></main>`;
  const ro = p.archived;
  const o = buildOpis(S.itemsOf(p.id), p);
  const visible = o.rows.filter((r) => !r.excluded);
  const excluded = o.rows.filter((r) => r.excluded);
  const showUnit = mode !== 'total';
  const showTotal = mode !== 'unit';

  const privacy = privacyWarnings(o.rows, [...S.state.clients.values()].map((c) => c.name));
  const letter = readLetter(p.id);
  const needName = visible.filter((r) => r.noRu > 0);
  const exportAs = async (kind) => {
    if (needName.length) return toast(`Сначала впишите русское название: ${needName.length} строк(и) вверху`);
    const missing = [...CARGO_FIELDS, ...LETTER_FIELDS].filter(([k]) => !String(letter[k] || '').trim()).map(([, label]) => label);
    const problems = [
      missing.length > 0 && `В письме не заполнено: ${missing.join(', ')}.`,
      o.noPrice > 0 && `${o.noPrice} шт. без цены попадут в файл с суммой 0,00.`,
      o.zero > 0 && `${o.zero} шт. округлились до 0 BYN.`,
      privacy.length > 0 && `Строк, где в названии похоже на имя клиента или номер: ${privacy.length}.`,
    ].filter(Boolean);
    if (problems.length && !confirm(`${problems.join('\n')}\nВсё равно сделать файл?`)) return undefined;
    setBusy(kind);
    try {
      const doc = await S.saveDoc({
        kind: 'opis', purchaseId: p.id, title: p.name, mode,
        rows: exportRows(o), totalKop: o.totalKop, totalQty: o.totalQty, letter,
      });
      setFile(await makeFile(doc, kind));
    } catch (e) {
      toast(`Ошибка: ${e.message}`);
    }
    setBusy('');
    return undefined;
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
    <${QtyPriceFix} items=${S.itemsOf(p.id)} ro=${ro} />

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
    ${needName.length > 0 && html`<section class="card warn">
      <div class="eyebrow">Нужно русское название (${needName.length})</div>
      <p class="small">Без него опись не выгрузится: в описи только русские названия. Впишите один раз — такие же товары дальше назовутся сами.</p>
      ${needName.map((r) => html`<${NeedName} key=${r.key} row=${r} />`)}
    </section>`}
    ${o.zero > 0 && html`<div class="card warn">${o.zero} шт. при таком округлении стоят 0 BYN. Поменяйте округление в настройках закупки.</div>`}
    ${privacy.length > 0 && html`<div class="card warn"><b>В описи не должно быть имён клиентов и номеров.</b>${privacy.map((w) => html`<div>«${w.name}» — ${w.reason}. Нажмите на строку и исправьте название.</div>`)}</div>`}
    ${o.rows.some((r) => r.stale) && html`<div class="card warn">В строки с отметкой ⚠ добавились или ушли товары: прежняя правка количества или исключение больше не действует. Проверьте их.</div>`}

    <section class="card opis">
      <div class="opis-head"><span>№</span><span>Наименование</span><span>Кол-во</span>${showUnit && html`<span>Цена</span>`}${showTotal && html`<span>Сумма</span>`}</div>
      ${visible.map((r) => html`<button class="opis-row" onClick=${() => setOpen(r.key)}>
        <span>${r.n}</span>
        <span>${r.name}${r.merged ? html` <span class="chip s3" title="объединено">∪</span>` : ''}${r.edited ? html` <span class="muted">✎</span>` : ''}${r.stale ? html` <span class="warn-text" title="состав строки изменился">⚠</span>` : ''}${r.noRu ? html`<span class="warn-text">впишите название ↑</span>` : ''}${r.autoRu && !r.noRu ? html` <span class="muted small" title="подобрано по словарю">слов.</span>` : ''}</span>
        <span>${r.qty} ${r.unit}</span>
        ${showUnit && html`<span>${formatCents(r.avgKop)}</span>`}
        ${showTotal && html`<span>${formatCents(r.totalKop)}</span>`}
      </button>`)}
      ${!visible.length && html`<${Empty}>В закупке нет товаров</${Empty}>`}
      <div class="opis-total">Итого: ${o.totalQty} ед. · <b>${fmtByn(o.totalKop)}</b></div>
    </section>

    <${LetterCard} pid=${p.id} letter=${letter} ro=${ro} onChange=${() => bump((x) => x + 1)} />
    ${needName.length > 0 && html`<p class="warn-text small">PDF и Excel станут доступны, когда у всех строк будет русское название.</p>`}
    <div class="btn-row">
      <button class="btn primary" disabled=${!!busy || !visible.length || needName.length > 0} onClick=${() => exportAs('pdf')}>${busy === 'pdf' ? 'Готовлю…' : 'PDF'}</button>
      <button class="btn primary" disabled=${!!busy || !visible.length || needName.length > 0} onClick=${() => exportAs('xlsx')}>${busy === 'xlsx' ? 'Готовлю…' : 'Excel'}</button>
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
