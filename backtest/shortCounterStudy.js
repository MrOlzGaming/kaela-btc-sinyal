// Riset 🛡️ SHORT TAHAN BULL (11 Okt 2026, ide Olan: "sistem short yang gak takut bull", buat counter posisi long).
//
// Aturan Olan (versi uji pertama):
//   - Zona: BTC di antara ATH s/d ATH -40% -> boleh buka siklus short. Di bawah -40% gak buka siklus baru.
//   - Leverage 1x isolated (likuidasi kira2 pas harga naik ~100% dari entry).
//   - Bet = 1% modal per posisi, DCA tiap BTC naik +10% dari entry terakhir, terus (selama saldo bebas cukup).
//   - TP = untung 10% dari TOTAL uang yang udah ditanam di siklus itu (bukan dari modal), rugi likuidasi ikut ketutup dulu.
//   - Posisi kena likuidasi -> langsung diganti posisi baru di harga itu dengan bet 1,25x bet yang diambil exchange.
//   - Periode: 2 halving terakhir (mulai 11 Mei 2020). Stress test di luar periode (bull 2017) dikasih terpisah.
//
// Data: web/data/btc-history.json (harian s/d 6 Agu 2026) + tambalan harga dari archive.json (laporan harian
// "Harga sekarang") & orderbook-wall-research-log.json (midPrice tiap siklus, 13 Sep 2026+). Hari tambalan
// high/low-nya PERKIRAAN (cuma dari beberapa titik harga) -- ditandai di output.
// Urutan di dalam 1 candle harian dibuat KONSERVATIF buat short: cek open (TP kalau udah lewat) -> high dulu
// (DCA + likuidasi) -> baru low (TP). Funding default 0 (gak ada data funding di server ini); versi dengan
// funding rata2 +0,01%/8 jam (short NERIMA pas bull) dikasih sbg pembanding.
//
// Jalanin: node backtest/shortCounterStudy.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DAY = 864e5;

function loadDaily() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/btc-history.json'), 'utf8'))
    .map((r) => ({ t: r.time, o: r.open, h: r.high, l: r.low, c: r.close, approx: false }));
  const lastT = base[base.length - 1].t;
  const pts = []; // titik harga tambalan {t, p}
  try {
    for (const m of JSON.parse(fs.readFileSync(path.join(ROOT, 'archive.json'), 'utf8'))) {
      if (m.type !== 'report-daily') continue;
      const x = /Harga sekarang:\s*\$([0-9,]+(?:\.[0-9]+)?)/.exec(m.content || '');
      if (x) pts.push({ t: Date.parse(m.date), p: Number(x[1].replace(/,/g, '')) });
    }
  } catch (_) { /* opsional */ }
  try {
    for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, 'orderbook-wall-research-log.json'), 'utf8'))) {
      if (r.midPrice) pts.push({ t: Date.parse(r.timestamp), p: r.midPrice });
    }
  } catch (_) { /* opsional */ }
  pts.sort((a, b) => a.t - b.t);
  const byDay = new Map();
  for (const x of pts) {
    const d = Math.floor(x.t / DAY) * DAY; if (d <= lastT) continue;
    if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(x.p);
  }
  const extra = [...byDay.keys()].sort((a, b) => a - b).map((d) => {
    const v = byDay.get(d);
    return { t: d, o: v[0], h: Math.max(...v), l: Math.min(...v), c: v[v.length - 1], approx: true };
  });
  return base.concat(extra);
}

// athMaxAge: siklus baru cuma boleh dibuka kalau ATH-nya "segar" (dicetak <= N hari lalu) -- null = gak dicek.
// tpMode: 'basket' (aturan Olan: semua posisi ditutup bareng) | 'lot' (tiap posisi TP sendiri pas turun tp% dari entry-nya).
const DEF = { bet: 0.01, step: 0.10, tp: 0.10, rep: 1.25, zone: 0.40, L: 1, fee: 0.0005, mm: 0.005, fundDay: 0, sizing: 'cycle', athMaxAge: null, tpMode: 'basket' };

