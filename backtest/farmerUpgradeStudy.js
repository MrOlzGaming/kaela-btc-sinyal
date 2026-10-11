// Riset UPGRADE FARMER (11 Okt 2026, Olan: "ambil terbaik.. trailing juga spesialisasi kita"):
//   A. PANEN SISAIN BIBIT -- tiap TP, seed% dari UNTUNG siklus itu dipake beli BTC SPOT yang ditahan (gak dijual), biar ikut bull besar.
//   B. TRAILING TP -- begitu target (rugi kelikuidasi + tp% total masuk) kesentuh, posisi gak langsung ditutup: stop ngikut harga
//      tertinggi, tutup kalau harga turun trail% dari puncak (lantai = harga target, untung minimal tetap kejaga).
// Mesin = Farmer live (MERGE isolated, abis liq langsung buka tangga lagi). Data 1 jam 2017-26, 94 titik mulai + jalur penuh.
// Jalanin: node backtest/farmerUpgradeStudy.js
const { loadHourly, idxAt } = require('./gridLab');
const FEE = 0.0005, MM = 0.005, FEE_SPOT = 0.001;

function run(D, i0, { m = 0.06, L = 5, g = 0.15, tp = 0.30, seed = 0, trail = 0 } = {}) {
  let wallet = 1, p = null, putIn = 0, realized = 0, unit = 0, cap = 0, lastE = 0, bag = 0, cycles = 0, peak = 1, maxDd = 0, trailOn = false, trailPeak = 0, floor = 0, trailFrom = 0;
  const eqAt = (px) => wallet + (p ? p.q * (px - p.e) : 0) + bag * px;
  const closeAll = (px) => {
    const fee = p.q * px * FEE, pnl = p.q * (px - p.e) - fee; wallet += pnl; const cycProfit = realized + pnl;
    p = null; putIn = 0; realized = 0; unit = 0; trailOn = false; cycles++;
    if (seed > 0 && cycProfit > 0) { const spend = Math.min(wallet, cycProfit * seed); bag += spend * (1 - FEE_SPOT) / px; wallet -= spend; }
  };
  for (let i = i0; i < D.n; i++) {
    const ath = D.ATH[i], o = D.O[i], h = D.H[i], l = D.L[i], c = D.C[i];
    if (D.F[i] !== 0 && p) wallet -= p.q * o * D.F[i];
    if (!p && putIn === 0 && ath > 0 && l <= ath * 0.85) { cap = wallet; unit = wallet * m; }
    if (unit > 0 && !trailOn) {
      const trig = putIn === 0 ? Math.min(ath * 0.85, o) : (p ? lastE * (1 - g) : Infinity);
      if (l <= trig && putIn + unit <= cap * 1.0001) {
        const e = Math.min(trig, o); let mg = unit;
        if (p) { const pnl = p.q * (e - p.e); realized += pnl; wallet += pnl - p.q * e * FEE; mg += Math.max(0, p.mg + pnl); p = null; }
        p = { e, mg, q: mg * L / e }; wallet -= mg * L * FEE; putIn += unit; lastE = e;
      }
    }
    if (p && l <= p.e * (1 - 1 / L + MM)) { wallet -= p.mg; realized -= p.mg; p = null; trailOn = false; if (putIn + unit > cap * 1.0001) { putIn = 0; realized = 0; unit = 0; } }
    if (p) {
      const tpPx = p.e + (tp * putIn - realized) / p.q;
      if (!trailOn && h >= tpPx) {
        if (trail <= 0) closeAll(tpPx);
        else { trailOn = true; floor = tpPx; trailPeak = h; trailFrom = i; }
      } else if (p && trailOn && i > trailFrom) { // candle aktivasi gak dicek (urutan high/low di dalam candle gak diketahui)
        const stop = Math.max(floor, trailPeak * (1 - trail));
        if (o <= stop) closeAll(o); else if (l <= stop) closeAll(stop);
        else trailPeak = Math.max(trailPeak, h);
      }
    }
    const eq = eqAt(c); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak);
  }
  const eq = eqAt(D.C[D.n - 1]), yrs = (D.T[D.n - 1] - D.T[i0]) / (365.25 * 864e5);
  return { mult: eq, cagr: (Math.pow(Math.max(eq, 1e-9), 1 / yrs) - 1) * 100, maxDd, cycles, bagUsd: bag * D.C[D.n - 1] };
}
module.exports = { run };

if (require.main === module) (async () => {
  const D = await loadHourly();
  const st = []; for (let y = 2018; y <= 2025; y++) for (let mo = 1; mo <= 12; mo++) { if (y === 2025 && mo > 10) break; st.push({ y, i: idxAt(D, `${y}-${String(mo).padStart(2, '0')}-01`) }); }
  const full = idxAt(D, '2017-09-01');
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const rows = [];
  for (const seed of [0, 0.25, 0.5, 0.75, 1]) for (const trail of [0, 0.02, 0.04, 0.06, 0.10]) {
    const rs = st.map((x) => ({ y: x.y, ...run(D, x.i, { seed, trail }) })); const f = run(D, full, { seed, trail });
    rows.push({ seed, trail, med: med(rs.map((r) => r.mult)), worst: Math.min(...rs.map((r) => r.mult)), p10: rs.map((r) => r.mult).sort((a, b) => a - b)[9], dd: Math.max(...rs.map((r) => r.maxDd)), a: med(rs.filter((r) => r.y <= 2021).map((r) => r.mult)), b: med(rs.filter((r) => r.y >= 2022).map((r) => r.mult)), full: f.mult, fullDd: f.maxDd });
  }
  rows.sort((x, y) => y.med - x.med);
  for (const r of rows) console.log(`bibit ${String(r.seed * 100).padStart(3)}% untung | trailing ${r.trail ? (r.trail * 100) + '%' : 'off'.padEnd(3)} | median x${r.med.toFixed(2)} (10% apes x${r.p10.toFixed(2)}, terburuk x${r.worst.toFixed(2)}) | 18-21 x${r.a.toFixed(2)} / 22-25 x${r.b.toFixed(2)} | DD ${(r.dd * 100).toFixed(0)}% | jalur 2017-skrg x${r.full.toFixed(2)} DD ${(r.fullDd * 100).toFixed(0)}%`);
})().catch((e) => { console.error(e); process.exit(1); });
