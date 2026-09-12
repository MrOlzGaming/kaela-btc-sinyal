// backtest/longOnlyEconReactionValidation.js -- 12 Sep 2026, permintaan Olan: "trading kalender
// ekonomi juga boleh otomatis, tapi long pokonya" -- CPI/PPI/NFP SEBELUMNYA ditolak (lihat memori
// project-dark-kaela + nfpAdvancedValidation.js), TAPI validasi lama SEMUA pakai sinyal LONG+SHORT
// DIGABUNG. "Nyopet Buy-Only" (lihat feedback-nyopet-buyonly) udah kebukti konsisten di SELURUH
// sistem ini: SHORT SELALU lebih lemah drpd LONG. Belum pernah ada yang nguji APA versi LONG-ONLY
// dari CPI/PPI/NFP (gabungan) lolos validasi ketat yang SAMA yang dipakai buat NFP dulu.
//
// METODE: SAMA PERSIS nfpAdvancedValidation.js (permutation test 2000 iterasi + Deflated Sharpe
// Ratio + Ulcer Index), horizon 30 menit (SATU-SATUNYA yang relevan buat live, SCALP_HOLD_MINUTES
// di econCalendarLiveMonitor.js) -- cuma bedanya: (1) filter LONG-ONLY, (2) NFP+CPI+PPI DIGABUNG
// jadi SATU dataset (biar sample size lebih besar, sesuai rencana "semua kalender ekonomi").
// FOMC SENGAJA gak diikutkan di sini -- itu udah live/lolos terpisah, biar gak ketuker sama
// keputusan strategi yang SUDAH jalan.
//
// ⛔ HASIL 12 Sep 2026 (RISET INI DITOLAK, JANGAN diulang tanpa data/metode baru): n=116 sinyal
// LONG (NFP+CPI+PPI gabungan, 2019-2026). Deflated Sharpe Ratio = 0% di SEMUA kombinasi (gabungan
// maupun sendiri-sendiri) -- Sharpe observed (~0,19-0,25) jauh di bawah "wajar ketemu kebetulan"
// dari 50 variasi parameter (~2,28). Breakdown per tahun retak: 2020 negatif, 2025-2026 (paling
// relevan) win rate cuma 47-50% (nyaris lempar koin), CPI 2026 cuma 20%, PPI 2025 cuma 14%.
// "Long-only" TIDAK otomatis nyelametin strategi yang gak solid -- beda kasus dari Sniper/Nyopet
// chart-pattern (short di situ emang kebukti ngerusak edge yang SEBENARNYA ada; di sini edge-nya
// sendiri emang gak cukup kuat dari awal, arah gak ngaruh).
//
// ⛔ CATATAN METODOLOGI: permutation test (Monte Carlo, ngacak LABEL arah) di output run ini
// gak valid dipakai -- didesain buat dataset CAMPURAN long+short, kalau dataset-nya UDAH
// difilter 1 arah doang gak ada apa-apa buat diacak (p-value=1 GAK BERARTI APA-APA, bukan bukti
// kuat menentang/mendukung). Kesimpulan PENOLAKAN di atas murni dari Deflated Sharpe Ratio +
// breakdown tahunan (dua-duanya TETAP valid buat kasus ini), BUKAN dari permutation test.

const { generateNfpEvents, generateCpiEvents, generatePpiEvents } = require('../fedEvents');
const { analyzeEvent, REACTION_THRESHOLD_PCT } = require('./econReactionBacktest');
const {
  permutationTest, metricAvgReturn, metricProfitFactor,
  probabilisticSharpeRatio, deflatedSharpeRatio, ulcerPerformanceIndex,
} = require('./backtestValidation');

const HORIZON = '30m';
// Variasi parameter yang PERNAH dicoba SPESIFIK buat ide long-only INI (konservatif, TAMBAHAN di
// atas 40 yang udah dipakai nfpAdvancedValidation.js -- long-only itu sendiri 1 "pilihan desain"
// baru yang belum pernah dihitung di angka lama) -- threshold reaksi(1) x kombinasi
// event(NFP/CPI/PPI/gabungan=4) x arah(long-only/keduanya=2) = 8, ditambah 40 lama = 48, dibulatin
// 50 biar KONSERVATIF (lebih tinggi = lebih ketat/lebih sulit lolos, bukan lebih longgar).
const ESTIMATED_INDEPENDENT_TRIALS = 50;

async function collectAll(label, events) {
  console.log(`Ambil data ${label} (${events.length} event)...`);
  const results = [];
  for (const ev of events) {
    const r = await analyzeEvent(ev);
    if (r) results.push({ ...r, source: label });
    await new Promise((res) => setTimeout(res, 200));
  }
  return results;
}

