// ictPo3Study.js -- riset ICT "Power of 3" / AMD (Akumulasi-Manipulasi-Distribusi) di BTC (3 Okt 2026, permintaan Olan:
// "coba kamu belajar ict.. akumulasi, manipulasi, distribusi.. pelajari, belajar deteksi pola ini, backtest, terapkan ke
// tempat yang pantas, ninja/ranger/sniper").
//
// Versi mekanis yang paling umum (sumber: fxopen.com, chartwhisperer.ca, theinnercircletraders.com -- dirangkum):
//   AKUMULASI   = range sesi Asia (jam New York 20:00 kemarin s/d asiaEnd).
//   MANIPULASI  = "Judas swing": harga NYAPU low/high Asia di killzone (London 02-05 NY / NY AM 07-10).
//   DISTRIBUSI  = balik arah setelah sapuan -> masuk arah berlawanan sapuan, SL di ujung sapuan.
//   Konfirmasi  = 'reclaim' (candle close balik ke dalam range) atau 'choch' (close nembus high/low struktur sebelum sapuan).
//   Hasil diukur dalam R (kelipatan risiko) BERSIH fee -- ukuran posisi beda2 tiap trade, R yang adil.
// Jalankan: node backtest/ictPo3Study.js <btc-5m.json>   (format [{openTime,open,high,low,close}])

const fs = require('fs');
const FEE_RT = Number(process.env.FEE_RT || 0.1) / 100;

// ---- jam New York (EDT/EST otomatis) ----
function nthSundayUTC(y, m, n) { const d = new Date(Date.UTC(y, m, 1)); let c = 0; for (;;) { if (d.getUTCDay() === 0 && ++c === n) return d.getTime(); d.setUTCDate(d.getUTCDate() + 1); } }
const dstCache = {};
function nyOffsetH(ms) {
  const y = new Date(ms).getUTCFullYear();
  if (!dstCache[y]) dstCache[y] = [nthSundayUTC(y, 2, 2) + 7 * 3600e3, nthSundayUTC(y, 10, 1) + 6 * 3600e3];
  return ms >= dstCache[y][0] && ms < dstCache[y][1] ? 4 : 5;
}
function nyParts(ms) { const t = new Date(ms - nyOffsetH(ms) * 3600e3); return { day: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() }; }
const H = (h) => h * 60;

function loadCandles(file) {
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  return a.map((c) => ({ t: c.openTime, o: +c.open, h: +c.high, l: +c.low, c: +c.close, ...nyParts(c.openTime) }));
}

// kelompokin per "hari trading NY": candle jam >= 20:00 masuk hari BERIKUTNYA (Asia = awal hari)
function buildDays(cs) {
  const days = new Map();
  for (let i = 0; i < cs.length; i++) {
    const x = cs[i];
    let key = x.day;
    if (x.min >= H(20)) key = new Date(Date.parse(x.day) + 864e5).toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { key, idx: [] });
    days.get(key).idx.push(i);
  }
  return [...days.values()];
}
// jam relatif hari trading: 20:00 kemarin = -240 menit, 00:00 = 0
const rel = (x) => (x.min >= H(20) ? x.min - H(24) : x.min);

// SMA close harian (pakai close jam 16:00 NY) buat filter bias
function dailyBias(cs, days, len) {
  const closes = [], bias = new Map();
  for (const d of days) {
    bias.set(d.key, closes.length >= len ? { sma: closes.slice(-len).reduce((a, b) => a + b, 0) / len, last: closes[closes.length - 1] } : null);
    const last = d.idx.filter((i) => rel(cs[i]) < H(16)).pop();
    if (last !== undefined) closes.push(cs[last].c);
  }
  return bias;
}