// Simulasi dari indeks i0 s/d akhir data. ATH dihitung dari SELURUH histori sebelum i0 (bukan mulai dari nol).
function run(D, i0, cfgIn = {}, startCap = 1000, i1 = D.length) {
  const cfg = { ...DEF, ...cfgIn };
  const { bet, step, tp, rep, zone, L, fee, mm, fundDay, sizing, athMaxAge, tpMode } = cfg;
  let ath = 0, athT = 0; for (let i = 0; i < i0; i++) if (D[i].h > ath) { ath = D[i].h; athT = D[i].t; }
  let wallet = startCap, lots = [], putIn = 0, realized = 0, unit = 0, lastE = 0, cycStart = 0;
  let peak = startCap, maxDd = 0, minEq = startCap, maxMarginPct = 0, maxLots = 0, maxFloatLossPct = 0;
  let liqs = 0, replFail = 0, addFail = 0, liqLossTotal = 0, feesTotal = 0, fundTotal = 0;
  const cycles = [], yearEq = new Map(), curve = [];
  const margins = () => lots.reduce((s, p) => s + p.mg, 0);
  const floatAt = (px) => lots.reduce((s, p) => s + p.q * (p.e - px), 0);
  const open = (e, mg, kind) => {
    if (wallet - margins() < mg + mg * L * fee - 1e-9) return false; // saldo bebas gak cukup
    lots.push({ e, q: (mg * L) / e, mg, kind }); wallet -= mg * L * fee; feesTotal += mg * L * fee; putIn += mg; return true;
  };
  const closeAll = (px, t, why) => {
    let pnl = 0;
    for (const p of lots) { const f = p.q * px * fee; pnl += p.q * (p.e - px) - f; feesTotal += f; }
    wallet += pnl;
    cycles.push({ start: cycStart, end: t, putIn, net: pnl + realized, liqs: cycles.liqCount || 0, why, maxLots: cycles.maxLotsCur || 0 });
    cycles.liqCount = 0; cycles.maxLotsCur = 0;
    lots = []; putIn = 0; realized = 0; unit = 0;
  };
  const tpPrice = () => {
    const Q = lots.reduce((s, p) => s + p.q, 0), cost = lots.reduce((s, p) => s + p.q * p.e, 0);
    return (cost - (tp * putIn - realized)) / Q; // untung short = cost - Q*px
  };
  const closeLotsAt = (px, t, atOpen) => { // tpMode 'lot': tutup posisi yang udah untung tp% sendiri2
    const keep = [];
    for (const p of lots) {
      // open udah lewat target = keluar di harga open, selain itu kena limit TP di target
      if (px <= p.e * (1 - tp)) { const ex = atOpen ? px : p.e * (1 - tp); const f = p.q * ex * fee; wallet += p.q * (p.e - ex) - f; feesTotal += f; }
      else keep.push(p);
    }
    if (keep.length !== lots.length) { lots = keep; if (!lots.length) { cycles.push({ start: cycStart, end: t, putIn, net: 0, liqs: cycles.liqCount || 0, why: 'TP-lot', maxLots: cycles.maxLotsCur || 0 }); cycles.liqCount = 0; cycles.maxLotsCur = 0; putIn = 0; realized = 0; unit = 0; } }
  };
  for (let i = i0; i < i1; i++) {
    const { t, o, h, l, c } = D[i];
    if (lots.length && fundDay) { const f = lots.reduce((s, p) => s + p.q * o, 0) * fundDay; wallet += f; fundTotal += f; }
    // 1) open udah lewat target TP -> tutup di open
    if (tpMode === 'lot') { if (lots.length) closeLotsAt(o, t, true); }
    else if (lots.length && o <= tpPrice()) closeAll(o, t, 'TP');
    // 2) mulai siklus baru (cuma di zona)
    const inZone = (zone == null || o >= ath * (1 - zone)) && (athMaxAge == null || (t - athT) / DAY <= athMaxAge);
    if (!lots.length && inZone) {
      const base = sizing === 'fixed' ? startCap : wallet;
      unit = base * bet; putIn = 0; realized = 0; cycStart = t;
      if (open(o, unit, 'awal')) lastE = o; else unit = 0;
    }
    // 3) high: DCA tiap +step, lalu likuidasi + ganti
    if (lots.length) {
      while (h >= lastE * (1 + step)) {
        const e = Math.max(lastE * (1 + step), o);
        if (!open(e, unit, 'dca')) addFail++;
        lastE = e;
      }
      let changed = true;
      while (changed) {
        changed = false;
        const keep = [], toReplace = [];
        for (const p of lots) {
          const liqPx = p.e * (1 + 1 / L - mm);
          if (h >= liqPx) { wallet -= p.mg; realized -= p.mg; liqLossTotal += p.mg; liqs++; cycles.liqCount = (cycles.liqCount || 0) + 1; toReplace.push({ px: Math.max(liqPx, o), mg: p.mg * rep }); changed = true; }
          else keep.push(p);
        }
        lots = keep;
        for (const r of toReplace) {
          if (open(r.px, r.mg, 'ganti')) lastE = Math.max(lastE, r.px); else replFail++;
        }
      }
      maxLots = Math.max(maxLots, lots.length); cycles.maxLotsCur = Math.max(cycles.maxLotsCur || 0, lots.length);
      // ukur kondisi terburuk pas high
      const eqHigh = wallet + floatAt(h);
      if (eqHigh > 0) maxMarginPct = Math.max(maxMarginPct, margins() / eqHigh);
      maxFloatLossPct = Math.max(maxFloatLossPct, -floatAt(h) / Math.max(1e-9, wallet));
      minEq = Math.min(minEq, eqHigh);
      if (peak > 0) maxDd = Math.max(maxDd, 1 - eqHigh / peak);
    }
    // 4) low: TP
    if (tpMode === 'lot') { if (lots.length) closeLotsAt(l, t, false); }
    else if (lots.length && l <= tpPrice()) closeAll(Math.min(o, tpPrice()), t, 'TP');
    if (h > ath) { ath = h; athT = t; }
    const eq = wallet + floatAt(c);
    if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak); minEq = Math.min(minEq, eq);
    const y = new Date(t).getUTCFullYear(); if (!yearEq.has(y)) yearEq.set(y, { first: eq, last: eq }); yearEq.get(y).last = eq;
    curve.push({ t, eq, c });
  }
  const end = D[i1 - 1];
  const eqEnd = wallet + floatAt(end.c);
  const years = (end.t - D[i0].t) / (365.25 * DAY);
  return {
    eqEnd, mult: eqEnd / startCap, cagr: Math.pow(Math.max(eqEnd, 1e-9) / startCap, 1 / years) - 1, maxDd, minEq,
    cycles, nTP: cycles.length, liqs, replFail, addFail, liqLossTotal, feesTotal, fundTotal, maxLots, maxMarginPct, maxFloatLossPct,
    openLots: lots.length, openPutIn: putIn, openFloat: floatAt(end.c), openRealized: realized, wallet, yearEq, curve,
  };
}