function runValidation(signaled, label) {
  console.log(`\n########## ${label} -- LONG-ONLY, n=${signaled.length} ##########`);
  if (signaled.length < 10) {
    console.log('Sample kurang dari 10 -- TERLALU KECIL buat statistik apapun dipercaya, skip validasi.');
    return;
  }

  console.log('=== 1) MONTE CARLO PERMUTATION TEST (2000 acakan) ===');
  const permAvg = permutationTest(signaled, { horizon: HORIZON, metricFn: metricAvgReturn, iterations: 2000 });
  const permPf = permutationTest(signaled, { horizon: HORIZON, metricFn: metricProfitFactor, iterations: 2000 });
  console.log('Metrik avgReturn:', permAvg);
  console.log('Metrik ProfitFactor:', permPf);
  console.log(permAvg.pValue < 0.05
    ? '-> p-value < 0.05: SIGNIFIKAN, lebih baik dari nebak acak.'
    : '-> p-value >= 0.05: BELUM bisa dibedain dari acak -- edge PATUT DICURIGAI.');

  console.log('\n=== 2) DEFLATED SHARPE RATIO ===');
  const returns = signaled.map((r) => r.forward[HORIZON]).filter((v) => v != null);
  const psrRaw = probabilisticSharpeRatio(returns, 0);
  console.log(`PSR(0) tanpa penalti: ${psrRaw.ok ? (psrRaw.psr * 100).toFixed(1) + '%' : psrRaw.error}`);
  const dsr = deflatedSharpeRatio(returns, ESTIMATED_INDEPENDENT_TRIALS);
  console.log(dsr);
  if (dsr.ok) {
    console.log(`-> DSR = ${(dsr.dsr * 100).toFixed(2)}%`);
    console.log(dsr.dsr > 0.95 ? '-> DSR > 95%: KUAT.' : dsr.dsr > 0.5 ? '-> DSR di tengah, gak konklusif.' : '-> DSR rendah: PATUT DICURIGAI multiple-testing bias.');
  }

  console.log('\n=== 3) ULCER INDEX (gross, biaya belum dipotong) ===');
  const upi = ulcerPerformanceIndex(returns);
  console.log(`Total return: ${upi.totalReturnPct.toFixed(2)}%, Max DD: ${upi.maxDrawdownPct.toFixed(2)}%, Ulcer: ${upi.ulcerIndex.toFixed(3)}, UPI: ${upi.upi.toFixed(3)}`);

  console.log('\n=== 4) BREAKDOWN PER TAHUN (cek konsistensi, bukan cuma 1-2 tahun anomali) ===');
  const byYear = {};
  for (const r of signaled) { const y = new Date(r.ev.timeMs).getUTCFullYear(); (byYear[y] = byYear[y] || []).push(r); }
  for (const y of Object.keys(byYear).sort()) {
    const vals = byYear[y].map((r) => r.forward[HORIZON]).filter((v) => v != null);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const win = (vals.filter((v) => v > 0).length / vals.length) * 100;
    console.log(`  ${y}: n=${vals.length} avgReturn=${avg.toFixed(3)}% winRate=${win.toFixed(1)}%`);
  }
}

async function main() {
  const nfp = await collectAll('NFP', generateNfpEvents(2019, 2026));
  const cpi = await collectAll('CPI', generateCpiEvents());
  const ppi = await collectAll('PPI', generatePpiEvents());

  const allSignaled = [...nfp, ...cpi, ...ppi].filter((r) => r.direction !== 'NETRAL' && r.forward[HORIZON] != null);
  allSignaled.sort((a, b) => a.ev.timeMs - b.ev.timeMs);
  const longOnly = allSignaled.filter((r) => r.direction === 'LONG');

  console.log(`\nTotal event tergabung (NFP+CPI+PPI) dengan sinyal: ${allSignaled.length} (LONG=${longOnly.length}, SHORT=${allSignaled.length - longOnly.length})`);

  runValidation(longOnly, 'NFP+CPI+PPI GABUNGAN');

  console.log('\n\n=== Cek per-event-type sendiri-sendiri (sample lebih kecil, cuma buat konteks) ===');
  runValidation(nfp.filter((r) => r.direction === 'LONG' && r.forward[HORIZON] != null), 'NFP saja');
  runValidation(cpi.filter((r) => r.direction === 'LONG' && r.forward[HORIZON] != null), 'CPI saja');
  runValidation(ppi.filter((r) => r.direction === 'LONG' && r.forward[HORIZON] != null), 'PPI saja');
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR longOnlyEconReactionValidation.js:', e.message); process.exit(1); });
}

module.exports = { main };
