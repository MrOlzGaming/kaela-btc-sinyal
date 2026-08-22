// Jalankan 1x sehari, abis candle HARIAN closing (00:00 UTC = 08:00 WITA -- pas jadwal
// sniper-daily-trigger.yml, 00:05 UTC): analisa gabungan OTOMATIS (teknikal + sentimen +
// on-chain) -> kesimpulan VALID/INVALID -> kalau VALID langsung catat "posisi bayangan" (shadow
// -- TIDAK ADA uang beneran) dan kirim WA. Kaela BUKAN eksekutor finansial -- keputusan Olan
// 9 Agu 2026, murni "kalkulator logika".
//
// UPGRADE BESAR (22 Agu 2026, riset+validasi backtestCombinedMultiPos.js/backtestFVG.js/
// halvingBearWindow.js): dari 1-posisi-BTC-doang jadi MULTI-ASET (BTC + XAU/Emas) x MULTI-MODE
// (Sniper pola chart + FVG), MULTI-POSISI FLOATING bareng (maks 1 slot per aset per mode, jadi
// maks 4 posisi sekaligus: BTC-Sniper, BTC-FVG, XAU-Sniper, XAU-FVG). Tiap entry baru pakai
// SALDO AVAILABLE (bankroll total - margin yang udah kepake posisi lain yang masih floating),
// BUKAN modal penuh -- exposure calculator ASLI tetap dipakai penuh (gak diganti), cuma basis
// modalnya yang disesuaikan. BTC dapat tambahan filter: window "istirahat" siklus halving
// (halvingBearWindow.js) -- Sniper+FVG BTC DIMATIKAN sementara pas fase pasca-puncak siklus yang
// historis rawan bear/crash (validasi: modal akhir naik $39.156->$48.363 dgn filter ini).
//
// Sentimen (Fear&Greed+funding) dan on-chain (SOPR/NUPL) itu metrik MAKRO KRIPTO -- gak
// relevan/gak ada buat emas, jadi CUMA di-fetch buat BTC.
//
// ⚠️ Batas margin 20% DICABUT (22 Agu 2026, permintaan eksplisit Olan: "gas terus, jangan
// patokan modal Kaela/Olan yang tipis kayak tisu.. posisimu juga cuma bayangan.. tetep on") --
// mode AGRESIF sengaja buat fase "kanak-kanak" bankroll bayangan Kaela ($100-1000-an), sadar
// bikin performa live Kaela BEDA dari backtest yang selalu hormat batas 20% (backtest TETAP
// acuan riset terpisah, gak ikut berubah). Topup $100/bln sampai $1000 tetap jalan sbg jaring
// pemulihan. MAX_NYAWA_PCT (kualitas pola, BUKAN soal ukuran modal) TETAP berlaku, gak dicabut.
// Kalkulator exposure (leverage cap 50x) tetap jaring pengaman terakhir yang jalan.

