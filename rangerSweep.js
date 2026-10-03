// rangerSweep.js (3 Okt 2026) -- deteksi "ICT liquidity sweep" 4 jam buat Ranger BTC (slot ke-3 rangerBtcDualExec.js).
//
// Asal: riset ICT Power of 3 / AMD permintaan Olan ("pelajari akumulasi-manipulasi-distribusi, deteksi, backtest, terapkan
// ke tempat yang pantas"). Versi INTRADAY (range Asia -> sapuan London -> NY) GAGAL setelah fee (backtest/ictPo3Study.js,
// 0/144 varian). Versi 4 JAM LOLOS (backtest/ictSweepHtfStudy.js, BTC 2019-10..2026-09, fee 0,1%):
//   "MANIPULASI" = candle 4H nyapu low terendah 20 candle sebelumnya (stop orang di bawah situ) lalu CLOSE balik di atasnya
//   -> LONG; mirror buat high -> SHORT. Filter tren SMA300 4H (~50 hari): long cuma kalau close >= SMA, short <= SMA.
//   SL = ujung sapuan +/- 0,1%. Exit = trailing 3x invalidasi (aturan Olan, standar BTC). 2 arah: PF 1,45 (2019-22) /
//   1,55 (2023-26), n=353; vs entry ACAK dgn risiko & exit sama: PF median 1,03 -> p=0,000 (pola beneran nambah edge).
// Fungsi MURNI (gak ada I/O) -- dipakai live (rangerAutoTrader.js) DAN dicek paritasnya sama backtest.

const SWEEP_PARAMS = { look: 20, trendLen: 300, slBufferPct: 0.1, minRiskPct: 0.3, maxRiskPct: 5 };

// candles: [{open,high,low,close}] candle 4H CLOSED, i = index candle sinyal (biasanya terakhir)
function detectSweepSignal(candles, i, params = SWEEP_PARAMS) {
  const p = { ...SWEEP_PARAMS, ...params };
  if (i < Math.max(p.look, p.trendLen - 1) + 1) return null;
  const x = candles[i];
  let swLo = Infinity, swHi = -Infinity;
  for (let k = i - p.look; k < i; k++) { swLo = Math.min(swLo, candles[k].low); swHi = Math.max(swHi, candles[k].high); }
  let s = 0; for (let k = i - p.trendLen + 1; k <= i; k++) s += candles[k].close;
  const smaTrend = s / p.trendLen;
  let direction = null;
  if (x.low < swLo && x.close > swLo) direction = 'buy';
  else if (x.high > swHi && x.close < swHi) direction = 'sell';
  if (!direction) return null;
  if (direction === 'buy' ? x.close < smaTrend : x.close > smaTrend) return null;
  const sl = direction === 'buy' ? x.low * (1 - p.slBufferPct / 100) : x.high * (1 + p.slBufferPct / 100);
  const riskPct = Math.abs(x.close - sl) / x.close * 100;
  if (riskPct < p.minRiskPct || riskPct > p.maxRiskPct) return null;
  return {
    direction, sl, patternType: 'ict_sweep', mode: 'ict_sweep',
    sweptLevel: direction === 'buy' ? swLo : swHi, sweepExtreme: direction === 'buy' ? x.low : x.high, smaTrend, riskPct,
    reasoning: `ICT liquidity sweep 4H: candle nyapu ${direction === 'buy' ? 'low' : 'high'} ${p.look} candle ($${(direction === 'buy' ? swLo : swHi).toFixed(0)}) lalu close balik ke dalam -- ${direction === 'buy' ? 'manipulasi turun abis, distribusi NAIK' : 'manipulasi naik abis, distribusi TURUN'} (searah tren SMA${p.trendLen} 4H).`,
  };
}

module.exports = { detectSweepSignal, SWEEP_PARAMS };
