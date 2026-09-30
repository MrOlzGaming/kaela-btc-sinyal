// ninjaMrSignal.js (30 Sep 2026) -- NINJA "Mean Reversion Searah Tren" BTC 15M, mode PAPER (sinyal +
// perhitungan lengkap, TANPA order ke exchange manapun). Permintaan Olan: "Sinyalnya jalan langsung
// bisa? Walau ga jalan di exchange atau demo tapi ada perhitungan jelas?" -- target venue BC.Game
// (fee buka/tutup 0, biaya inap per 8 jam), eksekusi MANUAL oleh Olan dari WA (BC.Game gak punya API).
//
// Dasar riset (BACKTEST-REGISTRY.md bagian Ninja, RESEARCH-LOG.md 30 Sep 2026): satu-satunya pola
// timeframe rendah yang lolos in-sample (Sep 2024-Sep 2026, PF 1,28) DAN out-of-sample (Sep 2019-
// Sep 2024, PF 1,20), semua k 1,5-4 positif, permutasi p=0,01 -- TAPI edge tipis (~0,07-0,1%/trade),
// cuma hidup kalau biaya per trade ~0. Paper dulu buat ngukur kenyataan sebelum pakai uang.
//
// Aturan (IDENTIK backtestNinjaResearch3.js kind 'mr', trend:true, exit 'mean' -- logika sinyal &
// indikator DI-IMPORT dari situ biar gak ada 2 versi; kesamaan trade-per-trade dikunci regressionTests.js):
//   - tren naik (close > EMA200) + close < Bollinger bawah (SMA20 - 2,5 SD) -> BUY
//   - tren turun (close < EMA200) + close > Bollinger atas (SMA20 + 2,5 SD) -> SELL
//   - entry di OPEN candle berikutnya; SL = k x ATR14 dari harga entry; exit pas CLOSE balik ke SMA20
//     (atau SL kena duluan). 1 posisi aktif; candle yang nutup posisi gak boleh buka baru.
// Ukuran posisi: Kalkulator Exposure (calculator.js hitung) pakai modal KERTAS `paperModalUsd`.
// Biaya: slippage per sisi + biaya inap per lewat 00/08/16 UTC (default 0,01% notional = asumsi 0,5%
// dari MARGIN @50x -- BELUM dikonfirmasi Olan; kalau ternyata 0,5% dari NOTIONAL, edge-nya MATI).
//
// Pakai: node ninjaMrSignal.js   (dipanggil tiap menit dari run-channel-breakout-vultr.sh; murah --
// kerja cuma pas ada candle 15M baru yang closed)

const fs = require('fs');
const path = require('path');
const { prepare, signal } = require('./backtestNinjaResearch3');
const { hitung } = require('./calculator');

const CONFIG_PATH = path.join(__dirname, 'ninja-mr-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ninja-mr-journal.json');
const H8 = 8 * 3600e3;
const TF_MS = 15 * 60e3;
const STALE_MS = 20 * 60e3; // candle yang ketutup > 20 menit lalu -> tetap dicatat, tapi GAK dikirim WA

function loadConfig() {
  const def = { enabled: false, paperModalUsd: 100, k: 3, slipPctPerSide: 0.01, holdFeePctPerBoundary: 0.01 };
  if (!fs.existsSync(CONFIG_PATH)) return def;
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}

