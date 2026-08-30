// Kaela Conviction Score -- gabungin SEMUA sinyal terpisah (teknikal, on-chain, sentimen, makro,
// posisi institusional, regime) jadi SATU skor/verdict per aset, gaya Bloomberg Intelligence:
// kesimpulan jelas + alasan pendukung, BUKAN sinyal-sinyal lepas yang pembaca harus rangkai
// sendiri. 22 Agu 2026 -- bagian terakhir dari "Kaela analis tier Bloomberg" (lihat memori
// project-kaela-analyst-tier), nyatuin semua modul yang udah dibangun sesi ini (macroData.js,
// cotReport.js, regimeTracker.js, onchainMetrics.js, marketSentiment.js, squeezeDetector.js).
//
// PRINSIP: SETIAP faktor nge-vote +1 (bullish)/-1 (bearish)/0 (netral) DENGAN ALASAN eksplisit
// yang ditampilkan -- bukan black box. Faktor yang datanya gagal diambil dilewatin (bukan
// dianggap 0/netral -- itu beda makna, "gak tau" vs "netral"), skor dihitung dari yang KETAHUAN
// aja + jujur soal berapa dari total yang missing. BUKAN backtest -- ini sintesis heuristik dari
// sinyal2 individual yang masing2 punya level keyakinan sendiri (mirip econDirectionalView.js).

function vote(condition, positiveIf, negativeIf, reasonPos, reasonNeg, reasonNeutral) {
  if (condition == null) return null;
  if (positiveIf(condition)) return { v: 1, reason: reasonPos };
  if (negativeIf(condition)) return { v: -1, reason: reasonNeg };
  return { v: 0, reason: reasonNeutral };
}

function verdictLabel(score, maxAbs) {
  const norm = maxAbs > 0 ? score / maxAbs : 0;
  if (norm >= 0.6) return '🟢 BULLISH KUAT';
  if (norm >= 0.25) return '🟢 Condong Bullish';
  if (norm <= -0.6) return '🔴 BEARISH KUAT';
  if (norm <= -0.25) return '🔴 Condong Bearish';
  return '⚪ NETRAL / Campuran';
}

