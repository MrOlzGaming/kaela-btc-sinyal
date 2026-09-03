// Riset 22 Agu 2026 (permintaan Olan: pelajari SMC/Fair Value Gap, backtest). FVG = pola 3 candle:
// candle1.high < candle3.low (gap NAIK, dianggap "support" -- zona yang belum sempat ditransaksikan
// krn harga gerak kelewat cepat). Entry: harga koreksi balik masuk zona FVG (masih AKTIF/belum
// "keisi" penuh) + konfirmasi pantul (tutup balik di atas batas atas gap -- BUKAN cuma nyentuh,
// belajar dari bug Fibonacci sebelumnya). SL di bawah batas bawah gap (invalidasi -- kalau gap
// keisi PENUH, thesis support-nya gugur). Filter tren SMA200 (pelajaran dari Fibonacci: jangan
// beli gap pas lagi di tengah downtrend besar). Exit pakai mekanisme 2-tier yang SAMA/tervalidasi.

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');

function detectBullishFVG(daily, i) {
  // candle1 = i-2, candle2(displacement) = i-1, candle3 = i
  if (i < 2) return null;
  const c1 = daily[i - 2], c3 = daily[i];
  if (c1.high < c3.low) return { gapTop: c3.low, gapBottom: c1.high, createdIdx: i };
  return null;
}

function runFVGBacktest(daily, opts = {}) {
  const {
    warmupDays = 60,
    partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    maxMarginPct = 20, trendSmaLen = 200,
    minGapPct = 0, // filter opsional: gap minimal sekian % dari harga (0 = semua gap dihitung)
  } = opts;

  const trades = [];
  const signals = [];
  let activeFvgs = []; // {gapTop, gapBottom, createdIdx}
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    // Deteksi FVG baru hari ini (candle3 = hari ini)
    const fvg = detectBullishFVG(daily, i);
    if (fvg) {
      const gapPct = (fvg.gapTop - fvg.gapBottom) / fvg.gapTop * 100;
      if (gapPct >= minGapPct) activeFvgs.push(fvg);
    }

    // Buang FVG yang udah "keisi PENUH" (low tembus ke bawah gapBottom)
    activeFvgs = activeFvgs.filter((z) => {
      if (i <= z.createdIdx) return true; // hari yang sama dgn pembentukan, belum bisa dites isi
      return today.low > z.gapBottom;
    });

    if (openPos) {
      const closesSoFar = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closesSoFar, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = today.low <= openPos.sl;
        const hitPartial = today.high >= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitPartial) {
          const rewardPct = Math.abs(openPos.partialTp - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitHalf = openPos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf;
          openPos.realizedPnl = profitHalf; openPos.partialDone = true; openPos.sl = openPos.entryPrice;
        }
      } else {
        const hitSl = today.low <= openPos.sl;
        const trendBroken = trailSma !== null && today.close < trailSma;
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: riskPct > 0 ? movePctSigned / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

    // Filter tren besar
    if (trendSmaLen !== null) {
      const closesSoFarTrend = daily.slice(0, i + 1).map((c) => c.close);
      const trendSma = sma(closesSoFarTrend, trendSmaLen);
      if (trendSma !== null && today.close < trendSma) continue;
    }

    // Cari FVG aktif yang harga BARU AJA pantul keluar (tutup > gapTop, abis sempat masuk zona).
    // 3 Sep 2026 -- tambah batas jarak (maxDistanceFromGapPct), SAMAIN sama fix live di
    // fvgDetector.js (bug ketemu Olan: entry bisa jauh dari gap kalau dibiarin lama). Di backtest
    // ini efeknya minimal (tiap hari SELALU dicek ulang, jadi jarang sempat "stale") -- ditambahin
    // murni biar 1 sumber kebenaran sama persis kayak yang live, gak diam-diam beda lagi ke depan.
    const { maxDistanceFromGapPct = 3 } = opts;
    // ⚠️ Ketemu 3 Sep 2026 (cross-check angka sama Olan) -- `activeFvgs` ke-push urut KRONOLOGIS
    // (tua->baru), TAPI `.find()` balikin match PERTAMA = gap PALING TUA. Live (fvgDetector.js)
    // sebaliknya: loop `for k=i-1; k>=2` = cek gap PALING BARU duluan. Backtest+live jadi milih
    // GAP BEDA kalau ada >1 aktif bareng -- bukan cuma soal jarak doang. Fix: scan MUNDUR (dari
    // yang paling baru ke-push) biar bener-bener 1 sumber kebenaran sama live, bukan cuma rumus
    // deteksinya doang yang sama.
    let zone = null;
    for (let zi = activeFvgs.length - 1; zi >= 0; zi--) {
      const z = activeFvgs[zi];
      if (i <= z.createdIdx) continue;
      if (!z._touched && today.low <= z.gapTop) z._touched = true;
      if (!z._touched || today.close <= z.gapTop) continue;
      const distancePct = (today.close - z.gapTop) / z.gapTop * 100;
      if (distancePct > maxDistanceFromGapPct) continue;
      zone = z; break;
    }
    if (!zone) continue;

    const lastPrice = today.close;
    const sl = zone.gapBottom;
    const riskDistance = lastPrice - sl;
    if (riskDistance <= 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = lastPrice + riskDistance * partialRR;

    signals.push({ time: today.closeTime, price: lastPrice, gapTop: zone.gapTop, gapBottom: zone.gapBottom });
    openPos = {
      direction: 'buy', entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: 'fvg_bounce',
    };
    activeFvgs = activeFvgs.filter((z) => z !== zone); // 1 FVG cuma dipakai sekali
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, signals, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return { n, winRate: (wins.length / n * 100).toFixed(1) + '%', profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf', totalR: totalR.toFixed(2), avgR: (totalR / n).toFixed(2) };
}

module.exports = { runFVGBacktest, detectBullishFVG, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'backtest', 'daily-cache.json'), 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(30), '| sinyal='+r.signals.length, '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| totalR='+s.totalR, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== FVG Bounce (filter minGapPct sweep) ===');
  for (const mg of [0, 1, 2, 3, 5]) {
    line('minGapPct=' + mg, runFVGBacktest(daily, { minGapPct: mg }));
  }
}
