// sniperBtcDualExec.js (26 Sep 2026) -- Demo+Real PARALEL buat leg BTC Sniper, Fase 2 dari 2
// (Fase 1 = rangerBtcDualExec.js, LIVE demo sejak hari yang sama). Pola PERSIS ninjaTrader.js/
// rangerBtcDualExec.js (demo SELALU jalan, real TAMBAHAN, `wibowoRoute` dikunci pas entry) --
// TAPI exit mechanic REPLIKASI PERSIS mekanisme Sniper ASLI (native SL/TP order di exchange,
// BUKAN pure-polling ala Ranger) biar profil edge yang udah divalidasi backtest gak berubah.
//
// ============ KENAPA KONSOLIDASI, BUKAN TEMPEL DI ATAS ARSITEKTUR LAMA ============
// Riset 3-agent (26 Sep 2026) nemuin Sniper BTC dipegang 4 SCRIPT beda yang tumpang-tindih:
// sniperAutoAnalysis.js (entry), localLiveExecutor.js (backstop entry, legacy era GH Actions
// diblokir Binance -- sekarang gak perlu lagi krn sniperAutoAnalysis.js udah jalan di Vultr),
// sniperLiveMonitor.js (monitor posisi ASLI -- partial-fill via qty-shrink, leg2 breakeven-reopen,
// trailing SMA10, PnL dari income-history), sniperOrderMonitor.js (monitor TERPISAH, simulasi
// harga lokal, NULIS PnL SENDIRI ke kaelaBankroll.js). BUG NYATA (pre-existing): sniperOrderMonitor
// & sniperLiveMonitor bisa DOBEL nyatet applyRealizedPnl buat 1 trade yang sama.
//
// Fix-nya BUKAN nge-patch 2 monitor itu jadi saling tau -- modul ini gantiin PERAN keduanya buat
// order yang lewat sini: SATU monitor, SATU journal (`sniper-btc-dual-exec-journal.json`), PnL per
// leg per mode (`stats.demo`/`stats.real`), gak PERNAH nyentuh `kaelaBankroll.js` sama sekali
// (sizing dari saldo exchange masing-masing leg LANGSUNG, sama pola Ranger/Ninja) -- begitu
// `enabled:true`, `sniperOrderMonitor.js`/`sniperLiveMonitor.js`/`localLiveExecutor.js` TIDAK
// DIUBAH SAMA SEKALI tapi otomatis gak pernah nemu order BTC baru buat diproses (entry baru lewat
// journal SINI, bukan numpuk state di `sniper-orders.json` kayak sebelumnya) -- bug dobel-PnL jadi
// MOOT buat BTC (satu-satunya code path yang nyentuh order-order ini).
//
// `sniper-orders.json` TETAP dipakai (createOrder shadow-record, PERSIS kayak sebelumnya -- biar
// sinyal tetep tercatat/keliatan di dashboard walau eksekusi gagal) -- `liveExecution` di situ
// jadi RINGKASAN doang (`{demo:{ok,filledQty}, real:{...}|null, wibowoRoute}`), state detail
// (SL/TP/leg2/trailing/PnL) hidup di journal modul ini.
//
// ⚠️ Bug KEDUA ketemu bareng riset ini (DIBENERIN LANGSUNG di sniperAutoAnalysis.js, TERPISAH dari
// modul ini, lihat commit "fix(sniper): TP native separuh qty"): native TP SEBELUMNYA dipasang
// FULL qty (bukan separuh) -- kontradiksi total sama tpReasoning "jual separuh". Modul ini dari
// AWAL udah bener (separuh qty, pola sniperMultiAccount.js).
//
// ⚠️ Scope simplification SADAR drpd jalur lama: (1) TIDAK ada rekonsiliasi offline
// summed-since-triggeredAt (akar bug clamp/dobel-catat) -- leg1 SL-hit diapproksimasi dari harga SL
// (STOP_MARKET native fill SANGAT dekat harga trigger buat pair seliquid BTCUSDT, SAMA
// approksimasi yang udah dipakai sniperOrderMonitor.js versi lama), leg1 partial-TP-hit
// diapproksimasi dari harga TP (SAMA alasan) -- HANYA leg2-hilang-tanpa-jejak (likuidasi murni,
// gak ada order kita sendiri buat baca harga) yang PAKAI income-history, TAPI di-scope SEMPIT
// (`since: leg2.openedAt`, BUKAN since order.triggeredAt) -- interval jauh lebih pendek, jauh
// lebih kecil resiko kecampur aktivitas simbol lain (akar masalah bug clamp lama). (2) TIDAK ada
// auto-adopt posisi nyasar ke journal (SAMA arsitektur ninjaTrader.js/rangerBtcDualExec.js).

