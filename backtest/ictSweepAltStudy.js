// ictSweepAltStudy.js (3 Okt 2026) -- ICT liquidity sweep 4H di ALT (LONG doang, aturan Olan) -- kandidat sistem Ninja/BingX
// (sweep 1H/2H BTC GAGAL, edge cuma muncul >= 4H). Koin = punya histori >= 3 thn (listing >= 2023 jelek di riset multi-koin).
// Seleksi JUJUR: koin dipilih pakai PF <2023, dinilai >=2023. Pembanding entry ACAK (risiko & exit sama) gabungan semua koin.
// Pakai: node backtest/ictSweepAltStudy.js <multicoinCacheDir>
const fs = require('fs');
const path = require('path');
const S = require('./ictSweepHtfStudy');
const SPLIT = Date.UTC(2023, 0, 1);
const COINS = ['ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'TRX', 'ATOM', 'NEAR', 'UNI', 'ETC', 'FIL', 'INJ', 'AAVE', 'XLM', 'HBAR'];
const dir = process.argv[2];
const data = {};
for (const c of COINS) data[c] = S.aggregate(JSON.parse(fs.readFileSync(path.join(dir, `${c}USDT-1h.json`), 'utf8')), 240);
let seed = 99; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (const look of [20, 50]) for (const trailR of [2, 3]) {
  const v = { look, trend: true, trendLen: 300, bodyConfirm: false, longOnly: true, exit: 'trail', trailR, maxRiskPct: 8 };
  const per = {};
  for (const c of COINS) per[c] = S.runWithRisk(data[c], v);
  const all = Object.values(per).flat();
  const a = all.filter((t) => t.t < SPLIT), b = all.filter((t) => t.t >= SPLIT);
  const picked = COINS.filter((c) => { const x = per[c].filter((t) => t.t < SPLIT); return x.length >= 8 && S.pf(x) > 1.2; });
  const pb = picked.flatMap((c) => per[c].filter((t) => t.t >= SPLIT));
  const sims = [];
  for (let s = 0; s < 100; s++) sims.push(S.pf(COINS.flatMap((c) => S.runRandom(data[c], v, per[c], rng))));
  sims.sort((x, y) => x - y);
  const real = S.pf(all), p = sims.filter((x) => x >= real).length / sims.length;
  console.log(`swing${look} trail${trailR} LONG | SEMUA koin PF ${real.toFixed(2)} (<2023 ${S.pf(a).toFixed(2)} n${a.length} / >=2023 ${S.pf(b).toFixed(2)} n${b.length}) | acak median ${sims[50].toFixed(2)} p=${p.toFixed(2)} | pilih <2023 (${picked.length} koin) -> >=2023 PF ${S.pf(pb).toFixed(2)} n${pb.length}`);
  if (look === 50 && trailR === 3) console.log('   per koin (<2023 / >=2023):', COINS.map((c) => `${c} ${S.pf(per[c].filter((t) => t.t < SPLIT)).toFixed(1)}/${S.pf(per[c].filter((t) => t.t >= SPLIT)).toFixed(1)}`).join(' '));
}
