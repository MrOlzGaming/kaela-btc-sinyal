// topTraderPrinciples.js (3 Okt 2026) -- uji 2 prinsip "top trader" yang belum kita punya (permintaan Olan: "belajar sama top
// trader.. gimana mereka trading"):
//   1) UKURAN POSISI MENURUT VOLATILITAS (risk parity / fixed-fractional ala trend follower CTA, Turtle, PTJ "risk 1-2%"):
//      rugi kalau kena SL = r% modal TETAP, posisi mengecil otomatis kalau SL lebar. Pembanding: kalkulator exposure kita
//      (`hitung()`: nilai posisi = exposure x modal/5, rugi-di-SL ikut melebar kalau SL lebar).
//   2) PYRAMIDING (nambah posisi pas UDAH untung, ala Turtle/Livermore): tiap harga jalan +k x R, tambah unit (maks N),
//      semua unit ikut stop trailing yang sama (trailing 3x invalidasi, aturan Olan).
// Sinyal: Ranger BTC 4H PERSIS (pattern+FVG, window halving -- precomputeSignals rangerExitResearch.js) dan Ranger slot
// ICT Sweep (rangerSweep.js). Exit trailing 3x (standar BTC live), fee 0,12% notional per unit. Modal compound $100,
// equity mark-to-market TIAP CANDLE (drawdown jujur, termasuk floating). Dinilai 2 era (<2023 / >=2023).
// Pakai: node backtest/topTraderPrinciples.js <multicoinCacheDir>

const fs = require('fs');
const path = require('path');
const { precomputeSignals } = require('./rangerExitResearch');
const { resampleTo4h } = require('./rangerChartPatternFvg');
const { detectSweepSignal } = require('../rangerSweep');
const { hitung } = require('../calculator');

const FEE = 0.12 / 100, SPLIT = Date.UTC(2023, 0, 1), TRAIL_R = 3;

function simulate(c, sigAt, flipAt, sizing, pyr, start, end) {
  let eq = 100, peak = 100, dd = 0, pos = null, trades = 0, wins = 0;
  const mtm = (x) => (pos ? pos.units.reduce((s, u) => s + u.notional * (x - u.entry) / u.entry * pos.sgn, 0) : 0);
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    if (x.openTime < start || x.openTime >= end) { if (pos && x.openTime >= end) { /* tutup di akhir era */ const pnl = mtm(x.open); eq += pnl; pos = null; } continue; }
    if (pos) {
      const L = pos.sgn > 0;
      let exitPx = null;
      if (flipAt && flipAt(i, pos.sgn)) exitPx = x.close;
      else if (L ? x.low <= pos.stop : x.high >= pos.stop) exitPx = L ? Math.min(x.open, pos.stop) : Math.max(x.open, pos.stop);
      if (exitPx !== null) {
        const pnl = pos.units.reduce((s, u) => s + u.notional * ((exitPx - u.entry) / u.entry * pos.sgn - FEE), 0);
        eq += pnl; trades++; if (pnl > 0) wins++; pos = null;
      } else {
        // trailing 3x invalidasi awal (aturan Olan) -- update buat candle berikutnya
        pos.best = L ? Math.max(pos.best, x.high) : Math.min(pos.best, x.low);
        const cand = pos.best - pos.sgn * TRAIL_R * pos.risk;
        pos.stop = L ? Math.max(pos.stop, cand) : Math.min(pos.stop, cand);
        // pyramiding: harga close udah +k x R (dari entry unit pertama) x jumlah unit -> tambah unit di close
        if (pyr && pos.units.length - 1 < pyr.maxAdds) {
          const lvl = pos.units[0].entry + pos.sgn * pyr.k * pos.risk * pos.units.length;
          if (L ? x.close >= lvl : x.close <= lvl) pos.units.push({ entry: x.close, notional: pos.units[0].notional * pyr.frac });
        }
      }
    }
    if (!pos) {
      const s = sigAt(i);
      if (s) {
        const entry = x.close, risk = Math.abs(entry - s.sl), nyawa = risk / entry * 100;
        let notional;
        if (sizing.mode === 'exposure') notional = hitung({ modal: Math.max(eq, 0) / 5, entry, stopLoss: s.sl, direction: s.dir }).nilaiPosisi;
        else notional = Math.min(Math.max(eq, 0) * sizing.riskPct / nyawa, Math.max(eq, 0) * 10); // rugi di SL = riskPct% modal, cap 10x modal
        if (s.dir === 'sell' && sizing.mode !== 'exposure') notional /= 2; // aturan short separuh (sama kalkulator)
        if (notional > 0) pos = { sgn: s.dir === 'buy' ? 1 : -1, risk, stop: s.sl, best: entry, units: [{ entry, notional }], openI: i };
      }
    }
    const e = eq + mtm(x.close);
    peak = Math.max(peak, e); dd = Math.max(dd, (peak - e) / peak * 100);
  }
  const yrs = (Math.min(end, c[c.length - 1].openTime) - Math.max(start, c[0].openTime)) / (365.25 * 864e5);
  const cagr = (Math.pow(Math.max(eq, 1e-9) / 100, 1 / yrs) - 1) * 100;
  return { eq, cagr, dd, mar: dd ? cagr / dd : 0, trades, win: trades ? wins / trades * 100 : 0 };
}

