// rangerMultiCoin.js (1 Okt 2026) -- Olan: "pokoknya cari momen culik duit paling tidak sehari dapat 1".
// Riset culikResearch.js (backtest/ninja/) buktiin maksa SERING di 1 koin timeframe rendah = kalah fee.
// Jalan lain: strategi yang UDAH tervalidasi (Ranger 4H: chart-pattern + FVG, window-gated, partial 2R +
// trail SMA60 -- PERSIS parameter live, lihat nyopetLatestFullReport.js) dipasang di BANYAK koin sekaligus
// -> frekuensi gabungan naik TANPA nurunin kualitas sinyal per koin.
//
// Data: candle 1 JAM spot Binance publik (data-api.binance.vision), di-resample ke 4H pakai resampleTo4h
// yang SAMA dengan backtest Ranger. Window bear/bull = siklus halving BTC (berbasis tanggal, berlaku
// buat semua koin -- alt ngikut siklus BTC). Fee: engine asli gak ngitung fee -> di sini tiap trade
// dipotong 0,12% notional (taker 0,05%/sisi + selip 0,01%/sisi, konservatif; partial = 3 kaki tapi
// kaki kecil, dibulatkan ke 0,12%).
// Output per koin + agregat: n, trade/hari, win, PF (% notional net fee), era <2023 vs >=2023.
// Pakai: node backtest/rangerMultiCoin.js [cacheDir]   (default cache: backtest/multicoin-cache/)

const fs = require('fs');
const path = require('path');
const { runNyopetV2BacktestWindowGated, makeBtcBearWindowFn, resampleTo4h, RESCALED_4H } = require('./rangerChartPatternFvg');

const COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'TRX', 'ATOM', 'NEAR',
  'UNI', 'ETC', 'FIL', 'APT', 'ARB', 'OP', 'SUI', 'INJ', 'AAVE', 'XLM', 'HBAR', 'SEI', 'TIA', 'WIF', 'PEPE'];
const START = Date.UTC(2019, 0, 1);
const FEE_RT_PCT = 0.12;
const ERA_SPLIT = Date.UTC(2023, 0, 1);
const CACHE = process.argv[2] || path.join(__dirname, 'multicoin-cache');

async function fetch1h(sym) {
  const f = path.join(CACHE, `${sym}USDT-1h.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = [];
  let t = START;
  const end = Date.now();
  while (t < end) {
    let raw;
    for (let a = 0; a < 5; a++) {
      try { const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1h&startTime=${t}&limit=1000`); raw = await r.json(); if (Array.isArray(raw)) break; } catch (e) { /* retry */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!Array.isArray(raw) || !raw.length) break;
    for (const x of raw) if (x[6] <= end) out.push({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], closeTime: x[6] });
    t = raw[raw.length - 1][0] + 3600e3;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

function stat(tr) {
  const n = tr.length;
  if (!n) return { n: 0, pf: NaN, sum: 0, win: NaN };
  let gw = 0, gl = 0, w = 0;
  for (const t of tr) { if (t.net > 0) { gw += t.net; w++; } else gl -= t.net; }
  return { n, pf: gl ? gw / gl : Infinity, sum: tr.reduce((a, t) => a + t.net, 0), win: (w / n) * 100 };
}
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : String(v));

(async () => {
  const all = [];
  const firstT = {};
  for (const coin of COINS) {
    const h = await fetch1h(coin);
    if (h.length < 24 * 400) { console.log(`${coin}: data kurang (${h.length} candle 1j), skip`); continue; }
    const c4 = resampleTo4h(h);
    const r = runNyopetV2BacktestWindowGated(c4, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn() });
    const tr = r.trades.map((t) => ({ coin, t: t.entryTime, dir: t.direction, reason: t.exitReason, net: (t.pnlUsd / t.nilaiPosisi) * 100 - FEE_RT_PCT, holdH: (t.exitTime - t.entryTime) / 3600e3 }));
    const days = (c4.at(-1).closeTime - c4[RESCALED_4H.warmupCandles]?.closeTime) / 864e5;
    firstT[coin] = c4[RESCALED_4H.warmupCandles]?.closeTime;
    const s = stat(tr), e1 = stat(tr.filter((x) => x.t < ERA_SPLIT)), e2 = stat(tr.filter((x) => x.t >= ERA_SPLIT));
    console.log(`${coin.padEnd(5)} mulai ${new Date(firstT[coin]).toISOString().slice(0, 10)} n=${String(s.n).padStart(3)} (${f(s.n / (days / 30), 1)}/bln) win=${f(s.win, 0)}% PF=${f(s.pf)} total=${f(s.sum, 1)}% | <2023 n=${e1.n} PF=${f(e1.pf)} | >=2023 n=${e2.n} PF=${f(e2.pf)} ${f(e2.sum, 1)}%`);
    all.push(...tr);
  }
  const s = stat(all), e1 = stat(all.filter((x) => x.t < ERA_SPLIT)), e2 = stat(all.filter((x) => x.t >= ERA_SPLIT));
  const since23 = all.filter((x) => x.t >= ERA_SPLIT);
  const days23 = (Date.now() - ERA_SPLIT) / 864e5;
  console.log(`\n=== GABUNGAN ${new Set(all.map((x) => x.coin)).size} koin (fee ${FEE_RT_PCT}% RT) ===`);
  console.log(`semua n=${s.n} win=${f(s.win, 0)}% PF=${f(s.pf)} | <2023 PF=${f(e1.pf)} n=${e1.n} | >=2023 PF=${f(e2.pf)} n=${e2.n}`);
  console.log(`frekuensi sejak 2023: ${f(since23.length / days23, 2)} sinyal/hari (kalau semua koin dipantau & 1 posisi per koin)`);
  // koin yang lolos di KEDUA era (PF>1,2 & n>=8 masing2) -- keranjang kandidat
  const byCoin = {};
  for (const t of all) (byCoin[t.coin] = byCoin[t.coin] || []).push(t);
  const good = Object.entries(byCoin).filter(([, tr]) => { const a = stat(tr.filter((x) => x.t < ERA_SPLIT)), b = stat(tr.filter((x) => x.t >= ERA_SPLIT)); return a.n >= 8 && b.n >= 8 && a.pf > 1.2 && b.pf > 1.2; }).map(([c]) => c);
  const gt = all.filter((x) => good.includes(x.coin) && x.t >= ERA_SPLIT);
  console.log(`koin lolos 2 era (PF>1,2, n>=8 tiap era): ${good.length} -> ${good.join(', ')}`);
  console.log(`  keranjang itu sejak 2023: ${f(gt.length / days23, 2)} sinyal/hari, PF=${f(stat(gt).pf)} (catatan: dipilih pakai 2 era sekaligus -> optimis, validasi sebenarnya = <2023 vs >=2023 GABUNGAN di atas)`);
})();