function runVariant(cs, days, bias, v) {
  const trades = [];
  for (const d of days) {
    const ix = d.idx;
    const asia = ix.filter((i) => rel(cs[i]) >= -H(4) && rel(cs[i]) < v.asiaEnd);
    if (asia.length < 30) continue;
    const aHi = Math.max(...asia.map((i) => cs[i].h)), aLo = Math.min(...asia.map((i) => cs[i].l));
    const mid = ix.find((i) => rel(cs[i]) === 0);
    const midOpen = mid !== undefined ? cs[mid].o : cs[asia[asia.length - 1]].c;
    const widthPct = (aHi - aLo) / aLo * 100;
    if (widthPct < v.minW || widthPct > v.maxW) continue;
    const b = bias.get(d.key);
    let swept = { lo: null, hi: null }, ext = { lo: Infinity, hi: -Infinity }, pre = { lo: null, hi: null };
    let trade = null;
    const win = ix.filter((i) => rel(cs[i]) >= v.winStart && rel(cs[i]) < v.winEnd);
    for (const i of win) {
      const x = cs[i];
      // catat sapuan
      if (x.l < aLo) { if (swept.lo === null) { swept.lo = i; pre.lo = Math.max(...ix.filter((k) => k < i).slice(-v.chochLook).map((k) => cs[k].h)); } ext.lo = Math.min(ext.lo, x.l); }
      if (x.h > aHi) { if (swept.hi === null) { swept.hi = i; pre.hi = Math.min(...ix.filter((k) => k < i).slice(-v.chochLook).map((k) => cs[k].l)); } ext.hi = Math.max(ext.hi, x.h); }
      for (const side of ['lo', 'hi']) {
        if (swept[side] === null || i === swept[side]) continue;
        const dir = side === 'lo' ? 1 : -1;
        const depthPct = side === 'lo' ? (aLo - ext.lo) / aLo * 100 : (ext.hi - aHi) / aHi * 100;
        if (depthPct > v.maxSweepPct) continue;
        const conf = v.conf === 'reclaim' ? (dir > 0 ? x.c > aLo : x.c < aHi) : (dir > 0 ? x.c > pre.lo : x.c < pre.hi);
        if (!conf) continue;
        if (v.bias === 'sma' && b && (dir > 0 ? b.last < b.sma : b.last > b.sma)) continue;
        if (v.bias === 'midopen' && (dir > 0 ? x.c > midOpen : x.c < midOpen)) continue; // beli di bawah open tengah malam (discount)
        if (v.longOnly && dir < 0) continue;
        const entry = x.c, sl = dir > 0 ? ext.lo * (1 - 0.0005) : ext.hi * (1 + 0.0005), risk = Math.abs(entry - sl);
        if (risk / entry < 0.001) continue; // SL kedeketan (< 0,1%) -- fee makan semua
        let tp = null;
        if (v.exit === 'range') { tp = dir > 0 ? aHi : aLo; if ((tp - entry) * dir < risk) continue; }
        if (v.exit === 'r2') tp = entry + dir * 2 * risk;
        trade = { i, dir, entry, sl, risk, tp, best: entry, day: d.key };
        break;
      }
      if (trade) break;
    }
    if (!trade) continue;
    // kelola sampai jam tutup (NY 16:00, atau kalau trailing: sampai v.holdEnd)
    let exit = null, stop = trade.sl;
    const after = ix.filter((k) => k > trade.i);
    const endRel = v.holdEnd;
    for (const k of after) {
      const x = cs[k];
      if (rel(x) >= endRel) { exit = x.o; break; }
      if (trade.dir > 0 ? x.l <= stop : x.h >= stop) { exit = stop; break; }
      if (trade.tp !== null && (trade.dir > 0 ? x.h >= trade.tp : x.l <= trade.tp)) { exit = trade.tp; break; }
      if (v.exit === 'trail') {
        trade.best = trade.dir > 0 ? Math.max(trade.best, x.h) : Math.min(trade.best, x.l);
        const cand = trade.best - trade.dir * v.trailR * trade.risk;
        if (trade.dir > 0 ? cand > stop : cand < stop) stop = cand;
      }
    }
    if (exit === null) exit = cs[after.length ? after[after.length - 1] : trade.i].c;
    const r = ((exit - trade.entry) * trade.dir - FEE_RT * trade.entry) / trade.risk;
    trades.push({ day: d.key, dir: trade.dir, r, riskPct: trade.risk / trade.entry * 100 });
  }
  return trades;
}

