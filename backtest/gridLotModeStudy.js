// Cara eksekusi grid isolated di 1 simbol BingX (posisi gak independen), 11 Okt 2026. Dibandingin di data asli (94 titik mulai):
//  A. LOT VIRTUAL: 1 posisi gabungan, tiap "bet" punya harga cut sendiri (= harga liq isolated-nya) -> dipotong market. = isolated asli.
//  B. MERGE (ide Olan): tiap rebuy tutup posisi lama, buka lagi pakai sisa margin + bet baru (5x dari total margin).
// Aturan sama: 5x, bet 8% saldo, tiap -17%, TP = rugi terealisasi + 20% total bet. Jalanin: node backtest/gridLotModeStudy.js
const { loadHourly, idxAt } = require('./gridLab');
const { run } = require('./gridManualStudy');
const FEE = 0.0005, MM = 0.005;
function merge(D, i0, { m, L, g, tp = 0.2 }) {
  let wallet = 1, p = null, putIn = 0, realized = 0, unit = 0, lastE = 0, rungkad = 0, peak = 1, maxDd = 0, cycles = 0;
  for (let i = i0; i < D.n; i++) {
    const ath = D.ATH[i], l = D.L[i], h = D.H[i], c = D.C[i], o = D.O[i];
    if (!p && putIn === 0 && l <= ath * 0.85) unit = wallet * m;
    if (unit > 0) {
      const trig = putIn === 0 ? Math.min(ath * 0.85, o) : lastE * (1 - g);
      const free = wallet - (p ? p.mg : 0);
      if (l <= trig && free >= unit * 0.999) {
        const e = Math.min(trig, o); let mg = unit;
        if (p) { const pnl = p.q * (e - p.e); realized += pnl; wallet += pnl - p.q * e * FEE; mg += Math.max(0, p.mg + pnl); p = null; }
        p = { e, mg, q: mg * L / e }; wallet -= mg * L * FEE; putIn += unit; lastE = e;
      }
    }
    if (p && l <= p.e * (1 - 1 / L + MM)) { wallet -= p.mg; realized -= p.mg; p = null; if (wallet - 0 < unit * 0.999) { rungkad++; putIn = 0; realized = 0; unit = 0; if (wallet < 0.01) break; } }
    if (p) { const tpPx = p.e + (0.2 * putIn - realized) / p.q; if (h >= tpPx) { wallet += p.q * (tpPx - p.e) - p.q * tpPx * FEE; p = null; putIn = 0; realized = 0; unit = 0; cycles++; } }
    const eq = wallet + (p ? p.q * (c - p.e) : 0); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak);
  }
  return { mult: wallet + (p ? p.q * (D.C[D.n - 1] - p.e) : 0), rungkad, maxDd, cycles };
}
module.exports = { merge };
if (require.main === module) (async () => {
  const D = await loadHourly();
  const starts = []; for (let y = 2018; y <= 2025; y++) for (let mo = 1; mo <= 12; mo++) { if (y === 2025 && mo > 10) break; starts.push(idxAt(D, `${y}-${String(mo).padStart(2, '0')}-01`)); }
  const cfg = { m: 0.08, L: 5, g: 0.17 };
  for (const [name, f] of [['A. LOT VIRTUAL (isolated per bet)', (s) => run(D, s, cfg)], ['B. MERGE tutup-buka (ide Olan)', (s) => merge(D, s, cfg)]]) {
    const rs = starts.map(f), ms = rs.map((r) => r.mult).sort((a, b) => a - b);
    console.log(`${name.padEnd(36)} | median x${ms[47].toFixed(2)} | terburuk x${ms[0].toFixed(2)} | rungkad ${rs.filter((r) => r.rungkad).length}/94 | DD terburuk ${(Math.max(...rs.map((r) => r.maxDd)) * 100).toFixed(0)}%`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
