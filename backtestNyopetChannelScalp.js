// backtestNyopetChannelScalp.js (22 Sep 2026, ide Olan -- "channel-fade" super cepat, 5 menit) --
// riset AWAL, BELUM live, BELUM masuk sinyal manapun. Dibahas panjang di chat sebelum ditulis
// (bukan asumsi sepihak) -- rule-nya:
//
//   1. Channel PARALEL (2 trendline dari swing high & swing low, minimal 2 titik tiap sisi) --
//      reuse `detectChannel`/`channelLinesAt` (chartPatterns.js), BARU ditambah 22 Sep 2026.
//   2. Harga NYENTUH garis bawah (wick) -> BUY. Nyentuh garis atas -> SELL. Entry ANTISIPASI
//      (begitu wick nyentuh, LANGSUNG entry -- Olan: "walau ngewick kalo wicknya ga selebar
//      jarak garis pinggir ke tengah ga kena liq", jadi SL yang lebar nutupin resiko fakeout wick).
//   3. SL = separuh lebar channel (garis pinggir ke tengah) DI LUAR garis yang disentuh.
//      TP = garis TENGAH channel (bukan garis seberang) -- R:R 1:1 by design (Olan konfirmasi
//      eksplisit ini "balance", bukan imbalance, karena SL dan TP sama-sama selebar itu).
//   4. Begitu SL fade kena (= breakout kekonfirmasi) -> LANGSUNG reverse, buka posisi BARU arah
//      breakout, SL/TP posisi baru PAKAI LEBAR YANG SAMA (diukur dari titik breakout, bukan dari
//      channel lama) -- Olan: "jarak channel pinggir ke mid itu juga yang kupake panduan follow
//      the breakout". Kalau leg breakout ini JUGA kena SL (fakeout) -- terima rugi, channel
//      dianggap SELESAI (Olan: "kalo bisa 1 channel 1x trading aja").
//   5. "1 channel 1x trading" diartikan SATU SIKLUS (fade, +reverse kalau fade gagal) -- BUKAN
//      re-entry berkali-kali di channel yang sama, bahkan kalau fade pertama TP duluan.
//
// ⚠️ SIMPLIFIKASI yang BELUM divalidasi (dicatat jujur, bisa direvisit kalau hasil awal ini perlu
// difilter lebih ketat): `detectChannel` di sini TIDAK mensyaratkan "tiang" (pole/gerakan tajam)
// sebelum channel kebentuk -- channel APAPUN yang parallel+2 titik dicoba, bukan cuma abis gerakan
// besar kayak yang Olan gambarkan awal. Threshold lookback/toleransi paralel juga TITIK AWAL
// (belum di-tuning), sama status kayak semua threshold baru di proyek ini sebelum divalidasi.
//
// Posisi sizing PAKAI `hitung()` yang SAMA (calculator.js) -- leverage otomatis dari nyawa%
// (jarak SL), dibatasin MAX_LEVERAGE=50 (Olan eksplisit KONFIRMASI gak perlu pengecualian).

const { fetchWithRetry } = require('./httpRetry');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { hitung: hitungExposure } = require('./calculator');
const {
  metricProfitFactor, barPermutationTest, buildEquityCurve, ulcerIndex, maxDrawdownPct,
  ulcerPerformanceIndex, deflatedSharpeRatio,
} = require('./backtest/backtestValidation');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }

async function fetchAllCandles(symbol, interval, startTime) {
  let all = [];
  let cursor = startTime;
  for (;;) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    all = all.concat(raw.map(parseCandle));
    const last = raw[raw.length - 1][6];
    if (last <= cursor) break;
    cursor = last + 1;
    if (raw.length < 1000) break;
  }
  return all;
}

