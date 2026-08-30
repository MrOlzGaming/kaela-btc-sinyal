// Uji ketat tambahan (31 Agu 2026, Olan: "yang mencurigakan teliti lagi.. gimana biar kamu puas
// dan ga curiga lagi?") -- filter DXY buat Sniper BTC/Emas kecurigaannya: untung numpuk di 1
// tahun doang (2023 buat BTC, 2025 buat Emas). Dua tes independen buat mastiin ini edge asli
// atau kebetulan:
// 1. Split 2 era independen (2020-2023 vs 2023-2026) -- edge ASLI harusnya nolong di DUA
//    periode, bukan cuma satu. Teknik SAMA persis yang udah dipakai+terbukti kepake riset
//    Full-Ride Sniper 22 Agu 2026 (lihat memori project-kaela-btc-sinyal).
// 2. Sensitivitas parameter SMA (10/20/50) -- kalau hasil goyah drastis pas parameter digeser
//    dikit, itu tanda overfitting ke 1 setting yang "kebetulan pas", bukan hubungan struktural.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { runCrossAssetBacktest, summarize } = require(path.join(ROOT, 'backtestCrossAsset.js'));
const { buildDxyWeakLookup } = require('./dxyFilter.js');

const btcDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'daily-cache.json'), 'utf8'));
const goldDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'gold-daily-cache.json'), 'utf8'));

function runEra(assetKey, daily, startMs, endMs, dxyFilter, haltBtc) {
  const filtered = daily.filter((c) => c.closeTime >= startMs && c.closeTime <= endMs);
  // butuh histori SEBELUM startMs juga buat warmup pola/SMA -- ambil full daily, pakai startMs
  // buat gerbang trade, endMs dibatasin manual di trades filter (runCrossAssetBacktest gak punya
  // endMs bawaan, jadi kita filter trade hasilnya manual).
  const r = runCrossAssetBacktest({ [assetKey]: daily }, { haltBtcInBearWindow: haltBtc, startMs, startCapital: 100, topUpAmount: 0, dxyFilter });
  const tradesInEra = r.trades.filter((t) => t.exitTime <= endMs);
  return summarize(tradesInEra);
}

console.log('=== TES 1: Split 2 era independen (edge asli harus nolong di DUA-duanya) ===\n');

const era1Start = new Date('2020-01-01T00:00:00Z').getTime();
const era1End = new Date('2023-01-01T00:00:00Z').getTime();
const era2Start = new Date('2023-01-01T00:00:00Z').getTime();
const era2End = new Date('2026-09-01T00:00:00Z').getTime();

['btc', 'gold'].forEach((assetKey) => {
  const daily = assetKey === 'btc' ? btcDaily : goldDaily;
  const label = assetKey === 'btc' ? 'Sniper BTC' : 'Sniper Emas';
  const haltBtc = assetKey === 'btc';
  console.log(`--- ${label} ---`);

  const dxy20 = buildDxyWeakLookup(20);
  const e1_base = runEra(assetKey, daily, era1Start, era1End, null, haltBtc);
  const e1_dxy = runEra(assetKey, daily, era1Start, era1End, dxy20, haltBtc);
  const e2_base = runEra(assetKey, daily, era2Start, era2End, null, haltBtc);
  const e2_dxy = runEra(assetKey, daily, era2Start, era2End, dxy20, haltBtc);

  console.log(`  Era1 (2020-2023) TANPA DXY : n=${e1_base.n}, PF=${e1_base.profitFactor}, WR=${e1_base.winRate}`);
  console.log(`  Era1 (2020-2023) + DXY     : n=${e1_dxy.n}, PF=${e1_dxy.profitFactor}, WR=${e1_dxy.winRate}`);
  console.log(`  Era2 (2023-2026) TANPA DXY : n=${e2_base.n}, PF=${e2_base.profitFactor}, WR=${e2_base.winRate}`);
  console.log(`  Era2 (2023-2026) + DXY     : n=${e2_dxy.n}, PF=${e2_dxy.profitFactor}, WR=${e2_dxy.winRate}`);
  console.log('');
});

console.log('\n=== TES 2: Sensitivitas parameter SMA (10/20/50) ===\n');
const BACKTEST_START = new Date('2020-01-01T00:00:00Z').getTime();
[10, 20, 50].forEach((smaLen) => {
  const dxy = buildDxyWeakLookup(smaLen);
  const btcR = runCrossAssetBacktest({ btc: btcDaily }, { haltBtcInBearWindow: true, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0, dxyFilter: dxy });
  const goldR = runCrossAssetBacktest({ gold: goldDaily }, { haltBtcInBearWindow: false, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0, dxyFilter: dxy });
  const btcS = summarize(btcR.trades);
  const goldS = summarize(goldR.trades);
  console.log(`SMA${smaLen}: Sniper BTC n=${btcS.n} PF=${btcS.profitFactor} WR=${btcS.winRate} final=$${btcR.finalCapital.toFixed(0)} | Sniper Emas n=${goldS.n} PF=${goldS.profitFactor} WR=${goldS.winRate} final=$${goldR.finalCapital.toFixed(0)}`);
});
