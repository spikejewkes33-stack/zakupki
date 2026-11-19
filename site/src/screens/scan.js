// Склад: сканер штрихкодов внутри открытой закупки и списки «Приехали / Ожидаются / Нет в списке».
// Камера, распознавание, фильтр кадров, звук и вибрация — модули «Посылок» (src/scan/), без изменений.
import { html, useState, useEffect, useRef, Header, Empty, Search, ItemRow, go, timeRu, toast } from '../ui.js';
import * as S from '../store.js';
import { itemTitle, matchItem, sortItems } from '../model.js';
import { arrivalLists, arrivalTimes, missingCodes } from '../arrivals.js';
import { ScanFilter } from '../scan/scanfilter.js';
import { openCamera, closeCamera, createScanLoop, decodeImage, listCameras, torchControl, zoomControl } from '../scan/scanner.js';
import { signal, soundOn, setSound, unlockAudio } from '../scan/feedback.js';

const isOpen = (p) => !!p && !p.archived && !p.deleted;
const plural = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// Вход на склад на экране закупки и на главной: кнопка сканера и прогресс «Приехали X из Y».
export function ScanEntry({ p, primary = true }) {
  const l = arrivalLists(S.itemsOf(p.id));
  if (!l.total) return null;
  return html`<div class="scan-entry">
    ${isOpen(p) && html`<a class="btn block ${primary ? 'primary big' : ''}" href=${`#/p/${p.id}/scan`} onClick=${unlockAudio}>📷 Сканировать на складе</a>`}
    <a class="scan-progress" href=${`#/p/${p.id}/arrived`}>
      <span>Приехали на склад: <b>${l.done} из ${l.total}</b></span>
      <span class="bar"><i style=${`width:${Math.floor((l.done * 100) / l.total)}%`}></i></span>
    </a>
  </div>`;
}

const RESULT_TEXT = { found: 'ПРИЕХАЛ', repeat: 'УЖЕ СКАНИРОВАЛИ', unknown: 'НЕТ В СПИСКЕ', other: 'НЕ ИЗ ЭТОЙ ЗАКУПКИ' };

// Что в посылке: один товар или список, если под треком несколько товаров.
function ResultItems({ items }) {
  if (!items.length) return null;
  const who = [...new Set(items.map((i) => i.clientId))];
  const whoLine = who.length === 1 && html`<p class="result-who">${S.clientName(who[0])}</p>`;
  if (items.length === 1) return html`<p class="result-name">${itemTitle(items[0])}</p>${whoLine}`;
  return html`<p class="result-name">В посылке ${items.length} ${plural(items.length, 'товар', 'товара', 'товаров')}:</p>
    <ul class="result-items">${items.map((i) => html`<li>${itemTitle(i)}${who.length > 1 ? ` · ${S.clientName(i.clientId)}` : ''}</li>`)}</ul>${whoLine}`;
}

function Result({ r, times }) {
  if (!r) return html`<div class="result"><p class="result-title">Наведи камеру на штрихкод</p></div>`;
  const when = r.result === 'repeat' && times.get(r.items[0]?.id);
  return html`<div class="result ${r.result}">
    <p class="result-title">${RESULT_TEXT[r.result]}</p>
    ${r.result === 'other' && html`<p class="result-name">Из закупки «${r.otherPids.map((id) => S.purchaseById(id)?.name || '?').join('», «')}»</p>`}
    <${ResultItems} items=${r.items} />
    <p class="mono ${r.result === 'unknown' ? 'big' : ''}">${r.rec.code}${when ? ` · отмечен ${timeRu(when)}` : ''}</p>
  </div>`;
}

// Полноэкранный сканер. Сверяет только с этой закупкой; закрытую сканировать нельзя.
export function ScanScreen({ id }) {
  const p = S.purchaseById(id);
  const open = isOpen(p);
  const video = useRef(null);
  const scan = useRef({ filter: new ScanFilter(), stream: null, loop: null, wake: null, torchOn: false, zoomAt: 0 });
  const [last, setLast] = useState(null);
  const [flash, setFlash] = useState({ kind: '', n: 0 });
  const [session, setSession] = useState({ found: 0, unknown: 0, repeat: 0 });
  const [camErr, setCamErr] = useState(false);
  const [ctl, setCtl] = useState({ torch: null, zoom: null });
  const [cams, setCams] = useState(null);
  const [sound, setSnd] = useState(soundOn());

  useEffect(() => {
    if (!open) go(`/p/${id}`);
  }, [open]);

  async function show(code, track) {
    let r;
    try {
      r = await S.scanCode(id, code, track);
    } catch (e) {
      toast(e.message);
      return;
    }
    const kind = r.result === 'other' ? 'unknown' : r.result; // «не из этой закупки» звучит как красный
    signal(kind);
    setSession((s) => ({ ...s, [kind]: s[kind] + 1 }));
    setLast(r);
    setFlash((f) => ({ kind: r.result, n: f.n + 1 }));
  }

  // manual — номер введён руками или с фото: срабатывает сразу, без фильтра кадров.
  function onCodes(codes, manual, now = performance.now()) {
    const events = manual
      ? codes.map((code) => ({ type: S.lookupTrack(code) ? 'match' : 'unknown', code, track: S.lookupTrack(code) }))
      : scan.current.filter.feed(codes, now, S.lookupTrack, S.shapeScore);
    for (const ev of events) show(ev.code, ev.type === 'match' ? ev.track : null);
  }

  async function start(deviceId) {
    const s = scan.current;
    try {
      s.stream = await openCamera(video.current, deviceId);
    } catch (e) {
      console.error(e);
      setCamErr(true);
      return;
    }
    setCamErr(false);
    setCtl({ torch: torchControl(s.stream), zoom: zoomControl(s.stream) });
    s.loop = createScanLoop(video.current, (codes, now) => onCodes(codes, false, now));
    s.loop.start();
    navigator.wakeLock?.request('screen').then((l) => (s.wake = l)).catch(() => {});
  }
  function stop() {
    const s = scan.current;
    s.loop?.stop();
    closeCamera(s.stream);
    s.wake?.release?.().catch(() => {});
    Object.assign(s, { loop: null, stream: null, wake: null });
  }

  useEffect(() => {
    if (!open) return undefined;
    start();
    // Экран свернули — камеру выключаем, вернулись — включаем снова.
    const onVis = () => (document.hidden ? stop() : !scan.current.stream && start());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [id]);

  if (!open) return null;
  const l = arrivalLists(S.itemsOf(id));
  const times = last?.result === 'repeat' ? arrivalTimes(S.state.events) : new Map();
  const manual = () => {
    unlockAudio();
    const code = prompt('Трек-номер с коробки');
    if (code?.trim()) onCodes([code.trim()], true);
  };
  const fromPhoto = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const codes = await decodeImage(f).catch(() => []);
    if (!codes.length) toast('На фото штрихкод не найден');
    else onCodes(codes, true);
  };
  const pickCamera = async () => {
    const list = await listCameras();
    if (list.length < 2) return toast('Другой камеры нет');
    setCams(list);
  };
  const useCamera = (deviceId) => {
    setCams(null);
    stop();
    start(deviceId);
  };
  return html`<section class="scanner">
    <video ref=${video} playsinline muted></video>
    <div class="aim"></div>
    <header class="scan-top">
      <a class="pill" href=${`#/p/${id}/arrived`}>Готово</a>
      <span class="pill scan-count">${l.done} из ${l.total}</span>
      <button class="pill" aria-label="Звук" onClick=${() => { setSound(!sound); setSnd(!sound); unlockAudio(); }}>${sound ? '🔊' : '🔇'}</button>
      ${ctl.zoom && html`<button class="pill" onClick=${() => {
        const z = ctl.zoom;
        scan.current.zoomAt = (scan.current.zoomAt + 1) % z.levels.length;
        z.set(z.levels[scan.current.zoomAt]).catch(() => {});
        setCtl({ ...ctl });
      }}>${ctl.zoom.levels[scan.current.zoomAt]}×</button>`}
      ${ctl.torch && html`<button class="pill" aria-label="Фонарик" onClick=${() => {
        scan.current.torchOn = !scan.current.torchOn;
        ctl.torch(scan.current.torchOn).catch(() => {});
      }}>🔦</button>`}
      <button class="pill" aria-label="Другая камера" onClick=${pickCamera}>📷</button>
    </header>
    ${camErr && !last
      ? html`<div class="result"><p class="result-title">Нет доступа к камере</p>
          <p>Разреши камеру: Настройки → Приложения → Safari → Камера → «Разрешить». Или введи номер вручную.</p></div>`
      : html`<${Result} r=${last} times=${times} />`}
    <p class="scan-where">Закупка «${p.name}»</p>
    <footer class="scan-bottom">
      <span>✓ ${session.found} · ✗ ${session.unknown} · ↺ ${session.repeat}</span>
      <label class="pill">Из фото<input type="file" accept="image/*" hidden onChange=${fromPhoto} /></label>
      <button class="pill" onClick=${manual}>Ввести номер</button>
    </footer>
    <div class=${`flash ${flash.kind} ${flash.n ? 'on' : ''}`} key=${flash.n}></div>
    ${cams && html`<div class="scan-cams">
      <p><b>Камера</b></p>
      <p class="small">Для близких коробок на iPhone Pro лучше «тройная» или «двойная широкоугольная».</p>
      ${cams.map((c, i) => html`<button class="btn block" onClick=${() => useCamera(c.deviceId)}>${c.label || `Камера ${i + 1}`}</button>`)}
      <button class="btn block" onClick=${() => setCams(null)}>Отмена</button>
    </div>`}
  </section>`;
}

const TABS = [['arrived', 'Приехали'], ['waiting', 'Ожидаются'], ['missing', 'Нет в списке']];

// Списки закупки. Ручная отметка — кнопкой справа (в закрытой закупке только просмотр).
export function ArrivalsScreen({ id, query }) {
  const p = S.purchaseById(id);
  const [tab, setTab] = useState(query.get('tab') || 'waiting');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (p) S.loadScans(id);
  }, [id]);
  if (!p || p.deleted) return html`<${Header} title="Склад" back="/purchases" /><main><${Empty}>Закупка не найдена</${Empty}></main>`;
  const ro = !isOpen(p);
  const l = arrivalLists(S.itemsOf(id));
  const scans = S.scansOf(id);
  const missing = scans ? missingCodes(scans) : [];
  const times = arrivalTimes(S.state.events);
  const find = (arr) => (q.trim() ? arr.filter((it) => matchItem(it, q, S.clientName(it.clientId))) : arr);
  const arrived = find(l.arrived).sort((a, b) => (times.get(b.id) || '').localeCompare(times.get(a.id) || ''));
  const counts = { arrived: l.done, waiting: l.waiting.length + l.noTrack.length, missing: missing.length };
  const row = (it, on) => html`<div class="arr-row" key=${it.id}>
    <${ItemRow} item=${it} showClient=${true} />
    <div class="arr-side">
      ${!on && times.get(it.id) && html`<span class="muted small">${timeRu(times.get(it.id))}</span>`}
      ${!ro && html`<button class="btn small" onClick=${async () => {
        if (!on && !confirm(`«${itemTitle(it)}» не приехал? Статус вернётся прежний.`)) return;
        await S.setArrived(it.id, on);
        toast(on ? 'Отмечен: приехал' : 'Отметка снята');
      }}>${on ? '✓ Приехал' : 'Снять'}</button>`}
    </div>
  </div>`;
  return html`<${Header} title="Склад" back=${`/p/${id}`} />
  <main>
    <section class="card">
      <div class="eyebrow">${p.name}${ro ? ' · закрыта' : ''}</div>
      <h2>Приехали ${l.done} из ${l.total}</h2>
      <div class="scan-progress"><span class="bar"><i style=${`width:${l.total ? Math.floor((l.done * 100) / l.total) : 0}%`}></i></span></div>
      ${!ro && html`<a class="btn primary block big" href=${`#/p/${id}/scan`} onClick=${unlockAudio}>📷 Сканировать</a>`}
    </section>
    <div class="seg arr-tabs">${TABS.map(([k, label]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${label} ${counts[k]}</button>`)}</div>
    ${tab !== 'missing' && html`<${Search} value=${q} onInput=${setQ} placeholder="Товар, трек, клиент" />`}
    ${tab === 'arrived' && html`
      <div class="list">${arrived.map((it) => row(it, false))}</div>
      ${!arrived.length && html`<${Empty}>${q ? 'Ничего не найдено' : 'Пока ничего не приехало'}</${Empty}>`}`}
    ${tab === 'waiting' && html`
      <div class="list">${sortItems(find(l.waiting), 'order').map((it) => row(it, true))}</div>
      ${!l.waiting.length && !l.noTrack.length && html`<${Empty}>Все товары на складе</${Empty}>`}
      ${l.noTrack.length > 0 && html`<h3>Без трека: сканер их не найдёт (${l.noTrack.length})</h3>
        <div class="list">${sortItems(find(l.noTrack), 'order').map((it) => row(it, true))}</div>`}`}
    ${tab === 'missing' && html`
      <p class="muted small">Коды, которые сканировали в этой закупке, а их в ней нет.</p>
      <div class="list">${missing.map((m) => html`<div class="row" key=${m.code}>
        <div class="row-main"><div class="row-title mono">${m.code}</div>
          <div class="row-sub">${m.result === 'other'
            ? html`<span class="other-text">есть в закупке «${m.otherPids.map((x) => S.purchaseById(x)?.name || '?').join('», «')}»</span>`
            : 'нет ни в одной открытой закупке'} · ${m.count} ${plural(m.count, 'раз', 'раза', 'раз')} · ${timeRu(m.lastAt)}</div></div>
        ${!ro && html`<button class="btn small" onClick=${() => S.dismissMissing(id, m.code)}>Убрать</button>`}
      </div>`)}</div>
      ${scans && !missing.length && html`<${Empty}>Пусто</${Empty}>`}`}
  </main>`;
}
