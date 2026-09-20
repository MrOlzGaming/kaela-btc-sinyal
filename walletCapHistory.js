// walletCapHistory.js (21 Sep 2026) -- helper histori + proyeksi Modal Futures Pool, DIPISAH dari
// walletCapProgress.js (yang nulis snapshot) SUPAYA monthlyFundingReminder.js bisa reuse fungsi
// proyeksi ini TANPA circular require. walletCapProgress.js SENDIRI require monthlyFundingReminder.js
// (buat WALLETS/CAP_PER_WALLET/fetchBalance) -- kalau monthlyFundingReminder.js require BALIK
// walletCapProgress.js, Node bakal balikin module.exports KOSONG/PARSIAL di salah satu arah
// (tergantung mana yang dijalanin sbg entry `node xxx.js` duluan), gak ketauan lewat error jelas,
// cuma muncul belakangan sbg "WALLETS is not iterable" pas main() jalan. File ini ZERO dependency
// ke keduanya (cuma fs/path + pure function), jadi aman di-require dari DUA arah sekaligus.

const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, 'web', 'wallet-cap-progress-history.json');
// ~3 tahun harian -- lebih dari cukup buat 1 siklus tanam-panen halving, gak numpuk gak terkendali.
const MAX_HISTORY_ENTRIES = 1095;

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch { return []; }
}

// Pure function (gampang ditest) -- kalau titik TERAKHIR histori tanggalnya SAMA (siklus lain di
// hari yang sama), REPLACE (biar angka hari ini selalu yang PALING BARU, bukan numpuk berkali-kali
// per hari). Kalau beda tanggal, APPEND baru + trim dari DEPAN kalau kelewat MAX_HISTORY_ENTRIES.
function upsertHistoryEntry(history, dateKey, totalBalance, totalCap) {
  const entry = { date: dateKey, totalBalance, totalCap };
  if (history.length && history[history.length - 1].date === dateKey) {
    return history.slice(0, -1).concat([entry]);
  }
  const next = history.concat([entry]);
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next;
}

// Proyeksi "berapa bulan lagi Modal Futures Pool penuh" (21 Sep 2026, permintaan Olan). Pure
// function. `currentBalance` DIPISAH dari histori (bukan diambil dari titik TERAKHIR histori) --
// caller (monthlyFundingReminder.js) udah fetch saldo FRESH hari itu sendiri, histori cuma
// dipakai buat HITUNG LAJU pertumbuhan (bukan sumber angka "sekarang", yang bisa telat 1 siklus).
// Lookback 30 titik (bukan SELURUH histori) -- biar proyeksi ngikutin TREN TERKINI, gak keblur
// rata-rata jangka panjang kalau pola setoran berubah (mis. abis 1 dompet capped, laju ganti).
function estimateMonthsToCap(history, currentBalance, cap) {
  if (currentBalance >= cap) return 0; // udah penuh
  if (!history || history.length < 2) return null; // belum cukup titik buat hitung laju
  const LOOKBACK = 30;
  const window = history.slice(-Math.min(LOOKBACK, history.length));
  const first = window[0];
  const last = window[window.length - 1];
  const daysElapsed = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (daysElapsed <= 0) return null;
  const growthPerDay = (last.totalBalance - first.totalBalance) / daysElapsed;
  if (growthPerDay <= 0) return null; // stagnan/turun -- gak jujur diproyeksi kapan nyampe cap
  const daysToCap = (cap - currentBalance) / growthPerDay;
  return Math.round((daysToCap / 30) * 10) / 10; // bulan, 1 desimal (asumsi 30 hari/bulan, kasar)
}

module.exports = { HISTORY_PATH, MAX_HISTORY_ENTRIES, loadHistory, upsertHistoryEntry, estimateMonthsToCap };
