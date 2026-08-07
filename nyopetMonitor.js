// Jalankan tiap jam: node nyopetMonitor.js
// Sinyal LIVE Mode Nyopet — terpisah total dari monitor.js (Siklus Halving utama).
// Spesifikasi final (lihat nyopetLog.js header, hasil sweep 315 kombinasi):
//   Hourly (entry) + Weekly (filter arah, wajib BULLISH), Long-only,
//   Nyawa 10%, TP tunggal RR 1:2, stake 15% saldo terbaru (compound).
// Nanti kalau WA (Fonnte) udah disiapkan, tinggal sambungin tiap event di bawah ke situ
// (pola sama seperti monitor.js) — dikirim ke WEB (arsip) DAN grup WA, bukan salah satu aja.

const fs = require('fs');
const path = require('path');
const { superTrend } = require('./backtest/indicators');
const { adaptiveSuperTrend } = require('./backtest/adaptiveSuperTrend');
const { formatNyopetEvent, computeLevels } = require('./nyopetLog');
const { addEntry } = require('./archive');

const STATE_PATH = path.join(__dirname, 'nyopet-state.json');
const BASE_URL = 'https://api.binance.com/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

async function fetchRecentKlines(interval, limit) {
  const res = await fetch(`${BASE_URL}?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  return raw.map(parseCandle);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { position: null, lastProcessedCloseTime: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  const now = new Date();
  const nowMs = now.getTime();
  const state = loadState();

  // limit 500 candle hourly (~20 hari) cukup buat warmup Adaptive SuperTrend (atrPeriod 10, avgLookback 50)
  const [hourlyRaw, weeklyRaw] = await Promise.all([
    fetchRecentKlines('1h', 500),
    fetchRecentKlines('1w', 60),
  ]);

  // buang candle yang masih berjalan (belum close) -- sama seperti logika backtest
  const hourly = hourlyRaw.filter((c) => c.closeTime <= nowMs);
  const weekly = weeklyRaw.filter((c) => c.closeTime <= nowMs);

  if (hourly.length < 60 || weekly.length < 15) {
    console.log('[Nyopet] Data belum cukup buat hitung indikator, skip siklus ini.');
    return;
  }

  const last = hourly[hourly.length - 1];
  if (last.closeTime === state.lastProcessedCloseTime) {
    console.log('[Nyopet]', now.toISOString(), '— candle jam ini sudah diproses, skip.');
    return;
  }

  const hourlyAdaptive = adaptiveSuperTrend(hourly);
  const weeklyTrend = superTrend(weekly, 10, 3);
  const i = hourly.length - 1;
  const currTrend = hourlyAdaptive[i]?.trend;
  const prevTrend = hourlyAdaptive[i - 1]?.trend;
  const weeklyNow = weeklyTrend[weeklyTrend.length - 1]?.trend;

  const events = [];

  // 1. posisi lagi OPEN? cek SL/TP dulu
  if (state.position) {
    const pos = state.position;
    const hitSL = last.low <= pos.slPrice;
    const hitTP = last.high >= pos.tpPrice;
    if (hitSL || hitTP) {
      const type = hitTP ? 'TP' : 'SL';
      const price = hitTP ? pos.tpPrice : pos.slPrice;
      events.push(formatNyopetEvent({ type, price, entry: pos.entry }));
      state.position = null;
    }
  }

  // 2. gak ada posisi (baru ditutup atau memang lagi kosong)? cek entry baru
  if (!state.position) {
    const flippedBullish = currTrend === 'BULLISH' && prevTrend === 'BEARISH';
    if (flippedBullish && weeklyNow === 'BULLISH') {
      const entry = last.close;
      const lv = computeLevels(entry);
      state.position = {
        entry, slPrice: lv.sl, tpPrice: lv.tp,
        entryDate: new Date(last.closeTime).toISOString(),
      };
      events.push(formatNyopetEvent({ type: 'ENTRY', price: entry }));
    }
  }

  state.lastProcessedCloseTime = last.closeTime;
  saveState(state);

  if (events.length === 0) {
    console.log(`[Nyopet] ${now.toISOString()} — no event. Trend hourly: ${currTrend}, Weekly: ${weeklyNow}, posisi: ${state.position ? 'OPEN sejak ' + state.position.entryDate : '-'}`);
    return;
  }

  for (const msg of events) {
    console.log(msg + '\n');
    addEntry('nyopet', msg, now);
  }
}

main().catch((e) => {
  console.error('ERROR nyopetMonitor.js:', e.message);
  process.exit(1);
});
