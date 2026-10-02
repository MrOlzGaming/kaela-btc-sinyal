// rangerStructureGate.js (3 Okt 2026) -- Olan: "silahkan kreatif untuk upgrade" (abis studi 4 indikator TradingView,
// lihat backtest/indicatorStudy.js). Satu2nya pola yang lolos 2 era di studi itu = SMC AI LONG: beli pullback
// ke FVG kalau STRUKTUR pasar (BOS/CHoCH, pivot + close-break) searah. Ide upgrade: pasang "gerbang struktur" ke
// Ranger 4H -- entry cuma diambil kalau arah struktur 4H SEARAH arah entry (window bull -> long butuh struktur naik,
// window bear -> short butuh struktur turun).
//
// Engine = Ranger live PERSIS (runNyopetV2BacktestWindowGated + RESCALED_4H, modal/5, window halving BTC), gerbang
// dipasang lewat hook `adxGateFn(candles, i)` yang udah ada (false = skip entry). Struktur dihitung TANPA ngintip:
// pivot dikonfirmasi L candle setelahnya, break = close tembus pivot terakhir (sama persis SMC AI).
// Varian: L = 5/10/20/30 candle 4H; mode 'searah' (struktur WAJIB searah) vs 'bukanLawan' (cuma tolak kalau lawan).
// Data: BTC hourly-cache.json (2017-2026, engine Ranger) + 22 koin (cache 1j dari rangerMultiCoin.js, seleksi <2023).
// Metrik: % notional net fee 0,12%/trade, PF, era <2023 / >=2023, plus modal akhir & max DD engine (BTC).
// Pakai: node backtest/rangerStructureGate.js [multicoinCacheDir]

const fs = require('fs');
const path = require('path');
const { runNyopetV2BacktestWindowGated, makeBtcBearWindowFn, resampleTo4h, RESCALED_4H, CANDLES_4H } = require('./rangerChartPatternFvg');
const { isBtcBearWindow } = require('../halvingBearWindow');

const FEE = 0.12, SPLIT = Date.UTC(2023, 0, 1);
const COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'TRX', 'ATOM', 'NEAR', 'UNI', 'ETC', 'FIL', 'INJ', 'AAVE', 'XLM', 'HBAR'];

function structureSeries(c, L) {
  const dir = new Array(c.length).fill(0);
  let sd = 0, sh = null, sl = null, shb = false, slb = false;
  const isPH = (p) => { for (let j = p - L; j <= p + L; j++) if (j !== p && c[j].high >= c[p].high && (j > p || c[j].high > c[p].high)) return false; return true; };
  const isPL = (p) => { for (let j = p - L; j <= p + L; j++) if (j !== p && c[j].low <= c[p].low && (j > p || c[j].low < c[p].low)) return false; return true; };
  for (let i = 0; i < c.length; i++) {
    const p = i - L;
    if (p >= L) { if (isPH(p)) { sh = c[p].high; shb = false; } if (isPL(p)) { sl = c[p].low; slb = false; } }
    if (i > 0 && sh !== null && !shb && c[i].close > sh && c[i - 1].close <= sh) { shb = true; sd = 1; }
    if (i > 0 && sl !== null && !slb && c[i].close < sl && c[i - 1].close >= sl) { slb = true; sd = -1; }
    dir[i] = sd;
  }
  return dir;
}

function makeGate(c, L, mode) {
  const sd = structureSeries(c, L);
  return (candles, i) => {
    const want = isBtcBearWindow(new Date(candles[i].closeTime)) ? -1 : 1;
    return mode === 'searah' ? sd[i] === want : sd[i] !== -want;
  };
}

function trades(c, gate) {
  const r = runNyopetV2BacktestWindowGated(c, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn(), adxGateFn: gate });
  return { r, tr: r.trades.map((t) => ({ t: t.entryTime, net: (t.pnlUsd / t.nilaiPosisi) * 100 - FEE })) };
}
function st(tr) {
  if (!tr.length) return { n: 0, pf: NaN, sum: 0 };
  let gw = 0, gl = 0; for (const t of tr) { if (t.net > 0) gw += t.net; else gl -= t.net; }
  return { n: tr.length, pf: gl ? gw / gl : Infinity, sum: tr.reduce((a, t) => a + t.net, 0) };
}
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : String(v));
const fmt = (s) => `n=${s.n} PF=${f(s.pf)} total=${f(s.sum, 0)}%`;

const VARIANTS = [['TANPA gerbang (Ranger sekarang)', null, null]];
for (const L of [5, 10, 20, 30]) for (const mode of ['searah', 'bukanLawan']) VARIANTS.push([`struktur L=${L} ${mode}`, L, mode]);

(function main() {
  // --- BTC (data engine Ranger asli, 2017-2026) ---
  console.log(`=== BTC 4H (engine Ranger, ${CANDLES_4H.length} candle) ===`);
  for (const [lab, L, mode] of VARIANTS) {
    const { r, tr } = trades(CANDLES_4H, L ? makeGate(CANDLES_4H, L, mode) : null);
    console.log(`${lab.padEnd(34)} semua ${fmt(st(tr))} | <2023 ${fmt(st(tr.filter((x) => x.t < SPLIT)))} | >=2023 ${fmt(st(tr.filter((x) => x.t >= SPLIT)))} | modal $100 -> $${f(r.finalCapital, 0)} DD ${f(r.maxDrawdownPct, 1)}%`);
  }
  // --- 22 koin ---
  const dir = process.argv[2];
  if (!dir) return;
  const data = {};
  for (const coin of COINS) {
    const fp = path.join(dir, `${coin}USDT-1h.json`);
    if (!fs.existsSync(fp)) continue;
    const h = JSON.parse(fs.readFileSync(fp, 'utf8')).map((x) => ({ openTime: x.openTime, open: x.open, high: x.high, low: x.low, close: x.close, closeTime: x.closeTime }));
    data[coin] = resampleTo4h(h);
  }
  console.log(`\n=== ${Object.keys(data).length} koin gabungan (seleksi <2023 dari rangerMultiCoin.js) ===`);
  for (const [lab, L, mode] of VARIANTS) {
    const all = [];
    let better = 0, worse = 0;
    const base = {};
    for (const [coin, c] of Object.entries(data)) {
      const { tr } = trades(c, L ? makeGate(c, L, mode) : null);
      all.push(...tr);
      base[coin] = st(tr);
    }
    console.log(`${lab.padEnd(34)} semua ${fmt(st(all))} | <2023 ${fmt(st(all.filter((x) => x.t < SPLIT)))} | >=2023 ${fmt(st(all.filter((x) => x.t >= SPLIT)))} | rata2/trade ${f(st(all).sum / Math.max(1, all.length), 2)}%`);
    if (!L) VARIANTS.baseByCoin = base;
    else {
      for (const coin of Object.keys(base)) { const b0 = VARIANTS.baseByCoin[coin]; if (base[coin].pf > b0.pf) better++; else worse++; }
      console.log(`${''.padEnd(34)} -> PF per koin lebih bagus di ${better}/${better + worse} koin`);
    }
  }
})();
