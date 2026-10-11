// Simulasi KANTONG PEMULA LULUS (11 Okt 2026, kebijakan Olan): 🌾 Farmer (leverage) mulai $1.000 -> begitu tembus $10.000 (pas lagi
// gak pegang posisi) LULUS: seluruh saldonya pindah ke 🏦 DCA Grid Spot (kebal crash) -> Farmer mulai lagi pakai $1.000.
// Varian A: $1.000 Farmer baru = setoran BARU dari luar. Varian B: $1.000 diambil dari saldo spot (gak ada setoran tambahan).
// Data harian 2010-sekarang (gridLifetimeStudy.loadDaily). Farmer = setting live (6%, tiap -15%, 5x isolated merge, TP 30%, ATH -15%).
// Spot = pemenang riset (2% modal, tiap -2,5%, tangga x1,1, TP 1,5% total masuk). Fee: futures 0,05%, spot 0,1%.
// Jalanin: node backtest/gridGraduateStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const FEE_F = 0.0005, FEE_S = 0.001, MM = 0.005, FUND = 0.0003, LEV = 5;

function sim(rows, { grad = 10000, seed = 1000, mode = 'A', from = 0, startFarmer = seed, startSpot = 0, monthly = 0 } = {}) {
  let lastMonth = null; // monthly = setoran rutin ke Farmer tiap awal bulan (mis. $100 dari gaji)
  let ath = 0, deposits = startFarmer + startSpot, grads = 0;
  // Farmer pocket
  const F = { w: startFarmer, pos: null, putIn: 0, realized: 0, unit: 0, cap: 0, lastE: 0 };
  // Spot
  const S = { cash: startSpot, btc: 0, invested: 0, base: 0, n: 0, lastBuy: 0, cycles: 0 };
  let peak = startFarmer + startSpot, maxDd = 0, worstDrop = 0, gradLog = [];
  const fEq = (px) => F.w + (F.pos ? F.pos.q * (px - F.pos.e) : 0);
  const sEq = (px) => S.cash + S.btc * px;
  for (const [t, o, h, l, c] of rows) {
    if (t < from) { ath = Math.max(ath, h); continue; }
    const mon = new Date(t).toISOString().slice(0, 7);
    if (monthly > 0 && lastMonth !== null && mon !== lastMonth) { F.w += monthly; deposits += monthly; }
    lastMonth = mon;
    // ---------- Farmer ----------
    if (F.pos) F.w -= F.pos.q * o * FUND;
    if (!F.pos && F.putIn === 0 && ath > 0 && l <= ath * 0.85) { F.cap = Math.min(F.w, grad); F.unit = F.cap * 0.06; }
    if (F.unit > 0) {
      const trig = F.putIn === 0 ? Math.min(ath * 0.85, o) : (F.pos ? F.lastE * 0.85 : Infinity);
      if (l <= trig && F.putIn + F.unit <= F.cap * 1.0001) {
        const e = Math.min(trig, o); let mg = F.unit;
        if (F.pos) { const pnl = F.pos.q * (e - F.pos.e); F.realized += pnl; F.w += pnl - F.pos.q * e * FEE_F; mg += Math.max(0, F.pos.mg + pnl); F.pos = null; }
        F.pos = { e, mg, q: mg * LEV / e }; F.w -= mg * LEV * FEE_F; F.putIn += F.unit; F.lastE = e;
      }
    }
    if (F.pos && l <= F.pos.e * (1 - 1 / LEV + MM)) { F.w -= F.pos.mg; F.realized -= F.pos.mg; F.pos = null; if (F.putIn + F.unit > F.cap * 1.0001) { F.putIn = 0; F.realized = 0; F.unit = 0; } }
    if (F.pos) { const tp = F.pos.e + (0.3 * F.putIn - F.realized) / F.pos.q; if (h >= tp) { F.w += F.pos.q * (tp - F.pos.e) - F.pos.q * tp * FEE_F; F.pos = null; F.putIn = 0; F.realized = 0; F.unit = 0; } }
    // LULUS: Farmer >= batas & lagi gak pegang posisi -> pindah ke spot, mulai Farmer baru $1.000
    if (!F.pos && F.putIn === 0 && F.w >= grad) {
      const moved = F.w; S.cash += moved; grads++;
      if (mode === 'A') { F.w = seed; deposits += seed; } else { const take = Math.min(seed, S.cash); S.cash -= take; F.w = take; }
      gradLog.push({ date: new Date(t).toISOString().slice(0, 10), moved: Math.round(moved), btc: Math.round(c) });
    }
    // ---------- Spot ----------
    if (S.cash + S.btc > 0) {
      if (S.invested === 0 && S.cash > 1) { S.base = sEq(o) * 0.02; const u = Math.min(S.cash, S.base); S.btc += u * (1 - FEE_S) / o; S.cash -= u; S.invested = u; S.lastBuy = o; S.n = 1; }
      while (S.invested > 0 && l <= S.lastBuy * 0.975 && S.cash > S.base * 0.05) { const px = Math.min(S.lastBuy * 0.975, o); const u = Math.min(S.cash, S.base * Math.pow(1.1, S.n)); S.n++; S.btc += u * (1 - FEE_S) / px; S.cash -= u; S.invested += u; S.lastBuy = px; }
      if (S.invested > 0) { const tp = S.invested * 1.015 / (S.btc * (1 - FEE_S)); if (h >= tp) { S.cash += S.btc * tp * (1 - FEE_S); S.btc = 0; S.invested = 0; S.cycles++; } }
    }
    ath = Math.max(ath, h);
    const tot = fEq(c) + sEq(c);
    if (tot > peak) peak = tot; maxDd = Math.max(maxDd, 1 - tot / peak);
  }
  const last = rows[rows.length - 1][4];
  return { total: fEq(last) + sEq(last), farmer: fEq(last), spot: sEq(last), deposits, grads, maxDd, gradLog, spotCycles: S.cycles };
}
module.exports = { sim };

if (require.main === module) (async () => {
  const rows = await loadDaily();
  const f = (v) => '$' + Math.round(v).toLocaleString('id-ID');
  for (const from of ['2010-08-18', '2014-01-01', '2018-01-01', '2021-11-10']) {
    const t0 = Date.parse(from);
    console.log(`\n=== mulai ${from} (modal awal $1.000) ===`);
    for (const [name, o] of [['A: Farmer baru = setor $1.000 lagi', { mode: 'A' }], ['B: Farmer baru dari saldo spot', { mode: 'B' }], ['Pembanding: Farmer doang, gak pernah lulus', { grad: 1e15 }]]) {
      const r = sim(rows, { ...o, from: t0 });
      console.log(`${name.padEnd(42)} | total ${f(r.total)} (Farmer ${f(r.farmer)} + spot ${f(r.spot)}) | setoran ${f(r.deposits)} | lulus ${r.grads}x | DD total ${(r.maxDd * 100).toFixed(0)}%`);
      if (name.startsWith('A') && r.gradLog.length) console.log('   lulus pertama:', r.gradLog.slice(0, 4).map((g) => `${g.date} (${f(g.moved)}, BTC ${f(g.btc)})`).join(', '));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
