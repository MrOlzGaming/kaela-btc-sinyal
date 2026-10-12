// Lanjutan target100kStudy (12 Okt 2026): kapan tembus $10rb/$25rb/$50rb/$100rb, + pembanding DCA BTC spot $100/bln (beli & tahan).
const { loadDaily } = require('./gridLifetimeStudy');
const { sim } = require('./gridGraduateStudy');
(async () => {
  const rows = await loadDaily();
  const M = [10000, 25000, 50000, 100000], yrs = (x) => (x / 12).toFixed(1);
  const mo = (a, b) => (b - a) / (30.44 * 864e5);
  console.log('mulai     | $10rb  | $25rb  | $50rb  | $100rb | total akhir (setoran) | DCA BTC tahan: akhir');
  for (const ym of ['2013-01', '2014-01', '2015-01', '2016-01', '2017-01', '2018-01', '2019-01', '2020-01', '2021-01', '2022-01', '2023-01', '2024-01']) {
    const from = Date.parse(ym + '-01'); const hit = {};
    const r = sim(rows, { from, startFarmer: 940, monthly: 100, mode: 'B', onDay: (t, tot) => { for (const m of M) if (!hit[m] && tot >= m) hit[m] = t; } });
    // DCA BTC: $940 di awal + $100 tiap awal bulan, beli spot fee 0,1%, tahan
    let btc = 0, lastMon = null, dep = 0;
    for (const [t, o] of rows) { if (t < from) continue; const mon = new Date(t).toISOString().slice(0, 7); if (lastMon === null) { btc += 940 * 0.999 / o; dep += 940; } else if (mon !== lastMon) { btc += 100 * 0.999 / o; dep += 100; } lastMon = mon; }
    const dca = btc * rows[rows.length - 1][4];
    console.log(`${ym}   | ${M.map((m) => (hit[m] ? yrs(mo(from, hit[m])) + ' th' : '  -   ').padEnd(6)).join(' | ')} | $${Math.round(r.total).toLocaleString('en-US')} ($${Math.round(r.deposits).toLocaleString('en-US')}) | $${Math.round(dca).toLocaleString('en-US')}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
