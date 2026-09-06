// backtest/nfpAdvancedValidation.js -- (6 Sep 2026, permintaan Olan: "boleh diadopsi dikit-dikit
// yang bisa menimbulkan peningkatan") TERAPIN backtestValidation.js (permutation test + deflated
// Sharpe + Ulcer Index, diadaptasi dari riset repo GitHub) ke strategi econ_reaction NFP yang
// SEKARANG LIVE trading (satu-satunya event yang lolos backtest per-tahun+split-era sebelumnya --
// lihat memori project-dark-kaela: CPI/PPI udah ditolak). Horizon 30m DOANG (SATU-SATUNYA yang
// dipakai live, lihat SCALP_HOLD_MINUTES di econCalendarLiveMonitor.js) -- gak perlu cek 1h/4h/24h
// lagi di sini, itu udah gak relevan buat keputusan live.
//
// Ini LAPISAN TAMBAHAN, BUKAN gantiin breakdown per-tahun+split-era yang udah ada di
// econReactionBacktest.js -- kalau salah satu (lama ATAU baru) gagal, edge-nya TETAP dianggap
// gak cukup kuat buat diperluas/dipertahankan tanpa didiskusiin ulang.

const { generateNfpEvents } = require('../fedEvents');
const { analyzeEvent, REACTION_THRESHOLD_PCT } = require('./econReactionBacktest');
const {
  permutationTest, metricAvgReturn, metricProfitFactor,
  probabilisticSharpeRatio, deflatedSharpeRatio, buildEquityCurve, ulcerPerformanceIndex,
} = require('./backtestValidation');

const HORIZON = '30m';
// Berapa banyak "variasi parameter independen" yang PERNAH dicoba buat nemuin strategi
// econ_reaction ini -- dipakai deflatedSharpeRatio (numTrials). Dihitung MANUAL dari histori riset
// yang tercatat di kode (bukan angka ngasal): threshold reaksi (REACTION_THRESHOLD_PCT diuji
// beberapa nilai sebelum settle di 0.10%), event yang dicoba (NFP/CPI/PPI = 3), horizon exit yang
// dibandingin (30m/1h/4h/24h = 4). ~3 threshold x 3 event x 4 horizon = 36, dibulatin ke 40 biar
// KONSERVATIF (lebih tinggi = lebih ketat/lebih sulit lolos DSR, bukan lebih longgar).
const ESTIMATED_INDEPENDENT_TRIALS = 40;

async function main() {
  const events = generateNfpEvents(2019, 2026);
  console.log(`Ambil ulang data NFP (2019-2026, threshold reaksi ${REACTION_THRESHOLD_PCT}%)...`);
  const results = [];
  for (const ev of events) {
    const r = await analyzeEvent(ev);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 200));
  }
  const signaled = results.filter((r) => r.direction !== 'NETRAL' && r.forward[HORIZON] != null);
  // Urutin KRONOLOGIS (equity curve/ulcer index butuh urutan waktu asli, bukan urutan array default
  // -- kebetulan udah urut krn generateNfpEvents ngasih tanggal menaik, tapi eksplisitin biar aman
  // kalau urutan sumbernya berubah suatu saat).
  signaled.sort((a, b) => a.ev.timeMs - b.ev.timeMs);
  console.log(`Event dengan sinyal @ ${HORIZON}: n=${signaled.length}\n`);

  console.log('=== 1) MONTE CARLO PERMUTATION TEST (2000 acakan label arah) ===');
  console.log('Null hypothesis: deteksi arah LONG/SHORT dari reaksi 5-15 menit gak lebih baik dari nebak-arah-acak (proporsi sama).');
  const permAvg = permutationTest(signaled, { horizon: HORIZON, metricFn: metricAvgReturn, iterations: 2000 });
  const permPf = permutationTest(signaled, { horizon: HORIZON, metricFn: metricProfitFactor, iterations: 2000 });
  console.log('Metrik avgReturn:', permAvg);
  console.log('Metrik ProfitFactor:', permPf);
  console.log(permAvg.pValue < 0.05
    ? '-> p-value < 0.05: deteksi arah LEBIH BAIK dari acak (signifikan secara statistik).'
    : '-> p-value >= 0.05: BELUM bisa dibedain dari nebak arah acak -- edge-nya PATUT DICURIGAI.');

  console.log('\n=== 2) DEFLATED SHARPE RATIO (asumsi ~' + ESTIMATED_INDEPENDENT_TRIALS + ' variasi parameter pernah dicoba) ===');
  const returns = signaled.map((r) => r.forward[HORIZON]);
  const psrRaw = probabilisticSharpeRatio(returns, 0);
  console.log(`PSR(0) TANPA penalti multiple-testing (numTrials=1, referensi pembanding): ${psrRaw.ok ? (psrRaw.psr * 100).toFixed(1) + '%' : psrRaw.error}`);
  const dsr = deflatedSharpeRatio(returns, ESTIMATED_INDEPENDENT_TRIALS);
  console.log(dsr);
  if (dsr.ok) {
    console.log(`-> DSR = ${(dsr.dsr * 100).toFixed(2)}% (peluang Sharpe ASLI > Sharpe-terbaik-yang-bisa-muncul-cuma-dari-untung-untungan kalau nyoba ${ESTIMATED_INDEPENDENT_TRIALS} variasi parameter).`);
    console.log(dsr.dsr > 0.95 ? '-> DSR > 95%: kuat, bukan cuma hasil multiple-testing.' : dsr.dsr > 0.5 ? '-> DSR di tengah, gak konklusif kuat.' : '-> DSR rendah: edge PATUT DICURIGAI cuma hasil nyoba banyak parameter (multiple-testing bias).');
  }

  console.log('\n=== 3) ULCER INDEX / ULCER PERFORMANCE INDEX (biaya transaksi BELUM dipotong -- gross) ===');
  const upi = ulcerPerformanceIndex(returns);
  console.log(upi);
  console.log(`-> Total return gross ${signaled.length} trade berurutan: ${upi.totalReturnPct.toFixed(2)}%, Max Drawdown: ${upi.maxDrawdownPct.toFixed(2)}%, Ulcer Index: ${upi.ulcerIndex.toFixed(3)}, UPI (Martin Ratio): ${upi.upi.toFixed(3)}`);

  console.log('\n=== RINGKASAN ===');
  console.log('Breakdown per-tahun + split-era SUDAH lolos sebelumnya (lihat econReactionBacktest.js/memori project-dark-kaela) -- hasil di atas TAMBAHAN, bukan gantiin. Semua kriteria harus konsisten baru edge dianggap kuat.');
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR nfpAdvancedValidation.js:', e.message); process.exit(1); });
}

module.exports = { main, ESTIMATED_INDEPENDENT_TRIALS, HORIZON };
