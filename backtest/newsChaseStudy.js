// newsChaseStudy.js (16 Okt 2026, Olan: "kalo ninja news zonk terus ga perbaikan?") -- uji perbaikan Ninja News pakai data 1 DETIK
// yang sama dengan newsDxyLeadStudy.js (cache backtest/.cache-news-1s, CPI/PPI/NFP/FOMC 2023-2026). Yang diuji:
//   (a) maxChase: live skip kalau BTC udah lari >= 0,5% ke arah sinyal pas mau entry (CPI 14 Okt ke-skip 0,58%) -> 0,3/0,5/0,75/1/tanpa batas
//   (b) ambang EUR & jendela (N detik), (c) exit. Fee+selip RT 0,12%, latensi 2 dtk (sama riset awal & paritas live).
// Jalanin: node backtest/newsChaseStudy.js
const fs = require('fs');
const path = require('path');
const { generateCpiEvents, generatePpiEvents, generateNfpEvents, generateFomcEvents } = require('../fedEvents');
const CACHE = path.join(__dirname, '.cache-news-1s');
const FEE_RT = 0.0012, LAT = 2, PRE = 60, POST = 1800;

async function load(sym, ev) {
  const f = path.join(CACHE, `${sym}-${ev.timeMs}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = []; let cur = ev.timeMs - PRE * 1000; const end = ev.timeMs + POST * 1000;
  while (cur < end) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1s&startTime=${cur}&endTime=${end}&limit=1000`);
    if (!r.ok) throw new Error(`${sym} ${r.status}`);
    const raw = await r.json(); if (!raw.length) break;
    for (const k of raw) out.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    cur = raw[raw.length - 1][0] + 1000;
  }
  fs.writeFileSync(f, JSON.stringify(out)); return out;
}
function series(rows, t0) {
  const n = PRE + POST, arr = new Array(n).fill(null);
  for (const r of rows) { const k = Math.round((r.t - t0) / 1000); if (k >= 0 && k < n) arr[k] = r; }
  let last = null; for (let k = 0; k < n; k++) { if (arr[k]) last = arr[k]; else if (last) arr[k] = { c: last.c, h: last.c, l: last.c }; }
  return arr;
}
function simulate(B, k0, dir, x) {
  if (!B[k0]) return null;
  const entry = B[k0].c; let stop = entry * (1 - dir * x.sl / 100), best = entry;
  const end = Math.min(B.length - 1, k0 + x.maxSec);
  for (let k = k0 + 1; k <= end; k++) {
    const b = B[k]; if (!b) continue;
    if (dir > 0 ? b.l <= stop : b.h >= stop) return dir * (stop - entry) / entry - FEE_RT;
    best = dir > 0 ? Math.max(best, b.h) : Math.min(best, b.l);
    if (x.trail && dir * (best - entry) / entry * 100 >= x.act) { const c = best * (1 - dir * x.trail / 100); if (dir > 0 ? c > stop : c < stop) stop = c; }
  }
  return dir * (B[end].c - entry) / entry - FEE_RT;
}
const pf = (rs) => { const gw = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0), gl = -rs.filter((r) => r <= 0).reduce((a, b) => a + b, 0); return gl > 0 ? gw / gl : (gw > 0 ? 99 : 0); };
const st = (rs) => (rs.length ? `n=${String(rs.length).padStart(3)} win=${(rs.filter((r) => r > 0).length / rs.length * 100).toFixed(0).padStart(3)}% tot=${(rs.reduce((a, b) => a + b, 0) * 100).toFixed(1).padStart(6)}% PF=${pf(rs).toFixed(2)}` : 'n=  0');