function summ(tr) {
  const n = tr.length; if (!n) return 'n=0';
  const w = tr.filter((t) => t.r > 0), gw = w.reduce((a, t) => a + t.r, 0), gl = -tr.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0);
  let eq = 0, pk = 0, dd = 0; for (const t of tr) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return `n=${n} win=${(w.length / n * 100).toFixed(0)}% totR=${(gw - gl).toFixed(1)} PF=${gl ? (gw / gl).toFixed(2) : 'inf'} ddR=${dd.toFixed(1)}`;
}

function main() {
  const file = process.argv[2];
  if (!file) { console.log('Pakai: node backtest/ictPo3Study.js <btc-5m.json>'); return; }
  const cs = loadCandles(file);
  const days = buildDays(cs);
  const bias = dailyBias(cs, days, 20);
  console.log(`Candle 5m: ${cs.length} (${new Date(cs[0].t).toISOString().slice(0, 10)} .. ${new Date(cs[cs.length - 1].t).toISOString().slice(0, 10)}), hari: ${days.length}, fee RT ${(FEE_RT * 100).toFixed(2)}%`);
  const base = { asiaEnd: 0, winStart: H(2), winEnd: H(5), minW: 0, maxW: 99, maxSweepPct: 99, conf: 'reclaim', chochLook: 6, exit: 'range', trailR: 1, holdEnd: H(16), bias: 'none', longOnly: false };
  const variants = [];
  for (const [wName, ws, we] of [['London 02-05', H(2), H(5)], ['NY AM 07-10', H(7), H(10)], ['London+NY 02-11', H(2), H(11)]]) {
    for (const asiaEnd of [0, H(2)]) {
      if (asiaEnd > ws) continue;
      for (const conf of ['reclaim', 'choch']) {
        for (const exit of ['range', 'r2', 'trail', 'time']) {
          for (const b of ['none', 'sma', 'midopen']) {
            variants.push({ ...base, name: `${wName} | Asia s/d ${asiaEnd / 60}:00 | ${conf} | exit ${exit} | bias ${b}`, asiaEnd, winStart: ws, winEnd: we, conf, exit, bias: b, trailR: 1.5 });
          }
        }
      }
    }
  }
  const rows = [];
  for (const v of variants) {
    const tr = runVariant(cs, days, bias, v);
    const is = tr.filter((t) => t.day < '2023-01-01'), oos = tr.filter((t) => t.day >= '2023-01-01');
    const pf = (x) => { const gw = x.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0), gl = -x.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0); return gl ? gw / gl : 0; };
    rows.push({ v, is, oos, pfIs: pf(is), pfOos: pf(oos), tr });
  }
  rows.sort((a, b) => Math.min(b.pfIs, b.pfOos) - Math.min(a.pfIs, a.pfOos));
  console.log('\n=== 25 varian terbaik (diurut PF TERBURUK dari 2 era -- harus bagus di DUA-DUANYA) ===');
  for (const r of rows.slice(0, 25)) console.log(`${r.v.name.padEnd(72)} | 2019-22 ${summ(r.is)} | 2023-26 ${summ(r.oos)}`);
  const pass = rows.filter((r) => r.pfIs > 1.1 && r.pfOos > 1.1 && r.is.length >= 100 && r.oos.length >= 100);
  console.log(`\nLolos (PF > 1,1 di DUA era, n >= 100 tiap era): ${pass.length} dari ${rows.length} varian`);
  const best = rows[0];
  if (best) {
    const byYear = {};
    for (const t of best.tr) { const y = t.day.slice(0, 4); (byYear[y] = byYear[y] || []).push(t); }
    console.log(`\nPer tahun varian teratas (${best.v.name}):`);
    for (const [y, tr] of Object.entries(byYear)) console.log(`  ${y}: ${summ(tr)}`);
    const L = best.tr.filter((t) => t.dir > 0), S = best.tr.filter((t) => t.dir < 0);
    console.log(`  LONG ${summ(L)} | SHORT ${summ(S)} | risiko rata2 ${(best.tr.reduce((a, t) => a + t.riskPct, 0) / best.tr.length).toFixed(2)}%`);
  }
}

if (require.main === module) main();
module.exports = { runVariant, buildDays, loadCandles, dailyBias, nyParts };
