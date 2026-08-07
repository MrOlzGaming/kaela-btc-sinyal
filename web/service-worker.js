// Kaela BTC Sinyal — service worker. NETWORK-FIRST (bukan cache-first) --
// selalu coba ambil versi terbaru dulu, cache cuma dipakai kalau offline.
// Ini sengaja diubah dari cache-first karena cache-first bikin pengunjung keliatan versi basi
// terus-terusan sampai manual clear cache, padahal situs ini sering banget di-update (arsip harian).

const CACHE_NAME = 'kaela-v4';
const CORE_ASSETS = [
  './',
  './index.html',
  './arsip.html',
  './kalkulator.html',
  './metodologi-sniper.html',
  './metodologi-nyopet.html',
  './css/variables.css',
  './js/chart-widget.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
