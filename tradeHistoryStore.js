// tradeHistoryStore.js (4 Sep 2026, permintaan Olan: "tiap tarikan data binance, soal riwayat
// transaksi trading simpan di data kita sendiri. jadi kita ga kehilangan data kan? sama mexc
// jugak") -- CACHE LOKAL append-only buat riwayat income/trade dari exchange (Binance+MEXC).
//
// KENAPA: getIncomeHistory Binance CUMA balikin max 1000 baris per panggilan, getFullIncomeHistorySince
// (multiAccountExecutor.js) udah paginasi TAPI tetap nge-fetch ULANG dari awal window ("sejak
// gabung") SETIAP siklus -- boros (banyak panggilan API tiap 15 menit) DAN beresiko: kalau exchange
// suatu saat batesin range query (mis. Binance BISA aja nerapin batas umur data kayak endpoint lain),
// data lama BISA ilang tanpa kita sadar krn kita gak pernah nyimpen sendiri.
//
// GIMANA: file JSON per (exchange, phone, mode) nyimpen SEMUA baris yang PERNAH ketarik, dedup by
// id. Sync berikutnya CUMA nanya "ada yang baru sejak lastSyncedMs?" -- incremental, hemat, DAN
// data lama TETAP ada di file kita walau exchange nanti gak mau kasih lagi. Baca butuh "PnL sejak
// X" -- filter dari FILE ini (source kebenaran lokal), BUKAN nanya exchange ulang.

const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'multi-account-state', 'trade-history');

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function storePath(exchange, phone, mode) {
  const safePhone = String(phone || '').replace(/[^0-9]/g, '');
  return path.join(STORE_DIR, `${exchange}-${safePhone}-${mode}.json`);
}

function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return { entries: [], lastSyncedMs: 0 };
  try {
    const s = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(s.entries)) s.entries = [];
    if (!s.lastSyncedMs) s.lastSyncedMs = 0;
    return s;
  } catch (e) {
    console.log(`[TradeHistoryStore] Gagal baca ${filePath} (dianggap kosong, JANGAN timpa file rusak -- backup manual dulu kalau ini kejadian):`, e.message);
    return { entries: [], lastSyncedMs: 0 };
  }
}

function saveStore(filePath, store) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

// Gabung entries BARU ke store LAMA -- dedup by `id` (SATU-SATUNYA cara aman nambah data tanpa
// dobel kalau window fetch kebetulan overlap dikit, sengaja ATAU gak sengaja). lastSyncedMs
// diupdate ke waktu entry TERBARU (bukan Date.now() -- biar sync berikutnya mulai PERSIS abis
// data terakhir yang beneran kesimpen, bukan ketinggalan/kelewat gara-gara jam lokal beda).
function mergeEntries(store, newEntries) {
  const byId = {};
  store.entries.forEach((e) => { byId[e.id] = e; });
  let added = 0;
  newEntries.forEach((e) => {
    if (!byId[e.id]) added++;
    byId[e.id] = e; // entry baru MENANG kalau id somehow overlap (data lebih fresh)
  });
  store.entries = Object.values(byId).sort((a, b) => a.time - b.time);
  if (store.entries.length) store.lastSyncedMs = store.entries[store.entries.length - 1].time;
  return added;
}

// Jumlah `amount` semua entry di store yang `time >= sinceMs` DAN (opsional) `type` termasuk di
// `types` (array, undefined = semua type). Filter LOKAL dari file -- gak nanya exchange lagi.
function sumSince(store, sinceMs, types) {
  return store.entries
    .filter((e) => e.time >= sinceMs && (!types || types.includes(e.type)))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

module.exports = { storePath, loadStore, saveStore, mergeEntries, sumSince };