// Simulasi 1 leg (fade ATAU breakout-follow) -- jalan candle demi candle SETELAH entry, cek SL/TP
// mana duluan kena. Kalau 1 candle nyentuh DUA-DUANYA (wick lebar), KONSERVATIF anggap SL duluan
// (asumsi terburuk, bukan asumsi terbaik -- gaya proyek ini).
function simulateLeg(candles, entryIndex, dir, sl, tp) {
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const hitSL = dir === 'long' ? c.low <= sl : c.high >= sl;
    const hitTP = dir === 'long' ? c.high >= tp : c.low <= tp;
    if (hitSL) return { outcome: 'SL', r: -1, exitIndex: j };
    if (hitTP) return { outcome: 'TP', r: 1, exitIndex: j };
  }
  return { outcome: 'EOF', r: 0, exitIndex: candles.length - 1 };
}

// strategyFn(candles) -> array R-multiple, kontrak yang sama dipakai barPermutationTest
// (backtestValidation.js) -- reuse LANGSUNG, bukan bikin harness terpisah.
// maxWidthAtrMultiple=1.5 -- default channelOpts di detectChannel (3) TERLALU LONGGAR buat 5-menit
// (tes cepat 22 Sep: >300 trade/3,5 hari, jelas noise, bukan konsolidasi beneran). 1,5x ATR
// dipilih EMPIRIS dari smoke-test cepat (~13 trade/hari, kedengeran wajar buat "scalp super
// cepat") -- TITIK AWAL, sama status kayak semua threshold baru lain di proyek ini, BELUM di-tuning
// serius (belum coba grid search/optimasi, cuma "kelihatan masuk akal" dari sample kecil).
const DEFAULT_CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 };

function simulateChannelScalp(candles, opts = {}) {
  const { channelOpts = DEFAULT_CHANNEL_OPTS, tradeExpiryBars = 100, minLookahead = 45 } = opts;
  const trades = [];
  const detail = [];
  let i = minLookahead;
  let activeChannel = null;
  let channelFoundAt = 0;

  while (i < candles.length) {
    if (!activeChannel) {
      const ch = detectChannel(candles, i, channelOpts);
      if (ch) { activeChannel = ch; channelFoundAt = i; }
      i++;
      continue;
    }
    if (i - channelFoundAt > tradeExpiryBars) { activeChannel = null; continue; }

    const { top, bottom, mid } = channelLinesAt(activeChannel, i);
    const halfWidth = (top - bottom) / 2;
    if (halfWidth <= 0) { activeChannel = null; continue; }
    const c = candles[i];

    let dir = null, entryPrice = null;
    if (c.low <= bottom) { dir = 'long'; entryPrice = bottom; }
    else if (c.high >= top) { dir = 'short'; entryPrice = top; }

    if (!dir) { i++; continue; }

    const fadeSL = dir === 'long' ? entryPrice - halfWidth : entryPrice + halfWidth;
    const leg1 = simulateLeg(candles, i, dir, fadeSL, mid);
    trades.push(leg1.r);
    detail.push({ leg: 'fade', dir, entryPrice, sl: fadeSL, tp: mid, ...leg1, entryTime: c.closeTime });

    if (leg1.outcome === 'SL') {
      const revDir = dir === 'long' ? 'short' : 'long';
      const revEntry = fadeSL; // titik breakout
      const revSL = revDir === 'long' ? revEntry - halfWidth : revEntry + halfWidth;
      const revTP = revDir === 'long' ? revEntry + halfWidth : revEntry - halfWidth;
      const leg2 = simulateLeg(candles, leg1.exitIndex, revDir, revSL, revTP);
      trades.push(leg2.r);
      detail.push({ leg: 'breakout-follow', dir: revDir, entryPrice: revEntry, sl: revSL, tp: revTP, ...leg2 });
    }

    activeChannel = null; // 1 channel 1x siklus (Olan eksplisit) -- selesai, cari channel baru
    i++;
  }

  simulateChannelScalp._lastDetail = detail; // dibaca report -- HACK kecil biar barPermutationTest (yang cuma butuh returns) gak perlu diubah kontraknya
  return trades;
}

function winRate(returns) { return returns.filter((r) => r > 0).length / returns.length; }

