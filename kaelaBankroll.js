// Bankroll BAYANGAN milik Kaela sendiri (12 Agu 2026, permintaan Olan: "Kaela akan dikasih
// saldo bayangan $100") -- TERPISAH dari saldo real Olan di nyopet-orders.json (yang tetap
// apa adanya, murni referensi Olan pribadi). Sizing sinyal Sniper & tracking performa SEKARANG
// pakai bankroll INI, biar hasil live bisa dibandingin apel-ke-apel sama backtest yang udah
// tervalidasi (backtestFlagBreakout.js: modal $100, top-up $100/bulan tiap tanggal 5 selama
// saldo <$1000, compound dari P&L trade beneran) -- BUKAN tercampur saldo real Olan yang naik-
// turun karena hal lain di luar strategi Sniper.

const fs = require('fs');
const path = require('path');
const { toLocal } = require('./config');

const BANKROLL_PATH = path.join(__dirname, 'kaela-bankroll.json');
const START_BALANCE = 100;
const TOP_UP_AMOUNT = 100;
const TOP_UP_STOP_AT = 1000;
const TOP_UP_DAY_OF_MONTH = 5;

function load() {
  if (!fs.existsSync(BANKROLL_PATH)) {
    return { balance: START_BALANCE, startedAt: null, lastTopUpMonthKey: null, topUpHistory: [], pnlHistory: [] };
  }
  return JSON.parse(fs.readFileSync(BANKROLL_PATH, 'utf8'));
}

function save(state) {
  fs.writeFileSync(BANKROLL_PATH, JSON.stringify(state, null, 2));
}

// Recurring, BUKAN permanen (bug lama yang udah dikoreksi di backtest, 10 Agu 2026) -- cek ULANG
// tiap tanggal 5 tiap bulan, kalau saldo waktu itu <$1000 (termasuk kalau sempat di atas lalu
// turun lagi karena rugi), top-up jalan lagi. Dipanggil tiap kali nyopetAutoAnalysis.js jalan
// (1x/hari), idempotent -- gak dobel top-up kalau ke-run ulang hari yang sama (lastTopUpMonthKey).
function checkAndApplyTopUp(now = new Date()) {
  const state = load();
  if (!state.startedAt) state.startedAt = now.toISOString();
  // WAJIB lewat toLocal() (config.js), JANGAN hardcode offset jam sendiri -- fix 14 Agu 2026,
  // ketauan pas audit: baris ini sempat nulis ulang +8 jam manual, padahal itu persis yang
  // diwanti-wanti config.js buat dihindari (kalau WITA berubah suatu saat, ini bakal salah diam2).
  const localNow = toLocal(now);
  const curMonthKey = localNow.getUTCFullYear() * 12 + localNow.getUTCMonth();
  const dayOfMonth = localNow.getUTCDate();

  if (dayOfMonth >= TOP_UP_DAY_OF_MONTH && curMonthKey !== state.lastTopUpMonthKey) {
    state.lastTopUpMonthKey = curMonthKey;
    if (state.balance < TOP_UP_STOP_AT) {
      state.balance += TOP_UP_AMOUNT;
      state.topUpHistory.push({ date: now.toISOString(), amount: TOP_UP_AMOUNT, balanceAfter: state.balance });
      save(state);
      return { toppedUp: true, amount: TOP_UP_AMOUNT, balanceAfter: state.balance };
    }
    save(state);
  }
  return { toppedUp: false };
}

// Update saldo abis trade closed (penuh ATAU partial -- caller kirim pnlUsd sebagian/penuh).
// `label` buat jejak riwayat (mis. "partial tahap 1", "closed_sl", dst).
function applyRealizedPnl(pnlUsd, label, date = new Date()) {
  const state = load();
  state.balance = Math.max(0, state.balance + pnlUsd);
  state.pnlHistory.push({ date: date.toISOString(), pnlUsd, label, balanceAfter: state.balance });
  save(state);
  return state.balance;
}

function getBalance() {
  return load().balance;
}

// Laporan ala FUND MANAGER (14 Agu 2026, permintaan Olan: "Kaela langsung jadi fund manajer
// trading di tradingan dia sendiri, harus bekerja seperti fund manajer beneran") -- pemisahan
// yang WAJIB ada di laporan fund asli: pertumbuhan dari SETORAN (top-up, bukan prestasi) vs
// pertumbuhan dari PERFORMA TRADING (P&L beneran, ini yang nunjukkin skill). Nyampur dua-duanya
// jadi "total growth" doang itu MENYESATKAN -- fund manager beneran gak pernah klaim "AUM naik
// 5x" kalau separuhnya cuma dari investor nambah setoran, bukan dari trading.
function getFundReport() {
  const state = load();
  const totalContributed = START_BALANCE + state.topUpHistory.reduce((s, t) => s + t.amount, 0);
  const totalRealizedPnl = state.pnlHistory.reduce((s, p) => s + p.pnlUsd, 0);
  const returnOnContributedPct = totalContributed > 0 ? (totalRealizedPnl / totalContributed) * 100 : 0;

  // Timeline gabungan (topup + pnl), urut kronologis -- INI equity curve SALDO BENERAN (bukan
  // cuma kumulatif P&L dari 0 kayak equity curve trade biasa di tab Jurnal) -- titik awal $100.
  const events = [
    { date: state.startedAt || new Date().toISOString(), type: 'start', amount: START_BALANCE, balanceAfter: START_BALANCE, label: 'Mulai' },
    ...state.topUpHistory.map((t) => ({ ...t, type: 'topup', label: 'Top-up' })),
    ...state.pnlHistory.map((p) => ({ ...p, type: 'pnl', amount: p.pnlUsd })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    balance: state.balance,
    startedAt: state.startedAt,
    totalContributed,
    totalRealizedPnl,
    returnOnContributedPct,
    tradeCount: state.pnlHistory.length,
    events,
  };
}

module.exports = { load, save, checkAndApplyTopUp, applyRealizedPnl, getBalance, getFundReport, START_BALANCE, TOP_UP_STOP_AT };
