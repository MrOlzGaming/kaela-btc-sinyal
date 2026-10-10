// Riset MINIMAL CAP Grid ATH (10 Okt 2026, Olan: "jangan mengacu modal kecil, ada minimal cap").
// Aturan live: CYCLE step 1 k 1 x1 TP 15, minDd 15. Bandingin rasio minCap/modal (1 = gak ada efek) x batas eksposur, pakai clip (live).
// Titik mulai: tiap bulan 2018-01..2025-10 (94). Jalanin: node backtest/gridMinCapStudy.js
const { loadHourly, sim, MULTS, idxAt } = require('./gridLab');
(async () => {
  const D = await loadHourly();
  const starts = []; for (let y = 2018; y <= 2025; y++) for (let m = 1; m <= 12; m++) { if (y === 2025 && m > 10) break; starts.push(idxAt(D, `${y}-${String(m).padStart(2, '0')}-01`)); }
  console.log(`titik mulai: ${starts.length}`);
  for (const ratio of [1, 2, 4, 8.3]) for (const cap of (process.argv[2] ? process.argv[2].split(",").map(Number) : [1.5, 2, 3])) {
    const rs = starts.map((s) => sim(D, s, D.n, { mode: 'CYCLE', step: 1, k: 1, mult: MULTS.x1, tp: 15, minDd: 15, cap, minBaseX: ratio, clip: true }));
    const c = rs.map((r) => r.cagr).sort((a, b) => a - b), med = c[Math.floor(c.length / 2)];
    console.log(`minCap ${String(ratio).padEnd(3)}x modal | cap ${cap}x | CAGR median ${med.toFixed(1)}% | terburuk x${Math.min(...rs.map((r) => r.mult)).toFixed(2)} | DD terburuk ${Math.max(...rs.map((r) => r.maxDd)).toFixed(0)}% | hangus ${rs.filter((r) => r.wipes > 0).length}/${rs.length} | eksposur maks ${Math.max(...rs.map((r) => r.maxExpo)).toFixed(2)}x`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
