// Bankroll BAYANGAN milik Kaela sendiri (12 Agu 2026, permintaan Olan: "Kaela akan dikasih
// saldo bayangan $100") -- TERPISAH dari saldo real Olan di nyopet-orders.json (yang tetap
// apa adanya, murni referensi Olan pribadi). Sizing sinyal Sniper & tracking performa SEKARANG
// pakai bankroll INI, biar hasil live bisa dibandingin apel-ke-apel sama backtest yang udah
// tervalidasi (backtestFlagBreakout.js: modal $100, top-up $100/bulan tiap tanggal 5 selama
// saldo <$1000, compound dari P&L trade beneran) -- BUKAN tercampur saldo real Olan yang naik-
// turun karena hal lain di luar strategi Sniper.

const fs = require('fs');
const path = require('path');
const { localDateKey } = require('./config');

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
  const todayDate = new Date(localDateKey(now)); // ambil komponen kalender WITA
  const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
  const dayOfMonth = new Date(now.getTime() + 8 * 3600 * 1000).getUTCDate(); // WITA

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

module.exports = { load, save, checkAndApplyTopUp, applyRealizedPnl, getBalance, START_BALANCE, TOP_UP_STOP_AT };
