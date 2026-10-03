// rangerFilterStudy.js (3 Okt 2026) -- 3 ide lama dari RESEARCH-LOG "belum dicoba" buat Ranger 4H:
//   A) FILTER VOLATILITAS: skip entry kalau ATR14/harga lagi ekstrem (persentil vs 500 candle terakhir).
//   B) FILTER JAM: PF per jam candle sinyal (UTC 00/04/08/12/16/20) -- ada jam yang KONSISTEN jelek di 2 era?
//   C) VALIDASI LOOKBACK: lookback pola Ranger = rescale x6 dari harian (gak pernah divalidasi independen) -> coba skala x4..x8.
// Engine Ranger PERSIS (precomputeSignals/runVariant rangerExitResearch.js), 8 koin rotasi live, exit live (BTC trailing 3x, alt
// 1/3@2R + BE + SMA60), fee 0,12%. Metrik: PF & rata2 %/trade (net), era <2023 / >=2023.
// Pakai: node backtest/rangerFilterStudy.js <multicoinCacheDir>
const fs = require('fs');
const path = require('path');
const R = require('./rangerExitResearch');
const { resampleTo4h } = require('./rangerChartPatternFvg');

const COINS = ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'];
const SPLIT = Date.UTC(2023, 0, 1);
const exitFor = (coin) => (coin === 'BTC' ? { trailR: 3, partialRR: null, partialFrac: 0 } : { partialRR: 2, partialFrac: 1 / 3, sma: 60 });
const BASE_LB = { pole: [...R.P.poleLookbackRange], flag: [...R.P.flagLookbackRange], wedge: [...R.P.wedgeLookbackRange] };

function st(tr) {
  if (!tr.length) return 'n=0';
  let w = 0, l = 0; for (const t of tr) { if (t.net > 0) w += t.net; else l -= t.net; }
  return `n=${tr.length} PF ${(l ? w / l : 99).toFixed(2)} avg ${(tr.reduce((a, t) => a + t.net, 0) / tr.length).toFixed(2)}%`;
}
const era = (tr) => `<2023 ${st(tr.filter((t) => t.t < SPLIT))} | >=2023 ${st(tr.filter((t) => t.t >= SPLIT))}`;

function main() {
  const dir = process.argv[2];
  const data = {};
  for (const coin of COINS) {
    const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(dir, `${coin}USDT-1h.json`), 'utf8')));
    data[coin] = { c, ind: { atr: R.atrArr(c), sma: { 60: R.smaArr(c, 60) } } };
  }
  // ---- C) lookback scale ----
  console.log('=== C) VALIDASI LOOKBACK (rentang pola = skala x N dari versi harian; live = x6) ===');
  for (const s of [4, 5, 6, 7, 8]) {
    const k = s / 6;
    R.P.poleLookbackRange = BASE_LB.pole.map((v) => Math.round(v * k));
    R.P.flagLookbackRange = BASE_LB.flag.map((v) => Math.round(v * k));
    R.P.wedgeLookbackRange = BASE_LB.wedge.map((v) => Math.round(v * k));
    const all = [], btc = [];
    for (const coin of COINS) {
      const { c, ind } = data[coin];
      const pre = R.precomputeSignals(c, coin);
      const tr = R.runVariant(c, pre, ind, exitFor(coin));
      all.push(...tr); if (coin === 'BTC') btc.push(...tr);
      if (s === 6) data[coin].pre = pre; // simpan versi live buat A & B
    }
    console.log(`x${s}${s === 6 ? ' (LIVE)' : '      '} | 8 koin ${era(all)} | BTC ${era(btc)}`);
  }
  R.P.poleLookbackRange = BASE_LB.pole; R.P.flagLookbackRange = BASE_LB.flag; R.P.wedgeLookbackRange = BASE_LB.wedge;

  // trade live (x6) + info entry (jam & persentil ATR)
  const trades = [];
  for (const coin of COINS) {
    const { c, ind, pre } = data[coin];
    const idxOf = new Map(c.map((x, i) => [x.openTime, i]));
    for (const t of R.runVariant(c, pre, ind, exitFor(coin))) {
      const i = idxOf.get(t.t);
      const atrPct = ind.atr[i] / c[i].close;
      const hist = []; for (let k = Math.max(15, i - 500); k < i; k++) if (ind.atr[k]) hist.push(ind.atr[k] / c[k].close);
      const pctile = hist.length ? hist.filter((v) => v < atrPct).length / hist.length * 100 : 50;
      trades.push({ ...t, coin, hour: new Date(c[i].openTime).getUTCHours(), pctile });
    }
  }
  console.log(`\nBaseline live (x6, tanpa filter): 8 koin ${era(trades)}`);

  console.log('\n=== A) FILTER VOLATILITAS (persentil ATR14/harga vs 500 candle) -- trade yang LOLOS filter ===');
  for (const [name, f] of [['skip vol tinggi (>80)', (t) => t.pctile <= 80], ['skip vol rendah (<20)', (t) => t.pctile >= 20], ['cuma tengah (20-80)', (t) => t.pctile >= 20 && t.pctile <= 80], ['cuma vol tinggi (>50)', (t) => t.pctile > 50], ['cuma vol rendah (<=50)', (t) => t.pctile <= 50]]) {
    console.log(`${name.padEnd(24)} | ${era(trades.filter(f))}`);
  }

  console.log('\n=== B) PER JAM candle sinyal (UTC buka candle 4H) ===');
  for (const h of [0, 4, 8, 12, 16, 20]) console.log(`jam ${String(h).padStart(2, '0')} UTC (${String((h + 8) % 24).padStart(2, '0')} WITA) | ${era(trades.filter((t) => t.hour === h))}`);
}
if (require.main === module) main();