const idxOf = (D, date) => { const t = Date.parse(date); let i = D.findIndex((r) => r.t >= t); return i < 0 ? D.length - 1 : i; };
const f$ = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const day = (t) => new Date(t).toISOString().slice(0, 10);

function summary(label, r) {
  return `${label.padEnd(34)} akhir ${f$(r.eqEnd).padStart(8)} (x${r.mult.toFixed(2)}, ${pct(r.cagr)}/th) | DD ${pct(r.maxDd)} | terendah ${f$(r.minEq)} | TP ${r.nTP}x | liq ${r.liqs} | maks posisi ${r.maxLots} | margin maks ${pct(r.maxMarginPct)} ekuitas | gagal tambah ${r.addFail}/ganti ${r.replFail}`;
}

module.exports = { loadDaily, run, DEF };

if (require.main === module) {
  const D = loadDaily();
  const approxFrom = D.find((r) => r.approx);
  console.log(`DATA: ${day(D[0].t)} .. ${day(D[D.length - 1].t)} (${D.length} hari)${approxFrom ? `, hari ${day(approxFrom.t)}+ = TAMBALAN (high/low perkiraan)` : ''}`);
  const H20 = idxOf(D, '2020-05-11'), H24 = idxOf(D, '2024-04-20');

  console.log('\n=== 1) ATURAN OLAN, mulai halving 11 Mei 2020, modal $1.000 ===');
  const main = run(D, H20);
  console.log(summary('bet 1% saldo tiap awal siklus', main));
  const fixed = run(D, H20, { sizing: 'fixed' });
  console.log(summary('bet 1% modal awal ($10 tetap)', fixed));
  const fund = run(D, H20, { fundDay: 0.0003 });
  console.log(summary('+ funding 0,01%/8 jam (asumsi)', fund));
  console.log(`  fee total ${f$(main.feesTotal)}, rugi likuidasi total ${f$(main.liqLossTotal)}`);
  console.log(`  posisi masih kebuka di akhir data: ${main.openLots} lot, tanam ${f$(main.openPutIn)}, floating ${f$(main.openFloat)}, rugi liq siklus ini ${f$(main.openRealized)}`);
  console.log('  per tahun (ekuitas awal -> akhir tahun):');
  for (const [y, v] of main.yearEq) console.log(`    ${y}: ${f$(v.first)} -> ${f$(v.last)} (${pct(v.last / v.first - 1)})`);

  console.log('\n  daftar siklus (mulai -> tutup | hari | ditanam | hasil bersih | liq | maks posisi):');
  for (const c of main.cycles) console.log(`    ${day(c.start)} -> ${day(c.end)} | ${String(Math.round((c.end - c.start) / DAY)).padStart(4)} hr | ${f$(c.putIn).padStart(6)} | ${f$(c.net).padStart(5)} | ${c.liqs} | ${c.maxLots}`);

  console.log('\n=== 2) PER SIKLUS HALVING (modal $1.000 di awal tiap siklus) ===');
  console.log(summary('halving 2020 -> 2024', run(D, H20, {}, 1000, H24)));
  console.log(summary('halving 2024 -> sekarang', run(D, H24)));

  console.log('\n=== 3) TITIK MULAI BEDA-BEDA (tiap tanggal 1, Mei 2020 .. Sep 2026, jalan s/d sekarang) ===');
  const starts = [];
  for (let y = 2020; y <= 2026; y++) for (let m = 0; m < 12; m++) {
    const d = Date.UTC(y, m, 1); if (d < Date.parse('2020-05-01') || d > Date.parse('2026-09-01')) continue;
    const r = run(D, idxOf(D, new Date(d).toISOString()));
    starts.push({ d, r });
  }
  const ms = starts.map((s) => s.r.mult).sort((a, b) => a - b);
  const dds = starts.map((s) => s.r.maxDd).sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  console.log(`  ${starts.length} titik mulai | hasil: terburuk x${ms[0].toFixed(2)}, median x${q(ms, 0.5).toFixed(2)}, terbaik x${ms[ms.length - 1].toFixed(2)} | rugi ${starts.filter((s) => s.r.mult < 1).length}/${starts.length}`);
  console.log(`  DD: median ${pct(q(dds, 0.5))}, terburuk ${pct(dds[dds.length - 1])}`);
  const worst = [...starts].sort((a, b) => a.r.mult - b.r.mult).slice(0, 5);
  for (const s of worst) console.log(`    terburuk: mulai ${day(s.d)} -> x${s.r.mult.toFixed(2)}, DD ${pct(s.r.maxDd)}, liq ${s.r.liqs}`);

  console.log('\n=== 4) SENSITIVITAS (mulai halving 2020, 1 parameter diubah, sisanya aturan Olan) ===');
  const vary = [
    ['jarak DCA', 'step', [0.05, 0.10, 0.15, 0.20]],
    ['bet', 'bet', [0.005, 0.01, 0.02, 0.05]],
    ['TP dari tanam', 'tp', [0.05, 0.10, 0.20, 0.30]],
    ['ganti likuidasi', 'rep', [1.0, 1.25, 1.5, 2.0]],
    ['zona dari ATH', 'zone', [0.2, 0.3, 0.4, 0.5, null]],
  ];
  for (const [name, key, vals] of vary) for (const v of vals) {
    const lab = `${name} = ${v == null ? 'tanpa zona' : key === 'rep' ? `x${v}` : pct(v)}`;
    console.log(summary(lab, run(D, H20, { [key]: v })));
  }

  console.log('\n=== 6) VARIAN (mulai halving 2020 + stress 2016) ===');
  const variants = [
    ['aturan Olan (pembanding)', {}],
    ['ATH segar <= 365 hr', { athMaxAge: 365 }],
    ['ATH segar <= 180 hr', { athMaxAge: 180 }],
    ['TP per posisi 10%', { tpMode: 'lot' }],
    ['TP per posisi + ATH segar 365', { tpMode: 'lot', athMaxAge: 365 }],
  ];
  for (const [lab, v] of variants) {
    console.log(summary(lab, run(D, H20, v)));
    console.log(summary('   ..stress mulai 2016', run(D, idxOf(D, '2016-07-09'), v)));
    const rs = starts.map((s) => run(D, idxOf(D, new Date(s.d).toISOString()), v).mult).sort((a, b) => a - b);
    console.log(`   ..77 titik mulai: terburuk x${rs[0].toFixed(2)}, median x${q(rs, 0.5).toFixed(2)}, rugi ${rs.filter((x) => x < 1).length}/77`);
  }

  console.log('\n=== 5) STRESS DI LUAR PERIODE (BTC "belum dewasa") ===');
  console.log(summary('mulai halving 9 Jul 2016', run(D, idxOf(D, '2016-07-09'))));
  console.log(summary('mulai 1 Jan 2017 (sebelum bull 20x)', run(D, idxOf(D, '2017-01-01'))));
  console.log(summary('mulai awal data Sep 2014', run(D, 0)));
}
