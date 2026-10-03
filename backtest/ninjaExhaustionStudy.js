// ninjaExhaustionStudy.js -- riset "Ninja Exhaustion" (3 Okt 2026, ide Olan: "manfaatkan sinyal kita sendiri di ninja..
// short kehabisan energi atau long kehabisan energi.. uji backtest, uji demo 100 transaksi").
//
// Replay logika radar Jalur C (actionableLiquidityRadar.js: episode burst >= $300rb/30 menit, exhausted kalau kecepatan
// likuidasi sisi itu turun <= 30% dari puncak) di data likuidasi ASLI Bybit (liquidation-events.jsonl) dengan beberapa
// cadence cek (1/5/15 menit), lalu FADE: long-liq kering -> LONG, short-liq kering -> SHORT. Entry = open candle 1m
// berikutnya (taker), harga = Binance BTCUSDT 1m. Fee RT default 0,10% (taker 0,05% x2, BingX).
//
// ⚠️ Data cuma ~3 minggu -> n KECIL. Ini buat milih aturan exit yang masuk akal buat UJI DEMO, BUKAN bukti edge.
// Jalankan: node backtest/ninjaExhaustionStudy.js   (env FEE_RT=0.1, DUMP=1 buat daftar trade)

const fs = require('fs');
const path = require('path');
const { fetchKlines } = require('./fetchKlines');

const EVENTS_PATH = path.join(__dirname, '..', 'liquidation-events.jsonl');
const FEE_RT = Number(process.env.FEE_RT || 0.1) / 100;
const WINDOW_MS = 30 * 60 * 1000;
const BURST_USD = Number(process.env.BURST_USD || 300000);
const RATIO = Number(process.env.RATIO || 0.3);
const EPISODE_MAX_AGE_MS = 6 * 3600 * 1000;

function loadEvents() {
  return fs.readFileSync(EVENTS_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.symbol === 'BTCUSDT').sort((a, b) => a.timestamp - b.timestamp);
}

// SAMA persis summarizeEvents/updateBurstEpisode di actionableLiquidityRadar.js (disalin biar gak require file live).
function summarize(evts) {
  let longUsd = 0, shortUsd = 0;
  for (const e of evts) { const n = e.price * e.qty; if (e.side === 'BUY') longUsd += n; else shortUsd += n; }
  return { longUsd, shortUsd };
}
function updateEpisode(ep, burst, now) {
  const stale = ep && (now - ep.startedAt > EPISODE_MAX_AGE_MS);
  if (ep && !stale) {
    const w = ep.side === 'long' ? burst.longUsd : burst.shortUsd;
    const peak = Math.max(ep.peakUsd, w);
    if (peak > 0 && w / peak <= RATIO) return { ep: null, exhausted: ep.side, peak };
    return { ep: { ...ep, peakUsd: peak } };
  }
  const side = burst.longUsd > burst.shortUsd ? 'long' : 'short';
  const usd = Math.max(burst.longUsd, burst.shortUsd);
  return usd >= BURST_USD ? { ep: { side, startedAt: now, peakUsd: usd } } : { ep: null };
}

function replaySignals(events, cadenceMin) {
  const t0 = Math.ceil(events[0].timestamp / 60000) * 60000 + WINDOW_MS;
  const tEnd = events[events.length - 1].timestamp;
  const sigs = [];
  let ep = null, lo = 0;
  for (let t = t0; t <= tEnd; t += cadenceMin * 60000) {
    while (lo < events.length && events[lo].timestamp < t - WINDOW_MS) lo++;
    let hi = lo; while (hi < events.length && events[hi].timestamp <= t) hi++;
    const r = updateEpisode(ep, summarize(events.slice(lo, hi)), t);
    ep = r.ep;
    // FOLLOW=1 -> ikut arah forced-flow (long-liq kering -> SHORT), bukan fade
    if (r.exhausted) sigs.push({ t, exhaustedSide: r.exhausted, dir: (r.exhausted === 'long' ? 1 : -1) * (process.env.FOLLOW ? -1 : 1), peak: r.peak });
  }
  return sigs;
}

