// backtest/backtestValidation.js -- LAPISAN VALIDASI TAMBAHAN (6 Sep 2026, riset GitHub soal
// risk-management/backtest-rigor, permintaan Olan lanjutin) buat DITUMPUK di atas disiplin
// per-tahun+split-era+sensitivity-parameter yang UDAH ADA (bukan gantiin -- kalau salah satu gagal,
// tetap DITOLAK). 3 alat baru, diadaptasi dari repo open-source (BUKAN pakai library-nya langsung,
// cuma pola/rumusnya ditulis ulang plain JS biar zero-dependency, sesuai gaya proyek ini):
//
// 1. permutationTest -- dari neurotrader888/mcpt (Monte Carlo Permutation Test). Acak label
//    arah (LONG/SHORT) antar event SAMBIL nahan jumlah LONG/SHORT observasi asli, hitung ulang
//    metrik (PF/avgReturn) tiap acakan -> bandingin hasil ASLI vs distribusi acakan itu. Kalau
//    hasil asli GAK BEDA jauh dari acakan random, itu tanda deteksi arahnya gak beneran punya
//    edge (cuma kebetulan statistik).
// 2. deflatedSharpeRatio -- dari eslazarev/purged-cross-validation (konsep Bailey & Lopez de
//    Prado). Sharpe biasa gampang keliatan bagus kalau abis nyoba BANYAK parameter (multiple
//    testing) -- DSR "mendiskon" ekspektasi Sharpe terbaik yang bisa muncul CUMA dari keberuntungan
//    kalau nyoba `numTrials` variasi, baru bandingin Sharpe asli ke situ.
// 3. ulcerIndex/ulcerPerformanceIndex -- dari paper DaruFinance/Monte-Carlo-paper (temuan: PF/
//    Sharpe gabungan gampang jadi "kebetulan angka", metrik yang mikirin JALUR drawdown lebih
//    jujur). Ulcer Index = akar rata-rata kuadrat drawdown sepanjang equity curve (drawdown DALAM
//    + LAMA dihukum lebih berat drpd cuma lihat drawdown MAKSIMUM sesaat).
//
// ⚠️ SEMUA rumus statistik di sini pendekatan PRAKTIS (dipakai buat SARINGAN riset internal),
// BUKAN klaim ketepatan akademis penuh -- terutama `deflatedSharpeRatio` yang butuh varians Sharpe
// ANTAR-TRIAL asli (belum ada arsip itu di proyek ini), jadi default `varianceOfTrialSharpes=1`
// (asumsi umum dipakai kalau data itu gak ada -- lihat komentar di fungsinya). Kalau hasil READER
// meragukan, verifikasi manual sebelum dipakai jadi alasan tolak/terima strategi SENDIRIAN --
// tetap gabungin sama breakdown per-tahun+split-era (itu tetap yang paling penting).

// ============ Statistik dasar (dipakai fungsi-fungsi di bawah, gak dieksport sendiri) ============

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function stdDev(arr, ddof = 1) {
  const m = mean(arr);
  const sumSq = arr.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(sumSq / (arr.length - ddof));
}

// Skewness & kurtosis sampel SEDERHANA (moment-based, BUKAN versi bias-corrected akademis) --
// cukup buat kebutuhan PSR/DSR di bawah, yang penting konsisten dipakai bareng.
function skewness(arr) {
  const m = mean(arr);
  const sd = stdDev(arr, 0); // population, biar konsisten sama denominator formula PSR standar
  if (sd === 0) return 0;
  return mean(arr.map((x) => ((x - m) / sd) ** 3));
}
function kurtosis(arr) { // NON-excess (distribusi normal = 3), sesuai konvensi formula PSR Bailey/LdP
  const m = mean(arr);
  const sd = stdDev(arr, 0);
  if (sd === 0) return 3;
  return mean(arr.map((x) => ((x - m) / sd) ** 4));
}

// erf via pendekatan Abramowitz-Stegun 7.1.26 (akurasi ~1.5e-7) -- cukup buat kebutuhan di sini,
// gak perlu library statistik eksternal (zero-dependency, gaya proyek ini).
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

