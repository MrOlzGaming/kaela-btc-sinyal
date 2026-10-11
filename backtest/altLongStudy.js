// Riset 📈 LONG DCA KOIN VOLATIL (11 Okt 2026, Olan: "sistem yang sama tapi buat koin lain yang lebih volatil tapi
// jangka panjang, acuan entry tetep ATH BTC -15%, leverage 3x dulu, tes ETH"). Cerminan LONG dari shortCounterStudy.js:
//   - Siklus baru cuma dibuka kalau BTC <= ATH BTC -15% (acuan sama kayak Farmer).
//   - Long KOIN isolated 3x, bet 1% saldo (diukur tiap awal siklus), DCA tiap koin TURUN 10% dari entry terakhir.
//   - TP = untung 10% dari TOTAL uang yang ditanam di siklus itu, rugi likuidasi ikut ketutup dulu.
//   - Posisi kena likuidasi -> langsung diganti posisi baru di harga itu, bet 1,25x bet yang diambil exchange.
// Data: candle HARIAN Binance spot (data-api.binance.vision), cache backtest/<SYM>-1d-cache.json (gitignored).
// Urutan dalam 1 candle KONSERVATIF buat long: open (TP kalau udah lewat) -> low dulu (DCA + likuidasi) -> baru high (TP).
// Funding: long BAYAR, asumsi rata2 +0,01%/8 jam dari nilai posisi (data funding Binance futures diblok dari server US).
// Jalanin: node backtest/altLongStudy.js [ETHUSDT] [bet, mis. 0.06]   (server cloud Kaela diblok Binance -> jalanin lewat
// .github/workflows/research-backtest.yml atau dari VPS)
const fs = require('fs');
const path = require('path');
const DAY = 864e5;