// Simulasi 1 trade di candle 1m. exit: {sl%, tp%|null, trail% (aktif setelah +act%), maxMin}
function simulate(c1m, idxByMin, sig, x) {
  let i = idxByMin.get(Math.floor(sig.t / 60000) * 60000);
  if (i == null) return null;
  i += 1; if (i >= c1m.length) return null; // entry open candle berikutnya
  const entry = c1m[i].open, d = sig.dir;
  let stop = entry * (1 - d * x.sl / 100);
  const tp = x.tp ? entry * (1 + d * x.tp / 100) : null;
  let best = entry;
  for (let k = i; k < c1m.length && k <= i + x.maxMin; k++) {
    const c = c1m[k];
    const adverse = d > 0 ? c.low : c.high, fav = d > 0 ? c.high : c.low;
    if (d > 0 ? adverse <= stop : adverse >= stop) return { ret: d * (stop - entry) / entry - FEE_RT, why: 'stop', min: k - i };
    if (tp && (d > 0 ? fav >= tp : fav <= tp)) return { ret: d * (tp - entry) / entry - FEE_RT, why: 'tp', min: k - i };
    best = d > 0 ? Math.max(best, c.high) : Math.min(best, c.low);
    if (x.trail && d * (best - entry) / entry * 100 >= x.act) {
      const cand = best * (1 - d * x.trail / 100);
      if (d > 0 ? cand > stop : cand < stop) stop = cand;
    }
  }
  const last = c1m[Math.min(c1m.length - 1, i + x.maxMin)];
  return { ret: d * (last.close - entry) / entry - FEE_RT, why: 'time', min: x.maxMin };
}

function stats(rs) {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r > 0), l = rs.filter((r) => r <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = -l.reduce((a, b) => a + b, 0);
  const avg = rs.reduce((a, b) => a + b, 0) / n;
  return `n=${n} win=${(w.length / n * 100).toFixed(0)}% avg=${(avg * 100).toFixed(3)}% PF=${gl > 0 ? (gw / gl).toFixed(2) : 'inf'} total=${(rs.reduce((a, b) => a + b, 0) * 100).toFixed(2)}%`;
}

async function main() {
  const events = loadEvents();
  const start = events[0].timestamp, end = events[events.length - 1].timestamp + 6 * 3600 * 1000;
  console.log(`Data likuidasi: ${events.length} event, ${new Date(start).toISOString()} .. ${new Date(events[events.length - 1].timestamp).toISOString()} | fee RT ${(FEE_RT * 100).toFixed(2)}%`);
  const c1m = await fetchKlines('BTCUSDT', '1m', start, Math.min(end, Date.now()));
  const idx = new Map(c1m.map((c, i) => [c.openTime, i]));
  const exits = [];
  for (const maxMin of [15, 30, 60, 120, 240]) exits.push({ name: `waktu ${maxMin}m (SL 1,5%)`, sl: 1.5, tp: null, maxMin });
  for (const [sl, tp] of [[0.5, 0.5], [0.5, 1], [0.7, 0.7], [0.7, 1.4], [1, 1], [1, 2]]) exits.push({ name: `SL ${sl}% TP ${tp}% (maks 4j)`, sl, tp, maxMin: 240 });
  for (const [sl, act, trail] of [[0.7, 0.5, 0.3], [1, 0.5, 0.5], [1, 1, 0.5], [0.7, 0.3, 0.3]]) exits.push({ name: `SL ${sl}% trail ${trail}% aktif +${act}% (maks 8j)`, sl, tp: null, trail, act, maxMin: 480 });

  for (const cad of [1, 5, 15]) {
    const sigs = replaySignals(events, cad);
    const nL = sigs.filter((s) => s.dir > 0).length;
    console.log(`\n=== cadence ${cad} menit: ${sigs.length} sinyal exhaustion (${nL} LONG / ${sigs.length - nL} SHORT) ===`);
    for (const x of exits) {
      const res = sigs.map((s) => ({ s, r: simulate(c1m, idx, s, x) })).filter((o) => o.r);
      const all = res.map((o) => o.r.ret);
      const lo = res.filter((o) => o.s.dir > 0).map((o) => o.r.ret), sh = res.filter((o) => o.s.dir < 0).map((o) => o.r.ret);
      const half = Math.floor(res.length / 2);
      console.log(`${x.name.padEnd(36)} | SEMUA ${stats(all)} | LONG ${stats(lo)} | SHORT ${stats(sh)} | paruh1 ${stats(all.slice(0, half))} | paruh2 ${stats(all.slice(half))}`);
      if (process.env.DUMP && cad === Number(process.env.DUMP)) res.forEach((o) => console.log('   ', new Date(o.s.t).toISOString(), o.s.dir > 0 ? 'LONG ' : 'SHORT', (o.r.ret * 100).toFixed(2) + '%', o.r.why, o.r.min + 'm'));
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { replaySignals, simulate, summarize, updateEpisode };
