// Skenario "BTC jatuh dari ATH -15% sampai -90%" (11 Okt 2026, permintaan Olan) buat grid manual ISOLATED.
// Bagian 1: jalur buatan turun lurus ke -90% lalu mantul. Bagian 2: varian yang tahan -90% diuji di data asli (94 titik mulai).
const { loadHourly, idxAt } = require('./gridLab');
const { run } = require('./gridManualStudy');
const ATH = 126200, MODAL = 600, MM = 0.005;
function path(cfg, bottom) {
  const { m, L, g } = cfg, unit = MODAL * m; let pos = [], lost = 0, putIn = 0, e = ATH * 0.85, rows = [];
  while (e >= ATH * (1 - bottom) - 1 && putIn + unit <= MODAL + 1e-9) { pos.push({ e, liq: e * (1 - 1 / L + MM) }); putIn += unit; rows.push(e); e *= 1 - g; }
  const low = ATH * (1 - bottom); const alive = pos.filter((p) => p.liq < low); lost = (pos.length - alive.length) * unit;
  // harga TP: sum(q*(P-e)) = lost + 20% putIn
  const Q = alive.reduce((a, p) => a + unit * L / p.e, 0), cost = alive.length * unit * L, need = lost + 0.2 * putIn;
  return { n: pos.length, firstE: rows[0], lastE: rows[rows.length - 1], putIn, lost, alive: alive.length, tpPx: Q ? (cost + need) / Q : null };
}
const pct = (p) => `${((p / ATH - 1) * 100).toFixed(0)}% ATH`;
(async () => {
  const VARS = [['Aturan Olan: 5x, 10%, tiap -15%', { m: 0.10, L: 5, g: 0.15 }], ['5x, 10%, tiap -21%', { m: 0.10, L: 5, g: 0.21 }], ['3x, 10%, tiap -21%', { m: 0.10, L: 3, g: 0.21 }], ['5x, 8%, tiap -17%', { m: 0.08, L: 5, g: 0.17 }], ['2x, 10%, tiap -21%', { m: 0.10, L: 2, g: 0.21 }]];
  console.log('=== JALUR BUATAN (modal $600, ATH $126.200) ===');
  for (const [name, cfg] of VARS) for (const b of [0.77, 0.84, 0.90]) {
    const r = path(cfg, b);
    console.log(`${name.padEnd(32)} dasar -${b * 100}% | ${r.n} posisi (${pct(r.firstE)}..${pct(r.lastE)}) masuk $${r.putIn} | kelikuidasi $${r.lost} | hidup ${r.alive} | ${r.tpPx ? 'TP kalau BTC balik ke $' + Math.round(r.tpPx) + ' (' + pct(r.tpPx) + ', mantul +' + ((r.tpPx / (ATH * (1 - b)) - 1) * 100).toFixed(0) + '%)' : 'MODAR -- semua posisi kelikuidasi'}`);
  }
  console.log('\n=== DATA ASLI 2018-2025 (94 titik mulai) ===');
  const D = await loadHourly();
  const starts = []; for (let y = 2018; y <= 2025; y++) for (let mo = 1; mo <= 12; mo++) { if (y === 2025 && mo > 10) break; starts.push(idxAt(D, `${y}-${String(mo).padStart(2, '0')}-01`)); }
  for (const [name, cfg] of VARS) {
    const rs = starts.map((s) => run(D, s, cfg)); const ms = rs.map((r) => r.mult).sort((a, b) => a - b);
    console.log(`${name.padEnd(32)} | median x${ms[47].toFixed(2)} | terburuk x${ms[0].toFixed(2)} | rungkad ${rs.filter((r) => r.rungkad).length}/94 | DD terburuk ${(Math.max(...rs.map((r) => r.maxDd)) * 100).toFixed(0)}%`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
