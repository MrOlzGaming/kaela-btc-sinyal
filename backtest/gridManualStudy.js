// Riset GRID MANUAL Olan (11 Okt 2026): isolated vs cross. Aturan Olan: BTC <= ATH -15% -> buka margin m% modal, leverage L,
// tambah posisi tiap harga turun g% dari entry terakhir. TP = tutup semua begitu (floating posisi hidup - margin yang udah
// kena likuidasi) >= 20% x total margin yang udah masuk ("posisi ilang ditambah target 20% dari duit yang udah masuk").
// Modal = saldo pas siklus mulai (compound). Data 1 jam BTCUSDT. Jalanin: node backtest/gridManualStudy.js
const { loadHourly, idxAt } = require('./gridLab');
const FEE = 0.0005, MM = 0.005;
function run(D, i0, cfg) {
  const { m, L, g, tp = 0.2, cross, maxPos = 99 } = cfg;
  let wallet = 1, pos = [], lost = 0, putIn = 0, unit = 0, cycles = 0, rungkad = 0, peak = 1, maxDd = 0;
  for (let i = i0; i < D.n; i++) {
    const ath = D.ATH[i], l = D.L[i], h = D.H[i], c = D.C[i];
    const free = () => wallet - pos.reduce((a, p) => a + p.mg, 0);
    // entry / tambah
    if (pos.length === 0 && putIn === 0 && l <= ath * 0.85) { unit = wallet * m; }
    if (unit > 0) {
      while (true) {
        const last = pos.length ? pos[pos.length - 1].e : (putIn > 0 ? lastE * (1 - g) / (1 - g) : null);
        const trig = putIn === 0 ? Math.min(ath * 0.85, D.O[i]) : lastE * (1 - g);
        if (!(l <= trig) || free() < unit * 0.999 || putIn >= unit * maxPos - 1e-9) break;
        const e = Math.min(trig, D.O[i]); pos.push({ e, mg: unit, q: unit * L / e }); wallet -= unit * L * FEE; putIn += unit; lastE = e;
      }
    }
    // likuidasi
    if (pos.length) {
      if (cross) {
        const eq = wallet + pos.reduce((a, p) => a + p.q * (l - p.e), 0);
        if (eq <= MM * pos.reduce((a, p) => a + p.q * l, 0)) { wallet = Math.max(0, eq); pos = []; rungkad++; putIn = 0; lost = 0; unit = 0; if (wallet < 0.01) break; }
      } else {
        const keep = [];
        for (const p of pos) { const liq = p.e * (1 - 1 / L + MM); if (l <= liq) { wallet -= p.mg; lost += p.mg; } else keep.push(p); }
        pos = keep;
        if (!pos.length && free() < unit * 0.999) { rungkad++; putIn = 0; lost = 0; unit = 0; if (wallet < 0.01) break; }
      }
    }
    // TP gabungan
    if (pos.length && putIn > 0) {
      const Q = pos.reduce((a, p) => a + p.q, 0), cost = pos.reduce((a, p) => a + p.q * p.e, 0);
      const need = lost + tp * putIn, tpPx = (cost + need) / Q;
      if (h >= tpPx) { wallet += Q * tpPx - cost - Q * tpPx * FEE - lost; wallet += lost; /* lost udah dipotong pas likuidasi */ wallet -= 0; pos = []; putIn = 0; lost = 0; unit = 0; cycles++; }
    }
    const eq = wallet + pos.reduce((a, p) => a + p.q * (c - p.e), 0); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak);
  }
  const eq = wallet + pos.reduce((a, p) => a + p.q * (D.C[D.n - 1] - p.e), 0);
  return { mult: eq, cycles, rungkad, maxDd };
}
let lastE = 0;
module.exports = { run };
if (require.main === module) (async () => {
  const D = await loadHourly();
  const starts = []; for (let y = 2018; y <= 2025; y++) for (let mo = 1; mo <= 12; mo++) { if (y === 2025 && mo > 10) break; starts.push(idxAt(D, `${y}-${String(mo).padStart(2, '0')}-01`)); }
  const cfgs = [
    ['Olan: isolated 5x margin 10% tiap -15%', { m: 0.10, L: 5, g: 0.15 }],
    ['isolated 5x margin 10% tiap -10%', { m: 0.10, L: 5, g: 0.10 }],
    ['isolated 3x margin 10% tiap -15%', { m: 0.10, L: 3, g: 0.15 }],
    ['isolated 2x margin 10% tiap -15%', { m: 0.10, L: 2, g: 0.15 }],
    ['CROSS 5x margin 6,7% tiap -15% (rencana Kaela)', { m: 0.0667, L: 5, g: 0.15, cross: true, maxPos: 6 }],
    ['CROSS 5x margin 10% maks 4 posisi', { m: 0.10, L: 5, g: 0.15, cross: true, maxPos: 4 }], ['isolated 5x 10% maks 6 posisi', { m: 0.10, L: 5, g: 0.15, maxPos: 6 }], ['isolated 5x margin 5% tiap -15%', { m: 0.05, L: 5, g: 0.15 }],
  ];
  for (const [name, cfg] of cfgs) {
    const rs = starts.map((s) => run(D, s, cfg));
    const ms = rs.map((r) => r.mult).sort((a, b) => a - b);
    console.log(`${name.padEnd(46)} | median x${ms[Math.floor(ms.length / 2)].toFixed(2)} | terburuk x${ms[0].toFixed(2)} | ada rungkad ${rs.filter((r) => r.rungkad).length}/${rs.length} | DD terburuk ${(Math.max(...rs.map((r) => r.maxDd)) * 100).toFixed(0)}% | siklus TP rata2 ${(rs.reduce((a, r) => a + r.cycles, 0) / rs.length).toFixed(0)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
