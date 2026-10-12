// Proyeksi "kapan tembus $100rb" (12 Okt 2026, Olan: "perkirakan kita capai 100k dolar bulan apa, berdasarkan backtest,
// tiap bulan isi $100 buat grid"). Pakai gridGraduateStudy.sim (Farmer setting live 6%/-15%/5x/TP30, ATH -15%, lulus ke grid spot
// di $10rb, mode B = Farmer baru diambil dari saldo spot, gak ada setoran tambahan selain $100/bln). Modal awal $940 (Farmer real
// sekarang). Tiap tanggal 1 dari 2013..2024 dijadiin titik mulai -> berapa bulan sampai total >= $100rb (+ total setoran).
// Data harian 2010-sekarang. Jalanin: node backtest/target100kStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const { sim } = require('./gridGraduateStudy');
(async () => {
  const rows = await loadDaily();
  const lastT = rows[rows.length - 1][0];
  const TARGET = 100000, START = 940, MONTHLY = 100;
  const res = [];
  for (let y = 2013; y <= 2024; y++) for (let m = 0; m < 12; m++) {
    const from = Date.UTC(y, m, 1); let hit = null, dep = null;
    const r = sim(rows, { from, startFarmer: START, startSpot: 0, monthly: MONTHLY, mode: 'B', onDay: (t, tot, d) => { if (hit === null && tot >= TARGET) { hit = t; dep = d; } } });
    const months = hit ? (hit - from) / (30.44 * 864e5) : null;
    res.push({ from, months, dep, maxDd: r.maxDd, horizon: (lastT - from) / (30.44 * 864e5), total: r.total });
  }
  const done = res.filter((r) => r.months != null), ms = done.map((r) => r.months).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
  const yrs = (x) => (x / 12).toFixed(1);
  console.log(`${res.length} titik mulai (2013-2024), modal $${START} + $${MONTHLY}/bln. Tembus $100rb: ${done.length}/${res.length} titik.`);
  console.log(`Waktu: tercepat ${yrs(ms[0])} th | 25% ${yrs(q(0.25))} th | MEDIAN ${yrs(q(0.5))} th | 75% ${yrs(q(0.75))} th | terlama ${yrs(ms[ms.length - 1])} th`);
  const miss = res.filter((r) => r.months == null);
  if (miss.length) console.log(`Belum tembus (sampai data habis): ${miss.length} titik, contoh mulai ${miss.slice(0, 4).map((r) => new Date(r.from).toISOString().slice(0, 7) + ' (' + yrs(r.horizon) + ' th, akhir $' + Math.round(r.total) + ')').join(', ')}`);
  console.log('Per tahun mulai (median bulan ke $100rb):');
  for (let y = 2013; y <= 2024; y++) { const g = res.filter((r) => new Date(r.from).getUTCFullYear() === y); const d = g.filter((r) => r.months != null).map((r) => r.months).sort((a, b) => a - b);
    console.log(`  mulai ${y}: ${d.length}/12 tembus${d.length ? `, median ${yrs(d[Math.floor(d.length / 2)])} th, setoran s/d tembus ~$${Math.round(g.find((r) => r.months != null).dep)}` : ''}, DD maks ${(Math.max(...g.map((r) => r.maxDd)) * 100).toFixed(0)}%`); }
  // tanpa setoran (pembanding)
  const n0 = []; for (let y = 2013; y <= 2024; y++) { const from = Date.UTC(y, 0, 1); let hit = null; sim(rows, { from, startFarmer: START, monthly: 0, mode: 'B', onDay: (t, tot) => { if (hit === null && tot >= TARGET) hit = t; } }); n0.push(hit ? yrs((hit - from) / (30.44 * 864e5)) : '-'); }
  console.log(`Pembanding TANPA setoran (mulai 1 Jan 2013..2024): ${n0.join(' | ')} th`);
})().catch((e) => { console.error(e); process.exit(1); });
