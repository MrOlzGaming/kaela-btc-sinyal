// backtest/fundingExtremeStudy.js (4 Okt 2026, riset malam -- kandidat strategi Ninja baru)
// HIPOTESIS (mindset bandar): funding rate BTC perp EKSTREM = satu sisi numpuk. Funding sangat positif -> long kerumunan,
// rawan dibuang -> SHORT. Funding sangat negatif -> short numpuk, rawan squeeze -> LONG. Bonus: posisi kontrarian MENERIMA
// funding selama ditahan. (Beda dari uji 14 Sep: itu funding sbg FILTER entry Nyopet; ini sinyal MANDIRI.)
//
// Ekstrem = persentil funding vs 90 hari KE BELAKANG (tanpa look-ahead). Sinyal dicek tiap settlement (8 jam).
// Entry: open candle 5m pertama setelah settlement. Exit: tahan H jam (+ varian SL). Gak numpuk (sinyal selama posisi
// jalan di-skip). Biaya 0,12% pulang-pergi; funding yang diterima/dibayar selama tahan IKUT dihitung.
// NULL: permutasi 1000x -- waktu entry diacak di antara semua settlement (arah & jumlah sama), p = proporsi acak >= asli.
// Rigor: PF bersih > 1,2 di DUA era (<2023, >=2023) + p < 0,05.
//
// Pakai: node backtest/fundingExtremeStudy.js <btc-5m.json> <funding.json [{t,r}]>
const fs = require('fs');

const [FILE5M, FILEF] = process.argv.slice(2);
if (!FILE5M || !FILEF) { console.log('Pakai: node backtest/fundingExtremeStudy.js <btc-5m.json> <funding.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(FILE5M, 'utf8'));
const C = Array.isArray(raw) ? raw : raw.candles;
const F = JSON.parse(fs.readFileSync(FILEF, 'utf8')).map((x) => ({ t: Math.round(x.t / 1000) * 1000, r: x.r })).sort((a, b) => a.t - b.t);
const BAR = 5 * 60e3;
const COST = 0.12;
const ERA_SPLIT = Date.UTC(2023, 0, 1);
const LOOKBACK = 90 * 3; // 90 hari x 3 settlement

// index candle pertama dgn openTime >= t (binary search)
function barAt(t) { let lo = 0, hi = C.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (C[mid].openTime < t) lo = mid + 1; else hi = mid; } return C[lo].openTime >= t ? lo : -1; }

// persentil funding sekarang vs lb settlement sebelumnya
function pctArr(lb) {
  return F.map((f, i) => {
    if (i < lb) return null;
    const win = F.slice(i - lb, i).map((x) => x.r);
    return win.filter((x) => x < f.r).length / win.length;
  });
}
const pct = pctArr(LOOKBACK);

// return trade: dir +1/-1, mulai di settlement index fi
function trade(fi, dir, { H, sl }) {
  const t0 = F[fi].t, i0 = barAt(t0);
  if (i0 < 0) return null;
  const entry = C[i0].open, end = t0 + H * 3600e3;
  let exitP = null, exitT = null;
  for (let i = i0; i < C.length && C[i].openTime < end; i++) {
    if (sl) {
      const slP = entry * (1 - dir * sl / 100);
      if (dir > 0 ? C[i].low <= slP : C[i].high >= slP) { exitP = slP; exitT = C[i].openTime; break; }
    }
    exitP = C[i].close; exitT = C[i].openTime + BAR;
  }
  if (exitP === null || exitT < end - 2 * BAR && !sl) return null; // data bolong
  // funding selama tahan: settlement setelah t0 s/d exit. Long BAYAR r, short TERIMA r (r positif).
  let fund = 0;
  for (let k = fi + 1; k < F.length && F[k].t <= exitT; k++) fund += -dir * F[k].r * 100;
  return { net: dir * (exitP - entry) / entry * 100 - COST + fund, fund, t: t0, exitT };
}

function run(sigIdx, p) {
  const rows = [];
  let busyUntil = 0;
  for (const { fi, dir } of sigIdx) {
    if (F[fi].t < busyUntil) continue;
    const r = trade(fi, dir, p);
    if (!r) continue;
    rows.push({ ...r, dir });
    busyUntil = r.exitT;
  }
  return rows;
}
function pfOf(nets) { const w = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0); return l > 0 ? w / l : (w > 0 ? 99 : 0); }
const S = (rows) => { const n = rows.map((r) => r.net); return { n: n.length, pf: pfOf(n), sum: n.reduce((a, b) => a + b, 0), avg: n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0 }; };
const fmt = (s) => `n${s.n} PF ${s.pf.toFixed(2)} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`;

// RNG deterministik biar hasil bisa diulang
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

console.log(`Funding: ${F.length} settlement ${new Date(F[0].t).toISOString().slice(0, 10)} .. ${new Date(F[F.length - 1].t).toISOString().slice(0, 10)}; candle 5m s/d ${new Date(C[C.length - 1].openTime).toISOString().slice(0, 10)}`);
const rs = F.map((f) => f.r * 100).sort((a, b) => a - b);
console.log(`Sebaran funding/8j: p5 ${rs[Math.floor(rs.length * 0.05)].toFixed(4)}%, median ${rs[Math.floor(rs.length / 2)].toFixed(4)}%, p95 ${rs[Math.floor(rs.length * 0.95)].toFixed(4)}%, max ${rs[rs.length - 1].toFixed(4)}%`);

