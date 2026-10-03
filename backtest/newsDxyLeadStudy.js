// newsDxyLeadStudy.js -- riset "copet news pakai DXY per detik" (3 Okt 2026, ide Olan: "pas jadwal jalan, detektor dxy
// kerja cepat.. deteksi perdetik saat news.. dxy ngaceng btc short dan sebaliknya.. satset copet sekali, trailing +
// invalidasi pendek, habis dapet tinggalin").
//
// Data: Binance 1 DETIK -- EURUSDT (proksi DXY TERBALIK: EUR = 57,6% bobot DXY; EUR naik = dolar lemah) + BTCUSDT.
// Event: CPI, PPI, NFP (08:30 ET) + FOMC (14:00 ET) dari fedEvents.js, 2023-2026. PCE belum ada daftar tanggalnya (dilewati).
// Sinyal: gerak EURUSDT dari T-1 detik ke T+N detik >= ambang -> EUR naik = BTC LONG, EUR turun = BTC SHORT.
// Entry: close BTC detik T+N+LAT (latensi eksekusi), fee+selip RT default 0,12%. Exit: SL pendek / trailing / batas waktu.
// Pembanding: "ikut BTC sendiri" (arah BTC T-1..T+N) -- buat tau apakah DXY beneran ngasih info TAMBAHAN.
// Jalankan: node backtest/newsDxyLeadStudy.js   (cache data di backtest/.cache-news-1s/)

const fs = require('fs');
const path = require('path');
const { generateCpiEvents, generatePpiEvents, generateNfpEvents, generateFomcEvents } = require('../fedEvents');

const CACHE_DIR = path.join(__dirname, '.cache-news-1s');
const FEE_RT = Number(process.env.FEE_RT || 0.12) / 100;
const LAT = Number(process.env.LAT || 2); // detik
const START = Date.UTC(2023, 0, 1);
const PRE = 60, POST = 1800; // detik

async function fetch1s(symbol, startMs, endMs) {
  const out = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1s&startTime=${cur}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${symbol} ${res.status}`);
    const raw = await res.json();
    if (!raw.length) break;
    for (const r of raw) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
    cur = raw[raw.length - 1][0] + 1000;
    if (raw.length < 1000) break;
  }
  return out;
}
async function load(symbol, ev) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const f = path.join(CACHE_DIR, `${symbol}-${ev.timeMs}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = await fetch1s(symbol, ev.timeMs - PRE * 1000, ev.timeMs + POST * 1000);
  fs.writeFileSync(f, JSON.stringify(d));
  return d;
}
// harga close per detik (forward-fill kalau detik itu gak ada trade)
function series(rows, t0) {
  const n = PRE + POST, arr = new Array(n).fill(null);
  for (const r of rows) { const k = Math.round((r.t - t0) / 1000); if (k >= 0 && k < n) arr[k] = r; }
  let last = null;
  for (let k = 0; k < n; k++) { if (arr[k]) last = arr[k]; else if (last) arr[k] = { t: t0 + k * 1000, o: last.c, h: last.c, l: last.c, c: last.c }; }
  return arr;
}

function simulate(btc, k0, dir, x) {
  if (!btc[k0]) return null;
  const entry = btc[k0].c;
  let stop = entry * (1 - dir * x.sl / 100), best = entry;
  const end = Math.min(btc.length - 1, k0 + x.maxSec);
  for (let k = k0 + 1; k <= end; k++) {
    const b = btc[k]; if (!b) continue;
    const adv = dir > 0 ? b.l : b.h;
    if (dir > 0 ? adv <= stop : adv >= stop) return dir * (stop - entry) / entry - FEE_RT;
    best = dir > 0 ? Math.max(best, b.h) : Math.min(best, b.l);
    if (x.trail && dir * (best - entry) / entry * 100 >= x.act) {
      const cand = best * (1 - dir * x.trail / 100);
      if (dir > 0 ? cand > stop : cand < stop) stop = cand;
    }
  }
  return dir * (btc[end].c - entry) / entry - FEE_RT;
}

function stats(rs) {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r > 0), gw = w.reduce((a, b) => a + b, 0), gl = -rs.filter((r) => r <= 0).reduce((a, b) => a + b, 0);
  return `n=${n} win=${(w.length / n * 100).toFixed(0)}% avg=${(rs.reduce((a, b) => a + b, 0) / n * 100).toFixed(3)}% PF=${gl > 0 ? (gw / gl).toFixed(2) : 'inf'}`;
}