function freshJournal() {
  return { lastProcessedCloseTime: null, pending: null, position: null, closed: [], stats: { n: 0, wins: 0, losses: 0, sumNetPct: 0, sumNetUsd: 0 } };
}
function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return freshJournal();
  try { return { ...freshJournal(), ...JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) }; } catch { return freshJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

function boundariesCrossed(entryT, exitT) { return Math.max(0, Math.floor(exitT / H8) - Math.floor(entryT / H8)); }

const P_MR = (k) => ({ kind: 'mr', trend: true, k, exit: 'mean' });

// Proses candle CLOSED index i (logika PERSIS loop run() di backtestNinjaResearch3.js). Mutasi `j`,
// return daftar event {type:'SIGNAL'|'OPEN'|'CLOSE', ...}.
function stepCandle(j, c, ind, i, cfg) {
  const x = c[i];
  const events = [];
  let closedNow = false;
  if (!j.position && j.pending) {
    const f = j.pending.distPct / 100, e = x.open;
    j.position = { id: j.pending.id, dir: j.pending.dir, entryPrice: e, entryTime: x.openTime, slDistPct: j.pending.distPct, sl: j.pending.dir === 'long' ? e * (1 - f) : e * (1 + f), sizing: j.pending.sizing };
    j.pending = null;
    events.push({ type: 'OPEN', position: { ...j.position } });
  }
  if (j.position) {
    const p = j.position;
    const hit = p.dir === 'long' ? x.low <= p.sl : x.high >= p.sl;
    let exitPrice = null, reason = null;
    if (hit) { exitPrice = p.dir === 'long' ? Math.min(x.open, p.sl) : Math.max(x.open, p.sl); reason = 'SL'; }
    else if (ind.sma20[i] !== null && (p.dir === 'long' ? x.close >= ind.sma20[i] : x.close <= ind.sma20[i])) { exitPrice = x.close; reason = 'MEAN'; }
    if (exitPrice !== null) {
      const grossPct = ((exitPrice - p.entryPrice) / p.entryPrice) * 100 * (p.dir === 'long' ? 1 : -1);
      const slipPct = 2 * cfg.slipPctPerSide;
      const boundaries = boundariesCrossed(p.entryTime, x.closeTime);
      const holdPct = boundaries * cfg.holdFeePctPerBoundary;
      const netPct = grossPct - slipPct - holdPct;
      const notional = p.sizing ? p.sizing.nilaiPosisi : 0;
      const trade = { ...p, exitPrice, exitTime: x.closeTime, reason, grossPct, slipPct, boundaries, holdPct, netPct, netUsd: (netPct / 100) * notional, holdMin: Math.round((x.closeTime + 1 - p.entryTime) / 60e3) };
      j.closed.push(trade);
      if (j.closed.length > 500) j.closed = j.closed.slice(-500);
      j.stats.n += 1;
      if (netPct > 0) j.stats.wins += 1; else j.stats.losses += 1;
      j.stats.sumNetPct += netPct;
      j.stats.sumNetUsd += trade.netUsd;
      j.position = null;
      closedNow = true;
      events.push({ type: 'CLOSE', trade });
    }
  }
  if (!j.position && !closedNow && ind.atr[i] !== null) {
    const dir = signal(P_MR(cfg.k), c, ind, i);
    if (dir) {
      const distPct = (cfg.k * ind.atr[i] / x.close) * 100;
      const sizing = hitung({ modal: cfg.paperModalUsd, nyawa: distPct, direction: dir === 'long' ? 'buy' : 'sell' });
      j.pending = { id: `NMR-${x.closeTime}`, dir, distPct, refPrice: x.close, signalTime: x.closeTime, sma20: ind.sma20[i], ema200: ind.ema200[i], sizing };
      events.push({ type: 'SIGNAL', pending: { ...j.pending } });
    }
  }
  return events;
}

// Proses semua candle yang closeTime-nya > lastProcessedCloseTime. Run pertama: cuma candle terakhir
// (gak nge-replay histori jadi sinyal WA basi).
function processCandles(j, candles, cfg) {
  const ind = prepare(candles);
  const events = [];
  let start = candles.findIndex((x) => j.lastProcessedCloseTime !== null && x.closeTime > j.lastProcessedCloseTime);
  if (j.lastProcessedCloseTime === null) start = candles.length - 1;
  if (start < 0) return events;
  for (let i = start; i < candles.length; i++) {
    for (const ev of stepCandle(j, candles, ind, i, cfg)) events.push({ ...ev, candleCloseTime: candles[i].closeTime });
    j.lastProcessedCloseTime = candles[i].closeTime;
  }
  return events;
}

// ================= Format pesan WA =================
const usd = (n, d = 2) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n, d = 3) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;
const HEADER = '🥷 NINJA · Mean Reversion 15M · 📝 PAPER (BC.Game manual)';