// data: { rsi, mvrv, nupl, fearGreed, squeezeState, halvingPhase } -- semua opsional/null-safe,
// null = data gak ke-fetch (dilewatin dari skor, BUKAN dianggap netral).
function computeBtcConviction(data) {
  const factors = [];

  const rsiVote = vote(data.rsi, (v) => v < 30, (v) => v > 70,
    `RSI ${data.rsi?.toFixed(0)} oversold -- rawan technical bounce`,
    `RSI ${data.rsi?.toFixed(0)} overbought -- rawan technical pullback`,
    `RSI ${data.rsi?.toFixed(0)} netral`);
  if (rsiVote) factors.push({ label: 'RSI Teknikal', ...rsiVote });

  if (data.mvrv) {
    const mv = data.mvrv.classification;
    const v = mv.includes('Undervalued') ? 1 : mv.includes('Overvalued') ? -1 : 0;
    factors.push({ label: 'MVRV (on-chain)', v, reason: `${data.mvrv.value.toFixed(2)} -- ${mv}` });
  }

  if (data.nupl) {
    const nu = data.nupl.classification;
    const v = nu === 'Capitulation' ? 1 : nu === 'Euphoria / Greed' ? -1 : 0;
    factors.push({ label: 'NUPL (on-chain)', v, reason: `${data.nupl.value.toFixed(2)} -- ${nu}` });
  }

  if (data.fearGreed) {
    const c = data.fearGreed.classification;
    const v = c === 'Extreme Fear' ? 1 : c === 'Extreme Greed' ? -1 : 0;
    factors.push({ label: 'Fear & Greed', v, reason: `${data.fearGreed.value}/100 -- ${c} (kontrarian)` });
  }

  if (data.squeezeState) {
    const v = data.squeezeState === 'short_squeeze_setup' ? 1 : data.squeezeState === 'long_squeeze_setup' ? -1 : 0;
    const label = data.squeezeState === 'short_squeeze_setup' ? 'short numpuk, risiko harga MELONJAK'
      : data.squeezeState === 'long_squeeze_setup' ? 'long numpuk, risiko harga ANJLOK' : 'gak ada setup squeeze aktif';
    factors.push({ label: 'Squeeze Setup', v, reason: label });
  }

  // Stablecoin supply growth (22 Agu 2026, lihat advancedMacro.js) -- suplai USDT+USDC beredar
  // NAIK berarti dana segar lagi disiapin masuk crypto (leading indicator), TURUN berarti dana
  // lagi keluar/di-redeem. Ambang 1% mingguan cukup buat nandain gerakan berarti (bukan noise).
  if (data.stablecoinGrowth) {
    const v = data.stablecoinGrowth.changePct > 1 ? 1 : data.stablecoinGrowth.changePct < -1 ? -1 : 0;
    factors.push({ label: 'Stablecoin Supply', v, reason: `${data.stablecoinGrowth.changePct >= 0 ? '+' : ''}${data.stablecoinGrowth.changePct.toFixed(2)}% (7 hari) -- ${v > 0 ? 'dana segar masuk' : v < 0 ? 'dana keluar/redeem' : 'stabil'}` });
  }

  // M2 Money Supply YoY (22 Agu 2026, lihat advancedMacro.js) -- likuiditas global, BTC historis
  // korelasi ke pertumbuhan M2 (lebih banyak uang beredar = lebih banyak dana cari aset risiko).
  if (data.m2Growth && data.m2Growth.changePctYoY != null) {
    const v = data.m2Growth.changePctYoY > 5 ? 1 : data.m2Growth.changePctYoY < 0 ? -1 : 0;
    factors.push({ label: 'M2 Money Supply (YoY)', v, reason: `${data.m2Growth.changePctYoY.toFixed(1)}% -- ${v > 0 ? 'likuiditas melimpah, tailwind' : v < 0 ? 'likuiditas mengetat, headwind' : 'netral'}` });
  }

  if (data.halvingPhase) {
    const v = data.halvingPhase === 'TANAM' ? 1 : data.halvingPhase === 'PANEN' ? -1 : 0;
    factors.push({ label: 'Fase Siklus Halving', v, reason: data.halvingPhase || 'di luar window aktif' });
  }

  // Fed Funds Rate trend (22 Agu 2026, lihat advancedMacro.js) -- dipotong = dovish = bullish
  // aset risiko, dinaikkan = hawkish = bearish. Vote dari TREN 90 hari, bukan level absolut.
  if (data.fedRateTrend) {
    const v = data.fedRateTrend.arah.includes('DIPOTONG') ? 1 : data.fedRateTrend.arah.includes('DINAIKKAN') ? -1 : 0;
    factors.push({ label: 'Fed Funds Rate', v, reason: `${data.fedRateTrend.arah} -- ${data.fedRateTrend.efek}` });
  }

  // Credit Spread High-Yield (22 Agu 2026, lihat advancedMacro.js) -- BTC-only (efeknya ke Emas
  // ambigu/gak konsisten, gak dipaksa vote di sana). Melebar = risk-off = bearish BTC.
  if (data.creditSpreadTrend) {
    const v = data.creditSpreadTrend.arah === 'MENYEMPIT' ? 1 : data.creditSpreadTrend.arah === 'MELEBAR' ? -1 : 0;
    factors.push({ label: 'Credit Spread (High-Yield)', v, reason: `${data.creditSpreadTrend.arah} -- ${data.creditSpreadTrend.efek}` });
  }

  // ETF Flow (30 Agu 2026, lihat advancedMacro.js fetchBtcEtfFlow) -- duit institusi RIIL lewat
  // ETF spot BTC. Vote dari TREN 7 hari (bukan 1 hari doang, biar gak kejebak noise harian) --
  // mayoritas hari inflow = bullish, mayoritas outflow = bearish. BTC-only (belum ada sumber
  // gratis terverifikasi buat ETF Emas/GLD -- lihat catatan riset, JANGAN dipaksa ke Emas).
  if (data.etfFlow && data.etfFlow.totalDays7d >= 5) {
    const { positiveDays7d, totalDays7d, sum7dUsd } = data.etfFlow;
    const v = positiveDays7d >= totalDays7d - 1 ? 1 : positiveDays7d <= 1 ? -1 : 0;
    factors.push({
      label: 'ETF Flow (institusi)',
      v,
      reason: `${positiveDays7d}/${totalDays7d} hari inflow, net 7hari $${(sum7dUsd / 1e6).toFixed(0)}jt -- ${v > 0 ? 'akumulasi institusi konsisten' : v < 0 ? 'distribusi institusi konsisten' : 'campuran'}`,
    });
  }

  const score = factors.reduce((s, f) => s + f.v, 0);
  return { score, verdict: verdictLabel(score, factors.length), factors, totalFactors: factors.length };
}