async function main() {
  const events = [
    ...generateCpiEvents(false).map((e) => ({ ...e, type: 'CPI' })),
    ...generatePpiEvents(false).map((e) => ({ ...e, type: 'PPI' })),
    ...generateNfpEvents(2023, 2026, false).map((e) => ({ ...e, type: 'NFP' })),
    ...generateFomcEvents(false).map((e) => ({ ...e, type: 'FOMC' })),
  ].filter((e) => e.timeMs >= START && e.timeMs < Date.now() - 3600e3).sort((a, b) => a.timeMs - b.timeMs);
  console.log(`Event: ${events.length} (CPI/PPI/NFP/FOMC ${START ? '2023+' : ''}) | fee+selip RT ${(FEE_RT * 100).toFixed(2)}% | latensi ${LAT}s`);

  const data = [];
  for (const ev of events) {
    try {
      const t0 = ev.timeMs - PRE * 1000;
      const [eur, btc] = await Promise.all([load('EURUSDT', ev), load('BTCUSDT', ev)]);
      const E = series(eur, t0), B = series(btc, t0);
      if (!E[PRE - 1] || !B[PRE - 1]) { console.log('  data kosong', ev.label); continue; }
      data.push({ ev, E, B });
    } catch (e) { console.log('  gagal', ev.label, e.message); }
  }
  console.log(`Data lengkap: ${data.length} event\n`);

  // 1) korelasi arah: EUR T-1..T+N vs BTC T+N..T+N+H
  console.log('=== Arah EUR (dolar terbalik) di N detik pertama vs arah BTC SESUDAHNYA ===');
  for (const N of [5, 10, 30, 60]) {
    for (const H of [60, 300, 900]) {
      let agree = 0, tot = 0;
      for (const { E, B } of data) {
        const e0 = E[PRE - 1].c, eN = E[PRE + N].c; const re = (eN - e0) / e0;
        if (Math.abs(re) < 0.0002) continue; // EUR gerak < 0,02% = gak ada reaksi jelas
        const b0 = B[PRE + N + LAT].c, bH = B[Math.min(B.length - 1, PRE + N + LAT + H)].c;
        tot++; if (Math.sign(bH - b0) === Math.sign(re)) agree++;
      }
      console.log(`  N=${String(N).padStart(2)}s H=${String(H).padStart(3)}s: BTC searah EUR (= lawan dolar) ${tot ? (agree / tot * 100).toFixed(0) : '-'}% dari ${tot} event`);
    }
  }

  // 2) simulasi trade
  const exits = [
    { name: 'SL 0,3% trail 0,2% aktif +0,3% maks 15m', sl: 0.3, trail: 0.2, act: 0.3, maxSec: 900 },
    { name: 'SL 0,5% trail 0,3% aktif +0,5% maks 30m', sl: 0.5, trail: 0.3, act: 0.5, maxSec: 1800 },
    { name: 'SL 0,5% trail 0,5% aktif +0,5% maks 30m', sl: 0.5, trail: 0.5, act: 0.5, maxSec: 1800 },
    { name: 'SL 0,8% trail 0,4% aktif +0,6% maks 30m', sl: 0.8, trail: 0.4, act: 0.6, maxSec: 1800 },
    { name: 'SL 0,5% tanpa trail, tutup 5m', sl: 0.5, maxSec: 300 },
    { name: 'SL 0,5% tanpa trail, tutup 15m', sl: 0.5, maxSec: 900 },
  ];
  for (const N of [5, 10, 30]) {
    for (const thr of [0.0003, 0.0006, 0.001]) {
      console.log(`\n=== Sinyal: EUR gerak >= ${(thr * 100).toFixed(2)}% dalam ${N} detik ===`);
      for (const x of exits) {
        const dxy = [], own = [], byType = {};
        for (const { ev, E, B } of data) {
          const e0 = E[PRE - 1].c, re = (E[PRE + N].c - e0) / e0;
          if (Math.abs(re) < thr) continue;
          const k0 = PRE + N + LAT;
          const r = simulate(B, k0, Math.sign(re), x);
          if (r === null) continue;
          dxy.push(r); (byType[ev.type] = byType[ev.type] || []).push(r);
          const rb = B[PRE + N].c - B[PRE - 1].c;
          if (rb !== 0) { const r2 = simulate(B, k0, Math.sign(rb), x); if (r2 !== null) own.push(r2); }
        }
        const half = Math.floor(dxy.length / 2);
        console.log(`  ${x.name.padEnd(40)} | DXY-led ${stats(dxy)} | paruh1 ${stats(dxy.slice(0, half))} | paruh2 ${stats(dxy.slice(half))} | ikut-BTC ${stats(own)} | ${Object.entries(byType).map(([k, v]) => `${k} ${stats(v)}`).join(' ; ')}`);
      }
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
