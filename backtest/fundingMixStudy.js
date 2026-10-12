// Riset CARA SETOR (12 Okt 2026, Olan: "tiap ada duit \$100/bln ke BTC spot, kalau grid butuh duit baru aku isi ke BingX").
// 3 cara, modal awal \$940 di Farmer + \$100 tiap awal bulan, data harian 2013-26:
//   A = semua \$100 ke Farmer (sekarang).  B = semua \$100 beli BTC spot & tahan (Farmer cuma modal awal).
//   D = IDE OLAN #2 (12 Okt): $100 beli BTC; BTC = CADANGAN Farmer (modal Farmer = BingX + nilai BTC, kayak saldo penambah); tangga
//       kepicu tapi saldo BingX kurang -> JUAL BTC seperlunya, pindah ke Farmer.
//   C = IDE OLAN: \$100 beli BTC, KECUALI Farmer lagi butuh (tangga berikutnya kepicu tapi saldo bebas < 1 tangga) -> \$100 bulan itu
//       ke Farmer dulu sampai kekurangannya ketutup, sisanya BTC. Tangga nunggu sampai dana masuk (sama kayak live "nunggu top up").
// Farmer = setting live: siklus mulai kalau BTC <= ATH -15%, tangga 6% modal (maks \$10rb), tiap -15% dari entry terakhir, isolated 5x
// MERGE, TP = rugi likuidasi + 30% total masuk. Untung Farmer di atas \$10rb -> bibit BTC (ditahan). Fee 0,05% + funding 0,03%/hari.
// Jalanin: node backtest/fundingMixStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const FEE = 0.0005, MM = 0.005, FUND = 0.0003, LEV = 5, CAP = 10000;
function sim(rows, from, mode, { start = 940, monthly = 100, share = 0 } = {}) {
  let sold = 0, ath = 0, last = null, btc = 0, dep = start, need = 0, peak = start, dd = 0, hit10 = null, hit100 = null, minRatio = 9;
  const F = { w: start, pos: null, putIn: 0, realized: 0, unit: 0, cap: 0, lastE: 0 };
  const buyBtc = (usd, px) => { btc += usd * 0.999 / px; };
  for (const [t, o, h, l, c] of rows) {
    if (t < from) { ath = Math.max(ath, h); continue; }
    const mon = new Date(t).toISOString().slice(0, 7);
    if (last !== null && mon !== last) {
      dep += monthly; let m = monthly;
      if (mode === 'A') { F.w += m; m = 0; }
      if (mode === 'S') { F.w += m * share; m -= m * share; } // S = share% ke Farmer, sisanya BTC
      if (mode === 'C' && need > 0) { const x = Math.min(m, need); F.w += x; need -= x; m -= x; }
      if (m > 0) buyBtc(m, o);
    }
    last = mon;
    if (F.pos) F.w -= F.pos.q * o * FUND;
    if (!F.pos && F.putIn === 0 && ath > 0 && l <= ath * 0.85) { F.cap = Math.min(F.w + (mode === 'D' ? btc * o : 0), CAP); F.unit = F.cap * 0.06; }
    if (F.unit > 0) {
      const trig = F.putIn === 0 ? Math.min(ath * 0.85, o) : (F.pos ? F.lastE * 0.85 : Math.min(F.lastE, o));
      if (l <= trig && F.putIn + F.unit <= F.cap * 1.0001) {
        let free = F.w - (F.pos ? F.pos.mg : 0);
        if (mode === 'D' && free < F.unit * 1.003 && btc > 0) { const px = Math.min(trig, o), needUsd = F.unit * 1.003 - free, q = Math.min(btc, needUsd / (px * 0.999)); btc -= q; F.w += q * px * 0.999; sold += q * px; free = F.w - (F.pos ? F.pos.mg : 0); }
        if (free >= F.unit * 1.003) {
          const e = Math.min(trig, o); let mg = F.unit;
          if (F.pos) { const pnl = F.pos.q * (e - F.pos.e); F.realized += pnl; F.w += pnl - F.pos.q * e * FEE; mg += Math.max(0, F.pos.mg + pnl); F.pos = null; }
          F.pos = { e, mg, q: mg * LEV / e }; F.w -= mg * LEV * FEE; F.putIn += F.unit; F.lastE = e; need = 0;
        } else if (mode === 'C') need = Math.max(need, F.unit * 1.003 - free);
      }
    }
    if (F.pos && l <= F.pos.e * (1 - 1 / LEV + MM)) { F.w -= F.pos.mg; F.realized -= F.pos.mg; F.lastE = F.pos.e * (1 - 1 / LEV + MM); F.pos = null; if (F.putIn + F.unit > F.cap * 1.0001) { F.putIn = 0; F.realized = 0; F.unit = 0; need = 0; } }
    if (F.pos) { const tp = F.pos.e + (0.3 * F.putIn - F.realized) / F.pos.q; if (h >= tp) { F.w += F.pos.q * (tp - F.pos.e) - F.pos.q * tp * FEE; F.pos = null; F.putIn = 0; F.realized = 0; F.unit = 0; need = 0; if (F.w > CAP) { buyBtc(F.w - CAP, tp); F.w = CAP; } } }
    ath = Math.max(ath, h);
    const tot = F.w + (F.pos ? F.pos.q * (c - F.pos.e) : 0) + btc * c;
    if (tot > peak) peak = tot; dd = Math.max(dd, 1 - tot / peak); minRatio = Math.min(minRatio, tot / dep);
    if (!hit10 && tot >= 1e4) hit10 = t; if (!hit100 && tot >= 1e5) hit100 = t;
  }
  const px = rows[rows.length - 1][4];
  return { sold, tot: F.w + (F.pos ? F.pos.q * (px - F.pos.e) : 0) + btc * px, dep, dd, minRatio, hit10, hit100, btcVal: btc * px };
}
(async () => {
  const rows = await loadDaily();
  const yrs = (a, b) => (b ? ((b - a) / (365.25 * 864e5)).toFixed(1) + ' th' : '-');
  const f$ = (v) => '$' + Math.round(v).toLocaleString('en-US');
  console.log('mulai    | A semua ke Farmer             | B semua beli BTC              | C IDE OLAN (BTC, Farmer kalau butuh)');
  for (const ym of ['2013-01', '2014-01', '2015-01', '2016-01', '2017-01', '2018-01', '2019-01', '2020-01', '2021-01', '2022-01', '2023-01', '2024-01']) {
    const from = Date.parse(ym + '-01');
    const cell = (r) => `${f$(r.tot).padStart(10)} DD${(r.dd * 100).toFixed(0).padStart(3)}% min${r.minRatio.toFixed(2)}x 10rb:${yrs(from, r.hit10)}`;
    console.log(`${ym}  | ${cell(sim(rows, from, 'A'))} | ${cell(sim(rows, from, 'B'))} | ${cell(sim(rows, from, 'C'))}`);
  }
  // ringkas semua titik bulanan 2013-2024
  const agg = { A: [], B: [], C: [] };
  for (let y = 2013; y <= 2024; y++) for (let m = 0; m < 12; m++) { const from = Date.UTC(y, m, 1); for (const k of ['A', 'B', 'C']) agg[k].push(sim(rows, from, k)); }
  for (const k of ['A', 'B', 'C']) {
    const rs = agg[k], med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(`${k}: median akhir/setoran x${med(rs.map((r) => r.tot / r.dep)).toFixed(2)} | DD median ${(med(rs.map((r) => r.dd)) * 100).toFixed(0)}% terburuk ${(Math.max(...rs.map((r) => r.dd)) * 100).toFixed(0)}% | pernah di bawah setoran (min<1): ${rs.filter((r) => r.minRatio < 1).length}/${rs.length} | tembus \$100rb ${rs.filter((r) => r.hit100).length}/${rs.length}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

module.exports = { sim };
