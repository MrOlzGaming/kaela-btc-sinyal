// fngFilterStudy.js (4 Okt 2026, audit malam) -- ide lama "Fear & Greed Index sbg konfirmasi entry": trade slot ICT Sweep 4H BTC
// (exit trailing 3x, fee 0,1%) dikelompokin per zona F&G hari entry (alternative.me, 2018+). Pertanyaan: long pas serakah ekstrem /
// short pas takut ekstrem lebih jelek? Dinilai 2 era. Pakai: node backtest/fngFilterStudy.js <btc-5m.json> <fng.json>
const fs = require('fs');
const S = require('./ictSweepHtfStudy');
const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const fng = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).data;
const fngByDay = new Map(fng.map((d) => [new Date(d.timestamp * 1000).toISOString().slice(0, 10), Number(d.value)]));
const cs = S.aggregate(c5, 240);
const tr = S.runWithRisk(cs, { look: 20, trend: true, trendLen: 300, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 3, maxRiskPct: 5 })
  .map((t) => ({ ...t, fng: fngByDay.get(new Date(t.t).toISOString().slice(0, 10)) })).filter((t) => t.fng !== undefined);
const SPLIT = Date.UTC(2023, 0, 1);
const zone = (v) => (v < 25 ? 'takut ekstrem (<25)' : v < 45 ? 'takut (25-44)' : v <= 55 ? 'netral (45-55)' : v <= 75 ? 'serakah (56-75)' : 'serakah ekstrem (>75)');
for (const dir of [1, -1]) {
  console.log(`\n=== ${dir > 0 ? 'LONG' : 'SHORT'} (n=${tr.filter((t) => t.dir === dir).length}) ===`);
  for (const z of ['takut ekstrem (<25)', 'takut (25-44)', 'netral (45-55)', 'serakah (56-75)', 'serakah ekstrem (>75)']) {
    const x = tr.filter((t) => t.dir === dir && zone(t.fng) === z);
    const a = x.filter((t) => t.t < SPLIT), b = x.filter((t) => t.t >= SPLIT);
    console.log(`${z.padEnd(24)} | semua ${S.summ(x)} | <2023 PF ${S.pf(a).toFixed(2)} n${a.length} | >=2023 PF ${S.pf(b).toFixed(2)} n${b.length}`);
  }
}

// ---- sensitivitas: skip SHORT kalau F&G < ambang -> hasil seluruh slot (long+short) per era ----
console.log('\n=== Filter "jangan short pas F&G < X" -> hasil SELURUH slot sweep ===');
for (const thr of [0, 15, 20, 25, 30, 35, 40]) {
  const kept = tr.filter((t) => !(t.dir < 0 && t.fng < thr));
  const a = kept.filter((t) => t.t < SPLIT), b = kept.filter((t) => t.t >= SPLIT);
  const tot = (x) => x.reduce((s, t) => s + t.r, 0).toFixed(1);
  console.log(`X=${String(thr).padStart(2)}${thr === 0 ? ' (tanpa filter)' : '              '} | n=${kept.length} | <2023 PF ${S.pf(a).toFixed(2)} totR ${tot(a)} | >=2023 PF ${S.pf(b).toFixed(2)} totR ${tot(b)}`);
}
