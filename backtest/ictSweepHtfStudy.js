// ictSweepHtfStudy.js -- ICT AMD versi timeframe BESAR (3 Okt 2026, lanjutan ictPo3Study.js yang intraday-nya GAGAL).
// "Manipulasi" = candle nyapu low/high swing sebelumnya (likuiditas stop di bawah low / di atas high), lalu CLOSE balik ke
// dalam (reclaim) -> "distribusi" diharapkan ke arah sebaliknya (ICT turtle soup / sweep reversal).
// Diuji di 4 jam (wilayah Ranger) & harian (wilayah Sniper). 1 posisi sekaligus, entry close candle konfirmasi, SL di ujung
// sapuan, hasil dalam R bersih fee. Exit: trailing N x risiko (aturan trailing Olan), TP 2R/3R, atau tahan N candle.
// Jalankan: node backtest/ictSweepHtfStudy.js <btc-5m.json>

const fs = require('fs');
const FEE_RT = Number(process.env.FEE_RT || 0.1) / 100;

function aggregate(c5, minutes) {
  const out = []; const ms = minutes * 60000; let cur = null;
  for (const c of c5) {
    const b = Math.floor(c.openTime / ms) * ms;
    if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: +c.open, h: +c.high, l: +c.low, c: +c.close }; }
    else { cur.h = Math.max(cur.h, +c.high); cur.l = Math.min(cur.l, +c.low); cur.c = +c.close; }
  }
  if (cur) out.push(cur);
  return out;
}
function sma(arr, i, len) { if (i + 1 < len) return null; let s = 0; for (let k = i - len + 1; k <= i; k++) s += arr[k].c; return s / len; }

function run(cs, v) {
  const trades = []; let pos = null;
  for (let i = v.look + 1; i < cs.length; i++) {
    const x = cs[i];
    if (pos) {
      let exit = null;
      if (pos.dir > 0 ? x.l <= pos.stop : x.h >= pos.stop) exit = pos.stop;
      else if (pos.tp && (pos.dir > 0 ? x.h >= pos.tp : x.l <= pos.tp)) exit = pos.tp;
      else if (v.exit === 'hold' && i - pos.i >= v.holdBars) exit = x.c;
      if (exit === null && v.exit === 'trail') {
        pos.best = pos.dir > 0 ? Math.max(pos.best, x.h) : Math.min(pos.best, x.l);
        const cand = pos.best - pos.dir * v.trailR * pos.risk;
        if (pos.dir > 0 ? cand > pos.stop : cand < pos.stop) pos.stop = cand;
      }
      if (exit !== null) { trades.push({ t: pos.t, dir: pos.dir, r: ((exit - pos.entry) * pos.dir - FEE_RT * pos.entry) / pos.risk }); pos = null; }
      continue;
    }
    let swLo = Infinity, swHi = -Infinity;
    for (let k = i - v.look; k < i; k++) { swLo = Math.min(swLo, cs[k].l); swHi = Math.max(swHi, cs[k].h); }
    const m = sma(cs, i, v.trendLen);
    let dir = 0;
    if (x.l < swLo && x.c > swLo && (!v.bodyConfirm || x.c > x.o)) dir = 1;
    else if (x.h > swHi && x.c < swHi && (!v.bodyConfirm || x.c < x.o)) dir = -1;
    if (!dir) continue;
    if (v.longOnly && dir < 0) continue;
    if (v.trend && m !== null && (dir > 0 ? x.c < m : x.c > m)) continue;
    const entry = x.c, ext = dir > 0 ? x.l : x.h;
    const stop = ext * (1 - dir * 0.001), risk = Math.abs(entry - stop);
    if (risk / entry < 0.003 || risk / entry > v.maxRiskPct / 100) continue;
    const tp = v.exit === 'tp' ? entry + dir * v.tpR * risk : null;
    pos = { i, t: x.t, dir, entry, stop, risk, tp, best: entry };
  }
  return trades;
}
function pf(tr) { const gw = tr.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0), gl = -tr.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0); return gl ? gw / gl : (gw ? 99 : 0); }
function summ(tr) {
  const n = tr.length; if (!n) return 'n=0';
  let eq = 0, pk = 0, dd = 0; for (const t of tr) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return `n=${n} win=${(tr.filter((t) => t.r > 0).length / n * 100).toFixed(0)}% totR=${eq.toFixed(1)} PF=${pf(tr).toFixed(2)} ddR=${dd.toFixed(1)}`;
}

