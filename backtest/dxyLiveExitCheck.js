// backtest/dxyLiveExitCheck.js (4 Okt 2026, audit paritas live vs backtest) -- filter DXY (`isDxyWeak(20)`: close DXY harian
// terakhir < SMA20, kalau dolar KUAT semua entry baru Ranger dijeda) jalan di rangerAutoTrader.js buat SEMUA aset (BTC & Emas).
// Validasinya dulu (31 Agu, dxyNyopetScrutiny.js) pakai mesin/exit LAMA. Exit sekarang beda (BTC trailing 3x invalidasi,
// Emas 1/2 @3R + SMA60 tanpa window) -- dicek ulang: filter DXY masih membantu di DUA era pakai exit LIVE?
// Pakai: COIN=XAU|BTC node backtest/dxyLiveExitCheck.js <multicoinCacheDir>
const COIN = process.env.COIN || 'XAU';
if (COIN === 'XAU') process.env.NOBEAR = '1'; // Emas live tanpa window (lihat donchianGoldLiveExit.js); BTC pakai window halving
const fs = require('fs');
const path = require('path');
const { precomputeSignals, runVariant, smaArr, atrArr } = require('./rangerExitResearch');
const { resampleTo4h } = require('./rangerChartPatternFvg');

const dir = process.argv[2];
const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(dir, `${COIN}USDT-1h.json`), 'utf8')));
const ind = { atr: atrArr(c), sma: { 30: smaArr(c, 30), 60: smaArr(c, 60), 90: smaArr(c, 90), 120: smaArr(c, 120) } };
const pre = precomputeSignals(c, COIN);
const LIVE = COIN === 'XAU' ? { partialRR: 3, partialFrac: 0.5, sma: 60 } : { partialRR: null, partialFrac: 0, trailR: 3 };
const SPLIT = Date.UTC(2023, 0, 1);

const dxyRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxy-daily-cache.json'), 'utf8'));
const dxy = (Array.isArray(dxyRaw) ? dxyRaw : dxyRaw.candles).sort((a, b) => a.closeTime - b.closeTime);
const lastDxyMs = dxy[dxy.length - 1].closeTime;
// status DXY pas candle 4H i close: pakai close harian yang closeTime <= closeTime candle (udah selesai)
function dxyWeakAt(t, len) {
  let lo = 0, hi = dxy.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dxy[m].closeTime <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < len - 1) return null;
  let s = 0; for (let j = k - len + 1; j <= k; j++) s += dxy[j].close;
  return dxy[k].close < s / len;
}
function st(tr) { let w = 0, l = 0, s = 0; for (const t of tr) { s += t.net; if (t.net > 0) w += t.net; else l -= t.net; } return { n: tr.length, pf: l ? w / l : (w ? 99 : 0), avg: tr.length ? s / tr.length : 0 }; }
function eqDd(tr) { let eq = 100, pk = 100, dd = 0; for (const t of tr) { eq += eq * t.notionalFrac * t.net / 100; pk = Math.max(pk, eq); dd = Math.max(dd, (pk - eq) / pk * 100); } return { x: eq / 100, dd }; }
const fmt = (s) => `n${s.n} PF ${s.pf.toFixed(2)} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`;
function report(label, p) {
  const tr = runVariant(c, p, ind, LIVE).filter((t) => t.t <= lastDxyMs);
  const e1 = tr.filter((t) => t.t < SPLIT), e2 = tr.filter((t) => t.t >= SPLIT);
  const q1 = eqDd(e1), q2 = eqDd(e2);
  console.log(`${label.padEnd(26)} | <2023 ${fmt(st(e1))} modal x${q1.x.toFixed(2)} DD ${q1.dd.toFixed(0)}% | >=2023 ${fmt(st(e2))} modal x${q2.x.toFixed(2)} DD ${q2.dd.toFixed(0)}%`);
}
console.log(`${COIN} 4H, exit LIVE ${JSON.stringify(LIVE)}, data DXY s/d ${new Date(lastDxyMs).toISOString().slice(0, 10)}`);
report('tanpa filter DXY', pre);
for (const len of [10, 20, 30, 50]) {
  report(`DXY lemah (SMA${len})${len === 20 ? ' = LIVE' : ''}`, { sig: pre.sig.map((s, i) => (s && dxyWeakAt(c[i].closeTime, len) !== false ? s : null)), bear: pre.bear });
}
