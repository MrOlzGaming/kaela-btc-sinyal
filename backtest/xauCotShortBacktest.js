// xauCotShortBacktest.js (19 Sep 2026) -- riset lanjutan short Emas SETELAH SMA200-based bear
// window TERBUKTI gagal total (lihat backtestFlagBreakout.js baris ~1083-1150, semua variasi
// SMA150/200/250 + forceCloseOnFlip on/off kalah jauh dari baseline buy-only $11.469). Olan minta
// "cari siapa hebat trading emas di dunia, kita bisa tiru" -- ketemu: institusi (Soros dkk) baca
// makro, kerangka paling konkret+terukur = posisi COT Commercial (CFTC resmi, lihat
// backtest/xauCotBearWindow.js buat detail sumber data + metodologi z-score).
//
// ATURAN BAKU proyek ini (RESEARCH-LOG.md) -- breakdown per tahun, split 2 era independen,
// sensitivitas parameter, DAN wajib jujur laporin hasil NEGATIF kalau memang negatif.
//
// ⛔ HASIL (19 Sep 2026, lihat RESEARCH-LOG.md buat detail lengkap+angka): TIDAK CUKUP KUAT,
// DITOLAK -- sensitivitas panjang rolling window (104/156/208/260 minggu) ngasilin hasil
// LOMPAT-LOMPAT gak konsisten (shortPnL nyebrang dari negatif ke positif ke negatif lagi tanpa
// pola), sample cuma ~3 episode independen sepanjang 25 tahun (n=8 short trade di konfigurasi
// "wajar" terbaik). LEBIH STABIL dari SMA200 (whipsaw turun drastis) TAPI itu BUKAN bukti "lebih
// baik" -- cuma "belum terbukti gagal separah SMA200". JANGAN reuse pendekatan ini APA ADANYA
// (COT Commercial sendirian) tanpa ide/data tambahan (mis. dikombinasi real yield/DXY regime).
const fs = require('fs');
const path = require('path');
const { runFlagBacktestWindowGated, runFlagBacktest, summarize } = require('../backtestFlagBreakout');
const { fetchFullGoldCotHistory, computeCommercialZScoreSeries, makeXauCotBearWindowFn } = require('./xauCotBearWindow');

async function main() {
  const goldDaily = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold-daily-cache.json'), 'utf8'));
  console.log('Gold daily candles:', goldDaily.length, '(', new Date(goldDaily[0].closeTime).toISOString().slice(0, 10), '->', new Date(goldDaily[goldDaily.length - 1].closeTime).toISOString().slice(0, 10), ')');

  const cotHistory = await fetchFullGoldCotHistory();
  console.log('COT history:', cotHistory.length, 'laporan mingguan (', cotHistory[0].date, '->', cotHistory[cotHistory.length - 1].date, ')');
  const zSeries = computeCommercialZScoreSeries(cotHistory);

  const baseline = runFlagBacktest(goldDaily, { allowShort: false });
  const baselineS = summarize(baseline.trades);
  console.log(`\n[ACUAN -- Emas BASELINE buy-only, TANPA window gate apapun] n=${baselineS.n} | PF=${baselineS.profitFactor} | totalR=${baselineS.totalR} | finalCapital=$${baseline.finalCapital.toFixed(2)} | maxDD=${baseline.maxDrawdownPct.toFixed(1)}%`);

  // Test 2 ARAH x 3 threshold -- gak presuppose arah mana yang bener, itung-itungan yang mutusin.
  console.log('\n=== Sensitivitas arah + threshold z-score Commercial (window bear = short diizinkan) ===');
  const results = [];
  for (const direction of ['low', 'high']) {
    for (const threshold of [1.0, 1.5, 2.0]) {
      const fn = makeXauCotBearWindowFn(zSeries, { threshold, direction });
      const wg = runFlagBacktestWindowGated(goldDaily, { bearWindowFn: fn, maxNyawaPct: 20 });
      const s = summarize(wg.trades);
      const shorts = wg.trades.filter((t) => t.direction === 'sell');
      const flips = wg.trades.filter((t) => t.exitReason === 'WINDOW_FLIP');
      const label = `direction=${direction} threshold=${threshold}`;
      console.log(`  ${label}: n=${s.n} (short=${shorts.length}, flip=${flips.length}) | PF=${s.profitFactor} | totalR=${s.totalR} | finalCapital=$${wg.finalCapital.toFixed(2)} | maxDD=${wg.maxDrawdownPct.toFixed(1)}% | shortTotalPnl=$${shorts.reduce((a, t) => a + t.pnlUsd, 0).toFixed(2)} | flipPnl=$${flips.reduce((a, t) => a + t.pnlUsd, 0).toFixed(2)}`);
      results.push({ direction, threshold, finalCapital: wg.finalCapital, trades: wg.trades, s });
    }
  }

  const best = results.reduce((a, b) => (b.finalCapital > a.finalCapital ? b : a));
  console.log(`\n>>> KANDIDAT TERBAIK: direction=${best.direction} threshold=${best.threshold} -- finalCapital=$${best.finalCapital.toFixed(2)} vs baseline $${baseline.finalCapital.toFixed(2)} (${best.finalCapital > baseline.finalCapital ? 'MENANG' : 'KALAH'})`);

  if (best.finalCapital > baseline.finalCapital) {
    console.log('\n-- Breakdown per TAHUN (kandidat terbaik) --');
    const byYear = {};
    for (const t of best.trades) {
      const y = new Date(t.entryTime).getUTCFullYear();
      (byYear[y] = byYear[y] || []).push(t);
    }
    for (const y of Object.keys(byYear).sort()) {
      const ts = byYear[y];
      const s2 = summarize(ts);
      const nShort = ts.filter((t) => t.direction === 'sell').length;
      console.log(`  ${y}: n=${s2.n} (short=${nShort}) | winRate=${s2.winRate} | totalR=${s2.totalR} | totalPnl=$${ts.reduce((s3, t) => s3 + t.pnlUsd, 0).toFixed(2)}`);
    }

    console.log('\n-- Split 2 ERA independen (kandidat terbaik) --');
    const mid = goldDaily[260].closeTime + (goldDaily[goldDaily.length - 1].closeTime - goldDaily[260].closeTime) / 2;
    const eraA = best.trades.filter((t) => t.entryTime < mid);
    const eraB = best.trades.filter((t) => t.entryTime >= mid);
    const sA = summarize(eraA), sB = summarize(eraB);
    console.log(`  Era A: n=${sA.n} | PF=${sA.profitFactor} | totalR=${sA.totalR}`);
    console.log(`  Era B: n=${sB.n} | PF=${sB.profitFactor} | totalR=${sB.totalR}`);
    if (sA.profitFactor < 1 || sB.profitFactor < 1) {
      console.log('  ⚠️ SALAH SATU era PF<1 -- edge gak konsisten lintas waktu, kemungkinan overfitting ke 1 era doang.');
    }
  } else {
    console.log('\n(Gak breakdown lebih lanjut -- kandidat terbaik pun masih kalah dari baseline, gak ada gunanya diperinci lagi.)');
  }
}

main().catch((e) => { console.error('ERROR xauCotShortBacktest.js:', e.message); process.exit(1); });