async function main() {
  const days = 120;
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  console.log(`[BacktestNyopetChannelScalp] Fetch BTCUSDT 5m, ${days} hari terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime);
  console.log(`[BacktestNyopetChannelScalp] ${candles.length} candle 5m kefetch (${new Date(candles[0].openTime).toISOString().slice(0, 10)} -> ${new Date(candles[candles.length - 1].openTime).toISOString().slice(0, 10)}).`);

  const trades = simulateChannelScalp(candles);
  const detail = simulateChannelScalp._lastDetail;
  const fadeTrades = detail.filter((d) => d.leg === 'fade');
  const breakoutTrades = detail.filter((d) => d.leg === 'breakout-follow');

  console.log(`\n=== HASIL MENTAH (${days} hari, BTCUSDT 5m) ===`);
  console.log(`Total leg trade: ${trades.length} (${fadeTrades.length} fade, ${breakoutTrades.length} breakout-follow)`);
  console.log(`Win rate keseluruhan: ${(winRate(trades) * 100).toFixed(1)}%`);
  console.log(`Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  console.log(`Profit Factor: ${metricProfitFactor(trades).toFixed(2)}`);
  console.log(`Win rate fade doang: ${fadeTrades.length ? (winRate(fadeTrades.map((d) => d.r)) * 100).toFixed(1) : 'n/a'}%`);
  console.log(`Win rate breakout-follow doang: ${breakoutTrades.length ? (winRate(breakoutTrades.map((d) => d.r)) * 100).toFixed(1) : 'n/a'}%`);

  // Equity curve pakai asumsi risiko TETAP 1% ekuitas per-leg (standar proyek ini buat metrik
  // Ulcer/DSR -- sizing REAL nanti tetap pakai hitungExposure() dinamis, ini CUMA buat bandingin
  // "jalur" hasil, bukan simulasi P&L dolar beneran).
  const returnsPct = trades.map((r) => r * 1);
  const curve = buildEquityCurve(returnsPct);
  console.log(`\nUlcer Index: ${ulcerIndex(curve).toFixed(2)}`);
  console.log(`Max Drawdown: ${maxDrawdownPct(curve).toFixed(1)}%`);
  console.log(`Ulcer Performance Index: ${ulcerPerformanceIndex(returnsPct).upi.toFixed(2)}`);

  if (trades.length >= 30) {
    const dsr = deflatedSharpeRatio(returnsPct, 5); // numTrials=5 -- jumlah "variasi ide" yang lumrah dicoba riset kayak gini (titik awal, bukan hitungan presisi)
    console.log(`Deflated Sharpe Ratio: psr=${dsr.psr != null ? dsr.psr.toFixed(3) : 'n/a'} (>0.95 = kuat, mempertimbangkan multiple-testing)`);
  }

  if (trades.length >= 5) {
    console.log('\n=== BAR PERMUTATION TEST (acak bentuk candle, jalanin ulang strategi persis, 200x) ===');
    const perm = barPermutationTest(candles, (c) => simulateChannelScalp(c), metricProfitFactor, { iterations: 200 });
    if (perm.ok) {
      console.log(`Observed PF: ${perm.observedMetric.toFixed(2)} (n=${perm.observedTradeCount} trade)`);
      console.log(`Null mean PF (data acak): ${perm.nullMean.toFixed(2)} +- ${perm.nullStdDev.toFixed(2)} (rata2 ${perm.nullMeanTradeCount.toFixed(0)} trade/acakan)`);
      console.log(`p-value: ${perm.pValue.toFixed(3)} (< 0.05 = edge SIGNIFIKAN, bukan kebetulan statistik)`);
    } else {
      console.log('Permutation test gagal:', perm.error);
    }
  }

  console.log('\n⚠️ Ini RISET AWAL -- belum breakdown per-era, belum ada filter "tiang" sebelum channel,');
  console.log('threshold lookback/toleransi paralel masih titik awal. Lapor jujur ke Olan sebelum lanjut.');
}

module.exports = { simulateChannelScalp, simulateLeg };
if (require.main === module) { main().catch((e) => { console.error('ERROR backtestNyopetChannelScalp.js:', e.message); process.exit(1); }); }
