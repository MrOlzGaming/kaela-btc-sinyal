// Analisa Sniper MANUAL, kapan aja -- versi read-only dari sniperAutoAnalysis.js (15 Agu 2026,
// permintaan Olan: "bantu analisa manual untuk sniper.. laporan taruh sini aja"). Fetch data
// SEGAR + jalanin logika VALID/INVALID yang SAMA PERSIS kayak cron harian, tapi TIDAK PERNAH
// createOrder/sendWhatsApp/saveTriggerState -- murni buat ngintip kondisi pasar kapan aja tanpa
// nyentuh state live atau ngirim WA. Aman dijalanin berkali-kali sehari.

const { analyze, fetchCandles } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { getActiveOrders } = require('./sniperOrders');
const { hitung: hitungExposure } = require('./calculator');
const { getBalance: getKaelaBalance } = require('./kaelaBankroll');
const { fetchWithRetry } = require('./httpRetry');
const { analyzeSentiment } = require('./marketSentiment');
const { fetchTradeMetrics } = require('./onchainMetrics');

const MAX_MARGIN_PCT = 20;
const MAX_NYAWA_PCT = 20;
const PARTIAL_RR = 2;
const PATTERN_HISTORY_DAYS = 200;

async function safeSentiment() {
  try { return await analyzeSentiment('BTCUSDT'); } catch (e) { return null; }
}
async function safeOnchain() {
  try { return await fetchTradeMetrics(); } catch (e) { return null; }
}
async function fetchLivePrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function main() {
  console.log('=== Sniper -- analisa manual (dry, gak nulis state/order/WA apapun) ===');
  console.log(new Date().toISOString(), '\n');

  const active = getActiveOrders().filter((o) => !o.silentTest);
  if (active.length > 0) {
    const order = active[0];
    console.log(`Ada posisi bayangan ${order.status} (${order.signalId}, ${order.direction} @ $${order.entryPrice || order.triggerPrice}) -- Sniper gak nyari sinyal baru selama ini masih terbuka.`);
    if (order.status === 'floating') {
      const livePrice = await fetchLivePrice();
      const pnlPct = order.direction === 'buy' ? (livePrice - order.entryPrice) / order.entryPrice * 100 : (order.entryPrice - livePrice) / order.entryPrice * 100;
      console.log(`Harga sekarang: $${livePrice.toLocaleString('en-US')} | SL: $${order.sl.toLocaleString('en-US')} | TP tahap1: $${order.tp.toLocaleString('en-US')} | Floating: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
    }
    return;
  }

  const [ta, daily, livePrice, sentiment, onchain] = await Promise.all([
    analyze('BTCUSDT'), fetchCandles('BTCUSDT', '1d', PATTERN_HISTORY_DAYS), fetchLivePrice(), safeSentiment(), safeOnchain(),
  ]);

  const dailyClose = daily[daily.length - 1].close;
  const signal = detectPatternSignal(daily, daily.length - 1, { allowShort: false });

  console.log(`Harga sekarang: $${livePrice.toLocaleString('en-US')} | Candle harian close terakhir: $${dailyClose.toLocaleString('en-US')}`);
  if (ta) console.log(`Teknikal: RSI14=${ta.rsi14Daily != null ? ta.rsi14Daily.toFixed(1) : '-'} | MA20=${ta.ma.ma20 != null ? ta.ma.ma20.toFixed(0) : '-'} | MA50=${ta.ma.ma50 != null ? ta.ma.ma50.toFixed(0) : '-'} | MA200=${ta.ma.ma200 != null ? ta.ma.ma200.toFixed(0) : '-'} | Tren mingguan=${ta.weeklyTrend || '-'}`);
  if (sentiment) console.log('Sentimen:', JSON.stringify(sentiment));
  if (onchain) console.log('On-chain:', JSON.stringify(onchain));

  if (!signal) {
    console.log('\n❌ INVALID -- belum ada pola Bull Flag/Pennant atau Falling Wedge yang breakout candle harian ini.');
    return;
  }

  const { direction, sl, patternType } = signal;
  const riskDistance = Math.abs(livePrice - sl);
  const nyawaPct = riskDistance / livePrice * 100;
  const patternLabel = { flag_bull: 'Bull Flag/Pennant', flag_bear: 'Bear Flag/Pennant', wedge_falling: 'Falling Wedge', wedge_rising: 'Rising Wedge' }[patternType] || patternType;

  console.log(`\n🟢 Pola terdeteksi: ${patternLabel} (${direction.toUpperCase()})`);
  console.log(`SL: $${sl.toLocaleString('en-US')} | Nyawa: ${nyawaPct.toFixed(1)}% (batas ${MAX_NYAWA_PCT}%)`);

  if (riskDistance === 0) { console.log('Jarak SL 0 -- gak valid, harga = SL.'); return; }
  if (nyawaPct > MAX_NYAWA_PCT) { console.log(`❌ INVALID -- nyawa ngelewatin batas ${MAX_NYAWA_PCT}%.`); return; }

  const partialTp = direction === 'buy' ? livePrice + riskDistance * PARTIAL_RR : livePrice - riskDistance * PARTIAL_RR;
  console.log(`TP tahap 1 (${PARTIAL_RR}x risiko): $${partialTp.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

  const modal = getKaelaBalance();
  const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sl });
  console.log(`\nSizing (bankroll bayangan Kaela $${modal}): exposure ${calc.exposure}x | leverage ${calc.leverage}x | margin $${calc.margin.toFixed(2)} (${calc.marginPct.toFixed(1)}% modal, batas ${MAX_MARGIN_PCT}%)`);

  if (calc.marginPct > MAX_MARGIN_PCT) {
    console.log(`❌ INVALID -- margin ngelewatin batas ${MAX_MARGIN_PCT}%.`);
    return;
  }

  console.log('\n✅ VALID -- syarat kepenuhi. (Ini analisa DRY, gak buka posisi bayangan/kirim WA -- cron harian yang beneran eksekusi kalau memang belum jalan hari ini.)');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