async function loadDaily(sym) {
  const cache = path.join(__dirname, `${sym}-1d-cache.json`);
  let rows = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : [];
  // candle terakhir di cache bisa masih berjalan (belum close) -> buang & ambil ulang dari situ
  if (rows.length) rows.pop();
  let cur = rows.length ? rows[rows.length - 1][0] + DAY : Date.parse('2017-01-01');
  for (;;) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1d&startTime=${cur}&limit=1000`;
    const k = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).json();
    if (!Array.isArray(k)) throw new Error(`${sym}: ${JSON.stringify(k).slice(0, 200)}`);
    if (!k.length) break;
    for (const r of k) rows.push([r[0], +r[1], +r[2], +r[3], +r[4]]);
    cur = k[k.length - 1][0] + DAY;
    if (k.length < 1000) break;
  }
  const seen = new Set(); rows = rows.filter((r) => (seen.has(r[0]) ? false : seen.add(r[0])));
  fs.writeFileSync(cache, JSON.stringify(rows));
  return rows.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
}

const DEF = { bet: 0.01, step: 0.10, tp: 0.10, rep: 1.25, L: 3, mm: 0.005, fee: 0.0005, fundDay: 0.0003, btcZone: 0.15, sizing: 'cycle' };

// C = candle koin, B = Map(t -> candle BTC) + btcAthBefore(t)
function run(C, btc, i0, cfgIn = {}, startCap = 1000, i1 = C.length) {
  const cfg = { ...DEF, ...cfgIn };
  const { bet, step, tp, rep, L, mm, fee, fundDay, btcZone, sizing } = cfg;
  let wallet = startCap, lots = [], putIn = 0, realized = 0, unit = 0, lastE = 0, cycStart = 0, cycLiq = 0, cycMaxLots = 0;
  let peak = startCap, maxDd = 0, minEq = startCap, maxLots = 0, maxMarginPct = 0;
  let liqs = 0, addFail = 0, replFail = 0, liqLoss = 0, fees = 0, funding = 0;
  const cycles = [], yearEq = new Map();
  const margins = () => lots.reduce((s, p) => s + p.mg, 0);
  const floatAt = (px) => lots.reduce((s, p) => s + p.q * (px - p.e), 0);
  const open = (e, mg) => {
    if (wallet - margins() < mg * (1 + L * fee) - 1e-9) return false;
    lots.push({ e, q: (mg * L) / e, mg }); wallet -= mg * L * fee; fees += mg * L * fee; putIn += mg; return true;
  };
  const tpPrice = () => {
    const Q = lots.reduce((s, p) => s + p.q, 0), cost = lots.reduce((s, p) => s + p.q * p.e, 0);
    return (cost + tp * putIn - realized) / Q; // untung long = Q*px - cost
  };
  const closeAll = (px, t) => {
    let pnl = 0; for (const p of lots) { const f = p.q * px * fee; pnl += p.q * (px - p.e) - f; fees += f; }
    wallet += pnl;
    cycles.push({ start: cycStart, end: t, putIn, net: pnl + realized, liqs: cycLiq, maxLots: cycMaxLots });
    lots = []; putIn = 0; realized = 0; unit = 0; cycLiq = 0; cycMaxLots = 0;
  };
  for (let i = i0; i < i1; i++) {
    const { t, o, h, l, c } = C[i];
    if (lots.length && fundDay) { const f = lots.reduce((s, p) => s + p.q * o, 0) * fundDay; wallet -= f; funding += f; }
    if (lots.length && o >= tpPrice()) closeAll(o, t);
    const b = btc.byT.get(t);
    const inZone = b ? b.o <= btc.athBefore(t) * (1 - btcZone) : false;
    if (!lots.length && inZone) {
      unit = (sizing === 'fixed' ? startCap : wallet) * bet; putIn = 0; realized = 0; cycStart = t;
      if (open(o, unit)) lastE = o; else unit = 0;
    }
    if (lots.length) {
      while (l <= lastE * (1 - step)) { const e = Math.min(lastE * (1 - step), o); if (!open(e, unit)) addFail++; lastE = e; }
      let changed = true;
      while (changed) {
        changed = false; const keep = [], rep_ = [];
        for (const p of lots) {
          const liqPx = p.e * (1 - 1 / L + mm);
          if (l <= liqPx) { wallet -= p.mg; realized -= p.mg; liqLoss += p.mg; liqs++; cycLiq++; rep_.push({ px: Math.min(liqPx, o), mg: p.mg * rep }); changed = true; }
          else keep.push(p);
        }
        lots = keep;
        for (const r of rep_) { if (open(r.px, r.mg)) lastE = Math.min(lastE, r.px); else replFail++; }
      }
      maxLots = Math.max(maxLots, lots.length); cycMaxLots = Math.max(cycMaxLots, lots.length);
      const eqLow = wallet + floatAt(l);
      if (eqLow > 0) maxMarginPct = Math.max(maxMarginPct, margins() / eqLow);
      minEq = Math.min(minEq, eqLow); maxDd = Math.max(maxDd, 1 - eqLow / peak);
    }
    if (lots.length) { const tpx = tpPrice(); if (h >= tpx) closeAll(Math.max(o, tpx), t); }
    const eq = wallet + floatAt(c);
    if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak); minEq = Math.min(minEq, eq);
    const y = new Date(t).getUTCFullYear(); if (!yearEq.has(y)) yearEq.set(y, { first: eq, last: eq }); yearEq.get(y).last = eq;
  }
  const end = C[i1 - 1], eqEnd = wallet + floatAt(end.c), years = (end.t - C[i0].t) / (365.25 * DAY);
  return { eqEnd, mult: eqEnd / startCap, cagr: Math.pow(Math.max(eqEnd, 1e-9) / startCap, 1 / years) - 1, maxDd, minEq, cycles,
    nTP: cycles.length, liqs, addFail, replFail, liqLoss, fees, funding, maxLots, maxMarginPct, openLots: lots.length, openPutIn: putIn,
    openFloat: floatAt(end.c), openRealized: realized, yearEq };
}

function btcIndex(B) {
  const byT = new Map(B.map((r) => [r.t, r]));
  const athAt = []; let a = 0; for (const r of B) { athAt.push([r.t, a]); a = Math.max(a, r.h); } // ATH SEBELUM hari itu
  const m = new Map(athAt);
  return { byT, athBefore: (t) => m.get(t) || 0 };
}

const f$ = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const summary = (lab, r) => `${lab.padEnd(30)} akhir ${f$(r.eqEnd).padStart(8)} (x${r.mult.toFixed(2)}, ${pct(r.cagr)}/th) | DD ${pct(r.maxDd)} | terendah ${f$(r.minEq)} | TP ${r.nTP}x | liq ${r.liqs} | maks posisi ${r.maxLots} | margin maks ${pct(r.maxMarginPct)} | gagal tambah ${r.addFail}/ganti ${r.replFail}`;

module.exports = { loadDaily, run, btcIndex, DEF };

if (require.main === module) (async () => {
  const SYM = process.argv[2] || 'ETHUSDT';
  if (process.argv[3]) DEF.bet = Number(process.argv[3]); // bet per posisi, mis. 0.06 = 6% (default 1%)
  console.log(`BET ${(DEF.bet * 100).toFixed(1)}% saldo per posisi`);
  // BTC: Binance mulai Agu 2017 -> ATH sebelumnya (Des 2013 ~$1.150) gak relevan karena harga Agu 2017 udah di atasnya.
  const [C, B] = await Promise.all([loadDaily(SYM), loadDaily('BTCUSDT')]);
  const btc = btcIndex(B);
  const idx = (d) => { const t = Date.parse(d); const i = C.findIndex((r) => r.t >= t); return i < 0 ? C.length - 1 : i; };
  console.log(`DATA ${SYM}: ${day(C[0].t)} .. ${day(C[C.length - 1].t)} (${C.length} hari), BTC ${day(B[0].t)} .. ${day(B[B.length - 1].t)}`);
  const H20 = idx('2020-05-11'), H24 = idx('2024-04-20');
  const hodl = (i0) => C[C.length - 1].c / C[i0].o;

  console.log(`\n=== 1) ATURAN OLAN: long ${SYM} 3x, 1%, DCA tiap -10%, TP 10% tanam, liq diganti x1,25, buka siklus kalau BTC <= ATH -15% ===`);
  const main = run(C, btc, H20);
  console.log(summary('mulai halving 2020', main));
  console.log(summary('  tanpa funding', run(C, btc, H20, { fundDay: 0 })));
  console.log(summary('  bet tetap 1% modal awal', run(C, btc, H20, { sizing: 'fixed' })));
  console.log(`  pembanding HODL ${SYM} spot dari 11 Mei 2020: x${hodl(H20).toFixed(2)}`);
  console.log(`  fee ${f$(main.fees)} | funding ${f$(main.funding)} | rugi likuidasi ${f$(main.liqLoss)} | kebuka di akhir: ${main.openLots} lot, tanam ${f$(main.openPutIn)}, floating ${f$(main.openFloat)}, rugi liq siklus ini ${f$(main.openRealized)}`);
  console.log('  per tahun:'); for (const [y, v] of main.yearEq) console.log(`    ${y}: ${f$(v.first)} -> ${f$(v.last)} (${pct(v.last / v.first - 1)})`);
  console.log('  siklus (mulai -> tutup | hari | ditanam | bersih | liq | maks posisi):');
  for (const c of main.cycles) console.log(`    ${day(c.start)} -> ${day(c.end)} | ${String(Math.round((c.end - c.start) / DAY)).padStart(4)} hr | ${f$(c.putIn).padStart(6)} | ${f$(c.net).padStart(5)} | ${c.liqs} | ${c.maxLots}`);

  console.log('\n=== 2) PER SIKLUS HALVING ($1.000 di awal tiap siklus) ===');
  console.log(summary('halving 2020 -> 2024', run(C, btc, H20, {}, 1000, H24)));
  console.log(summary('halving 2024 -> sekarang', run(C, btc, H24)));

  console.log('\n=== 3) TITIK MULAI (tiap tanggal 1, Mei 2020 .. Sep 2026) ===');
  const starts = [];
  for (let t = Date.UTC(2020, 4, 1); t <= Date.UTC(2026, 8, 1); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) starts.push(idx(new Date(t).toISOString()));
  const startStats = (v) => { const rs = starts.map((i) => run(C, btc, i, v)); const m = rs.map((r) => r.mult).sort((a, b) => a - b);
    return { worst: m[0], med: m[Math.floor(m.length / 2)], best: m[m.length - 1], lose: m.filter((x) => x < 1).length, n: m.length, dd: Math.max(...rs.map((r) => r.maxDd)) }; };
  const st = startStats({});
  console.log(`  ${st.n} titik: terburuk x${st.worst.toFixed(2)}, median x${st.med.toFixed(2)}, terbaik x${st.best.toFixed(2)}, rugi ${st.lose}/${st.n}, DD terburuk ${pct(st.dd)}`);

  console.log('\n=== 4) SENSITIVITAS (mulai halving 2020, 1 parameter diubah) ===');
  const vary = [['leverage', 'L', [1, 2, 3, 5]], ['jarak DCA', 'step', [0.05, 0.10, 0.15, 0.20]], ['bet', 'bet', [0.01, 0.02, 0.03, 0.04, 0.06]],
    ['TP dari tanam', 'tp', [0.05, 0.10, 0.20, 0.30]], ['ganti liq', 'rep', [1, 1.25, 1.5]], ['zona BTC', 'btcZone', [0, 0.15, 0.30]]];
  for (const [n, k, vals] of vary) for (const v of vals) {
    const s = startStats({ [k]: v });
    console.log(`${summary(`${n} = ${k === 'L' ? v + 'x' : k === 'rep' ? 'x' + v : pct(v)}`, run(C, btc, H20, { [k]: v }))} || 77 mulai: terburuk x${s.worst.toFixed(2)} median x${s.med.toFixed(2)} rugi ${s.lose}`);
  }

  console.log('\n=== 5) STRESS: mulai dari awal data Binance (bear 2018 -94% ETH) ===');
  console.log(summary('mulai awal data', run(C, btc, 0)));
  console.log(summary('mulai 1 Jan 2018 (puncak)', run(C, btc, idx('2018-01-01'))));
  console.log(summary('mulai puncak Nov 2021', run(C, btc, idx('2021-11-10'))));
  console.log(`  HODL dari awal data: x${hodl(0).toFixed(2)}, dari 1 Jan 2018: x${hodl(idx('2018-01-01')).toFixed(2)}`);

  if (SYM !== 'BTCUSDT') {
    console.log('\n=== 6) PEMBANDING: aturan SAMA persis di BTC ===');
    const iB = B.findIndex((r) => r.t >= Date.parse('2020-05-11'));
    console.log(summary('BTC 3x mulai halving 2020', run(B, btc, iB)));
  }
})().catch((e) => { console.error('ERROR', e.stack); process.exit(1); });
