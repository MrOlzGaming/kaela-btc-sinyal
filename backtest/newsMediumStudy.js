// newsMediumStudy.js -- riset: event MEDIUM (Jobless Claims mingguan, ISM Manufaktur, ISM Jasa) layak masuk jadwal uji
// Ninja News atau nggak? (5 Okt 2026, arahan Olan: "kalo malam ini impact lumayan, kita bisa masukkan medium yang lain").
// ISM Jasa 5 Okt live: dolar cuma gerak 0,018% dalam 1 menit -> gak entry. Satu sampel gak cukup -> cek 2023-2026.
//
// Aturan PERSIS detektor live (ninjaNewsTrader.js + ninja-news-config.json): tiap detik 1..WINDOW setelah rilis, kalau
// |EURUSDT - patokan| >= THR -> BTC arah kebalikan dolar (EUR naik = LONG); skip kalau BTC udah lari >= 0,5% searah.
// Entry close BTC detik sinyal + LAT, SL 0,8% + trailing 0,4% aktif +0,6%, maks 30 menit, biaya pulang-pergi 0,12%.
// Data: Binance 1 detik (cache bareng newsDxyLeadStudy.js di backtest/.cache-news-1s/).
//
// ⚠️ Tanggal event DIHITUNG dari aturan kalender (bukan daftar resmi): Claims = tiap Kamis 08:30 ET (Kamis libur -> Rabu),
// ISM Manufaktur = hari kerja ke-1, ISM Jasa = hari kerja ke-3 (10:00 ET), libur federal awal bulan dihitung (1 Jan, 4 Jul,
// Labor Day). Kamis yang barengan CPI/PPI/NFP DIBUANG dari Claims (reaksinya punya event besar, bukan Claims).
// Jalankan: node backtest/newsMediumStudy.js

const fs = require('fs');
const path = require('path');
const { isEDT, generateCpiEvents, generatePpiEvents, generateNfpEvents } = require('../fedEvents');

const CACHE_DIR = path.join(__dirname, '.cache-news-1s');
const FEE_RT = 0.0012, LAT = 2, PRE = 60, POST = 1800;
const START = Date.UTC(2023, 0, 1);
const LIVE = { window: 10, thr: 0.001, chase: 0.005, sl: 0.8, trail: 0.4, act: 0.6, maxSec: 1800 };

// ---------- kalender ----------
const etToUtcMs = (y, m, d, hh, mm) => Date.UTC(y, m, d, hh + (isEDT(Date.UTC(y, m, d, 12)) ? 4 : 5), mm);
function nthWeekday(y, m, weekday, n) { const d = new Date(Date.UTC(y, m, 1)); while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 7 * (n - 1)); return d.getUTCDate(); }
function isHoliday(y, m, d) {
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
  if (m === 0 && (d === 1 || (d === 2 && dow === 1))) return true;           // Tahun Baru (+ pengganti Senin)
  if (m === 6 && (d === 4 || (d === 5 && dow === 1) || (d === 3 && dow === 5))) return true; // 4 Juli (+ pengganti)
  if (m === 8 && d === nthWeekday(y, 8, 1, 1)) return true;                   // Labor Day
  if (m === 10 && d === nthWeekday(y, 10, 4, 4)) return true;                 // Thanksgiving
  if (m === 11 && (d === 25 || (d === 26 && dow === 1) || (d === 24 && dow === 5))) return true; // Natal
  return false;
}
const isBizDay = (y, m, d) => { const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); return dow !== 0 && dow !== 6 && !isHoliday(y, m, d); };
function nthBizDay(y, m, n) { let c = 0; for (let d = 1; d <= 10; d++) if (isBizDay(y, m, d) && ++c === n) return d; return null; }

function mediumEvents() {
  const big = new Set([...generateCpiEvents(false), ...generatePpiEvents(false), ...generateNfpEvents(2023, 2026, false)]
    .map((e) => new Date(e.timeMs).toISOString().slice(0, 10)));
  const out = [];
  const now = Date.now() - 3600e3;
  for (let y = 2023; y <= 2026; y++) for (let m = 0; m < 12; m++) {
    const d1 = nthBizDay(y, m, 1), d3 = nthBizDay(y, m, 3);
    if (d1) out.push({ type: 'ISM Manufaktur', label: `ISM-M ${y}-${m + 1}-${d1}`, timeMs: etToUtcMs(y, m, d1, 10, 0) });
    if (d3) out.push({ type: 'ISM Jasa', label: `ISM-S ${y}-${m + 1}-${d3}`, timeMs: etToUtcMs(y, m, d3, 10, 0) });
  }
  for (let t = Date.UTC(2023, 0, 5); t < now; t += 7 * 864e5) { // 5 Jan 2023 = Kamis
    const dt = new Date(t); let y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
    if (isHoliday(y, m, d)) { const w = new Date(t - 864e5); y = w.getUTCFullYear(); m = w.getUTCMonth(); d = w.getUTCDate(); }
    const day = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (big.has(day)) continue; // barengan CPI/PPI/NFP -> bukan murni Claims
    out.push({ type: 'Jobless Claims', label: `Claims ${day}`, timeMs: etToUtcMs(y, m, d, 8, 30) });
  }
  return out.filter((e) => e.timeMs >= START && e.timeMs < now).sort((a, b) => a.timeMs - b.timeMs);
}

