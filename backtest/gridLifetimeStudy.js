// BACKTEST SEUMUR HIDUP BTC (11 Okt 2026, permintaan Olan): modal $1.000, sistem Grid kita dari harga BTC pertama kali ada di pasar.
// Data HARIAN gabungan: 2010-07 .. 2014-09 blockchain.info (cuma harga rata2 harian -> high=low=close, sumbu bawah/atas harian
// GAK kebaca = hasil era ini sedikit terlalu optimis), 2014-09 .. 2017-08 Yahoo OHLC, 2017-08 .. sekarang Binance OHLC.
// Sistem (aturan yang sekarang dipakai/disimpan):
//   LONG  = Grid Tangga LIVE: BTC <= ATH -15% -> 8% saldo terbaru per tangga, isolated 5x, tambah tiap turun 20% dari entry
//           terakhir, TP = rugi tangga kelikuidasi + 20% total modal masuk. Funding long bayar 0,03%/hari (asumsi 0,01%/8 jam).
//   SHORT = Tangga Short (riset, belum live): hari ke-520..900 sejak halving, 1x, 5% saldo per tangga, tambah tiap naik 10%,
//           TP 10% total modal masuk, ditutup paksa pas window habis. Short nerima funding 0,03%/hari.
// Fee taker 0,05%. Long & short pakai 1 saldo yang sama. Jalanin: node backtest/gridLifetimeStudy.js
const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'btc-daily-since-2010.json');
const FEE = 0.0005, MM = 0.005, FUND_DAY = 0.0003, DAY = 864e5;
const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map((d) => Date.parse(d));

