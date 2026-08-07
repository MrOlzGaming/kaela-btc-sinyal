// Kaela BTC Sinyal — service worker sederhana. Cache halaman inti biar tetap kebuka offline
// (harga live gak akan update kalau offline, tapi laporan terakhir & kalkulator tetap bisa dibuka).

const CACHE_NAME = 'kaela-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './arsip.html',
  './kalkulator.html',
  './metodologi-sniper.html',
  './metodologi-nyopet.html',
  './css/variables.css',
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
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