// data: { rsi, dxyTrend, realYieldTrend, cot, fedRateTrend } -- semua opsional/null-safe.
function computeGoldConviction(data) {
  const factors = [];

  const rsiVote = vote(data.rsi, (v) => v < 30, (v) => v > 70,
    `RSI ${data.rsi?.toFixed(0)} oversold -- rawan technical bounce`,
    `RSI ${data.rsi?.toFixed(0)} overbought -- rawan technical pullback`,
    `RSI ${data.rsi?.toFixed(0)} netral`);
  if (rsiVote) factors.push({ label: 'RSI Teknikal', ...rsiVote });

  if (data.dxyTrend) {
    const v = data.dxyTrend.arah === 'MELEMAH' ? 1 : data.dxyTrend.arah === 'MENGUAT' ? -1 : 0;
    factors.push({ label: 'DXY (Dolar)', v, reason: `${data.dxyTrend.arah} -- Emas ${data.dxyTrend.efekEmas}` });
  }

  if (data.realYieldTrend) {
    const v = data.realYieldTrend.arah === 'TURUN' ? 1 : data.realYieldTrend.arah === 'NAIK' ? -1 : 0;
    factors.push({ label: 'Real Yield 10Y', v, reason: `${data.realYieldTrend.arah} -- Emas ${data.realYieldTrend.efekEmas}` });
  }

  // Fed Funds Rate trend -- sama arahnya kayak BTC (dipotong = bullish Emas juga, biaya peluang
  // pegang Emas ikut turun bareng suku bunga).
  if (data.fedRateTrend) {
    const v = data.fedRateTrend.arah.includes('DIPOTONG') ? 1 : data.fedRateTrend.arah.includes('DINAIKKAN') ? -1 : 0;
    factors.push({ label: 'Fed Funds Rate', v, reason: `${data.fedRateTrend.arah} -- ${data.fedRateTrend.efek}` });
  }

  // COT: net positioning EKSTREM (>=40% OI) diperlakukan sbg CAUTION (v=0, ditandain "crowded"),
  // BUKAN vote directional -- posisi ekstrem itu ambigu (bisa dibaca "smart money yakin" ATAU
  // "crowded trade, rawan unwind"), jujur gak dipaksa milih 1 arah. Moderat (15-40%) baru dianggap
  // vote directional ngikut arah posisinya.
  if (data.cot) {
    const abs = Math.abs(data.cot.netPctOi);
    let v = 0, reason;
    if (abs >= 40) {
      reason = `${data.cot.label} -- posisi EKSTREM, ditandain caution (bisa dibaca 2 arah: yakin ATAU crowded/rawan unwind), gak divote`;
    } else if (abs >= 15) {
      v = data.cot.net > 0 ? 1 : -1;
      reason = data.cot.label;
    } else {
      reason = data.cot.label;
    }
    factors.push({ label: 'COT Smart Money', v, reason });
  }

  const score = factors.reduce((s, f) => s + f.v, 0);
  return { score, verdict: verdictLabel(score, factors.length), factors, totalFactors: factors.length };
}

function formatConvictionLines(result) {
  const lines = [`🎯 KAELA CONVICTION SCORE: ${result.verdict} (${result.score >= 0 ? '+' : ''}${result.score} dari ${result.totalFactors} faktor)`];
  for (const f of result.factors) {
    const tag = f.v > 0 ? '🟢' : f.v < 0 ? '🔴' : '⚪';
    lines.push(`   ${tag} ${f.label}: ${f.reason}`);
  }
  lines.push('   ⚠️ Ini SINTESIS heuristik dari sinyal individual (bukan backtest gabungan) -- level keyakinan beda dari sinyal Sniper/Musiman yang diuji data historis.');
  return lines;
}

module.exports = { computeBtcConviction, computeGoldConviction, formatConvictionLines };