function main() {
  const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const SPLIT = Date.UTC(2023, 0, 1);
  const rows = [];
  for (const [tfName, tfMin, holdBars] of [['4H', 240, 12], ['1D', 1440, 5]]) {
    const cs = aggregate(c5, tfMin);
    for (const look of [5, 10, 20, 50]) {
      for (const trend of [false, true]) {
        for (const bodyConfirm of [false, true]) {
          for (const longOnly of [false, true]) {
            for (const [exit, extra] of [['trail', { trailR: 1 }], ['trail', { trailR: 2 }], ['trail', { trailR: 3 }], ['tp', { tpR: 2 }], ['tp', { tpR: 3 }], ['hold', {}]]) {
              const v = { look, trend, trendLen: tfName === '4H' ? 300 : 50, bodyConfirm, longOnly, exit, holdBars, maxRiskPct: tfName === '4H' ? 5 : 10, ...extra };
              const tr = run(cs, v);
              const a = tr.filter((t) => t.t < SPLIT), b = tr.filter((t) => t.t >= SPLIT);
              rows.push({ name: `${tfName} swing${look} ${trend ? 'tren' : 'tanpaTren'} ${bodyConfirm ? 'body' : 'wick'} ${longOnly ? 'LONG' : '2arah'} ${exit}${extra.trailR || extra.tpR || ''}`, a, b, all: tr });
            }
          }
        }
      }
    }
  }
  rows.sort((x, y) => Math.min(pf(y.a), pf(y.b)) - Math.min(pf(x.a), pf(x.b)));
  console.log(`fee RT ${(FEE_RT * 100).toFixed(2)}% | split 2019-10..2022 vs 2023..2026-09\n=== 30 terbaik (diurut PF TERBURUK dari 2 era) ===`);
  for (const r of rows.slice(0, 30)) console.log(`${r.name.padEnd(44)} | 2019-22 ${summ(r.a)} | 2023-26 ${summ(r.b)}`);
  const pass = rows.filter((r) => pf(r.a) > 1.2 && pf(r.b) > 1.2 && r.a.length >= 30 && r.b.length >= 30);
  console.log(`\nLolos (PF > 1,2 DUA era, n >= 30 tiap era): ${pass.length} dari ${rows.length}`);
  for (const r of pass.slice(0, 10)) {
    const by = {}; for (const t of r.all) { const y = new Date(t.t).getUTCFullYear(); (by[y] = by[y] || []).push(t); }
    console.log(`  ${r.name}: ` + Object.entries(by).map(([y, t]) => `${y} ${t.reduce((s, q) => s + q.r, 0).toFixed(1)}R`).join(' | '));
  }
}
if (require.main === module && !process.env.MODE) main();
if (require.main === module && process.env.MODE === "validate") setImmediate(() => validate());

