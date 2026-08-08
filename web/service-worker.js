// Kaela BTC Sinyal — service worker. NETWORK-FIRST (bukan cache-first) --
// selalu coba ambil versi terbaru dulu, cache cuma dipakai kalau offline.
// Ini sengaja diubah dari cache-first karena cache-first bikin pengunjung keliatan versi basi
// terus-terusan sampai manual clear cache, padahal situs ini sering banget di-update (arsip harian).
//
// PENTING: fetch(event.request) polos MASIH bisa kena HTTP cache browser biasa (di luar kendali
// SW ini) kalau Netlify/browser kasih header cache ke .js/.css -- "network-first" jadi percuma
// kalau fetch()-nya sendiri dipenuhi dari cache tanpa beneran ke jaringan. WAJIB {cache:'no-store'}
// biar tiap fetch beneran ke server, gak pernah nyangkut versi lama (ketauan pas toolbar gambar
// baru di-deploy tapi browser Olan masih jalanin chart-widget.js versi lama yang gak kenal
// elemen toolbar baru -- semua tombol keliatan gak berfungsi).

const CACHE_NAME = 'kaela-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './arsip.html',
  './kalkulator.html',
  './metodologi-sniper.html',
  './metodologi-nyopet.html',
  './css/variables.css',
  './js/price-ticker.js',
  './js/nyopet-orders-widget.js',
  './fonts/Inter-Variable.woff2',
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
  // Cuma urus request ke origin situs kita sendiri -- biarkan request cross-origin (widget
  // TradingView dari s3.tradingview.com, Binance API, dst) lewat NORMAL tanpa campur tangan SW
  // ini. SW yang ikut nge-force no-store ke asset besar milik pihak lain cuma bikin lambat &
  // berpotensi ganggu caching strategy mereka sendiri, gak ada untungnya buat kita.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