function main() {
  const dir = process.argv[2];
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'BTCUSDT-1h.json'), 'utf8'));
  const c = resampleTo4h(h);
  const pre = precomputeSignals(c, 'BTC');
  const strategies = [
    { name: 'Ranger BTC pattern+FVG', sigAt: (i) => (pre.sig[i] ? { dir: pre.sig[i].dir, sl: pre.sig[i].sl } : null), flipAt: (i, sgn) => (sgn > 0 ? pre.bear[i] : !pre.bear[i]) },
    { name: 'Ranger slot ICT Sweep', sigAt: (i) => { const s = detectSweepSignal(c, i); return s ? { dir: s.direction, sl: s.sl } : null; }, flipAt: null },
  ];
  const sizings = [
    { name: 'KALKULATOR EXPOSURE (sekarang)', mode: 'exposure' },
    { name: 'risiko tetap 1%/trade', mode: 'risk', riskPct: 1 },
    { name: 'risiko tetap 2%/trade', mode: 'risk', riskPct: 2 },
    { name: 'risiko tetap 3%/trade', mode: 'risk', riskPct: 3 },
    { name: 'risiko tetap 5%/trade', mode: 'risk', riskPct: 5 },
  ];
  const pyrs = [null, { k: 1, maxAdds: 1, frac: 0.5 }, { k: 1, maxAdds: 2, frac: 0.5 }, { k: 2, maxAdds: 1, frac: 1 }, { k: 2, maxAdds: 2, frac: 0.5 }];
  const pname = (p) => (p ? `pyramid +${p.k}R x${p.maxAdds} (${p.frac * 100}%)` : 'tanpa pyramid');
  const fmt = (r) => `CAGR ${r.cagr.toFixed(0)}% DD ${r.dd.toFixed(0)}% MAR ${r.mar.toFixed(2)} n${r.trades} win${r.win.toFixed(0)}%`;
  console.log(`BTC 4H ${new Date(c[0].openTime).toISOString().slice(0, 10)}..${new Date(c[c.length - 1].openTime).toISOString().slice(0, 10)} | exit trailing ${TRAIL_R}x | fee 0,12%/unit | DD mark-to-market tiap candle\n`);
  for (const st of strategies) {
    console.log(`===== ${st.name} =====`);
    for (const sz of sizings) for (const p of pyrs) {
      if (sz.mode === 'risk' && sz.riskPct !== 2 && p) continue; // pyramiding cuma dicek di exposure & risiko 2% biar ringkas
      const a = simulate(c, st.sigAt, st.flipAt, sz, p, 0, SPLIT), b = simulate(c, st.sigAt, st.flipAt, sz, p, SPLIT, Infinity);
      console.log(`${(sz.name + ' | ' + pname(p)).padEnd(64)} | <2023 ${fmt(a)} | >=2023 ${fmt(b)}`);
    }
    console.log('');
  }
}
if (require.main === module) main();
