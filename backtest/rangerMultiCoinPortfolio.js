// rangerMultiCoinPortfolio.js (3 Okt 2026) -- simulasi PORTOFOLIO Ranger 4H multi-koin (lanjutan rangerMultiCoin.js):
// semua koin pakai SATU modal bersama, maksimal K posisi barengan (slot), tiap posisi dapet jatah modal = ekuitas/K
// pas dibuka; sinyal yang dateng pas semua slot penuh = DILEWATI. Sizing tiap trade = PERSIS engine Ranger
// (hitungExposure modal/5) dalam skala jatah slot itu, jadi return akun = jatah x (notional/modal engine) x net%.
// Fee 0,12% notional/trade. Ekuitas cuma diupdate pas posisi DITUTUP (tanpa mark-to-market) -> drawdown di sini
// LEBIH OPTIMIS dari aslinya (rugi berjalan posisi yg masih kebuka gak keitung) -- dicatat jujur di output.
// Koin = 19 yang lolos seleksi <2023 & tetap positif (rangerMultiCoin.js, minus NEAR/UNI/FIL yg gagal di >=2023
// TIDAK dibuang di sini biar adil: seleksi cuma pakai data <2023 = 22 koin).
// Pakai: node backtest/rangerMultiCoinPortfolio.js <multicoinCacheDir>

const fs = require('fs');
const path = require('path');
const { runNyopetV2BacktestWindowGated, makeBtcBearWindowFn, resampleTo4h, RESCALED_4H } = require('./rangerChartPatternFvg');

const FEE = 0.12;
const COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'TRX', 'ATOM', 'NEAR', 'UNI', 'ETC', 'FIL', 'INJ', 'AAVE', 'XLM', 'HBAR'];
const dir = process.argv[2];
const CACHE = path.join(dir, 'ranger-trades-per-coin.json');

let all;
if (fs.existsSync(CACHE)) all = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
else {
  all = [];
  for (const coin of COINS) {
    const fp = path.join(dir, `${coin}USDT-1h.json`);
    if (!fs.existsSync(fp)) continue;
    const c = resampleTo4h(JSON.parse(fs.readFileSync(fp, 'utf8')));
    const r = runNyopetV2BacktestWindowGated(c, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn() });
    for (const t of r.trades) {
      const capAtEntry = t.margin / (t.marginPct / 100);
      all.push({ coin, open: t.entryTime, close: t.exitTime, dir: t.direction, net: (t.pnlUsd / t.nilaiPosisi) * 100 - FEE, notionalFrac: t.nilaiPosisi / capAtEntry });
    }
    console.error(`${coin}: ${r.trades.length} trade`);
  }
  fs.writeFileSync(CACHE, JSON.stringify(all));
}
all.sort((a, b) => a.open - b.open);
const D = (t) => new Date(t).toISOString().slice(0, 10);

function simulate(K, start, end) {
  let eq = 100, peak = 100, dd = 0, taken = 0, skipped = 0, maxOpen = 0, worstDay = 0;
  const open = [];
  const events = all.filter((t) => t.open >= start && t.open < end);
  const closeUntil = (time) => {
    open.sort((a, b) => a.close - b.close);
    while (open.length && open[0].close <= time) {
      const p = open.shift();
      const pnl = p.alloc * p.notionalFrac * p.net / 100;
      eq += pnl; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100);
    }
  };
  for (const t of events) {
    closeUntil(t.open);
    if (open.length >= K) { skipped++; continue; }
    open.push({ ...t, alloc: eq / K });
    taken++; maxOpen = Math.max(maxOpen, open.length);
  }
  closeUntil(Infinity);
  const years = (Math.min(end, Date.now()) - start) / (365.25 * 864e5);
  return { eq, dd, taken, skipped, maxOpen, cagr: (Math.pow(eq / 100, 1 / years) - 1) * 100, perDay: taken / (years * 365.25) };
}

console.log(`Total trade 22 koin: ${all.length}, rata2 notional/modal engine ${(all.reduce((a, t) => a + t.notionalFrac, 0) / all.length).toFixed(2)}x`);
for (const [nm, s, e] of [['2019-09 -> sekarang', Date.UTC(2019, 8, 1), Infinity], ['<2023', Date.UTC(2019, 8, 1), Date.UTC(2023, 0, 1)], ['>=2023', Date.UTC(2023, 0, 1), Infinity]]) {
  console.log(`\n=== ${nm} (modal $100) ===`);
  for (const K of [1, 3, 5, 8, 12, 22]) {
    const r = simulate(K, s, e);
    console.log(`maks ${String(K).padStart(2)} posisi barengan: ambil ${r.taken} (${r.perDay.toFixed(2)}/hari), lewat ${r.skipped} | $100 -> $${r.eq.toFixed(0)} (CAGR ${r.cagr.toFixed(0)}%/thn) | DD tertutup maks ${r.dd.toFixed(1)}% (asli lebih dalam)`);
  }
}