const fs = require('fs');
const path = require('path');
const { sma } = require('./technicalAnalysis');
const { fetchCandles } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const { isInsufficientBalanceError, formatInsufficientBalanceAlert, shouldAlertInsufficientBalance } = require('./balanceAlert');
const { CLOSE_REASON_LABEL, KAELA_ACCESS_URL, EXCHANGE_BADGE, SYSTEM_LABEL, formatAutoOpen, formatAutoPartial, formatAutoClosed, formatAutoClosedUntracked, formatWinRateLines } = require('./darkKaelaLog');
const { sendWhatsAppToSniperClub } = require('./fonnte');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');
const { updateOrder } = require('./sniperOrders');

const CONFIG_PATH = path.join(__dirname, 'sniper-btc-dual-exec-config.json');
const JOURNAL_PATH = path.join(__dirname, 'sniper-btc-dual-exec-journal.json');
const SYMBOL = 'BTCUSDT';
const MARGIN_ASSET = 'USDT';
const PARTIAL_RR = 2; // SAMA persis sniperAutoAnalysis.js
const TRAIL_SMA_LEN = 10; // SAMA persis sniperAutoAnalysis.js -- SMA harian
const PARTIAL_SHRINK_RATIO = 0.75; // SAMA threshold sniperLiveMonitor.js ("posQty < filledQty*0.75")
const ASSET_LABEL = 'BTCUSDT';

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, allowReal: false };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { enabled: false, allowReal: false }; }
}

function freshStats() { return { wins: 0, losses: 0, totalPnlUsd: 0 }; }
function loadJournal() {
  const def = { orders: {}, stats: { demo: freshStats(), real: freshStats() } };
  if (!fs.existsSync(JOURNAL_PATH)) return def;
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    return {
      orders: j.orders || {},
      stats: { demo: { ...freshStats(), ...(j.stats?.demo || {}) }, real: { ...freshStats(), ...(j.stats?.real || {}) } },
    };
  } catch { return def; }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