async function loadDaily() {
  if (fs.existsSync(CACHE) && Date.now() - fs.statSync(CACHE).mtimeMs < DAY) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const bc = await (await fetch('https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=false', { signal: AbortSignal.timeout(60000) })).json();
  const yh = JSON.parse(fs.readFileSync(path.join(__dirname, 'yahoo-btc-ohlc.json'), 'utf8'));
  const rows = [];
  const yStart = yh[0].time, bnStart = Date.UTC(2017, 7, 17);
  for (const v of bc.values) { const t = v.x * 1000; if (v.y > 0 && t < yStart) rows.push([t, v.y, v.y, v.y, v.y]); }
  for (const y of yh) if (y.time >= yStart && y.time < bnStart && y.close > 0) rows.push([y.time, y.open, y.high, y.low, y.close]);
  let cur = bnStart;
  while (cur < Date.now() - DAY) {
    const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`, { signal: AbortSignal.timeout(20000) })).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) if (x[6] < Date.now()) rows.push([x[0], +x[1], +x[2], +x[3], +x[4]]);
    cur = k[k.length - 1][0] + DAY; if (k.length < 1000) break;
  }
  fs.writeFileSync(CACHE, JSON.stringify(rows));
  return rows;
}
const daysSinceHalving = (t) => { let h = null; for (const x of HALVINGS) if (x <= t) h = x; return h == null ? -1 : (t - h) / DAY; };

function sim(rows, { long = true, short = true, start = 1000, gap = 0.20, betL = 0.08 } = {}) {
  let wallet = start, ath = 0, peak = start, maxDd = 0, minEq = start;
  const L = { pos: null, putIn: 0, realized: 0, unit: 0, cap: 0, lastE: 0, tp: 0, liqs: 0, rungkad: 0 };
  const S = { lots: [], putIn: 0, realized: 0, unit: 0, cap: 0, lastE: 0, tp: 0, liqs: 0, forced: 0 };
  const yearly = {}; let lastYear = null;
  const eqAt = (px) => wallet + (L.pos ? L.pos.q * (px - L.pos.e) : 0) + S.lots.reduce((s, p) => s + p.q * (p.e - px), 0);
  for (const [t, o, h, l, c] of rows) {
    const yr = new Date(t).getUTCFullYear(); if (yr !== lastYear) { if (lastYear != null) yearly[lastYear].end = eqAt(o); yearly[yr] = { start: eqAt(o) }; lastYear = yr; }
    // funding harian
    if (L.pos) wallet -= L.pos.q * o * FUND_DAY;
    for (const p of S.lots) wallet += p.q * o * FUND_DAY;
    // ================= LONG (merge, isolated 5x) =================
    if (long) {
      const lev = 5;
      if (!L.pos && L.putIn === 0 && ath > 0 && l <= ath * 0.85) { L.cap = wallet; L.unit = wallet * betL; L.lastE = 0; }
      if (L.unit > 0) {
        const trig = L.putIn === 0 ? Math.min(ath * 0.85, o) : (L.pos ? L.lastE * (1 - gap) : Infinity); // abis liq -> langsung buka lagi
        if (l <= trig && L.putIn + L.unit <= L.cap * 1.0001) {
          const e = Math.min(trig, o); let mg = L.unit;
          if (L.pos) { const pnl = L.pos.q * (e - L.pos.e); L.realized += pnl; wallet += pnl - L.pos.q * e * FEE; mg += Math.max(0, L.pos.mg + pnl); L.pos = null; }
          L.pos = { e, mg, q: mg * lev / e }; wallet -= mg * lev * FEE; L.putIn += L.unit; L.lastE = e;
        }
      }
      if (L.pos && l <= L.pos.e * (1 - 1 / lev + MM)) {
        wallet -= L.pos.mg; L.realized -= L.pos.mg; L.pos = null; L.liqs++;
        if (L.putIn + L.unit > L.cap * 1.0001) { L.rungkad++; L.putIn = 0; L.realized = 0; L.unit = 0; }
      }
      if (L.pos) { const tpPx = L.pos.e + (0.2 * L.putIn - L.realized) / L.pos.q; if (h >= tpPx) { wallet += L.pos.q * (tpPx - L.pos.e) - L.pos.q * tpPx * FEE; L.pos = null; L.putIn = 0; L.realized = 0; L.unit = 0; L.tp++; } }
    }
    // ================= SHORT (1x, window halving) =================
    if (short) {
      const d = daysSinceHalving(t), bear = d >= 520 && d < 900;
      const closeAll = (px) => { for (const p of S.lots) wallet += p.q * (p.e - px) - p.q * px * FEE; S.lots = []; S.putIn = 0; S.realized = 0; S.unit = 0; };
      if (!bear && S.lots.length) { closeAll(o); S.forced++; }
      if (bear) {
        if (S.putIn === 0) { S.cap = wallet; S.unit = wallet * 0.05; S.lots.push({ e: o, q: S.unit / o, mg: S.unit }); wallet -= S.unit * FEE; S.putIn = S.unit; S.lastE = o; }
        while (h >= S.lastE * 1.1 && S.putIn + S.unit <= S.cap * 1.0001) { const e = Math.max(S.lastE * 1.1, o); S.lots.push({ e, q: S.unit / e, mg: S.unit }); wallet -= S.unit * FEE; S.putIn += S.unit; S.lastE = e; }
        const keep = []; for (const p of S.lots) { if (h >= p.e * (2 - MM)) { wallet -= p.mg; S.realized -= p.mg; S.liqs++; } else keep.push(p); } S.lots = keep;
        if (S.lots.length) {
          const Q = S.lots.reduce((s, p) => s + p.q, 0), cost = S.lots.reduce((s, p) => s + p.q * p.e, 0);
          const tpPx = (cost - (0.1 * S.putIn - S.realized)) / Q;
          if (l <= tpPx) { closeAll(tpPx); S.tp++; }
        }
      }
    }
    ath = Math.max(ath, h);
    const eq = eqAt(c); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak); minEq = Math.min(minEq, eq);
    if (eq <= 0.01) break;
  }
  const last = rows[rows.length - 1]; yearly[lastYear].end = eqAt(last[4]);
  return { end: eqAt(last[4]), maxDd, minEq, L, S, yearly };
}
module.exports = { loadDaily, sim };
if (require.main === module) (async () => {
  const rows = await loadDaily();
  const f = (v) => '$' + Math.round(v).toLocaleString('id-ID');
  console.log(`data harian ${new Date(rows[0][0]).toISOString().slice(0, 10)} ($${rows[0][4]}) .. ${new Date(rows[rows.length - 1][0]).toISOString().slice(0, 10)} ($${Math.round(rows[rows.length - 1][4])}), ${rows.length} hari`);
  const yrs = (rows[rows.length - 1][0] - rows[0][0]) / (365.25 * DAY);
  for (const [name, o] of [['LONG + SHORT', {}], ['LONG doang (Grid Tangga live)', { short: false }], ['SHORT doang', { long: false }]]) {
    const r = sim(rows, o);
    console.log(`\n=== ${name} ===\n$1.000 -> ${f(r.end)} (x${(r.end / 1000).toFixed(1)}, ${((Math.pow(r.end / 1000, 1 / yrs) - 1) * 100).toFixed(0)}%/th) | DD terburuk ${(r.maxDd * 100).toFixed(0)}% | saldo terendah ${f(r.minEq)}`);
    console.log(`  long: TP ${r.L.tp}x, tangga kelikuidasi ${r.L.liqs}, rungkad ${r.L.rungkad} | short: TP ${r.S.tp}x, kelikuidasi ${r.S.liqs}, ditutup paksa akhir window ${r.S.forced}x`);
    if (name === 'LONG + SHORT') console.log('  per tahun: ' + Object.entries(r.yearly).map(([y, v]) => `${y} ${f(v.end)}`).join(' | '));
  }
})().catch((e) => { console.error(e); process.exit(1); });