// Inverse normal CDF (quantile), algoritma rasional Peter Acklam -- dipakai expectedMaxSharpe.
function normalInvCdf(p) {
  if (p <= 0 || p >= 1) throw new Error(`normalInvCdf: p harus di antara 0-1 (dikasih ${p})`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ============ 1. Monte Carlo Permutation Test ============

// `rows`: array {direction:'LONG'|'SHORT', forward:{[horizon]: pctReturnSignedByGuess}} -- format
// PERSIS output analyzeEvent() di econReactionBacktest.js/econReactionBacktestCpiPpi.js.
// `metricFn(returnsArr)`: hitung 1 angka ringkasan dari array return (avgReturn atau PF) --
// caller yang nentuin (lihat exportedMetrics di bawah), biar modul ini gak hardcode definisi PF.
// Null hypothesis yang diuji: "label arah (LONG/SHORT) yang dideteksi TIDAK, punya info lebih dari
// nebak-arah-acak dengan proporsi LONG/SHORT yang SAMA" -- kalau observed gak beda jauh dari
// distribusi acakan (p-value tinggi), edge-nya PATUT DICURIGAI cuma kebetulan.
function permutationTest(rows, { horizon, metricFn, iterations = 2000 } = {}) {
  const raw = rows.map((r) => {
    const signed = r.forward[horizon];
    if (signed == null) return null;
    const sign = r.direction === 'LONG' ? 1 : -1; // ±1, self-invers -> balikin return MENTAH sebelum di-flip sesuai arah tebakan
    return { rawReturn: signed * sign, observedDirection: r.direction };
  }).filter(Boolean);
  if (raw.length < 5) return { ok: false, error: `Data terlalu sedikit buat permutation test (n=${raw.length}, minimal 5).` };

  const observedSigned = raw.map((r) => r.rawReturn * (r.observedDirection === 'LONG' ? 1 : -1));
  const observedMetric = metricFn(observedSigned);

  const directions = raw.map((r) => r.observedDirection);
  const nullMetrics = [];
  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffle(directions);
    const shuffledSigned = raw.map((r, idx) => r.rawReturn * (shuffled[idx] === 'LONG' ? 1 : -1));
    nullMetrics.push(metricFn(shuffledSigned));
  }
  nullMetrics.sort((a, b) => a - b);
  const countGte = nullMetrics.filter((m) => m >= observedMetric).length;
  const pValue = countGte / iterations;

  return {
    ok: true, n: raw.length, iterations, observedMetric,
    nullMean: mean(nullMetrics), nullStdDev: stdDev(nullMetrics),
    pValue, // < 0.05 = observed SIGNIFIKAN lebih baik dari acakan random (satu-arah, "lebih baik")
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Metrik siap-pakai buat `metricFn` (biar caller gak nulis ulang definisi avgReturn/PF tiap kali).
function metricAvgReturn(returns) { return mean(returns); }
function metricProfitFactor(returns) {
  const sumWin = returns.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const sumLoss = Math.abs(returns.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  if (sumLoss === 0) return sumWin > 0 ? Infinity : 0;
  return sumWin / sumLoss;
}

// ============ 2. Probabilistic & Deflated Sharpe Ratio ============

function sharpeRatio(returns) {
  const sd = stdDev(returns);
  if (sd === 0) return 0;
  return mean(returns) / sd;
}

// PSR(benchmarkSR) = peluang Sharpe ASLI (populasi) > benchmarkSR, dikoreksi skewness+kurtosis
// (rumus Bailey & Lopez de Prado -- "The Sharpe Ratio Efficient Frontier"). benchmarkSR=0 artinya
// "peluang strategi ini beneran > 0 secara statistik" (BUKAN cuma titik estimasi Sharpe > 0).
function probabilisticSharpeRatio(returns, benchmarkSR = 0) {
  const n = returns.length;
  if (n < 3) return { ok: false, error: `n terlalu kecil buat PSR (n=${n}, minimal 3).` };
  const srHat = sharpeRatio(returns);
  const skew = skewness(returns);
  const kurt = kurtosis(returns);
  const denom = Math.sqrt(1 - skew * srHat + ((kurt - 1) / 4) * srHat ** 2);
  if (!isFinite(denom) || denom === 0) return { ok: false, error: 'Denominator PSR gak valid (kemungkinan varians return = 0).' };
  const z = ((srHat - benchmarkSR) * Math.sqrt(n - 1)) / denom;
  return { ok: true, n, sharpeRatio: srHat, skewness: skew, kurtosis: kurt, psr: normalCdf(z) };
}

// E[max Sharpe] under null kalau nyoba `numTrials` variasi INDEPENDEN (parameter sweep dsb),
// pakai pendekatan Bailey & Lopez de Prado. `varianceOfTrialSharpes` IDEALNYA varians Sharpe
// ANTAR hasil sweep yang BENERAN pernah dicoba -- proyek ini BELUM punya arsip itu (tiap riset
// nyimpen hasil akhir doang, bukan distribusi Sharpe semua parameter yang dicoba), jadi default 1
// (konvensi umum kalau info itu gak ada) -- kasih tau eksplisit di hasil biar gak disalahartikan
// presisi penuh.
const EULER_MASCHERONI = 0.5772156649015329;
function expectedMaxSharpe(numTrials, varianceOfTrialSharpes = 1) {
  if (numTrials < 2) return 0;
  const sigma = Math.sqrt(varianceOfTrialSharpes);
  return sigma * ((1 - EULER_MASCHERONI) * normalInvCdf(1 - 1 / numTrials) + EULER_MASCHERONI * normalInvCdf(1 - 1 / (numTrials * Math.E)));
}

// ⚠️ KALIBRASI (ketauan 6 Sep 2026 pas dites ke 3 strategi live -- Chart Pattern+FVG BTC/Emas +
// Fed Dovish Grid): `varianceOfTrialSharpes=1` itu KONVENSI YANG BIASA DIPAKAI BUAT SHARPE
// ANNUALIZED (skala umum ~0,5-3). Kalau `returns` yang dikasih itu Sharpe PER-TRADE MENTAH (bukan
// diannualisasi -- skalanya jauh lebih kecil, ~0,1-0,4), DSR bisa JATUH KE ~0% WALAU strategi-nya
// beneran bagus (PSR/return riil kuat) -- itu ARTEFAK MISMATCH SKALA, bukan bukti strategi lemah.
// SEBELUM percaya angka DSR rendah sebagai bukti kuat, bandingin dulu sama PSR(0) (independen dari
// asumsi ini) dan return riil/UPI -- kalau ITU JUGA lemah (kayak kasus NFP: PSR cuma 80,6%, avg
// return tipis 0,049%/trade), DSR rendah nge-KUATIN kesimpulan. Kalau PSR(0) TINGGI (>90%) dan
// return riil substansial tapi DSR tetap ~0%, itu tanda MISMATCH KALIBRASI ini yang muncul, bukan
// strategi yang lemah -- JANGAN ambil tindakan cuma dari DSR rendah SENDIRIAN.
function deflatedSharpeRatio(returns, numTrials, varianceOfTrialSharpes = 1) {
  const benchmarkSR = expectedMaxSharpe(numTrials, varianceOfTrialSharpes);
  const result = probabilisticSharpeRatio(returns, benchmarkSR);
  if (!result.ok) return result;
  return { ...result, numTrials, varianceOfTrialSharpesAssumed: varianceOfTrialSharpes, expectedMaxSharpeUnderNull: benchmarkSR, dsr: result.psr };
}

// ============ 3. Ulcer Index & Ulcer Performance Index (Martin Ratio) ============

// `returnsPct`: array return PER-TRADE dalam PERSEN, diurutkan KRONOLOGIS (bukan acak) --
// caller WAJIB urutin dulu (biar equity curve merepresentasikan urutan kejadian asli, bukan
// urutan array sembarang).
function buildEquityCurve(returnsPct, startEquity = 100) {
  const curve = [startEquity];
  for (const r of returnsPct) curve.push(curve[curve.length - 1] * (1 + r / 100));
  return curve;
}

function drawdownSeriesPct(equityCurve) {
  let peak = equityCurve[0];
  return equityCurve.map((v) => {
    if (v > peak) peak = v;
    return ((peak - v) / peak) * 100;
  });
}

function maxDrawdownPct(equityCurve) { return Math.max(...drawdownSeriesPct(equityCurve)); }

// Ulcer Index = akar rata-rata kuadrat drawdown -- drawdown DALAM+LAMA dihukum kuadratik (lebih
// berat drpd cuma liat max drawdown sesaat), makanya "lebih jujur" soal jalur equity beneran.
function ulcerIndex(equityCurve) {
  const dd = drawdownSeriesPct(equityCurve);
  return Math.sqrt(mean(dd.map((d) => d ** 2)));
}

// Ulcer Performance Index / "Martin Ratio" -- total return dibagi Ulcer Index, analog Calmar tapi
// pembaginya drawdown-PATH (bukan cuma drawdown maksimum sesaat).
function ulcerPerformanceIndex(returnsPct) {
  const curve = buildEquityCurve(returnsPct);
  const totalReturnPct = ((curve[curve.length - 1] - curve[0]) / curve[0]) * 100;
  const ui = ulcerIndex(curve);
  return { totalReturnPct, ulcerIndex: ui, maxDrawdownPct: maxDrawdownPct(curve), upi: ui === 0 ? (totalReturnPct > 0 ? Infinity : 0) : totalReturnPct / ui };
}

// ============ 4. Bar-permutation (buat strategi LONG-only berbasis deteksi pola, BUKAN label
// arah per-event -- Chart Pattern+FVG/Fed Dovish Grid) ============
//
// `permutationTest` di atas (acak label arah) gak masuk akal buat strategi ini -- gak ada "arah"
// buat diacak (LONG-only), dan entry-nya dari DETEKSI POLA di candle, bukan event diskrit.
// Null hypothesis yang lebih pas: "apa DETEKSI POLA beneran nemuin momen entry yang lebih bagus
// dari 'kebetulan urutan candle-nya begitu' -- kalau URUTAN candle diacak (bentuk tiap bar
// dipertahankan, CUMA urutannya diacak), apa pattern-detector yang SAMA masih nemuin hasil
// SEBAGUS itu?" Ini pola "bar permutation" dari neurotrader888/mcpt.
//
// Caranya: ambil rasio open/high/low tiap bar RELATIF ke close bar sebelumnya + log-return
// close-to-close, ACAK urutan tuple itu, susun ulang jadi candle series SINTETIS (bentuk tiap bar
// dipertahankan persis, urutan waktu antar-bar yang berubah) -- lalu jalanin STRATEGI YANG SAMA
// PERSIS (pattern detector + simulasi) di candle sintetis itu, bandingin hasilnya ke candle ASLI.
function permuteBarSeries(candles) {
  const n = candles.length;
  if (n < 3) throw new Error('permuteBarSeries: candle terlalu sedikit.');
  const shapes = [];
  for (let i = 1; i < n; i++) {
    const prevClose = candles[i - 1].close;
    const c = candles[i];
    shapes.push({
      logReturn: Math.log(c.close / prevClose),
      openRatio: c.open / prevClose, highRatio: c.high / prevClose, lowRatio: c.low / prevClose,
    });
  }
  const shuffled = shuffle(shapes);
  const result = [{ ...candles[0] }]; // bar pertama TETAP (anchor harga awal)
  let close = candles[0].close;
  for (let i = 0; i < shuffled.length; i++) {
    const s = shuffled[i];
    const newClose = close * Math.exp(s.logReturn);
    // openTime/closeTime dari POSISI ASLI (bukan ikut si shape yang diacak) -- cuma buat
    // kompatibilitas kode strategi yang butuh timestamp berurutan, GAK mempengaruhi hasil uji
    // (strategi cuma peduli urutan+bentuk harga, bukan tanggal kalender asli).
    result.push({
      openTime: candles[i + 1].openTime, closeTime: candles[i + 1].closeTime,
      open: close * s.openRatio, high: close * s.highRatio, low: close * s.lowRatio, close: newClose,
    });
    close = newClose;
  }
  return result;
}

// `strategyFn(candles) -> array return per-trade (angka, boleh rMultiple/pnlPct apa aja asal
// KONSISTEN)` -- caller yang nentuin (reuse fungsi backtest yang UDAH ADA, biar gak duplikasi
// logika strategi di modul ini). `metricFn(returnsArr)` sama kayak permutationTest di atas.
function barPermutationTest(candles, strategyFn, metricFn, { iterations = 200 } = {}) {
  const observedReturns = strategyFn(candles);
  if (observedReturns.length < 5) return { ok: false, error: `Trade asli terlalu sedikit (n=${observedReturns.length}).` };
  const observedMetric = metricFn(observedReturns);
  const observedCount = observedReturns.length;

  const nullMetrics = [];
  const nullCounts = [];
  for (let i = 0; i < iterations; i++) {
    const synthetic = permuteBarSeries(candles);
    const returns = strategyFn(synthetic);
    nullCounts.push(returns.length);
    nullMetrics.push(returns.length > 0 ? metricFn(returns) : 0);
  }
  nullMetrics.sort((a, b) => a - b);
  const countGte = nullMetrics.filter((m) => m >= observedMetric).length;
  return {
    ok: true, observedMetric, observedTradeCount: observedCount, iterations,
    nullMean: mean(nullMetrics), nullStdDev: stdDev(nullMetrics), nullMeanTradeCount: mean(nullCounts),
    pValue: countGte / iterations,
  };
}

module.exports = {
  permutationTest, metricAvgReturn, metricProfitFactor,
  permuteBarSeries, barPermutationTest,
  sharpeRatio, probabilisticSharpeRatio, deflatedSharpeRatio, expectedMaxSharpe,
  buildEquityCurve, drawdownSeriesPct, maxDrawdownPct, ulcerIndex, ulcerPerformanceIndex,
  // internal, diexport CUMA buat kebutuhan self-test (backtestValidation.selftest.js)
  _internal: { mean, stdDev, skewness, kurtosis, normalCdf, normalInvCdf, erf },
};
