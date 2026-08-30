// Riset 31 Agu 2026: uji apa konfirmasi DXY (Sniper+Nyopet v2 SEKARANG long-only -- cuma ambil
// entry kalau dolar LEMAH, DXY close < SMA20 sendiri) beneran nambah edge atau enggak, buat
// SEMUA 4 slot (Sniper BTC/Emas, Nyopet BTC/Emas). Permintaan Olan: "setiap entry juga diyakinkan
// dengan dxy.. tambahan konfirmasi" + "bahas dulu lalu kita re backtest semua btc emas sniper
// nyopet" + "dari 2020 aja". Filter SIMPEL sengaja (SMA20 polos) -- hindari overfitting.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { runCrossAssetBacktest, summarize: summarizeSniper } = require(path.join(ROOT, 'backtestCrossAsset.js'));
const { runNyopetV2Backtest, summarize: summarizeNyopet, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H } = require('./nyopetChartPatternFvg.js');
const { buildDxyWeakLookup } = require('./dxyFilter.js');

const BACKTEST_START = new Date('2020-01-01T00:00:00Z').getTime();
const dxyFilter = buildDxyWeakLookup(20);

const btcDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'daily-cache.json'), 'utf8'));
const goldDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'gold-daily-cache.json'), 'utf8'));

function line(label, s, extra) {
  console.log(`  ${label.padEnd(28)} | n=${String(s.n).padEnd(4)} | WR=${s.winRate.padEnd(6)} | PF=${s.profitFactor.padEnd(5)} ${extra || ''}`);
}

console.log('=== Konfirmasi DXY (dolar lemah = close < SMA20) -- SEMUA 4 slot, mulai 2020 ===\n');

console.log('--- SNIPER BTC (harian) ---');
{
  const base = runCrossAssetBacktest({ btc: btcDaily }, { haltBtcInBearWindow: true, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0 });
  const filtered = runCrossAssetBacktest({ btc: btcDaily }, { haltBtcInBearWindow: true, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0, dxyFilter });
  line('TANPA filter DXY', summarizeSniper(base.trades), `| final=$${base.finalCapital.toFixed(0)} | DD=${base.maxDrawdownPct.toFixed(1)}%`);
  line('DENGAN filter DXY', summarizeSniper(filtered.trades), `| final=$${filtered.finalCapital.toFixed(0)} | DD=${filtered.maxDrawdownPct.toFixed(1)}%`);
}

console.log('\n--- SNIPER EMAS (harian) ---');
{
  const base = runCrossAssetBacktest({ gold: goldDaily }, { haltBtcInBearWindow: false, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0 });
  const filtered = runCrossAssetBacktest({ gold: goldDaily }, { haltBtcInBearWindow: false, startMs: BACKTEST_START, startCapital: 100, topUpAmount: 0, dxyFilter });
  line('TANPA filter DXY', summarizeSniper(base.trades), `| final=$${base.finalCapital.toFixed(0)} | DD=${base.maxDrawdownPct.toFixed(1)}%`);
  line('DENGAN filter DXY', summarizeSniper(filtered.trades), `| final=$${filtered.finalCapital.toFixed(0)} | DD=${filtered.maxDrawdownPct.toFixed(1)}%`);
}

console.log('\n--- NYOPET BTC (4H) ---');
{
  const base = runNyopetV2Backtest(CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START });
  const filtered = runNyopetV2Backtest(CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START, dxyFilter });
  line('TANPA filter DXY', summarizeNyopet(base.trades), `| final=$${base.finalCapital.toFixed(0)} | DD=${base.maxDrawdownPct.toFixed(1)}%`);
  line('DENGAN filter DXY', summarizeNyopet(filtered.trades), `| final=$${filtered.finalCapital.toFixed(0)} | DD=${filtered.maxDrawdownPct.toFixed(1)}%`);
}

console.log('\n--- NYOPET EMAS (4H) ---');
if (CANDLES_4H_GOLD) {
  const base = runNyopetV2Backtest(CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START });
  const filtered = runNyopetV2Backtest(CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START, dxyFilter });
  line('TANPA filter DXY', summarizeNyopet(base.trades), `| final=$${base.finalCapital.toFixed(0)} | DD=${base.maxDrawdownPct.toFixed(1)}%`);
  line('DENGAN filter DXY', summarizeNyopet(filtered.trades), `| final=$${filtered.finalCapital.toFixed(0)} | DD=${filtered.maxDrawdownPct.toFixed(1)}%`);
}
