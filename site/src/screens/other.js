// История (закрытые закупки и сохранённые описи) и «Данные»: резервная копия, хранилище, журнал изменений.
import { html, useState, useEffect, Header, Empty, Search, FileReady, timeRu, toast } from '../ui.js';
import * as S from '../store.js';
import { PurchaseRow } from './purchases.js';
import { makeFile } from './opis.js';
import { fmtByn } from '../money.js';
import { FIELD_LABELS } from '../model.js';
import { formatChange } from './items.js';

const MODE = { total: 'сумма', unit: 'цена за ед.', both: 'цена и сумма' };

export function HistoryScreen() {
  const [q, setQ] = useState('');
  const [file, setFile] = useState(null);
  const ql = q.trim().toLowerCase();
  const archived = [...S.state.purchases.values()]
    .filter((x) => x.archived && !x.deleted && x.name.toLowerCase().includes(ql))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const docs = S.state.docs.filter((d) => d.title.toLowerCase().includes(ql)).slice(0, 50);
  return html`<${Header} title="История" />
  <main>
    <${Search} value=${q} onInput=${setQ} placeholder="Найти закупку" />
    <h3>Закрытые закупки</h3>
    <div class="list">${archived.map((p) => html`<${PurchaseRow} p=${p} />`)}</div>
    ${!archived.length && html`<${Empty}>Пока нет. Закупка попадает сюда кнопкой «Закрыть закупку».</${Empty}>`}
    <h3>Сформированные описи</h3>
    <div class="list">${docs.map((d) => html`<div class="row">
      <div class="row-main"><div class="row-title">${d.title}</div><div class="row-sub">${timeRu(d.createdAt)} · ${d.rows.length} строк · ${MODE[d.mode] || ''} · ${fmtByn(d.totalKop)}</div></div>
      <div class="row-side btn-col">
        <button class="btn small" onClick=${async () => setFile(await makeFile(d, 'pdf'))}>PDF</button>
        <button class="btn small" onClick=${async () => setFile(await makeFile(d, 'xlsx'))}>Excel</button>
      </div>
    </div>`)}</div>
    ${!docs.length && html`<${Empty}>Описей пока нет</${Empty}>`}
    ${file && html`<${FileReady} file=${file} onClose=${() => setFile(null)} />`}
  </main>`;
}

const ENT = { item: 'Товар', purchase: 'Закупка', client: 'Клиент' };
function entityName(e) {
  if (e.entity === 'item') { const it = S.state.items.get(e.entityId); return it ? it.name || it.nameCn || '' : ''; }
  if (e.entity === 'purchase') return S.state.purchases.get(e.entityId)?.name || '';
  return S.state.clients.get(e.entityId)?.name || '';
}

export function SettingsScreen() {
  const [persist, setPersist] = useState(null);
  const [file, setFile] = useState(null);
  const [n, setN] = useState(50);
  const [before, setBefore] = useState(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersist).catch(() => setPersist(null));
    S.getBeforeRestore().then((b) => setBefore(b || null)).catch(() => {});
  }, [S.getVersion()]);
  const last = S.state.settings.lastBackupAt;
  const backup = async () => {
    const json = await S.makeBackup();
    const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
    const stamp = new Date().toLocaleString('ru-RU').replace(/[.:, ]+/g, '-');
    setFile({ blob, name: `Закупки-копия-${stamp}.json`, at: json.exportedAt });
  };
  const restore = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const err = S.checkBackup(json);
      if (err) return toast(err);
      const c = json.data;
      if (!confirm(`Заменить ВСЕ данные в этом телефоне копией от ${timeRu(json.exportedAt)}?\nВ копии: закупок ${c.purchases.length}, клиентов ${c.clients.length}, товаров ${c.items.length}.\nТекущие данные приложение сохранит рядом — их можно будет вернуть кнопкой ниже.`)) return undefined;
      await S.restoreBackup(json);
      toast('Данные восстановлены');
    } catch (err) {
      toast(`Не получилось: ${err.message}`);
    }
    return undefined;
  };
  const events = S.state.events.slice(-n).reverse();
  return html`<${Header} title="Данные и копии" back="/" />
  <main>
    <section class="card">
      <h2>Резервная копия</h2>
      <p class="muted">Все данные лежат только в этом телефоне. Сохраняйте копию в «Файлы» (iCloud) или себе в Telegram — так их можно вернуть на новом телефоне или компьютере.</p>
      <p class="small">Последняя копия: <b>${last ? timeRu(last) : 'ещё не делалась'}</b></p>
      <button class="btn primary block" onClick=${backup}>Сохранить копию</button>
      <label class="btn block file-btn">Восстановить из копии…<input type="file" accept="application/json,.json" onChange=${restore} /></label>
      ${before && html`<button class="btn block" onClick=${async () => {
        if (!confirm(`Вернуть данные, которые были до восстановления ${timeRu(before.at)}? (закупок ${before.counts.purchases}, товаров ${before.counts.items})`)) return;
        try { await S.undoRestore(); toast('Данные возвращены'); } catch (err) { toast(err.message); }
      }}>Вернуть данные до восстановления (${timeRu(before.at)})</button>`}
    </section>
    <section class="card">
      <h2>Помощь</h2>
      <a class="btn block" href="#/help">Как настроить «Команду» для PDD</a>
    </section>
    <section class="card">
      <h2>Хранилище</h2>
      <p class="small">${persist === true ? 'Телефон обещал не стирать данные приложения.' : persist === false ? 'Телефон может стереть данные при нехватке места. Добавьте приложение на экран «Домой» и делайте копии.' : 'Статус хранилища неизвестен.'}</p>
      ${persist === false && html`<button class="btn block" onClick=${async () => { const r = await navigator.storage.persist(); setPersist(r); toast(r ? 'Готово' : 'Телефон отказал — делайте копии'); }}>Попросить не стирать данные</button>`}
      <p class="muted small">Важно: в Safari и в приложении с экрана «Домой» данные разные. Работайте всегда из значка на экране «Домой».</p>
    </section>
    <section class="card">
      <h2>Журнал изменений</h2>
      <ul class="history">${events.map((e) => html`<li>
        <div class="muted small">${timeRu(e.at)} · ${ENT[e.entity] || e.entity} «${entityName(e)}» · ${e.action}</div>
        ${e.action !== 'create' && Object.entries(e.changes).filter(([f]) => !['opis', 'sessions'].includes(f)).map(([f, [a, b]]) => html`<div class="small">${FIELD_LABELS[f] || f}: ${formatChange(f, a)} → <b>${formatChange(f, b)}</b></div>`)}
      </li>`)}</ul>
      ${S.state.events.length > n && html`<button class="btn block" onClick=${() => setN(n + 100)}>Показать ещё</button>`}
      ${!events.length && html`<${Empty}>Изменений пока нет</${Empty}>`}
    </section>
    <p class="muted small center">Закупки · этап 1 · данные на устройстве</p>
    ${file && html`<${FileReady} file=${file} onClose=${() => setFile(null)} onSaved=${() => file.at && S.saveSettings({ lastBackupAt: file.at })} />`}
  </main>`;
}