const results = [];
const valid = F.map((_, i) => i).filter((i) => pct[i] !== null && F[i].t < C[C.length - 1].openTime - 4 * 86400e3);
for (const q of [0.9, 0.95, 0.98])
  for (const side of ['both', 'short-only', 'long-only'])
    for (const H of [8, 24, 72])
      for (const sl of [null, 2, 4]) {
        const sig = [];
        for (const i of valid) {
          if (pct[i] >= q && side !== 'long-only') sig.push({ fi: i, dir: -1 });
          else if (pct[i] <= 1 - q && side !== 'short-only') sig.push({ fi: i, dir: 1 });
        }
        const p = { H, sl };
        const rows = run(sig, p);
        if (rows.length < 15) continue;
        const real = S(rows);
        // permutasi: acak waktu (arah tetap)
        let ge = 0;
        for (let k = 0; k < 300; k++) {
          const fake = sig.map((s) => ({ fi: valid[Math.floor(rnd() * valid.length)], dir: s.dir })).sort((a, b) => a.fi - b.fi);
          if (S(run(fake, p)).sum >= real.sum) ge++;
        }
        results.push({ q, side, H, sl, all: real, a: S(rows.filter((r) => r.t < ERA_SPLIT)), b: S(rows.filter((r) => r.t >= ERA_SPLIT)), p: (ge + 1) / 301, fundAvg: rows.reduce((a, r) => a + r.fund, 0) / rows.length, rows });
      }

results.sort((x, y) => Math.min(y.a.pf, y.b.pf) - Math.min(x.a.pf, x.b.pf));
console.log('\n== Grid (urut PF era terburuk). Lolos = PF >= 1,2 dua era + permutasi p < 0,05 ==');
for (const r of results.slice(0, 18)) {
  const ok = r.a.pf >= 1.2 && r.b.pf >= 1.2 && r.p < 0.05 ? '✅' : '  ';
  console.log(`${ok} persentil ${r.q} ${r.side} H=${r.H}j SL=${r.sl || '-'}% | semua ${fmt(r.all)} | <2023 ${fmt(r.a)} | >=2023 ${fmt(r.b)} | funding rata2 ${r.fundAvg >= 0 ? '+' : ''}${r.fundAvg.toFixed(3)}% | p=${r.p.toFixed(3)}`);
}
const lolos = results.filter((r) => r.a.pf >= 1.2 && r.b.pf >= 1.2 && r.p < 0.05);
console.log(`\nLolos rigor: ${lolos.length}/${results.length} kombinasi (catatan: ${results.length} uji -> ~${(results.length * 0.05).toFixed(0)} lolos p<0,05 kebetulan doang, jadi butuh DATARAN, bukan 1 titik).`);
const best = (lolos[0] || results[0]);
console.log(`\n== Per tahun: persentil ${best.q} ${best.side} H=${best.H}j SL=${best.sl || '-'}% ==`);
for (let y = 2019; y <= 2026; y++) { const yr = best.rows.filter((r) => new Date(r.t).getUTCFullYear() === y); if (yr.length) console.log(`  ${y}: ${fmt(S(yr))}`); }
console.log(`  long ${fmt(S(best.rows.filter((r) => r.dir > 0)))} | short ${fmt(S(best.rows.filter((r) => r.dir < 0)))}`);

// ---- ROBUSTNESS: dataran parameter buat LONG pas funding paling rendah (temuan grid di atas) ----
// Kalau edge-nya nyata, tetangga parameter (lookback/persentil/lama tahan) harus ikut positif -- bukan 1 titik doang.
// Kolom "2025-26" dipisah: grid di atas nunjukin 2 tahun terakhir rugi -> cek apakah itu konsisten di semua tetangga.
console.log('\n== ROBUSTNESS long-only (funding persentil rendah), tanpa SL ==');
const robust = [];
for (const lbDays of [30, 60, 90, 180]) {
  const pa = pctArr(lbDays * 3);
  const validR = F.map((_, i) => i).filter((i) => pa[i] !== null && F[i].t < C[C.length - 1].openTime - 4 * 86400e3 && F[i].t >= Date.UTC(2020, 3, 1)); // start seragam Apr 2020 (lookback 180 hari butuh histori)
  for (const q of [0.95, 0.97, 0.98, 0.99])
    for (const H of [12, 24, 48]) {
      const sig = validR.filter((i) => pa[i] <= 1 - q).map((i) => ({ fi: i, dir: 1 }));
      const rows = run(sig, { H, sl: null });
      if (rows.length < 15) continue;
      const real = S(rows);
      let ge = 0;
      for (let k = 0; k < 200; k++) {
        const fake = sig.map(() => ({ fi: validR[Math.floor(rnd() * validR.length)], dir: 1 })).sort((a, b) => a.fi - b.fi);
        if (S(run(fake, { H, sl: null })).sum >= real.sum) ge++;
      }
      const a = S(rows.filter((r) => r.t < ERA_SPLIT)), b = S(rows.filter((r) => r.t >= ERA_SPLIT && r.t < Date.UTC(2025, 0, 1))), c = S(rows.filter((r) => r.t >= Date.UTC(2025, 0, 1)));
      robust.push({ lbDays, q, H, real, a, b, c, p: (ge + 1) / 201 });
      console.log(`  lb ${String(lbDays).padStart(3)}h q${q} H${String(H).padStart(2)}j | ${fmt(real)} | <2023 PF ${a.pf.toFixed(2)} (n${a.n}) | 2023-24 PF ${b.pf.toFixed(2)} (n${b.n}) | 2025-26 PF ${c.pf.toFixed(2)} (n${c.n}) | p=${p3((ge + 1) / 201)}`);
    }
}
function p3(x) { return x.toFixed(3); }
const pos = robust.filter((r) => r.real.pf > 1).length, sig05 = robust.filter((r) => r.p < 0.05).length, recentPos = robust.filter((r) => r.c.pf > 1).length;
console.log(`\nRingkasan dataran: ${pos}/${robust.length} kombinasi PF > 1, ${sig05}/${robust.length} p < 0,05 (kebetulan ~${(robust.length * 0.05).toFixed(1)}), 2025-26 PF > 1 cuma ${recentPos}/${robust.length}.`);

