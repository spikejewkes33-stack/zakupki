// «Забрать» из «Команды»: выбрать файл PDD.txt (или вставить текст) → сводка → поправить → применить.
import { html, useState, Header, Empty, ClientPicker, Sheet, go, timeRu, toast } from '../ui.js';
import * as S from '../store.js';
import { splitBlocks, buildPlan, diagnoseText, asSingleBlock } from '../pddimport.js';
import { centsToInput, parseCents, fmtCny, fmtByn, itemMoney } from '../money.js';
import { statusLabel, itemTitle } from '../model.js';
import { cropThumbFromBase64, cropAtFromBase64, snapshotUrl } from '../photocrop.js';

// Фото товара из снимков экрана: вырезаем заранее, чтобы показать в сводке и записать в карточку.
async function addPhotos(plan) {
  const one = async (x) => {
    if (!x.image) return x;
    for (const img of [x.image, ...(x.moreImages || []).filter((m) => m !== x.image)]) {
      const blob = await cropThumbFromBase64(img).catch(() => null);
      if (blob) return { ...x, image: img, photoBlob: blob, photoUrl: URL.createObjectURL(blob), photoTried: true };
    }
    return { ...x, photoTried: true };
  };
  return { ...plan, newItems: await Promise.all(plan.newItems.map(one)), updates: await Promise.all(plan.updates.map(one)) };
}

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