// ---------- data (sama persis newsDxyLeadStudy.js) ----------
async function fetch1s(symbol, startMs, endMs) {
  const out = []; let cur = startMs;
  while (cur < endMs) {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1s&startTime=${cur}&endTime=${endMs}&limit=1000`);
    if (!res.ok) throw new Error(`${symbol} ${res.status}`);
    const raw = await res.json(); if (!raw.length) break;
    for (const r of raw) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
    cur = raw[raw.length - 1][0] + 1000; if (raw.length < 1000) break;
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
function series(rows, t0) {
  const n = PRE + POST, arr = new Array(n).fill(null);
  for (const r of rows) { const k = Math.round((r.t - t0) / 1000); if (k >= 0 && k < n) arr[k] = r; }
  let last = null;
  for (let k = 0; k < n; k++) { if (arr[k]) last = arr[k]; else if (last) arr[k] = { t: t0 + k * 1000, o: last.c, h: last.c, l: last.c, c: last.c }; }
  return arr;
}
function simulate(btc, k0, dir, x) {
  if (!btc[k0]) return null;
  const entry = btc[k0].c; let stop = entry * (1 - dir * x.sl / 100), best = entry;
  const end = Math.min(btc.length - 1, k0 + x.maxSec);
  for (let k = k0 + 1; k <= end; k++) {
    const b = btc[k]; if (!b) continue;
    if (dir > 0 ? b.l <= stop : b.h >= stop) return dir * (stop - entry) / entry - FEE_RT;
    best = dir > 0 ? Math.max(best, b.h) : Math.min(best, b.l);
    if (dir * (best - entry) / entry * 100 >= x.act) { const c = best * (1 - dir * x.trail / 100); if (dir > 0 ? c > stop : c < stop) stop = c; }
  }
  return dir * (btc[end].c - entry) / entry - FEE_RT;
}
const pf = (rs) => { const w = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0), l = -rs.filter((r) => r <= 0).reduce((a, b) => a + b, 0); return l > 0 ? w / l : (w > 0 ? Infinity : 0); };
const fmt = (rs) => (rs.length ? `n=${rs.length} win=${(rs.filter((r) => r > 0).length / rs.length * 100).toFixed(0)}% avg=${(rs.reduce((a, b) => a + b, 0) / rs.length * 100).toFixed(3)}% PF=${pf(rs) === Infinity ? 'inf' : pf(rs).toFixed(2)}` : 'n=0');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function main() {
  const events = mediumEvents();
  console.log(`Event medium: ${events.length} (2023+) | aturan live: EUR >= ${LIVE.thr * 100}% dalam ${LIVE.window} dtk, SL ${LIVE.sl} trail ${LIVE.trail} aktif +${LIVE.act}, maks 30m, biaya ${FEE_RT * 100}%`);
  const rows = [];
  for (const ev of events) {
    try {
      const t0 = ev.timeMs - PRE * 1000;
      const [eur, btc] = [await load('EURUSDT', ev), await load('BTCUSDT', ev)];
      const E = series(eur, t0), B = series(btc, t0);
      if (!E[PRE - 1] || !B[PRE - 1]) continue;
      const e0 = E[PRE - 1].c, b0 = B[PRE - 1].c;
      let maxMv = 0, sig = null;
      for (let s = 1; s <= LIVE.window; s++) {
        const mv = (E[PRE + s].c - e0) / e0;
        if (Math.abs(mv) > Math.abs(maxMv)) maxMv = mv;
        for (const thr of [0.0005, LIVE.thr]) {
          if (sig && sig[thr]) continue;
          if (Math.abs(mv) >= thr) {
            const dir = Math.sign(mv), chase = dir * (B[PRE + s].c - b0) / b0;
            (sig = sig || {})[thr] = chase >= LIVE.chase ? 'skip' : simulate(B, PRE + s + LAT, dir, LIVE);
          }
        }
      }
      const btc5m = Math.abs((B[PRE + 300].c - b0) / b0);
      rows.push({ ev, maxMv, sig: sig || {}, btc5m });
    } catch (e) { console.log('  gagal', ev.label, e.message); }
  }
  console.log(`Data lengkap: ${rows.length} event\n`);
  const types = [...new Set(rows.map((r) => r.ev.type))];
  for (const ty of types) {
    const R = rows.filter((r) => r.ev.type === ty);
    const abs = R.map((r) => Math.abs(r.maxMv) * 100);
    const tr = (thr) => R.map((r) => r.sig[thr]).filter((x) => typeof x === 'number');
    const t10 = tr(LIVE.thr), t05 = tr(0.0005), half = Math.floor(t10.length / 2);
    console.log(`=== ${ty} (n=${R.length}) ===`);
    console.log(`  Gerak dolar terbesar 10 dtk: median ${median(abs).toFixed(3)}% | >=0,05%: ${(abs.filter((a) => a >= 0.05).length / R.length * 100).toFixed(0)}% event | >=0,10%: ${(abs.filter((a) => a >= 0.1).length / R.length * 100).toFixed(0)}% event`);
    console.log(`  BTC gerak 5 menit (abs): median ${(median(R.map((r) => r.btc5m)) * 100).toFixed(3)}%`);
    console.log(`  Trade aturan LIVE (>=0,10%): ${fmt(t10)} | paruh1 ${fmt(t10.slice(0, half))} | paruh2 ${fmt(t10.slice(half))}`);
    console.log(`  Info ambang longgar (>=0,05%): ${fmt(t05)}\n`);
  }
}
main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
