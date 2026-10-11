// Cari parameter TERBAIK long DCA koin (11 Okt 2026, Olan: "boleh coba modif parameter"). Pakai run() dari altLongStudy.js.
// Syarat AMAN: stress mulai 1 Jan 2018 DD <= 50%, 105 titik mulai (tiap tgl 1, 2018..2026) rugi 0 & DD terburuk <= 50%,
// gak pernah gagal tambah/ganti (peluru gak habis). Urut: hasil mulai halving 2020.  node backtest/altLongGridSearch.js [ETHUSDT]
const { loadDaily, run, btcIndex } = require('./altLongStudy');
(async () => {
  const SYM = process.argv[2] || 'ETHUSDT';
  const C = await loadDaily(SYM), B = await loadDaily('BTCUSDT'), btc = btcIndex(B);
  const idx = (d) => C.findIndex((r) => r.t >= Date.parse(d));
  const H20 = idx('2020-05-11'), J18 = Math.max(0, idx('2018-01-01'));
  const starts = []; for (let t = Date.UTC(2018, 0, 1); t <= Date.UTC(2026, 8, 1); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) { const i = idx(new Date(t).toISOString()); if (i >= 0) starts.push(i); }
  const hodl20 = C[C.length - 1].c / C[H20].o;
  const out = [];
  for (const L of [1, 2, 3]) for (const step of [0.10, 0.15, 0.20, 0.25]) for (const bet of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08]) for (const tp of [0.05, 0.10, 0.20]) for (const rep of [1, 1.25]) {
    const v = { L, step, bet, tp, rep };
    const s = run(C, btc, J18, v); if (s.maxDd > 0.5 || s.addFail || s.replFail) continue;
    const rs = starts.map((i) => run(C, btc, i, v));
    const dd = Math.max(...rs.map((r) => r.maxDd)), lose = rs.filter((r) => r.mult < 1).length, fail = rs.some((r) => r.addFail || r.replFail);
    if (dd > 0.5 || lose || fail) continue;
    const a = run(C, btc, H20, v), m = rs.map((r) => r.mult).sort((x, y) => x - y);
    out.push({ v, a, s, dd, med: m[Math.floor(m.length / 2)], worst: m[0] });
  }
  out.sort((x, y) => y.a.mult - x.a.mult);
  const p = (x) => (x * 100).toFixed(0) + '%';
  console.log(`${SYM}: ${out.length} kombinasi lolos syarat aman. HODL ${SYM} dari halving 2020 x${hodl20.toFixed(2)}. Top 15:`);
  for (const o of out.slice(0, 15)) console.log(`  ${o.v.L}x jarak ${p(o.v.step)} bet ${p(o.v.bet)} TP ${p(o.v.tp)} ganti x${o.v.rep} | 2020: x${o.a.mult.toFixed(2)} (${p(o.a.cagr)}/th) DD ${p(o.a.maxDd)} liq ${o.a.liqs} | 2018: x${o.s.mult.toFixed(2)} DD ${p(o.s.maxDd)} | ${starts.length} mulai: terburuk x${o.worst.toFixed(2)} median x${o.med.toFixed(2)} DD maks ${p(o.dd)}`);
})().catch((e) => { console.error(e); process.exit(1); });
