// Работа без интернета: файлы приложения лежат в кэше телефона.
// При выкладке GitHub Actions подставляет номер версии в имя кэша — телефон видит, что sw.js изменился,
// скачивает новую версию целиком и включает её при следующем запуске.
const CACHE = 'pdd-zakupki-dev';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/preact-htm.js',
  'vendor/idb.js',
  'vendor/pdfmake.min.js',
  'vendor/vfs_fonts.js',
  'vendor/xlsx.mini.min.js',
  'src/app.js',
  'src/ui.js',
  'src/db.js',
  'src/store.js',
  'src/money.js',
  'src/model.js',
  'src/order.js',
  'src/opis.js',
  'src/export.js',
  'src/pddimport.js',
  'src/screens/import.js',
  'src/screens/purchases.js',
  'src/screens/items.js',
  'src/screens/clients.js',
  'src/screens/opis.js',
  'src/screens/other.js',
];

self.addEventListener('install', (event) => {
  // Новая версия скачивается целиком в новый кэш (мимо кэша браузера); старая работает, пока новая не готова.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Файлы приложения — только из кэша одной версии (не смешиваются старые и новые); чего нет в кэше — из сети.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request)),
  );
});