// ============ Exec per mode -- 2 instance TERPISAH TOTAL (kredensial beda) ============
function execFor(mode) {
  const secrets = binanceExecutorDefault.loadSecrets();
  const apiKey = mode === 'real' ? secrets.BINANCE_API_KEY_REAL : secrets.BINANCE_API_KEY;
  const apiSecret = mode === 'real' ? secrets.BINANCE_API_SECRET_REAL : secrets.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return binanceExecutorDefault.createBinanceClient({ apiKey, apiSecret, testnet: mode !== 'real' });
}
function baseUrlFor(mode) { return mode === 'real' ? 'https://fapi.binance.com' : 'https://demo-fapi.binance.com'; }
async function fetchLivePrice(mode) {
  const res = await fetch(`${baseUrlFor(mode)}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
  return parseFloat((await res.json()).price);
}
function badge() { return EXCHANGE_BADGE.binance; }

// Income-history SEMPIT (lihat catatan header) -- CUMA dipakai buat leg2 yang hilang tanpa jejak
// (likuidasi murni). `since` WAJIB openedAt LEG2 ITU SENDIRI (bukan order.triggeredAt) -- interval
// pendek (leg2 biasanya cuma idup beberapa jam-hari), jauh lebih kecil resiko kecampur aktivitas
// simbol lain drpd bug lama yang jumlahin SEJAK AWAL TRADE (bisa berhari-hari kalau eksekutor
// sempat offline lama).
function sign(q, s) { return require('crypto').createHmac('sha256', s).update(q).digest('hex'); }
async function fetchRealizedPnlSince(mode, startTimeMs) {
  const secrets = binanceExecutorDefault.loadSecrets();
  const apiKey = mode === 'real' ? secrets.BINANCE_API_KEY_REAL : secrets.BINANCE_API_KEY;
  const apiSecret = mode === 'real' ? secrets.BINANCE_API_SECRET_REAL : secrets.BINANCE_API_SECRET;
  const params = { symbol: SYMBOL, startTime: startTimeMs, timestamp: Date.now(), recvWindow: 15000, limit: 1000 };
  const query = new URLSearchParams(params).toString();
  const sig = sign(query, apiSecret);
  const res = await fetch(`${baseUrlFor(mode)}/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': apiKey } });
  const income = await res.json();
  if (!Array.isArray(income)) return 0;
  return income.reduce((s, inc) => s + parseFloat(inc.income), 0);
}

// ============ Buka posisi (2 leg) ============
// `order` = shadow order YANG UDAH DIBUAT+status:'floating' (createOrder/updateOrder,
// sniperAutoAnalysis.js) -- modul ini gak deteksi/nyimpen shadow record sendiri, cuma nambahin
// eksekusi live-nya. `order.direction`('buy'/'sell'), `order.sl`, `order.tp`(=partialTp target 2R
// yang UDAH dihitung caller), `order.id`/`signalId`/`patternType`/`mode` dipakai apa adanya.
async function openSniperBtcDual({ order, livePrice }) {
  const cfg = loadConfig();
  const journal = loadJournal();
  if (journal.orders[order.id]) { console.log(`[SniperBtcDual] Order ${order.id} udah ada di journal, skip (harusnya gak kejadian).`); return; }

  async function openLeg(exec, mode) {
    const balance = await exec.getAccountBalance(MARGIN_ASSET).catch(() => 0);
    const calc = hitungExposure({ modal: balance || 0, entry: livePrice, stopLoss: order.sl, direction: order.direction });
    if (calc.nilaiPosisi <= 0) return null;
    const strayCheck = await exec.getPositionRisk(SYMBOL).catch(() => null);
    if (strayCheck && Math.abs(parseFloat(strayCheck.positionAmt)) > 0) {
      console.log(`[SniperBtcDual] Akun ${mode} udah ada posisi live yang gak dikenal jurnal modul ini -- skip leg ${mode} siklus ini demi aman.`);
      return null;
    }
    await exec.setLeverage(SYMBOL, calc.leverage).catch(() => {});
    const entryOrder = await exec.placeMarketEntry({ symbol: SYMBOL, direction: order.direction, notionalUsd: calc.nilaiPosisi, livePrice });
    const filledQty = parseFloat(entryOrder.executedQty);
    const entryPrice = parseFloat(entryOrder.avgPrice);
    try {
      await exec.placeStopLoss({ symbol: SYMBOL, direction: order.direction, stopPrice: order.sl, quantity: filledQty });
    } catch (slErr) {
      console.log(`[SniperBtcDual] (${mode}) SL GAGAL nempel (${slErr.message}) -- posisi udah masuk, tutup PAKSA demi keamanan.`);
      await exec.emergencyCloseMarket({ symbol: SYMBOL, direction: order.direction, quantity: filledQty }).catch(() => {});
      throw new Error(`Entry (${mode}) masuk tapi SL gagal nempel (${slErr.message}) -- UDAH DITUTUP PAKSA otomatis.`);
    }
    const { stepSize, quantityPrecision } = await exec.getSymbolInfo(SYMBOL);
    const halfQty = binanceExecutorDefault.roundToStepSize(filledQty / 2, stepSize, quantityPrecision);
    await exec.placeTakeProfit({ symbol: SYMBOL, direction: order.direction, tpPrice: order.tp, quantity: halfQty > 0 ? halfQty : filledQty });
    return {
      entryPrice, qty: filledQty, leverage: calc.leverage, marginUsd: calc.margin, nilaiPosisi: calc.nilaiPosisi,
      partialDone: false, partialPnlUsd: 0, leg2: null, closedAt: null, exitPrice: null, pnlUsd: null,
    };
  }

  let demoResult = null;
  try {
    const demoExec = execFor('demo');
    if (!demoExec) { console.log('[SniperBtcDual] BINANCE_API_KEY demo belum disiapin -- skip total.'); return; }
    demoResult = await openLeg(demoExec, 'demo');
  } catch (e) {
    console.log('[SniperBtcDual] Gagal buka leg DEMO:', e.message);
    return; // demo gagal -- jangan lanjut coba real, skip siklus ini (SAMA pola ninjaTrader.js/rangerBtcDualExec.js)
  }
  if (!demoResult) return;

  let realResult = null;
  let wibowoRoute = 'demo';
  if (cfg.allowReal === true) {
    const realExec = execFor('real');
    if (realExec) {
      try {
        realResult = await openLeg(realExec, 'real');
        if (realResult) wibowoRoute = 'real';
      } catch (e) {
        if (isInsufficientBalanceError(e.message)) {
          const alertKey = 'sniper-btc-dual-real';
          if (shouldAlertInsufficientBalance(alertKey)) {
            await sendWhatsAppToWibowo(formatInsufficientBalanceAlert({ strategy: 'Sniper BTC (Real)', assetLabel: ASSET_LABEL, direction: order.direction, entry: livePrice, tp: order.tp })).catch(() => {});
          }
          console.log('[SniperBtcDual] Real skip -- saldo kurang.');
        } else {
          console.log('[SniperBtcDual] Real gagal (BUKAN saldo kurang -- perlu dicek):', e.message);
        }
      }
    }
  }

  journal.orders[order.id] = {
    signalId: order.signalId, direction: order.direction, sl: order.sl, tp: order.tp,
    patternType: order.patternType, mode: order.mode, wibowoRoute,
    demo: demoResult, real: realResult,
  };
  saveJournal(journal);
  console.log(`[SniperBtcDual] Entry ${order.direction.toUpperCase()} @ ${livePrice} -- demo @ ${demoResult.entryPrice}${realResult ? `, real @ ${realResult.entryPrice}` : ' (real skip)'}.`);

  updateOrder(order.id, {
    liveExecutedAt: new Date().toISOString(),
    liveExecution: { demo: { ok: true, filledQty: demoResult.qty }, real: realResult ? { ok: true, filledQty: realResult.qty } : null, wibowoRoute },
  });

  const posBase = { id: order.id, signalId: order.signalId, direction: order.direction, sl: order.sl, tp: order.tp, patternType: order.patternType, mode: order.mode, assetLabel: ASSET_LABEL };
  const demoMsg = formatAutoOpen({ ...posBase, entryPrice: demoResult.entryPrice, marginUsd: demoResult.marginUsd, leverage: demoResult.leverage, nilaiPosisi: demoResult.nilaiPosisi }, new Date(), '', true, null, '', null, badge(), SYSTEM_LABEL.SNIPER);
  await sendWhatsAppToSniperClub(demoMsg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Sniper Club:', e.message));
  if (wibowoRoute === 'real') {
    const realMsg = formatAutoOpen({ ...posBase, entryPrice: realResult.entryPrice, marginUsd: realResult.marginUsd, leverage: realResult.leverage, nilaiPosisi: realResult.nilaiPosisi }, new Date(), '', false, null, '', null, badge(), SYSTEM_LABEL.SNIPER);
    await sendWhatsAppToWibowo(realMsg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Wibowo (real):', e.message));
  } else {
    await sendWhatsAppToWibowo(demoMsg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Wibowo (demo pengganti):', e.message));
  }
}

// ============ Leg1 -> Leg2 (partial TP kena, breakeven-reopen) ============
// Replikasi PERSIS closeThenReopenBreakeven() (sniperLiveMonitor.js) -- cancel order sisa (TP/SL
// yang masih nempel buat qty LAMA udah gak nyambung), market-close sisa qty, buka ulang FULL sisa
// qty itu (BUKAN resize dari saldo) di leverage BARU (dihitung dari SL=harga entry awal ->
// nyawa% kecil -> leverage gede -> likuidasi ~breakeven).
async function _doPartialAndReopen(o, mode, exec, posQtyBeforeClose, idrRate) {
  const leg = o[mode];
  await exec.cancelAllOpenOrders(SYMBOL).catch(() => {});
  // Exit price leg1 diapproksimasi dari harga TP target (native TAKE_PROFIT_MARKET fill SANGAT
  // dekat trigger price buat pair seliquid BTCUSDT) -- BUKAN nebak dari income-history (lihat
  // catatan header kenapa). Approksimasi SAMA persis yang udah dipakai sniperOrderMonitor.js versi
  // lama buat kasus serupa.
  const exitPriceLeg1 = o.tp;
  leg.partialPnlUsd = o.direction === 'buy' ? (exitPriceLeg1 - leg.entryPrice) * posQtyBeforeClose : (leg.entryPrice - exitPriceLeg1) * posQtyBeforeClose;
  leg.partialDone = true;

  const livePrice = await fetchLivePrice(mode);
  // `direction` DIOPER EKSPLISIT (26 Sep 2026, FIX drpd jalur lama sniperLiveMonitor.js yang
  // manggil hitungExposure() TANPA direction -- exposure short jadi kebaca FULL bukan separuh
  // kalau leg2 arahnya sell. Modul ini baru, gak ada alasan replikasi bug itu).
  const calc = hitungExposure({ modal: await exec.getAccountBalance(MARGIN_ASSET).catch(() => 0), entry: livePrice, stopLoss: leg.entryPrice, direction: o.direction });
  await exec.setIsolatedMargin(SYMBOL).catch(() => {});
  await exec.setLeverage(SYMBOL, calc.leverage).catch(() => {});
  const reopenOrder = await exec.placeMarketEntry({ symbol: SYMBOL, direction: o.direction, notionalUsd: posQtyBeforeClose * livePrice, livePrice });
  leg.leg2 = { entryPrice: parseFloat(reopenOrder.avgPrice), qty: parseFloat(reopenOrder.executedQty), leverage: calc.leverage, openedAt: new Date().toISOString() };

  const isDemo = mode !== 'real';
  const msg = formatAutoPartial({ id: o.id, signalId: o.signalId, realizedPnlUsd: leg.partialPnlUsd, entryPrice: leg.entryPrice, assetLabel: ASSET_LABEL, trailSmaLen: TRAIL_SMA_LEN }, new Date(), isDemo, idrRate, null, badge(), SYSTEM_LABEL.SNIPER);
  await sendWhatsAppToSniperClub(msg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Sniper Club (partial):', e.message));
  if ((mode === 'real') === (o.wibowoRoute === 'real')) await sendWhatsAppToWibowo(msg).catch(() => {});
}

// ============ Tutup leg (final -- leg1 SL-hit sebelum partial, ATAU leg2 selesai) ============
async function _reportAndTallyClose(orderId, o, mode, idrRate, reasonCode) {
  const leg = o[mode];
  const isDemo = mode !== 'real';
  const stats = (loadJournal().stats)[mode]; // re-load biar stats akumulasi konsisten kalau ada order lain kepr proses bareng siklus ini -- caller yang nyimpen ulang journal penuh

  if (leg.untracked) {
    const msg = formatAutoClosedUntracked({ id: o.id, direction: o.direction === 'buy' ? 'long' : 'short', assetLabel: ASSET_LABEL, entryPrice: leg.entryPrice }, isDemo, SYSTEM_LABEL.SNIPER);
    if (mode === 'demo') await sendWhatsAppToSniperClub(msg).catch(() => {});
    if ((mode === 'real') === (o.wibowoRoute === 'real')) await sendWhatsAppToWibowo(msg).catch(() => {});
    return stats;
  }

  const won = leg.pnlUsd >= 0;
  if (won) stats.wins += 1; else stats.losses += 1;
  stats.totalPnlUsd += leg.pnlUsd;

  const alasanText = CLOSE_REASON_LABEL[reasonCode] || reasonCode;
  let msg = formatAutoClosed({ id: o.id, signalId: o.signalId, direction: o.direction === 'buy' ? 'long' : 'short', mode: o.mode, entryPrice: leg.entryPrice, exitPrice: leg.exitPrice, pnlUsd: leg.pnlUsd, pnlPct: leg.marginUsd ? (leg.pnlUsd / leg.marginUsd) * 100 : null, assetLabel: ASSET_LABEL }, new Date(), isDemo, alasanText, idrRate, null, badge(), SYSTEM_LABEL.SNIPER);
  const winRateLines = formatWinRateLines(stats, `Sniper ${ASSET_LABEL} (${isDemo ? 'Demo' : 'Real'})`, idrRate);
  msg = msg.replace(`🔗 ${KAELA_ACCESS_URL}`, winRateLines + `🔗 ${KAELA_ACCESS_URL}`);

  if (mode === 'demo') await sendWhatsAppToSniperClub(msg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Sniper Club (close):', e.message));
  if ((mode === 'real') === (o.wibowoRoute === 'real')) await sendWhatsAppToWibowo(msg).catch((e) => console.log('[SniperBtcDual] Gagal kirim Wibowo (close):', e.message));
  return stats;
}

// ============ Monitor + tutup posisi -- dipanggil 1x per siklus ============
async function monitorSniperBtcDual({ idrRate } = {}) {
  const journal = loadJournal();
  let touched = false;
  let trailBrokenCache = null; // {dir: trailBroken} -- dihitung SEKALI per arah per siklus (SMA harian sama buat semua order arah yang sama), bukan per order/leg

  async function isTrailBroken(direction) {
    if (trailBrokenCache && trailBrokenCache.direction === direction) return trailBrokenCache.broken;
    const candles = await fetchCandles(SYMBOL, '1d', TRAIL_SMA_LEN + 5).catch(() => []);
    const closes = candles.map((c) => c.close);
    const trailSma = sma(closes, TRAIL_SMA_LEN);
    const lastClose = closes[closes.length - 1];
    const broken = trailSma !== null && lastClose != null && (direction === 'buy' ? lastClose < trailSma : lastClose > trailSma);
    trailBrokenCache = { direction, broken };
    return broken;
  }

  for (const [orderId, o] of Object.entries(journal.orders)) {
    const activeLegs = ['demo', 'real'].filter((m) => o[m] && !o[m].closedAt);
    if (activeLegs.length === 0) continue;
    touched = true;

    for (const mode of activeLegs) {
      const exec = execFor(mode);
      if (!exec) { console.log(`[SniperBtcDual] Order ${orderId} leg ${mode}: key dicabut di tengah jalan -- gak bisa dipantau, biarin (kasus ekstrem).`); continue; }
      const leg = o[mode];
      const posRisk = await exec.getPositionRisk(SYMBOL).catch(() => undefined);
      if (posRisk === undefined) continue; // gagal fetch -- coba lagi siklus depan
      const posQty = posRisk ? Math.abs(parseFloat(posRisk.positionAmt)) : 0;

      if (!leg.leg2) {
        // ============ Fase leg1 (belum partial) ============
        if (posQty <= 0) {
          // Posisi abis -- native SL FULL qty adalah SATU-SATUNYA mekanisme yang bisa nutup
          // leg1 ke NOL (TP sekarang cuma separuh qty, gak pernah nutup penuh sendirian) --
          // diapproksimasi dari harga SL (lihat catatan header).
          leg.closedAt = new Date().toISOString();
          leg.exitPrice = o.sl;
          leg.pnlUsd = o.direction === 'buy' ? (o.sl - leg.entryPrice) * leg.qty : (leg.entryPrice - o.sl) * leg.qty;
          journal.stats[mode] = await _reportAndTallyClose(orderId, o, mode, idrRate, 'SL');
          continue;
        }
        if (posQty < leg.qty * PARTIAL_SHRINK_RATIO) {
          try {
            await _doPartialAndReopen(o, mode, exec, posQty, idrRate);
          } catch (e) {
            console.log(`[SniperBtcDual] Order ${orderId} leg ${mode}: GAGAL proses partial->leg2:`, e.message);
          }
          continue;
        }
        continue; // masih floating penuh, lanjut pantau
      }

      // ============ Fase leg2 (udah partial, breakeven-reopen) ============
      if (posQty <= 0) {
        // Leg2 hilang tanpa jejak order kita sendiri (likuidasi murni, implisit via margin --
        // leg2 emang gak punya SL eksplisit) -- SATU-SATUNYA kasus yang PAKAI income-history,
        // di-scope SEMPIT sejak leg2 dibuka (lihat catatan header).
        try {
          const leg2PnlRaw = await fetchRealizedPnlSince(mode, new Date(leg.leg2.openedAt).getTime());
          const maxLoss = -(leg.leg2.entryPrice * leg.leg2.qty / leg.leg2.leverage);
          const leg2Pnl = leg2PnlRaw < maxLoss ? maxLoss : leg2PnlRaw;
          leg.closedAt = new Date().toISOString();
          leg.exitPrice = leg.leg2.entryPrice; // dekat breakeven by design, gak ada harga exact buat dilaporin
          leg.pnlUsd = leg.partialPnlUsd + leg2Pnl;
          journal.stats[mode] = await _reportAndTallyClose(orderId, o, mode, idrRate, 'SL_BREAKEVEN');
        } catch (e) {
          console.log(`[SniperBtcDual] Order ${orderId} leg ${mode}: GAGAL rekonsiliasi leg2 hilang:`, e.message);
        }
        continue;
      }

      if (await isTrailBroken(o.direction)) {
        try {
          const closeOrder = await exec.emergencyCloseMarket({ symbol: SYMBOL, direction: o.direction, quantity: leg.leg2.qty });
          let avgPrice = parseFloat(closeOrder.avgPrice);
          if (!avgPrice) avgPrice = await fetchLivePrice(mode);
          const leg2Pnl = o.direction === 'buy' ? (avgPrice - leg.leg2.entryPrice) * leg.leg2.qty : (leg.leg2.entryPrice - avgPrice) * leg.leg2.qty;
          leg.closedAt = new Date().toISOString();
          leg.exitPrice = avgPrice;
          leg.pnlUsd = leg.partialPnlUsd + leg2Pnl;
          journal.stats[mode] = await _reportAndTallyClose(orderId, o, mode, idrRate, 'TRAIL');
        } catch (e) {
          console.log(`[SniperBtcDual] Order ${orderId} leg ${mode}: GAGAL tutup leg2 (trailing patah):`, e.message);
        }
      }
    }
  }

  if (touched) saveJournal(journal);
}

module.exports = { loadConfig, loadJournal, openSniperBtcDual, monitorSniperBtcDual };