function formatSignal(p, cfg) {
  const f = p.distPct / 100;
  const slRef = p.dir === 'long' ? p.refPrice * (1 - f) : p.refPrice * (1 + f);
  const s = p.sizing;
  return `${HEADER}
*SINYAL ${p.dir === 'long' ? '🟢 BUY' : '🔴 SELL'}* BTC -- #${p.id}

Harga sekarang: ${usd(p.refPrice)} (entry kertas = open candle 15M berikutnya)
SL: ~${usd(slRef)} (${p.distPct.toFixed(2)}% = ${cfg.k}x ATR14)
Target: balik ke rata-rata SMA20 ~${usd(p.sma20)} (bergerak tiap candle, bukan TP tetap)
Alasan: ${p.dir === 'long' ? 'tren naik (di atas EMA200) tapi harga jatuh keluar Bollinger bawah' : 'tren turun (di bawah EMA200) tapi harga naik keluar Bollinger atas'} -- ${p.dir === 'long' ? 'beli saat turun' : 'jual saat naik'}

Kalkulator Exposure (modal kertas ${usd(cfg.paperModalUsd, 0)}):
Nilai posisi ${usd(s.nilaiPosisi)} · Leverage ${s.leverage}x · Margin ${usd(s.margin)}

⚠️ Paper trading -- belum pakai uang. Edge tipis, cuma hidup kalau biaya ~0.`;
}

function formatClose(t, stats, cfg) {
  const wr = stats.n ? (stats.wins / stats.n) * 100 : 0;
  return `${HEADER}
*TUTUP ${t.netPct > 0 ? '✅' : '❌'}* ${t.dir === 'long' ? '🟢 BUY' : '🔴 SELL'} BTC -- #${t.id}

Entry ${usd(t.entryPrice)} → Exit ${usd(t.exitPrice)} (${t.reason === 'SL' ? 'kena SL' : 'balik ke rata-rata SMA20'}, ${t.holdMin} menit)
Gerak harga (gross): ${pct(t.grossPct)}
Slippage (2 sisi @${cfg.slipPctPerSide}%): -${t.slipPct.toFixed(3)}%
Biaya inap: ${t.boundaries}x lewat 00/08/16 UTC @${cfg.holdFeePctPerBoundary}% = -${t.holdPct.toFixed(3)}%
*Bersih: ${pct(t.netPct)} = ${t.netUsd >= 0 ? '+' : '-'}${usd(Math.abs(t.netUsd))}* (nilai posisi ${usd(t.sizing ? t.sizing.nilaiPosisi : 0)})

Rekap paper: ${stats.wins}/${stats.n} menang (${wr.toFixed(1)}%) · akumulasi ${pct(stats.sumNetPct, 2)} notional = ${stats.sumNetUsd >= 0 ? '+' : '-'}${usd(Math.abs(stats.sumNetUsd))}`;
}

async function fetchClosedCandles15m() {
  const { fetchWithRetry } = require('./httpRetry');
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1000');
  const raw = await res.json();
  const now = Date.now();
  return raw.map((x) => ({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], closeTime: x[6] })).filter((x) => x.closeTime <= now);
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[NinjaMR] enabled:false -- gak ngapa-ngapain.'); return; }
  const candles = await fetchClosedCandles15m();
  if (candles.length < 300) { console.log(`[NinjaMR] Candle kurang (${candles.length}), skip.`); return; }
  const j = loadJournal();
  const before = j.lastProcessedCloseTime;
  const events = processCandles(j, candles, cfg);
  saveJournal(j);
  if (j.lastProcessedCloseTime === before) return; // belum ada candle 15M baru -- diam
  const { sendWhatsApp } = require('./fonnte');
  const { WIBOWO_GROUP_ID } = require('./wibowoNotify');
  for (const ev of events) {
    const fresh = Date.now() - ev.candleCloseTime <= STALE_MS;
    let msg = null;
    if (ev.type === 'SIGNAL') msg = formatSignal(ev.pending, cfg);
    if (ev.type === 'CLOSE') msg = formatClose(ev.trade, j.stats, cfg);
    if (ev.type === 'OPEN') console.log(`[NinjaMR] OPEN kertas ${ev.position.dir} @ ${ev.position.entryPrice} (#${ev.position.id})`);
    if (!msg) continue;
    console.log(`[NinjaMR] ${ev.type}${fresh ? '' : ' (basi, gak dikirim WA)'}:\n${msg}`);
    // Eksperimen pribadi Olan (venue BC.Game) -> CUMA grup Wibowo Hedgefund, pola sama Jalur C
    // actionableLiquidityRadar.js (bukan broadcast Sniper Club).
    if (fresh) await sendWhatsApp(msg, WIBOWO_GROUP_ID).catch((e) => console.log('[NinjaMR] Kirim WA GAGAL:', e.message));
  }
}

if (require.main === module) main().catch((e) => { console.error('[NinjaMR] ERROR:', e.message); process.exit(1); });

module.exports = { stepCandle, processCandles, formatSignal, formatClose, freshJournal, loadConfig, boundariesCrossed };
