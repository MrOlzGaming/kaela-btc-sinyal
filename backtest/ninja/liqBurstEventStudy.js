// liqBurstEventStudy.js (1 Okt 2026) -- studi kejadian: habis LEDAKAN likuidasi (data ASLI Bybit yang
// direkam liquidationListener.js ke liquidation-events.jsonl), harga beneran mantul (fade) atau lanjut?
// Konvensi side (Bybit, lihat liquidationListener.js): 'BUY' = posisi LONG kena force-close (tekanan
// jual -> fade = LONG), 'SELL' = posisi SHORT kena force-close (tekanan beli -> fade = SHORT).
// Bucket 5 menit; burst = notional sisi dominan >= ambang (persentil). Masuk di close bucket (harga
// close candle 5m yang sama), ukur return +15/+30/+60 menit ke ARAH FADE, dibanding baseline semua bucket.
// DESKRIPTIF (data cuma ~17 hari) -- bukan bukti edge, cuma cek apa arah hipotesisnya masuk akal.
// Pakai: node backtest/ninja/liqBurstEventStudy.js <cache5m.json>

const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', '..');

const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const idx = new Map(c5.map((x, i) => [x.openTime, i]));
const ev = fs.readFileSync(path.join(R, 'liquidation-events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.symbol === 'BTCUSDT');
const B = 300e3;
const buckets = new Map();
for (const e of ev) {
  const b = Math.floor(e.timestamp / B) * B;
  const o = buckets.get(b) || { longLiq: 0, shortLiq: 0 };
  if (e.side === 'BUY') o.longLiq += e.price * e.qty; else o.shortLiq += e.price * e.qty;
  buckets.set(b, o);
}
const first = Math.floor(ev[0].timestamp / B) * B, last = Math.floor(ev.at(-1).timestamp / B) * B;
console.log(`event ${ev.length}, rentang ${new Date(first).toISOString()} -> ${new Date(last).toISOString()} (${((last - first) / 864e5).toFixed(1)} hari), bucket berisi ${buckets.size}`);

const fwd = (i, bars, dir) => { const a = c5[i], b = c5[i + bars]; if (!a || !b) return null; const r = (b.close - a.close) / a.close * 100; return dir === 'long' ? r : -r; };
const vals = [...buckets.values()].map((o) => Math.max(o.longLiq, o.shortLiq)).sort((a, b) => a - b);
const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];

// baseline: SEMUA bucket 5m di rentang ini, arah long & short (rata2 drift)
const baseIdx = [];
for (let t = first; t <= last; t += B) if (idx.has(t)) baseIdx.push(idx.get(t));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
for (const bars of [3, 6, 12]) {
  const L = baseIdx.map((i) => fwd(i, bars, 'long')).filter((v) => v !== null);
  console.log(`baseline +${bars * 5}m: rata2 long ${avg(L).toFixed(3)}% (n=${L.length})`);
}

for (const p of [0.8, 0.9, 0.95, 0.98]) {
  const thr = pct(p);
  const rows = [];
  for (const [t, o] of buckets) {
    const i = idx.get(t);
    if (i === undefined) continue;
    const dom = o.longLiq >= o.shortLiq ? 'long' : 'short'; // sisi yg kelikuidasi dominan -> fade searah kebalikan tekanan
    const size = Math.max(o.longLiq, o.shortLiq);
    if (size < thr) continue;
    rows.push({ t, dir: dom, size, r15: fwd(i, 3, dom), r30: fwd(i, 6, dom), r60: fwd(i, 12, dom) });
  }
  const s = (k) => { const a = rows.map((r) => r[k]).filter((v) => v !== null); const w = a.filter((v) => v > 0).length; return `${avg(a).toFixed(3)}% (menang ${a.length ? (w / a.length * 100).toFixed(0) : '-'}%, n=${a.length})`; };
  console.log(`\nburst >= persentil ${p * 100} ($${Math.round(thr).toLocaleString()} / 5 mnt): ${rows.length} kejadian (${rows.filter((r) => r.dir === 'long').length} fade-long, ${rows.filter((r) => r.dir === 'short').length} fade-short)`);
  console.log(`  fade +15m ${s('r15')} | +30m ${s('r30')} | +60m ${s('r60')}`);
  console.log(`  fee round-trip maker/maker 0,04% -- taker/taker+selip 0,12%`);
}