// ---- VALIDASI (MODE=validate): robustness grid + pembanding entry ACAK (risk% & exit sama) ----
function runRandom(cs, v, template, rng) {
  // entry acak: tiap trade asli diganti entry di bar acak (era sama, lagi flat) dgn risiko % sama, exit sama
  const trades = [];
  for (const tt of template) {
    for (let tries = 0; tries < 50; tries++) {
      const i = v.look + 1 + Math.floor(rng() * (cs.length - v.look - 2));
      if ((cs[i].t < Date.UTC(2023, 0, 1)) !== (tt.t < Date.UTC(2023, 0, 1))) continue;
      const entry = cs[i].c, risk = entry * tt.riskPct / 100, dir = tt.dir;
      let stop = entry - dir * risk, best = entry, exit = null;
      for (let k = i + 1; k < cs.length && exit === null; k++) {
        const x = cs[k];
        if (dir > 0 ? x.l <= stop : x.h >= stop) { exit = stop; break; }
        if (v.exit === 'trail') { best = dir > 0 ? Math.max(best, x.h) : Math.min(best, x.l); const c = best - dir * v.trailR * risk; if (dir > 0 ? c > stop : c < stop) stop = c; }
      }
      if (exit === null) exit = cs[cs.length - 1].c;
      trades.push({ t: cs[i].t, dir, r: ((exit - entry) * dir - FEE_RT * entry) / risk });
      break;
    }
  }
  return trades;
}
function validate() {
  const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const cs = aggregate(c5, 240);
  const SPLIT = Date.UTC(2023, 0, 1);
  console.log('=== Grid robustness 4H LONG trailing (PF 2019-22 / 2023-26, n) ===');
  for (const trailR of [2, 3, 4]) for (const look of [10, 20, 30, 50, 80]) {
    const cells = [];
    for (const trend of [false, true]) for (const bodyConfirm of [false, true]) {
      const tr = run(cs, { look, trend, trendLen: 300, bodyConfirm, longOnly: true, exit: 'trail', trailR, maxRiskPct: 5 });
      const a = tr.filter((t) => t.t < SPLIT), b = tr.filter((t) => t.t >= SPLIT);
      cells.push(`${trend ? 'T' : '-'}${bodyConfirm ? 'B' : 'W'} ${pf(a).toFixed(2)}/${pf(b).toFixed(2)} n${a.length}/${b.length}`);
    }
    console.log(`trail${trailR} swing${String(look).padEnd(2)} | ${cells.join(' | ')}`);
  }
  // pembanding acak buat 3 kandidat
  let seed = 12345; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const v of [
    { name: '4H swing20 tren wick LONG trail3', look: 20, trend: true, trendLen: 300, bodyConfirm: false, longOnly: true, exit: 'trail', trailR: 3, maxRiskPct: 5 },
    { name: '4H swing50 tanpaTren body LONG trail3', look: 50, trend: false, trendLen: 300, bodyConfirm: true, longOnly: true, exit: 'trail', trailR: 3, maxRiskPct: 5 },
    { name: '4H swing20 tren wick 2arah trail3', look: 20, trend: true, trendLen: 300, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 3, maxRiskPct: 5 },
  ]) {
    // butuh riskPct per trade -> jalanin ulang run dgn pencatat risk
    const tr = runWithRisk(cs, v);
    const real = pf(tr);
    const sims = []; for (let s = 0; s < 300; s++) sims.push(pf(runRandom(cs, v, tr, rng)));
    sims.sort((a, b) => a - b);
    const p = sims.filter((x) => x >= real).length / sims.length;
    console.log(`\n${v.name}: PF asli ${real.toFixed(2)} (n=${tr.length}) | acak median ${sims[150].toFixed(2)}, p95 ${sims[285].toFixed(2)} | p-value ${p.toFixed(3)} ${p < 0.05 ? '-> pola NAMBAH edge (bukan cuma ikut tren naik BTC)' : '-> BELUM beda jelas dari entry acak'}`);
  }
}
function runWithRisk(cs, v) {
  // salinan run() yang nyimpen riskPct (biar pembanding acak pakai risiko SAMA)
  const trades = []; let pos = null;
  for (let i = v.look + 1; i < cs.length; i++) {
    const x = cs[i];
    if (pos) {
      let exit = null;
      if (pos.dir > 0 ? x.l <= pos.stop : x.h >= pos.stop) exit = pos.stop;
      if (exit === null) { pos.best = pos.dir > 0 ? Math.max(pos.best, x.h) : Math.min(pos.best, x.l); const c = pos.best - pos.dir * v.trailR * pos.risk; if (pos.dir > 0 ? c > pos.stop : c < pos.stop) pos.stop = c; }
      if (exit !== null) { trades.push({ t: pos.t, dir: pos.dir, riskPct: pos.risk / pos.entry * 100, r: ((exit - pos.entry) * pos.dir - FEE_RT * pos.entry) / pos.risk }); pos = null; }
      continue;
    }
    let swLo = Infinity, swHi = -Infinity;
    for (let k = i - v.look; k < i; k++) { swLo = Math.min(swLo, cs[k].l); swHi = Math.max(swHi, cs[k].h); }
    const m = sma(cs, i, v.trendLen);
    let dir = 0;
    if (x.l < swLo && x.c > swLo && (!v.bodyConfirm || x.c > x.o)) dir = 1;
    else if (x.h > swHi && x.c < swHi && (!v.bodyConfirm || x.c < x.o)) dir = -1;
    if (!dir || (v.longOnly && dir < 0)) continue;
    if (v.trend && m !== null && (dir > 0 ? x.c < m : x.c > m)) continue;
    const entry = x.c, stop = (dir > 0 ? x.l : x.h) * (1 - dir * 0.001), risk = Math.abs(entry - stop);
    if (risk / entry < 0.003 || risk / entry > v.maxRiskPct / 100) continue;
    pos = { i, t: x.t, dir, entry, stop, risk, best: entry };
  }
  return trades;
}
if (require.main === module && process.env.MODE === 'validate') { /* main() udah jalan di atas kalau MODE kosong */ }

// ---- MODE=validate1d: pembanding entry ACAK buat kandidat HARIAN (Sniper) ----
function validate1d() {
  const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const cs = aggregate(c5, 1440);
  let seed = 777; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const v of [
    { name: '1D swing5 tren wick 2arah trail1', look: 5, trend: true, trendLen: 50, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 1, maxRiskPct: 10 },
    { name: '1D swing5 tren wick 2arah trail2', look: 5, trend: true, trendLen: 50, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 2, maxRiskPct: 10 },
    { name: '1D swing10 tren wick 2arah trail1', look: 10, trend: true, trendLen: 50, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 1, maxRiskPct: 10 },
    { name: '1D swing5 tren wick 2arah trail3', look: 5, trend: true, trendLen: 50, bodyConfirm: false, longOnly: false, exit: 'trail', trailR: 3, maxRiskPct: 10 },
  ]) {
    const tr = runWithRisk(cs, v);
    const SPLIT = Date.UTC(2023, 0, 1);
    const a = tr.filter((t) => t.t < SPLIT), b = tr.filter((t) => t.t >= SPLIT);
    const sims = []; for (let s = 0; s < 300; s++) sims.push(pf(runRandom(cs, v, tr, rng)));
    sims.sort((x, y) => x - y);
    const real = pf(tr), p = sims.filter((x) => x >= real).length / sims.length;
    console.log(`${v.name}: PF ${real.toFixed(2)} (2019-22 ${pf(a).toFixed(2)} n${a.length} / 2023-26 ${pf(b).toFixed(2)} n${b.length}) | acak median ${sims[150].toFixed(2)} p95 ${sims[285].toFixed(2)} | p=${p.toFixed(3)}`);
  }
}
if (require.main === module && process.env.MODE === 'validate1d') setImmediate(() => validate1d());
