// Pengumuman SEKALI PAKAI (22 Agu 2026) -- sinyal PERDANA Kaela Conviction Score, dipicu manual
// (bukan nunggu jadwal Senin) sesuai permintaan Olan. Pakai LOGIKA & DATA SAMA PERSIS kayak
// weekly block groupMonitor.js -- verdict ini BENERAN dicatat ke track record (logVerdict) dan
// analyst-dashboard.json, BUKAN cuma simulasi/demo. Siklus mingguan normal (Senin) tetap jalan
// seperti biasa setelah ini -- refresh berikutnya cuma 2 hari lagi, itu wajar/gak masalah.

const fs = require('fs');
const path = require('path');
const { getWindowPhase } = require('./groupReport');
const { fetchCycleMetrics, fetchTradeMetrics } = require('./onchainMetrics');
const { fetchMacroContext } = require('./macroData');
const { fetchGoldCotContext } = require('./cotReport');
const { fetchBtcNasdaqRegime, fetchGoldDxyRegime } = require('./regimeTracker');
const { fetchFearGreed } = require('./marketSentiment');
const { rsi, fetchCandles } = require('./technicalAnalysis');
const { computeBtcConviction, computeGoldConviction, formatConvictionLines } = require('./convictionScore');
const { logVerdict, formatTrackRecordLine } = require('./trackRecord');
const { fetchAdvancedMacroContext, classifyFedRateTrend, classifyCreditSpreadTrend } = require('./advancedMacro');
const { sendWhatsApp } = require('./fonnte');
const { WEB_URL } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[InauguralAnalysis] ${label} gagal diambil (dilewatin):`, e.message.slice(0, 150));
    return null;
  }
}

function readSqueezeState() {
  try {
    const p = path.join(__dirname, 'squeeze-alert-state.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')).lastType || null;
  } catch {
    return null;
  }
}

async function fetchLivePrice(symbol) {
  const res = await require('./httpRetry').fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
  return parseFloat((await res.json()).price);
}

async function main() {
  const now = new Date();

  const [btcCandles, goldCandles, btcPrice, goldPrice, onchain, nupl, fearGreed, advancedMacro, btcRegime, macro, cot, goldRegime] = await Promise.all([
    fetchCandles('BTCUSDT', '1d', 30),
    fetchCandles('PAXGUSDT', '1d', 30),
    fetchLivePrice('BTCUSDT'),
    fetchLivePrice('PAXGUSDT'),
    safe(fetchCycleMetrics, 'On-chain Cycle'),
    safe(async () => (await fetchTradeMetrics()).nupl, 'NUPL'),
    safe(fetchFearGreed, 'Fear & Greed'),
    safe(fetchAdvancedMacroContext, 'Advanced Macro'),
    safe(fetchBtcNasdaqRegime, 'BTC-Nasdaq Regime'),
    safe(fetchMacroContext, 'Macro (DXY/RealYield)'),
    safe(fetchGoldCotContext, 'COT'),
    safe(fetchGoldDxyRegime, 'Emas-DXY Regime'),
  ]);

  const btcConviction = computeBtcConviction({
    rsi: rsi(btcCandles.map((c) => c.close), 14),
    mvrv: onchain?.mvrv || null, nupl, fearGreed,
    squeezeState: readSqueezeState(),
    halvingPhase: getWindowPhase(now),
    stablecoinGrowth: advancedMacro?.stablecoin || null,
    m2Growth: advancedMacro?.m2 || null,
    fedRateTrend: advancedMacro?.fedRate ? classifyFedRateTrend(advancedMacro.fedRate) : null,
    creditSpreadTrend: advancedMacro?.creditSpread ? classifyCreditSpreadTrend(advancedMacro.creditSpread) : null,
  });
  const goldConviction = computeGoldConviction({
    rsi: rsi(goldCandles.map((c) => c.close), 14),
    dxyTrend: macro?.dxy?.trend || null, realYieldTrend: macro?.realYield?.trend || null, cot,
    fedRateTrend: advancedMacro?.fedRate ? classifyFedRateTrend(advancedMacro.fedRate) : null,
  });

  logVerdict('btc', now, btcConviction.score, btcConviction.verdict, btcPrice);
  logVerdict('xau', now, goldConviction.score, goldConviction.verdict, goldPrice);

  const dashboardData = {
    btc: { price: btcPrice, conviction: btcConviction, trackRecord: null, regime: btcRegime, advancedMacro },
    xau: { price: goldPrice, conviction: goldConviction, trackRecord: null, regime: goldRegime, macro, cot, yieldCurve: advancedMacro?.yieldCurve || null },
    updatedAt: now.toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, 'analyst-dashboard.json'), JSON.stringify(dashboardData, null, 2));

  const msg = [
    `${CATEGORY_COLOR.laporan.emoji} 🎉 KAELA CONVICTION SCORE — SINYAL PERDANA`,
    '',
    `🟧 BTC ($${btcPrice.toLocaleString('en-US')})`,
    ...formatConvictionLines(btcConviction),
    '',
    `🟡 XAU/Emas ($${goldPrice.toLocaleString('en-US')})`,
    ...formatConvictionLines(goldConviction),
    '',
    'Mulai sekarang update tiap Senin -- track record baru mulai dinilai 7 hari lagi.',
    '',
    `🔗 ${WEB_URL}/analis.html`,
  ].join('\n');

  console.log(msg);
  await sendWhatsApp(msg);
}

main().catch((e) => {
  console.error('ERROR sendInauguralAnalysis.js:', e.message);
  process.exit(1);
});
