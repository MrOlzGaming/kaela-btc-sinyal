// Jalankan tiap jam: node nyopetMonitor.js
// Sinyal LIVE Mode Nyopet — terpisah total dari monitor.js (Siklus Halving utama).
// Spesifikasi final (lihat nyopetLog.js header, hasil sweep 315 kombinasi):
//   Hourly (entry) + Weekly (filter arah, wajib BULLISH), Long-only,
//   Nyawa 10%, TP tunggal RR 1:2, stake 15% saldo terbaru (compound).
// Tiap event dikirim ke WEB (arsip) DAN grup WA "BTC Sniper Club" lewat Fonnte (fonnte.js).

const fs = require('fs');
const path = require('path');
const { superTrend } = require('./backtest/indicators');
const { adaptiveSuperTrend } = require('./backtest/adaptiveSuperTrend');
const { formatNyopetEvent, formatNyopetNoSignal, computeLevels } = require('./nyopetLog');
const { addEntry } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');

const STATE_PATH = path.join(__dirname, 'nyopet-state.json');
const BASE_URL = 'https://api.binance.com/api/v3/klines';

function parseCandle(raw) {
  return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] };
}

async function fetchRecentKlines(interval, limit) {
  const res = await fetchWithRetry(`${BASE_URL}?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
  const raw = await res.json();
  return raw.map(parseCandle);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { position: null, lastProcessedCloseTime: null, lastNoSignalStatusDate: null };
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
  const events = [];
  const isNewCandle = last.closeTime !== state.lastProcessedCloseTime;

  if (isNewCandle) {
    const hourlyAdaptive = adaptiveSuperTrend(hourly);
    const weeklyTrend = superTrend(weekly, 10, 3);
    const i = hourly.length - 1;
    const currTrend = hourlyAdaptive[i]?.trend;
    const prevTrend = hourlyAdaptive[i - 1]?.trend;
    const weeklyNow = weeklyTrend[weeklyTrend.length - 1]?.trend;

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
  } else {
    console.log('[Nyopet Market]', now.toISOString(), '— candle jam ini sudah diproses.');
  }

  // Status harian: kalau HARI INI belum ada event nyata, gak ada posisi terbuka,
  // dan belum kirim status hari ini -- kirim 1x "sedang mengumpulkan data" (keputusan Olan: lapor tiap hari, jangan diam total).
  const todayStr = now.toISOString().slice(0, 10);
  if (events.length === 0 && !state.position && state.lastNoSignalStatusDate !== todayStr) {
    events.push(formatNyopetNoSignal(now));
    state.lastNoSignalStatusDate = todayStr;
  }

  saveState(state);

  if (events.length === 0) {
    console.log(`[Nyopet Market] ${now.toISOString()} — gak ada yang perlu dikirim. posisi: ${state.position ? 'OPEN sejak ' + state.position.entryDate : '-'}`);
    return;
  }

  for (const msg of events) {
    console.log(msg + '\n');
    addEntry('nyopet', msg, now);
    await sendWhatsApp(msg);
  }
}

main().catch((e) => {
  console.error('ERROR nyopetMonitor.js:', e.message);
  process.exit(1);
});