const fs = require('fs');
const path = require('path');
const { analyze, fetchCandles } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { detectFvgSignal } = require('./fvgDetector');
const { getActiveOrders, getClosedOrders, createOrder, updateOrder } = require('./sniperOrders');
const { hitung: hitungExposure } = require('./calculator');
const { checkAndApplyTopUp, getBalance: getKaelaBalance } = require('./kaelaBankroll');
const { formatAutoValid, formatAutoInvalid, formatPositionMonitor } = require('./sniperOrderLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey, isWaMuted } = require('./config');
const { analyzeSentiment } = require('./marketSentiment');
const { fetchTradeMetrics } = require('./onchainMetrics');
const { ASSETS } = require('./assetConfig');
const { isBtcBearWindow } = require('./halvingBearWindow');
const { detectWatchingPattern, detectWatchingFvg } = require('./patternWatchlist');
const { isLiveTradingEnabled, isTestnet } = require('./killSwitch');
const { setLeverage, placeMarketEntry, placeStopLoss, placeTakeProfit } = require('./binanceExecutor');

const MAX_MARGIN_PCT = 20;
const MAX_NYAWA_PCT = 20;
const PARTIAL_RR = 2;
const TRAIL_SMA_LEN = 10;
const PATTERN_HISTORY_DAYS = 200;

async function safeSentiment(symbol) {
  try {
    return await analyzeSentiment(symbol);
  } catch (e) {
    console.log('[SniperAutoAnalysis] Sentimen gagal diambil (dilewatin):', e.message);
    return null;
  }
}

async function safeOnchain() {
  try {
    return await fetchTradeMetrics();
  } catch (e) {
    console.log('[SniperAutoAnalysis] On-chain metrics gagal diambil (dilewatin):', e.message);
    return null;
  }
}

async function sendWhatsAppRespectMute(msg, label, silent = false) {
  if (silent) {
    console.log(`[SniperAutoAnalysis] Order SILENT (trial/simulasi) -- ${label} TETAP tercatat di web, gak pernah dikirim ke grup.`);
    return;
  }
  if (isWaMuted()) {
    console.log(`[SniperAutoAnalysis] WA DIMUTE sampai Jumat -- ${label} TETAP tercatat di web, gak dikirim ke grup dulu.`);
    return;
  }
  await sendWhatsApp(msg);
}

const TRIGGER_STATE_PATH = path.join(__dirname, 'sniper-trigger-state.json');
function loadTriggerState() {
  if (!fs.existsSync(TRIGGER_STATE_PATH)) return { lastSentDate: null };
  return JSON.parse(fs.readFileSync(TRIGGER_STATE_PATH, 'utf8'));
}
function saveTriggerState(state) {
  fs.writeFileSync(TRIGGER_STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchLivePrice(symbol) {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

// PATTERN_LABEL (22 Agu 2026, dipisah flag vs pennant -- keduanya beda bentuk konsolidasi,
// dulu digabung jadi 1 label krn deteksinya emang belum bisa bedain, sekarang udah bisa
// via classifyConsolidationShape() di chartPatterns.js).
const PATTERN_LABEL = { flag_bull: 'Bull Flag', pennant_bull: 'Bullish Pennant', flag_bear: 'Bear Flag', pennant_bear: 'Bearish Pennant', wedge_falling: 'Falling Wedge', wedge_rising: 'Rising Wedge', fvg_bounce: 'Fair Value Gap (pantulan)' };

async function main() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const triggerState = loadTriggerState();
  if (triggerState.lastSentDate === todayKey) {
    console.log('[SniperAutoAnalysis]', now.toISOString(), '-- udah dicek hari ini, skip (cegah dobel kalau ke-run ulang).');
    return;
  }

  const allActive = getActiveOrders().filter((o) => !o.silentTest);

  // Order 'pending' (belum floating) -- jarang kejadian dari jalur otomatis ini (order langsung
  // di-set floating begitu dibuat), tapi tetap jaga-jaga: kalau ADA, diam total dulu (behavior
  // lama), biar gak numpuk analisa di atas state yang belum jelas.
  if (allActive.some((o) => o.status !== 'floating')) {
    console.log('[SniperAutoAnalysis]', now.toISOString(), '-- ada posisi bayangan masih pending, skip pemantauan (belum floating).');
    return;
  }

  // Pemantauan harian buat SEMUA posisi floating (bukan cuma order[0] kayak versi lama -- upgrade
  // multi-posisi, 22 Agu 2026). Tiap posisi dapat pesan monitor sendiri-sendiri.
  for (const order of allActive) {
    const assetCfg = ASSETS[order.asset] || ASSETS.btc;
    const livePrice = await fetchLivePrice(assetCfg.symbol);
    const msg = formatPositionMonitor(order, livePrice, assetCfg);
    console.log(msg + '\n');
    addEntry('sniper', msg, now);
    await sendWhatsAppRespectMute(msg, `pemantauan posisi terbuka (${assetCfg.label} ${order.mode})`, order.silentTest);
  }

  // Saldo AVAILABLE (22 Agu 2026) -- bankroll TOTAL dikurangi margin yang udah kepake di SEMUA
  // posisi floating (lintas aset & mode). Kalkulator exposure ASLI tetap dipakai penuh, cuma
  // basis modalnya yang jadi "sisa nganggur", bukan modal penuh -- biar gak overleverage kalau
  // ada beberapa posisi bareng.
  checkAndApplyTopUp(now);
  const totalBalance = getKaelaBalance();
  let usedMargin = allActive.reduce((s, o) => s + (o.marginUsd || 0), 0);
  const closedOrders = getClosedOrders();

  let anyNewSignal = false;
  const invalidNotes = [];

  for (const assetKey of Object.keys(ASSETS)) {
    const assetCfg = ASSETS[assetKey];
    // (22 Agu 2026, bug ketemu -- Olan lapor "analisa Emas mana?" pas sinyal ketemu tapi ditolak
    // margin, gak nongol SAMA SEKALI di pesan harian) -- SEKARANG tiap aset WAJIB dapat MINIMAL
    // 1 baris status per hari, apapun hasilnya (halt/gak ada pola/ada pola tapi ditolak sizing/
    // valid). `continue` polos yang lama diganti pola push-lalu-continue biar konsisten -- gak
    // ada jalur yang bisa "senyap total" lagi (kecuali 2 edge-case data rusak yang emang gak
    // perlu dilaporin -- riskDistance=0 / partialTp<=0, itu murni jaring pengaman teknis).
    const assetLabelTag = `Sniper (${assetCfg.label})`;

    if (assetCfg.useHalvingBearWindow && isBtcBearWindow(now)) {
      console.log(`[SniperAutoAnalysis] ${assetCfg.label}: lagi window istirahat siklus halving (fase pasca-puncak, historis rawan bear) -- sinyal baru DIMATIKAN sementara.`);
      invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag}: lagi window ISTIRAHAT siklus halving (fase pasca-puncak, historis rawan bear/crash) -- sinyal baru dimatikan sementara sampai window ini lewat.`);
      continue;
    }

    const hasSniperOpen = allActive.some((o) => o.asset === assetKey && o.mode === 'sniper');
    const hasFvgOpen = allActive.some((o) => o.asset === assetKey && o.mode === 'fvg');
    if (hasSniperOpen && hasFvgOpen) {
      console.log(`[SniperAutoAnalysis] ${assetCfg.label}: kedua slot (Sniper+FVG) udah floating, skip cek sinyal baru.`);
      invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag}: 2 posisi (Pola Chart+FVG) lagi floating bareng, gak cek sinyal baru dulu.`);
      continue;
    }

    let daily, livePrice, sentiment = null, onchain = null;
    try {
      [daily, livePrice] = await Promise.all([
        fetchCandles(assetCfg.symbol, '1d', PATTERN_HISTORY_DAYS), fetchLivePrice(assetCfg.symbol),
      ]);
      if (assetKey === 'btc') {
        [sentiment, onchain] = await Promise.all([safeSentiment(assetCfg.symbol), safeOnchain()]);
      }
    } catch (e) {
      console.log(`[SniperAutoAnalysis] ${assetCfg.label}: gagal ambil data (${e.message}), skip aset ini giliran ini.`);
      invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag}: gagal ambil data harga hari ini (${e.message}), dicoba lagi besok.`);
      continue;
    }
    const dailyClose = daily[daily.length - 1].close;
    const ta = assetKey === 'btc' ? await analyze(assetCfg.symbol) : null;

    const fvgOrdersThisAsset = [...allActive, ...closedOrders].filter((o) => o.asset === assetKey && o.mode === 'fvg' && o.gapCreatedTime);
    const usedGapTimes = new Set(fvgOrdersThisAsset.map((o) => o.gapCreatedTime));

    const candidates = [];
    if (!hasSniperOpen) {
      const sig = detectPatternSignal(daily, daily.length - 1, { allowShort: false });
      if (sig) candidates.push({ mode: 'sniper', direction: sig.direction, sl: sig.sl, patternType: sig.patternType });
    }
    if (!hasFvgOpen) {
      const sig = detectFvgSignal(daily, daily.length - 1, { usedGapTimes });
      if (sig) candidates.push({ mode: 'fvg', direction: sig.direction, sl: sig.sl, patternType: sig.patternType, gapCreatedTime: sig.gapCreatedTime, gapTop: sig.gapTop, gapBottom: sig.gapBottom });
    }

    if (candidates.length === 0) {
      // Ancang-ancang (22 Agu 2026, lihat patternWatchlist.js) -- belum breakout, tapi kalau ada
      // pola/FVG lagi KEBENTUK, info itu duluan (bukan sinyal, gak buka posisi apapun) biar Olan
      // gak kaget pas beneran valid besok-besok.
      const watchNotes = [];
      if (!hasSniperOpen) {
        const watch = detectWatchingPattern(daily, { allowShort: false });
        if (watch) watchNotes.push(`👀 ${assetCfg.emoji} ${assetLabelTag} (ANCANG-ANCANG): ${watch.note}`);
      }
      if (!hasFvgOpen) {
        const watch = detectWatchingFvg(daily, { usedGapTimes });
        if (watch) watchNotes.push(`👀 ${assetCfg.emoji} ${assetLabelTag} (ANCANG-ANCANG): ${watch.note}`);
      }
      if (watchNotes.length > 0) {
        invalidNotes.push(...watchNotes);
      } else {
        invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag}: belum ada pola Sniper/FVG yang breakout hari ini.`);
      }
      continue;
    }

    for (const cand of candidates) {
      const modeLabelId = cand.mode === 'fvg' ? 'FVG' : 'Pola Chart';
      const availableBalance = Math.max(0, totalBalance - usedMargin);
      if (availableBalance <= 1) {
        console.log(`[SniperAutoAnalysis] Saldo available abis, skip sisa sinyal.`);
        invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag} (${modeLabelId}): pola ketemu tapi saldo available abis, gak sempat entry.`);
        continue;
      }

      const riskDistance = Math.abs(livePrice - cand.sl);
      if (riskDistance === 0) { console.log('[SniperAutoAnalysis] Jarak SL 0, skip -- lebih aman diam.'); continue; }
      const nyawaPct = riskDistance / livePrice * 100;
      if (nyawaPct > MAX_NYAWA_PCT) {
        console.log(`[SniperAutoAnalysis] ${assetCfg.label} ${cand.mode}: nyawa ${nyawaPct.toFixed(1)}% ngelewatin batas ${MAX_NYAWA_PCT}% -- invalidasi diterima.`);
        invalidNotes.push(`${assetCfg.emoji} ${assetLabelTag} (${modeLabelId}): pola ketemu tapi nyawa ${nyawaPct.toFixed(1)}% kelewat lebar (batas ${MAX_NYAWA_PCT}%) -- invalidasi diterima.`);
        continue;
      }
      const partialTp = cand.direction === 'buy' ? livePrice + riskDistance * PARTIAL_RR : livePrice - riskDistance * PARTIAL_RR;
      if (partialTp <= 0) continue;

      const calc = hitungExposure({ modal: availableBalance, entry: livePrice, stopLoss: cand.sl });
      // Batas margin 20% DICABUT (22 Agu 2026, permintaan Olan eksplisit: "gas terus, jangan
      // patokan modal yang tipis kayak tisu.. posisimu juga cuma bayangan.. tetep on") -- mode
      // AGRESIF sengaja buat fase awal/kecil bankroll bayangan Kaela ("masa kanak-kanak"), sadar
      // ini bikin performa live Kaela BEDA dari backtest yang selalu hormat batas 20% (backtest
      // TETAP jadi acuan riset terpisah, gak diubah). Kalkulator exposure (leverage cap 50x) TETAP
      // jaring pengaman terakhir yang jalan -- cuma batas marginPct% doang yang dicabut.
      if (calc.marginPct > MAX_MARGIN_PCT) {
        console.log(`[SniperAutoAnalysis] ${assetCfg.label} ${cand.mode}: margin ${calc.marginPct.toFixed(1)}% saldo available (di atas ${MAX_MARGIN_PCT}% lama) -- TETAP JALAN, mode agresif bankroll kecil.`);
      }

      const patternLabel = PATTERN_LABEL[cand.patternType] || cand.patternType;
      const confirmationNote = cand.mode === 'fvg'
        ? `Fair Value Gap terbentuk @ $${cand.gapBottom.toLocaleString('en-US')}-$${cand.gapTop.toLocaleString('en-US')} (candle harian ${assetCfg.label} tutup balik di atas batas atas gap, tanda pantulan). SL di bawah batas bawah gap (nyawa ${nyawaPct.toFixed(1)}%) -- kalau gap keisi penuh, thesis-nya gugur. Deteksi otomatis fvgDetector.js.`
        : `Breakout pola ${patternLabel} -- candle harian ${assetCfg.label} CLOSE ${cand.direction === 'buy' ? 'di atas' : 'di bawah'} batas pola ($${dailyClose.toLocaleString('en-US')}). SL nempel lebar pola itu sendiri (nyawa ${nyawaPct.toFixed(1)}%), bukan zona jauh. Deteksi otomatis chartPatterns.js.`;
      const tpReasoning = `Target tahap 1 (jual separuh): ${PARTIAL_RR}x risiko @ $${partialTp.toLocaleString('en-US', { maximumFractionDigits: 0 })}. Sisanya di-trail pakai SMA${TRAIL_SMA_LEN} harian (SL digeser breakeven abis tahap 1).`;

      const created = createOrder({
        asset: assetKey, mode: cand.mode,
        direction: cand.direction, strategyType: 'breakout', triggerPrice: livePrice,
        confirmationNote, tpReasoning, tp: partialTp, sl: cand.sl,
        exposure: calc.exposure, leverage: calc.leverage, marginUsd: calc.margin,
        patternType: cand.patternType, partialTp, trailSmaLen: TRAIL_SMA_LEN,
        gapCreatedTime: cand.gapCreatedTime ?? null,
        notes: `Analisa otomatis Kaela (${assetCfg.label}, mode ${cand.mode === 'fvg' ? 'Fair Value Gap' : 'pola chart'}, 22 Agu 2026): posisi BAYANGAN, murni perhitungan, tidak ada uang bergerak. Eksekusi asli tetap manual Olan kalau mau ikut.`,
      }, now);
      const opened = updateOrder(created.id, { status: 'floating', entryPrice: livePrice, triggeredAt: now.toISOString() });
      usedMargin += calc.margin;
      anyNewSignal = true;

      // Eksekusi LIVE (22 Agu 2026, permintaan Olan: "eksekusi sinyal Kaela, semua sesuai
      // exposure") -- GATED total di kill switch (killSwitch.js, default OFF). Gagal eksekusi
      // live TIDAK BOLEH gugurin shadow tracking (itu tetap "source of truth" buat backtest) --
      // ditangkep di sini, dilaporin, run tetep lanjut normal.
      let liveExecution = null;
      if (isLiveTradingEnabled()) {
        try {
          await setLeverage(assetCfg.symbol, calc.leverage);
          const entryOrder = await placeMarketEntry({ symbol: assetCfg.symbol, direction: cand.direction, notionalUsd: calc.nilaiPosisi, livePrice });
          const filledQty = parseFloat(entryOrder.executedQty || entryOrder.origQty);
          await placeStopLoss({ symbol: assetCfg.symbol, direction: cand.direction, stopPrice: cand.sl, quantity: filledQty });
          await placeTakeProfit({ symbol: assetCfg.symbol, direction: cand.direction, tpPrice: partialTp, quantity: filledQty });
          liveExecution = { ok: true, filledQty, testnet: isTestnet() };
          console.log(`[SniperAutoAnalysis] EKSEKUSI LIVE (${isTestnet() ? 'testnet' : 'MAINNET ASLI'}) sukses -- qty ${filledQty}.`);
        } catch (e) {
          liveExecution = { ok: false, error: e.message, testnet: isTestnet() };
          console.log(`[SniperAutoAnalysis] EKSEKUSI LIVE gagal (shadow tracking TETAP jalan normal): ${e.message}`);
        }
      }

      const msg = formatAutoValid({ order: opened, ta, sentiment, onchain, assetCfg, liveExecution });
      console.log(msg + '\n');
      addEntry('sniper', msg, now);
      await sendWhatsAppRespectMute(msg, `sinyal VALID (${assetCfg.label} ${patternLabel})`);
      console.log('[SniperAutoAnalysis] VALID --', assetCfg.label, cand.mode, patternLabel, 'posisi bayangan dibuka @', livePrice);
    }
  }

  if (!anyNewSignal && invalidNotes.length > 0) {
    const msg = formatAutoInvalid({ notes: invalidNotes });
    console.log(msg + '\n');
    addEntry('sniper', msg, now);
    await sendWhatsAppRespectMute(msg, 'status INVALID (semua aset)');
  }

  saveTriggerState({ lastSentDate: todayKey });
}

main().catch((e) => {
  console.error('ERROR sniperAutoAnalysis.js:', e.message);
  process.exit(1);
});