// ---- FILTER TREN: long funding-rendah CUMA kalau close harian terakhir (yang udah selesai) > SMA N hari ----
// Dugaan: 2025-26 rezim turun -> funding negatif = bear beneran, bukan short numpuk. Filter berprinsip (sistem lain juga
// pakai filter tren); bukti cuma kalau 2025-26 membaik di SEMUA tetangga tanpa ngerusak era lama.
console.log('\n== FILTER TREN (close harian > SMA N) -- long-only funding rendah, tanpa SL ==');
const DAY = 86400e3;
const dailyClose = new Map(); // dayStart -> close
for (const c of C) dailyClose.set(Math.floor(c.openTime / DAY) * DAY, c.close);
const days = [...dailyClose.keys()].sort((a, b) => a - b);
const dayIdx = new Map(days.map((d, i) => [d, i]));
const closes = days.map((d) => dailyClose.get(d));
function aboveSma(t, n) {
  const i = dayIdx.get(Math.floor(t / DAY) * DAY) - 1; // hari kemarin (udah close)
  if (!(i >= n)) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return closes[i] > s / n;
}
const trendRows = [];
for (const smaN of [0, 50, 100, 200]) {
  let cnt = 0, pos = 0, recentPos = 0, sig05 = 0;
  for (const lbDays of [30, 60, 90, 180]) {
    const pa = pctArr(lbDays * 3);
    const validR = F.map((_, i) => i).filter((i) => pa[i] !== null && F[i].t < C[C.length - 1].openTime - 4 * DAY && F[i].t >= Date.UTC(2020, 3, 1));
    for (const q of [0.95, 0.97, 0.98])
      for (const H of [24, 48]) {
        const pass = (i) => smaN === 0 || aboveSma(F[i].t, smaN) === true;
        const sig = validR.filter((i) => pa[i] <= 1 - q && pass(i)).map((i) => ({ fi: i, dir: 1 }));
        const rows = run(sig, { H, sl: null });
        if (rows.length < 10) continue;
        const real = S(rows), c = S(rows.filter((r) => r.t >= Date.UTC(2025, 0, 1))), a = S(rows.filter((r) => r.t < ERA_SPLIT)), b = S(rows.filter((r) => r.t >= ERA_SPLIT && r.t < Date.UTC(2025, 0, 1)));
        // null: entry acak yang LOLOS filter tren yg sama (biar gak cuma ngukur "uptrend = untung")
        const pool = validR.filter(pass);
        let ge = 0;
        for (let k = 0; k < 200; k++) {
          const fake = sig.map(() => ({ fi: pool[Math.floor(rnd() * pool.length)], dir: 1 })).sort((x, y) => x.fi - y.fi);
          if (S(run(fake, { H, sl: null })).sum >= real.sum) ge++;
        }
        const p = (ge + 1) / 201;
        cnt++; if (real.pf > 1) pos++; if (c.pf > 1) recentPos++; if (p < 0.05) sig05++;
        trendRows.push({ smaN, lbDays, q, H, real, a, b, c, p });
      }
  }
  const sub = trendRows.filter((r) => r.smaN === smaN);
  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log(`  ${smaN ? 'SMA' + smaN : 'tanpa filter'}: ${cnt} kombinasi | PF>1 ${pos}/${cnt} | p<0,05 ${sig05}/${cnt} | median PF <2023 ${med(sub.map((r) => r.a.pf)).toFixed(2)}, 2023-24 ${med(sub.map((r) => r.b.pf)).toFixed(2)}, 2025-26 ${med(sub.map((r) => r.c.pf)).toFixed(2)} (PF>1 ${recentPos}/${cnt}) | median n ${med(sub.map((r) => r.real.n))}`);
}
