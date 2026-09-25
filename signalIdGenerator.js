// signalIdGenerator.js (25 Sep 2026, permintaan Olan: "id juga kasih logika seragam biar itu 1
// manajemen mantap") -- SATU sumber format ID manusiawi dipakai Sniper+Ranger+Ninja: dayKey WITA
// (YYYYMMDD) + urutan 2 digit HARI ITU, mis. "2026092501" = sinyal ke-1 tanggal 25 Sep 2026.
// Logika ASLI dari sniperOrders.js createOrder() (12 Agu 2026, jauh lebih deskriptif dibanding
// id timestamp/random yang gak ada artinya buat manusia) -- sekarang jadi 1 fungsi dipakai SEMUA
// sistem, bukan cuma format teksnya yang disamain tapi PERHITUNGANNYA juga.
//
// Scope hitungan SELALU per-instance (per akun/journal sendiri-sendiri) -- caller yang nentuin
// `countTodayBefore`/`existingIds` dari SUMBER DATA-nya sendiri (journal.orders Ranger,
// state.orders Sniper, counter tersendiri buat Ninja yang jurnalnya gak nyimpen histori penuh --
// lihat masing-masing caller). TIDAK dimaksudkan unik LINTAS sistem/akun (badge WA sendiri udah
// cukup buat bedain SNIPER/RANGER/NINJA, gak masalah kalau kebetulan sama "2026092501" di sistem
// yang beda -- itu bukan primary key global, cuma referensi manusiawi jangka pendek).
const { localDateKey } = require('./config');

function dayKeyOf(date = new Date()) {
  return localDateKey(date).replace(/-/g, ''); // 'YYYY-MM-DD' -> 'YYYYMMDD'
}

// `countTodayBefore`: berapa entry SEBELUM ini yang udah kepake HARI INI (dalam scope caller).
function nextSignalId(countTodayBefore, date = new Date()) {
  return dayKeyOf(date) + String((countTodayBefore || 0) + 1).padStart(2, '0');
}

// Helper buat caller yang nyimpen HISTORI PENUH (array of signalId, boleh ada null/undefined
// nyempil buat entry lama sebelum fitur ini ada -- difilter aman).
function countSignalIdsToday(existingIds, date = new Date()) {
  const dayKey = dayKeyOf(date);
  return (existingIds || []).filter((id) => (id || '').startsWith(dayKey)).length;
}

module.exports = { nextSignalId, countSignalIdsToday, dayKeyOf };
