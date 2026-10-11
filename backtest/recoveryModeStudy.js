// Riset MODE BANGKIT "kejar jumlah BTC" (11 Okt 2026, ide Olan): Farmer rungkad & BTC jauh di bawah ATH -> setoran bulanan $100
// dipake NUMPUK BTC spot selama BTC masih <= ATH -buyDd%. Koin dijual (balik jadi modal Farmer) begitu BTC naik ke >= ATH -sellDd%.
// Dibanding: Farmer 5x restart $100/bln & beli-tahan murni. Data harian. Jalanin: node backtest/recoveryModeStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const { sim } = require('./gridGraduateStudy');
function accum(rows, t0, end, { buyDd, sellDd }) {
  let ath = 0, btc = 0, cash = 0, dep = 0, last = null, sold = false, minRatio = 9;
  for (const [t, o, h, l, c] of rows) {
    if (t < t0) { ath = Math.max(ath, h); continue; } if (t > end) break;
    const m = new Date(t).toISOString().slice(0, 7);
    if (m !== last) { cash += 100; dep += 100; last = m; }
    const dd = 1 - o / ath;
    if (!sold && dd >= buyDd && cash > 0) { btc += cash * 0.999 / o; cash = 0; }
    if (sellDd != null && btc > 0 && h >= ath * (1 - sellDd)) { cash += btc * ath * (1 - sellDd) * 0.999; btc = 0; sold = true; }
    ath = Math.max(ath, h);
    minRatio = Math.min(minRatio, (cash + btc * c) / dep);
  }
  const lastC = rows.filter((r) => r[0] <= end).pop()[4];
  return { total: cash + btc * lastC, dep, sold, minRatio };
}
(async () => {
  const rows = await loadDaily();
  const f = (v) => '$' + Math.round(v).toLocaleString('id-ID');
  for (const from of ['2018-12-15', '2022-11-21', '2018-06-01', '2022-06-15', '2014-01-14', '2015-08-01']) {
    const t0 = Date.parse(from), end = t0 + 48 * 30.44 * 864e5;
    console.log(`\n=== bangkit mulai ${from}, $100/bln selama 4 tahun ===`);
    const fr = sim(rows.filter((r) => r[0] <= end), { from: t0, startFarmer: 100, monthly: 100, grad: 1e15 });
    console.log(`  Farmer 5x restart                     setor ${f(fr.deposits)} -> ${f(fr.total)}`);
    for (const buyDd of [0.3, 0.5]) for (const sellDd of [0.15, 0.05, null]) {
      const r = accum(rows, t0, end, { buyDd, sellDd });
      console.log(`  numpuk BTC kalau <= ATH -${buyDd * 100}%, jual ${sellDd == null ? 'GAK PERNAH (tahan)' : 'pas >= ATH -' + sellDd * 100 + '%'}`.padEnd(70) + ` setor ${f(r.dep)} -> ${f(r.total)}${r.sold ? ' (udah dijual)' : ''} | terendah ${(r.minRatio * 100).toFixed(0)}% setoran`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
