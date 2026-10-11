// Riset DCA GRID SPOT BTC (11 Okt 2026, ide Olan): tanpa leverage, beli unit% modal tiap BTC turun step% dari beli terakhir,
// jual SEMUA begitu untung bersih >= tp% dari total modal yang udah masuk, lalu mulai lagi (compound). Spot = gak bisa likuidasi.
// Fee spot 0,1% per transaksi. Data 1 jam BTCUSDT 2017-08..sekarang, 94 titik mulai bulanan 2018-2025 + 1 jalur penuh.
// Jalanin: node backtest/gridSpotStudy.js
const { loadHourly, idxAt } = require('./gridLab');
const FEE = 0.001;

function run(D, i0, { unit = 0.01, step = 0.025, tp = 0.02, minDd = 0, growth = 1, yieldApy = 0, ddScale = 0 }) {
  // yieldApy = bunga uang nganggur (USDC Earn), ddScale = tangga digedein sesuai jarak dari ATH (base x (1 + ddScale x dd))
  let cash = 1, btc = 0, invested = 0, lastBuy = 0, unitUsd = 0, nBuy = 0, base = 0, cycles = 0, peak = 1, maxDd = 0, maxIn = 0, stuckMax = 0, cycleStart = i0, ath = 0;
  const eqAt = (p) => cash + btc * p;
  for (let i = i0; i < D.n; i++) {
    const o = D.O[i], h = D.H[i], l = D.L[i], c = D.C[i];
    ath = Math.max(ath, D.ATH[i]);
    if (yieldApy > 0 && cash > 0 && i > i0) cash *= Math.pow(1 + yieldApy, (D.T[i] - D.T[i - 1]) / (365.25 * 864e5));
    // mulai siklus: beli pertama di harga open (opsional syarat ATH -minDd)
    if (invested === 0 && (minDd === 0 || o <= ath * (1 - minDd))) {
      base = eqAt(o) * unit * (1 + ddScale * Math.max(0, 1 - o / Math.max(ath, o))); unitUsd = base; nBuy = 1;
      if (cash >= unitUsd) { btc += unitUsd * (1 - FEE) / o; cash -= unitUsd; invested = unitUsd; lastBuy = o; cycleStart = i; }
    }
    // DCA tiap turun step% dari beli terakhir
    while (invested > 0 && l <= lastBuy * (1 - step) && cash > base * 0.05) {
      unitUsd = Math.min(cash, base * Math.pow(growth, nBuy)); nBuy++;
      const px = Math.min(lastBuy * (1 - step), o);
      btc += unitUsd * (1 - FEE) / px; cash -= unitUsd; invested += unitUsd; lastBuy = px;
    }
    // TP: nilai jual bersih >= invested * (1 + tp)
    if (invested > 0) {
      const tpPx = invested * (1 + tp) / (btc * (1 - FEE));
      if (h >= tpPx && i > cycleStart) { cash += btc * tpPx * (1 - FEE); btc = 0; invested = 0; cycles++; }
    }
    const eq = eqAt(c); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak);
    if (invested > 0) { maxIn = Math.max(maxIn, invested / Math.max(eq, 1e-9)); stuckMax = Math.max(stuckMax, (D.T[i] - D.T[cycleStart]) / 864e5); }
  }
  const eq = eqAt(D.C[D.n - 1]), yrs = (D.T[D.n - 1] - D.T[i0]) / (365.25 * 864e5);
  return { mult: eq, cagr: (Math.pow(eq, 1 / yrs) - 1) * 100, cycles, maxDd, maxIn, stuckMax, yrs };
}
module.exports = { run };

if (require.main === module) (async () => {
  const D = await loadHourly();
  const starts = []; for (let y = 2018; y <= 2025; y++) for (let m = 1; m <= 12; m++) { if (y === 2025 && m > 10) break; starts.push(idxAt(D, `${y}-${String(m).padStart(2, '0')}-01`)); }
  const full = idxAt(D, '2017-09-01');
  const fmt = (name, cfg) => {
    const rs = starts.map((s) => run(D, s, cfg)); const ms = rs.map((r) => r.mult).sort((a, b) => a - b); const cg = rs.map((r) => r.cagr).sort((a, b) => a - b);
    const f = run(D, full, cfg);
    console.log(`${name.padEnd(34)} | 94 titik: median x${ms[47].toFixed(2)} (${cg[47].toFixed(0)}%/th), terburuk x${ms[0].toFixed(2)}, DD terburuk ${(Math.max(...rs.map((r) => r.maxDd)) * 100).toFixed(0)}%, modal kepake maks ${(Math.max(...rs.map((r) => r.maxIn)) * 100).toFixed(0)}%, nyangkut maks ${Math.max(...rs.map((r) => r.stuckMax)).toFixed(0)} hr | 2017-09..skrg: x${f.mult.toFixed(2)} (${f.cagr.toFixed(0)}%/th), TP ${f.cycles}x, DD ${(f.maxDd * 100).toFixed(0)}%`);
  };
  console.log('=== Ide Olan + variasi (spot, fee 0,1%) ===');
  fmt('Olan: 1% modal, tiap -2,5%, TP 2%', { unit: 0.01, step: 0.025, tp: 0.02 });
  for (const tp of [0.03, 0.05]) fmt(`1%, -2,5%, TP ${tp * 100}%`, { unit: 0.01, step: 0.025, tp });
  for (const unit of [0.02, 0.03]) fmt(`${unit * 100}%, -2,5%, TP 2%`, { unit, step: 0.025, tp: 0.02 });
  for (const step of [0.015, 0.05]) fmt(`1%, -${step * 100}%, TP 2%`, { unit: 0.01, step, tp: 0.02 });
  fmt('1%, -2,5%, TP 2%, cuma kalau ATH -15%', { unit: 0.01, step: 0.025, tp: 0.02, minDd: 0.15 });
  // pembanding buy & hold
  const bh = starts.map((s) => D.C[D.n - 1] / D.O[s]).sort((a, b) => a - b);
  console.log(`Pembanding HOLD BTC: median x${bh[47].toFixed(2)}, terburuk x${bh[0].toFixed(2)} | 2017-09..skrg x${(D.C[D.n - 1] / D.O[full]).toFixed(2)}`);
})().catch((e) => { console.error(e); process.exit(1); });