(async () => {
  const events = [
    ...generateCpiEvents(false).map((e) => ({ ...e, type: 'CPI' })), ...generatePpiEvents(false).map((e) => ({ ...e, type: 'PPI' })),
    ...generateNfpEvents(2023, 2026, false).map((e) => ({ ...e, type: 'NFP' })), ...generateFomcEvents(false).map((e) => ({ ...e, type: 'FOMC' })),
  ].filter((e) => e.timeMs >= Date.UTC(2023, 0, 1) && e.timeMs < Date.now() - 3600e3).sort((a, b) => a.timeMs - b.timeMs);
  const data = [];
  for (const ev of events) { try { const t0 = ev.timeMs - PRE * 1000; const [e, b] = await Promise.all([load('EURUSDT', ev), load('BTCUSDT', ev)]); const E = series(e, t0), B = series(b, t0); if (E[PRE - 1] && B[PRE - 1]) data.push({ ev, E, B }); } catch (err) { /* skip */ } }
  const years = (data[data.length - 1].ev.timeMs - data[0].ev.timeMs) / (365.25 * 864e5);
  console.log(`Event lengkap: ${data.length} (${new Date(data[0].ev.timeMs).toISOString().slice(0, 10)} .. ${new Date(data[data.length - 1].ev.timeMs).toISOString().slice(0, 10)}, ${years.toFixed(1)} th) | fee RT 0,12% | latensi ${LAT}s\n`);
  const EXITS = { live: { sl: 0.8, trail: 0.4, act: 0.6, maxSec: 1800 }, ketat: { sl: 0.5, trail: 0.3, act: 0.5, maxSec: 1800 }, lebar: { sl: 1.2, trail: 0.6, act: 0.8, maxSec: 1800 } };
  const run = ({ N, thr, chase, exit }) => {
    const rs = [], half = [];
    for (const { E, B } of data) {
      const re = (E[PRE + N].c - E[PRE - 1].c) / E[PRE - 1].c; if (Math.abs(re) < thr) continue;
      const dir = Math.sign(re), k0 = PRE + N + LAT;
      const ran = dir * (B[k0].c - B[PRE - 1].c) / B[PRE - 1].c * 100;
      if (chase != null && ran >= chase) continue;
      const r = simulate(B, k0, dir, EXITS[exit]); if (r !== null) rs.push(r);
    }
    return rs;
  };
  console.log('=== (a) BATAS NGEJAR (setting live: EUR >= 0,10% dalam 10 dtk, exit SL 0,8 trail 0,4) ===');
  for (const chase of [0.3, 0.5, 0.75, 1.0, null]) { const rs = run({ N: 10, thr: 0.001, chase, exit: 'live' }); const h = Math.floor(rs.length / 2); console.log(`  maxChase ${chase == null ? 'tanpa batas' : chase + '%'}`.padEnd(26), st(rs), `| ${(rs.length / years).toFixed(1)} trade/th | paruh1 PF ${pf(rs.slice(0, h)).toFixed(2)} paruh2 PF ${pf(rs.slice(h)).toFixed(2)}`); }
  console.log('\n=== (b) AMBANG & JENDELA (maxChase 0,5%, exit live) ===');
  for (const N of [5, 10, 15]) for (const thr of [0.0006, 0.0008, 0.001, 0.0015]) { const rs = run({ N, thr, chase: 0.5, exit: 'live' }); const h = Math.floor(rs.length / 2); console.log(`  EUR >= ${(thr * 100).toFixed(2)}% dalam ${N} dtk`.padEnd(26), st(rs), `| ${(rs.length / years).toFixed(1)} trade/th | paruh1 PF ${pf(rs.slice(0, h)).toFixed(2)} paruh2 PF ${pf(rs.slice(h)).toFixed(2)}`); }
  console.log('\n=== (c) EXIT (EUR >= 0,10%/10 dtk, maxChase 0,5% vs 1%) ===');
  for (const exit of Object.keys(EXITS)) for (const chase of [0.5, 1.0]) { const rs = run({ N: 10, thr: 0.001, chase, exit }); console.log(`  exit ${exit} chase ${chase}%`.padEnd(26), st(rs)); }
  console.log('\n=== Seberapa sering rilis "zonk" (gak ada sinyal) di setting live ===');
  const sig = data.filter(({ E }) => Math.abs((E[PRE + 10].c - E[PRE - 1].c) / E[PRE - 1].c) >= 0.001).length;
  console.log(`  ${sig}/${data.length} rilis ada sinyal (${(sig / data.length * 100).toFixed(0)}%), sisanya zonk -- WAJAR (edge cuma ada di gerak dolar gede+cepat)`);
})().catch((e) => { console.error(e); process.exit(1); });
