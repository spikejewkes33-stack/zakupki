// Каркас: маршруты по адресу после #, нижнее меню, загрузка данных.
import { html, render, useState, useEffect } from '../vendor/preact-htm.js';
import { Toasts, PhotoViewer } from './ui.js';
import * as S from './store.js';
import { Home, PurchaseList, PurchaseForm, PurchaseScreen, PurchaseClient, PurchaseAllItems } from './screens/purchases.js';
import { ItemForm } from './screens/items.js';
import { ClientList, ClientCard } from './screens/clients.js';
import { OpisScreen } from './screens/opis.js';
import { HistoryScreen, SettingsScreen } from './screens/other.js';
import { ImportScreen } from './screens/import.js';
import { HelpScreen } from './screens/help.js';

const TABS = [
  { path: '/', label: 'Главная', icon: '⌂', match: (r) => r === '/' || r === '/settings' || r === '/import' || r === '/help' },
  { path: '/purchases', label: 'Закупки', icon: '▤', match: (r) => /^\/(purchases|purchase\/|p\/|item\/)/.test(r) },
  { path: '/clients', label: 'Клиенты', icon: '☺', match: (r) => /^\/client/.test(r) },
  { path: '/opis', label: 'Опись', icon: '≡', match: (r) => /^\/opis/.test(r) },
  { path: '/history', label: 'История', icon: '↺', match: (r) => /^\/history/.test(r) },
];

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function screen({ path, query }) {
  let m;
  if (path === '/') return html`<${Home} />`;
  if (path === '/purchases') return html`<${PurchaseList} />`;
  if (path === '/purchase/new') return html`<${PurchaseForm} />`;
  if ((m = path.match(/^\/p\/([^/]+)\/edit$/))) return html`<${PurchaseForm} id=${m[1]} />`;
  if ((m = path.match(/^\/p\/([^/]+)\/all$/))) return html`<${PurchaseAllItems} id=${m[1]} />`;
  if ((m = path.match(/^\/p\/([^/]+)\/c\/([^/]+)$/))) return html`<${PurchaseClient} pid=${m[1]} cid=${m[2]} />`;
  if ((m = path.match(/^\/p\/([^/]+)$/))) return html`<${PurchaseScreen} id=${m[1]} />`;
  if (path === '/item/new') return html`<${ItemForm} query=${query} />`;
  if ((m = path.match(/^\/item\/([^/]+)$/))) return html`<${ItemForm} id=${m[1]} query=${query} />`;
  if (path === '/clients') return html`<${ClientList} />`;
  if ((m = path.match(/^\/client\/([^/]+)$/))) return html`<${ClientCard} id=${m[1]} />`;
  if ((m = path.match(/^\/opis(?:\/([^/]+))?$/))) return html`<${OpisScreen} id=${m[1]} />`;
  if (path === '/history') return html`<${HistoryScreen} />`;
  if (path === '/settings') return html`<${SettingsScreen} />`;
  if (path === '/import') return html`<${ImportScreen} />`;
  if (path === '/help') return html`<${HelpScreen} />`;
  return html`<${Home} />`;
}

function App() {
  const [route, setRoute] = useState(parse);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const onHash = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    const off = S.subscribe(setVersion);
    setVersion(S.getVersion()); // данные могли загрузиться раньше подписки
    return () => {
      removeEventListener('hashchange', onHash);
      off();
    };
  }, []);
  if (!S.state.ready) return html`<main><p class="muted center">Загрузка…</p></main>`;
  return html`<div class="app">
    <div class="screen" key=${route.path + route.query.toString()}>${screen(route)}</div>
    <nav class="tabs">${TABS.map((t) => html`<a href=${`#${t.path}`} class=${t.match(route.path) ? 'on' : ''}>
      <span class="tab-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span></a>`)}</nav>
    <${Toasts} />
    <${PhotoViewer} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
S.load().catch((e) => {
  document.getElementById('app').innerHTML = `<p style="padding:20px">Не открылось хранилище: ${e.message}</p>`;
});
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js');
// Попросить телефон не стирать данные (на iOS срабатывает для значка на экране «Домой»).
navigator.storage?.persist?.().catch(() => {});