// Фото не нашлось само или вырезалось не то: показываем весь снимок, человек нажимает на товар.
function SnapshotPicker({ image, onPick, onClose }) {
  const tap = async (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const blob = await cropAtFromBase64(image, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (blob) onPick(blob);
    else toast('Не получилось вырезать — попробуйте ещё раз');
  };
  return html`<${Sheet} title="Нажмите на фото товара" onClose=${onClose}>
    <img class="snapshot" src=${snapshotUrl(image)} alt="Снимок экрана" onClick=${tap} />
  </${Sheet}>`;
}

function NewItemCard({ n, update, multiPurchase }) {
  const [pick, setPick] = useState(false);
  const [snap, setSnap] = useState(false);
  const photoNote = n.photoUrl ? 'другое фото' : n.photoTried ? 'не нашёл — нажмите' : 'ищу фото…';
  const p = S.purchaseById(n.purchaseId);
  const m = itemMoney({ qty: n.qty, paidFen: n.paidFen }, p);
  return html`<div class=${`card import-item ${n.skip ? 'off' : ''}`}>
    <label class="check"><input type="checkbox" checked=${!n.skip} onChange=${(e) => update({ skip: !e.target.checked })} /> Добавить</label>
    <div class="muted small">${n.time ? timeRu(n.time) : 'время нажатия неизвестно'}${multiPurchase && p ? ` · ${p.name}` : ''}</div>
    <button class=${`btn block left ${n.clientId ? '' : 'warn-btn'}`} onClick=${() => setPick(true)}>
      ${n.clientId ? `${S.clientName(n.clientId)}${n.clientBy === 'time' ? ' · по времени' : ''}` : 'Выбрать клиента'}
    </button>
    <div class="import-head">
      ${n.image ? html`<button class="import-photo-btn" onClick=${() => setSnap(true)} aria-label="Выбрать фото на снимке">
          ${n.photoUrl ? html`<img class="import-photo" src=${n.photoUrl} alt="Фото товара" />` : html`<div class="import-photo none">нет фото</div>`}
          <span class="small">${photoNote}</span></button>`
        : html`<div class="import-photo none">нет снимка</div>`}
      <label class="small grow">Название
        <input value=${n.name} onInput=${(e) => update({ name: e.target.value, nameAuto: false })} placeholder="впишите по-русски" />
        ${n.nameAuto && html`<span class="hint">${n.nameFrom === 'mt' ? 'взято из машинного перевода — проверьте и сократите' : 'переведено по словарю — проверьте'}</span>`}
        ${!n.name && html`<span class="hint warn-text">не знаю такой товар — впишите один раз, запомню</span>`}</label>
    </div>
    <div class="grid2">
      <label class="small">Количество<input inputmode="numeric" value=${n.qty} onInput=${(e) => update({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
      <label class="small">Оплачено (实付), ¥<input inputmode="decimal" value=${centsToInput(n.paidFen)}
        onChange=${(e) => { const v = parseCents(e.target.value); update({ paidFen: Number.isNaN(v) ? n.paidFen : v }); }} /></label>
    </div>
    <div class="small">${fmtCny(m.totalFen)} → ${fmtByn(m.totalKop)}${n.qty > 1 ? ` · за 1 шт ≈ ${fmtCny(m.unitFen)}` : ''}</div>
    ${n.track ? html`<div class="small">Трек: <b class="mono">${n.track}</b> · ${n.carrier} · ${statusLabel(n.status)}</div>`
      : html`<div class="muted small">Трека пока нет — появится, когда продавец отправит (снимите этот заказ ещё раз).</div>`}
    <details class="muted small"><summary>Из PDD</summary><div>${n.nameCn || '—'}</div>${n.variant && html`<div>Вариант: ${n.variant}</div>`}<div>Заказ ${n.pddOrderNo || '—'}</div></details>
    ${n.doubts.length > 0 && html`<div class="warn-text small">Проверьте: ${n.doubts.join('; ')}</div>`}
    ${snap && html`<${SnapshotPicker} image=${n.image} onClose=${() => setSnap(false)}
      onPick=${(blob) => { setSnap(false); update({ photoBlob: blob, photoUrl: URL.createObjectURL(blob), photoTried: true }); }} />`}
    ${pick && html`<${ClientPicker} title="Чей товар?" onClose=${() => setPick(false)} onPick=${(c) => { setPick(false); update({ clientId: c.id, clientBy: 'hand' }); }} />`}
  </div>`;
}

// Фото пришли позже, чем пользователь мог поправить сводку: переносим только фото.
function mergePhotos(cur, ph) {
  const pick = (list, src) => list.map((x, i) => (x.photoBlob ? x : src[i]?.photoBlob ? { ...x, photoBlob: src[i].photoBlob, photoUrl: src[i].photoUrl, photoTried: true } : { ...x, photoTried: true }));
  return { ...cur, newItems: pick(cur.newItems, ph.newItems), updates: pick(cur.updates, ph.updates) };
}

export function ImportScreen() {
  const [plan, setPlan] = useState(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null); // { kind, text, from }

  const load = (text, from) => {
    const kind = diagnoseText(text);
    if (kind !== 'blocks') {
      const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
      setProblem({ kind, text, from, count: lines.length, head: lines.slice(0, 3) });
      return;
    }
    setProblem(null);
    const pl = makePlan(text);
    setPlan(pl);
    if (pl.newItems.some((x) => x.image) || pl.updates.some((x) => x.image)) addPhotos(pl).then((withPhotos) => setPlan((cur) => (cur && cur.newItems.length === withPhotos.newItems.length ? mergePhotos(cur, withPhotos) : cur)));
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.txt$/i.test(f.name) && f.type && f.type !== 'text/plain') {
      setProblem({ kind: 'foreign', text: '', from: `файл «${f.name}»` });
      return;
    }
    load(await f.text(), `файл «${f.name}»`);
  };
  // Буфер обмена: iPhone покажет плашку «Вставить» — её нужно нажать.
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      load(t, 'буфер обмена');
    } catch {
      setShowPaste(true);
      toast('Не удалось прочитать буфер — вставьте текст в поле ниже (нажмите в поле → «Вставить»)');
    }
  };
  const setNew = (i, patch) => setPlan({ ...plan, newItems: plan.newItems.map((n, k) => (k === i ? { ...n, ...patch } : n)) });

  if (!plan) {
    return html`<${Header} title="Забрать из PDD" back=${true} />
    <main>
      <section class="card">
        <p>Снимки Кнопкой действия копятся в файле <b>PDD.txt</b>. <b>Сами в приложение они не попадают</b> — их забирают здесь:</p>
        <label class="btn primary block file-btn">Выбрать файл PDD.txt<input type="file" accept=".txt,text/plain" onChange=${onFile} /></label>
        <p class="muted small">Откроется выбор файла: «Обзор» → iCloud Drive → папка <b>Shortcuts</b> (может называться «Быстрые команды») → PDD.txt.</p>
        <button class="btn block" onClick=${fromClipboard}>Вставить из буфера обмена</button>
        <p class="muted small">Если «Команда» копирует текст в буфер — нажмите и потом «Вставить» на плашке iPhone.</p>
        ${problem && html`<div class="card warn">
          ${problem.kind === 'empty' && html`<div><b>${problem.from ? `${problem.from[0].toUpperCase()}${problem.from.slice(1)}` : 'Текст'} пустой.</b> Снимков ещё нет: нажмите Кнопку действия на экране заказа в Pinduoduo — должна быть вибрация. Если вибрации нет, «Команда» не настроена.</div>`}
          ${problem.kind === 'foreign' && html`<div><b>Это не снимки PDD</b> (${problem.from}). Нужен текстовый файл PDD.txt из папки Shortcuts в iCloud Drive.</div>`}
          ${problem.kind === 'nomarker' && html`<div><b>Это текст снимка PDD, но без строки ===PDD===.</b> Похоже, «Команда» ещё пробная («Показать результат») или в действии «Текст» нет первой строки ===PDD===. Время нажатия неизвестно — клиента выберете сами.</div>
            <button class="btn primary block" onClick=${() => load(asSingleBlock(problem.text), problem.from)}>Разобрать как один снимок</button>`}
          <div class="small">Выбрано: <b>${problem.from || '—'}</b> · строк с текстом: <b>${problem.count}</b></div>
          ${problem.head.length > 0 && html`<pre class="raw">${problem.head.join('\n')}</pre>`}
          <a class="btn block" href="#/help">Как настроить «Команду»</a>
        </div>`}
        <a class="help-link" href="#/help">Как настроить «Команду» на iPhone</a>
        <button class="linkish" onClick=${() => setShowPaste(!showPaste)}>${showPaste ? '▾' : '▸'} или вставить текст</button>
        ${showPaste && html`<textarea rows="6" value=${paste} onInput=${(e) => setPaste(e.target.value)} placeholder="===PDD===…"></textarea>
          <button class="btn block" onClick=${() => load(paste, 'вставленный текст')}>Разобрать</button>`}
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
  const onlySeen = !active.length && !realTracks.length && !plan.updates.some((u) => Object.keys(u.patch).length || u.photoBlob) && !plan.pending.length;

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
      ${plan.updates.some((u) => Object.keys(u.patch).length || u.photoBlob) && html`<div>Дополню ваши карточки: <b>${plan.updates.filter((u) => Object.keys(u.patch).length || u.photoBlob).length}</b></div>`}
      ${plan.pending.length > 0 && html`<div>Треков без карточки (подождут): <b>${plan.pending.length}</b></div>`}
      ${plan.unknown.length > 0 && html`<div class="warn-text">Не понял снимков: <b>${plan.unknown.length}</b></div>`}
      ${plan.skipped > 0 && html`<div class="muted">Уже забирали раньше: ${plan.skipped}</div>`}
      ${noClient > 0 && html`<button class="btn block" onClick=${() => setBulk(true)}>Назначить клиента всем без клиента</button>`}
      <button class="btn primary block" disabled=${busy || noClient > 0 || nothing} onClick=${apply}>${noClient ? 'Сначала выберите клиентов' : nothing ? 'Нечего добавлять' : onlySeen ? 'Отметить как забранное' : 'Записать'}</button>
      <button class="btn block" onClick=${() => setPlan(null)}>Отмена</button>
    </section>

    ${plan.newItems.length > 0 && html`<h3>Новые товары</h3>
      ${plan.newItems.map((n, i) => html`<${NewItemCard} key=${n.blockId} n=${n} multiPurchase=${multiPurchase} update=${(patch) => setNew(i, patch)} />`)}`}

    ${plan.updates.some((u) => Object.keys(u.patch).length || u.photoBlob) && html`<h3>Дополню ваши карточки</h3>
      <div class="list">${plan.updates.filter((u) => Object.keys(u.patch).length || u.photoBlob).map((u) => {
        const it = S.state.items.get(u.itemId);
        const what = [u.photoBlob && 'фото', u.patch.name && `название «${u.patch.name}»`, u.patch.track && `трек ${u.patch.track}`, u.patch.paidFen != null && 'цену', u.patch.status && statusLabel(u.patch.status)].filter(Boolean);
        return html`<div class="row">${u.photoUrl && html`<img class="import-photo small" src=${u.photoUrl} alt="" />`}
          <div class="row-main"><div class="row-title">${itemTitle(it)}</div><div class="row-sub">${S.clientName(it.clientId)} · добавлю: ${what.join(', ')}</div></div></div>`;
      })}</div>`}

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
