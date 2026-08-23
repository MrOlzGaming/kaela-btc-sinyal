// Nyopet Auto-Trader -- era Binance Demo (23 Agu 2026, desain Olan). LOCAL ONLY (numpang jalan
// bareng localLiveExecutor.js di run-local-executor.ps1) -- Binance Demo diblokir dari GitHub
// Actions, dan sistem ini butuh cek SETIAP SIKLUS (bukan cuma pas ada sinyal baru) buat mantau
// posisi floating, jadi gak worth dipisah cloud-detect/local-execute kayak Sniper.
//
// MULTI-ASET (23 Agu 2026, permintaan Olan: "semua mode sniper dan nyopet berlaku buat semua
// aset.. baik BTC dan PAXG") -- loop tiap aset di NYOPET_ASSETS, TIAP ASET dapet slot 1 posisi
// SENDIRI-SENDIRI (BTC dan PAXG bisa floating bebarengan, gak rebutan slot) -- pola sama kayak
// Sniper multi-aset. State (`orders`/`watchZoneByAsset`) di journal dipisah per-key aset.
//
// MULTI-AKUN (23 Agu 2026, permintaan Olan: "Kaela Pro Trader" -- family/member lain bisa jalanin
// akun Binance sendiri) -- REFACTOR jadi factory `createNyopetTrader({...})`, pola SAMA persis
// kayak binanceExecutor.js `createBinanceClient()`: kredensial/journal-path/pengirim-WA di-CLOSURE
// per instance, bukan module-level global lagi. Wrapper module-level (processAsset/main di bawah)
// TETAP ada dan ZERO PERUBAHAN PERILAKU buat akun Olan sendiri (CLI `node nyopetAutoTrader.js`) --
// itu cuma factory instance DEFAULT pakai binanceExecutor default client + fonnte.js biasa +
// nyopet-journal.json (path lama, TIDAK BERUBAH).
//
// LOGIKA per-aset (murni trigger zona likuiditas, GAK PAKAI R:R) -- SAMA buat SEMUA akun (data
// chart/zona itu PUBLIK, sama buat siapapun) -- yang beda per-akun cuma SIZING (dari saldo/modal
// masing-masing) & journal/notif:
//   FADE (default, asumsi SELALU mantul): harga nyentuh zona -> counter posisi, nyawa 2% FLAT
//     (jadi leverage), TP = zona LAWAN. Kena TP -> tutup (WIN), REVERSE (posisi baru arah
//     kebalikan di zona ini).
//   FOLLOW (override kalau zona GAGAL nahan/ditembus beneran, bukan cuma wick): ikutin arah
//     tembusan, target = zona BERIKUTNYA di arah situ. Kena target -> tutup, balik ke FADE lagi.
//   Kena LIKUIDASI di mode manapun -> tutup (LOSS), buka posisi baru lagi (cek zona ulang).
//
// GAK PAKAI ORDER SL TERPISAH (23 Agu 2026, permintaan Olan: "kita ga pake sl tp pastikan buka
// pake isolated jadi liq adalah sl") -- margin ISOLATED dipastiin eksplisit tiap buka posisi,
// LIKUIDASI-nya sendiri yang jadi nyawa. Konsekuensi: monitoring TP/loss WAJIB nanya status REAL
// ke Binance (getPositionRisk) dulu tiap siklus, JANGAN cuma bandingin harga live vs SL yang
// "seharusnya" -- kalau posisi udah kelikuidasi SELAMA kita offline, rekonsiliasi dari income
// history Binance (bukan nebak harga).
//
// SKEMA JURNAL 100% sama sniper-orders.json ({balance, orders[]} + status
// floating/closed_tp/closed_sl, tiap order punya field `asset`) -- gak ada batas 100 trade lagi.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchCandles } = require('./technicalAnalysis');
const { detectZones, findTouchCandidate, findNearestPair, isZoneBroken } = require('./darkKaelaZones');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const { formatAutoOpen, formatAutoClosed } = require('./darkKaelaLog');
const { sendWhatsApp } = require('./fonnte');
const { isLiveTradingEnabled } = require('./killSwitch');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');

const NYAWA_PCT = 2; // flat (23 Agu 2026, direvisi dari 1% -> 2%), dipakai buat nentuin LEVERAGE (bukan buat SL order -- itu gak ada lagi, likuidasi yang jadi SL)
const DEFAULT_JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');
// "Modal aktif" = 1/5 saldo (23 Agu 2026, permintaan Olan) -- BUKAN all-in tiap posisi, biar tahan
// beberapa siklus rugi beruntun tanpa ngabisin saldo sekaligus. Kalkulator exposure TETAP dipakai
// persis sama (WAJIB, "cheat anti rungkad"), cuma `modal` yang diinput ke situ udah dikecilin duluan.
const MODAL_ACTIVE_FRACTION = 1 / 5;

function sign(q, s) { return crypto.createHmac('sha256', s).update(q).digest('hex'); }

// ============ Factory (23 Agu 2026) ============
// `client`     : hasil binanceExecutor.createBinanceClient({apiKey, apiSecret, testnet}) -- atau
//                default module (akun Olan sendiri, wrapper lama).
// `journalPath`: file JSON journal KHUSUS instance ini (per akun -- beda phone/mode = beda file).
// `sendWA(msg)`: fungsi kirim notifikasi -- default `sendWhatsApp` (fonnte.js, ke Olan sendiri).
// `getModalBase(marginAsset)`: override sumber modal (saldo Binance live vs live+eksternal) --
//                default null = pakai `client.getAccountBalance(marginAsset)` apa adanya.
// `apiCreds`   : { apiKey, apiSecret, testnet } -- WAJIB kalau mau `fetchRealizedPnlSince` jalan
//                (butuh signed request langsung ke /fapi/v1/income, belum ada di client factory).
function createNyopetTrader({ client, journalPath, sendWA, getModalBase, apiCreds, onEvent } = {}) {
  const c = client || binanceExecutorDefault;
  const jPath = journalPath || DEFAULT_JOURNAL_PATH;
  const notify = sendWA || sendWhatsApp;
  const emit = onEvent || (() => {}); // 23 Agu 2026 -- hook OPSIONAL buat jurnal personal (Kaela Pro
                                       // Trader, multiAccountExecutor.js) -- default no-op, ZERO efek
                                       // samping buat akun Olan sendiri (dia gak butuh hook ini).
  const baseUrl = apiCreds && apiCreds.testnet === false ? 'https://fapi.binance.com' : 'https://demo-fapi.binance.com';

  function loadJournal() {
    if (!fs.existsSync(jPath)) return { balance: 0, orders: [], watchZoneByAsset: {} };
    const j = JSON.parse(fs.readFileSync(jPath, 'utf8'));
    let migrated = false;
    for (const o of j.orders || []) {
      if (!o.asset) { o.asset = 'btc'; migrated = true; }
    }
    if (!j.watchZoneByAsset) j.watchZoneByAsset = {};
    if (j.watchZone && !j.watchZoneByAsset.btc) { j.watchZoneByAsset.btc = j.watchZone; migrated = true; }
    if (j.watchZone) { delete j.watchZone; migrated = true; }
    if (migrated) saveJournal(j);
    return j;
  }
  function saveJournal(j) {
    fs.writeFileSync(jPath, JSON.stringify(j, null, 2));
  }
  function getFloatingOrder(journal, assetKey) {
    return (journal.orders || []).find((o) => o.status === 'floating' && o.asset === assetKey) || null;
  }

  async function fetchLivePrice(symbol) {
    const res = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`);
    return parseFloat((await res.json()).price);
  }

  // Income history (realized PNL asli dari Binance) -- WAJIB dipakai buat rekonsiliasi kalau
  // posisi ternyata udah closed/likuidasi SELAMA kita offline, JANGAN pernah nebak PNL dari harga.
  async function fetchRealizedPnlSince(symbol, startTime) {
    const creds = apiCreds || (function () { const s = require('./secrets'); return { apiKey: s.BINANCE_API_KEY, apiSecret: s.BINANCE_API_SECRET }; })();
    const params = { symbol, startTime, timestamp: Date.now(), recvWindow: 5000, limit: 1000 };
    const query = new URLSearchParams(params).toString();
    const sig = sign(query, creds.apiSecret);
    const res = await fetch(`${baseUrl}/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': creds.apiKey } });
    const income = await res.json();
    return income.reduce((s, inc) => s + parseFloat(inc.income), 0);
  }

  async function resolveModal(marginAsset) {
    if (getModalBase) {
      const override = await getModalBase(marginAsset);
      if (override != null) return override;
    }
    return c.getAccountBalance(marginAsset);
  }

  // Buka posisi beneran + tulis ke journal (status floating) + kirim notif.
  async function openPosition(assetCfg, { direction, tp, mode, zoneCtx }) {
    const { symbol, marginAsset, key: assetKey } = assetCfg;
    const [modalFull, livePrice] = await Promise.all([resolveModal(marginAsset), fetchLivePrice(symbol)]);
    const modal = modalFull * MODAL_ACTIVE_FRACTION;
    const calc = hitungExposure({ modal, nyawa: NYAWA_PCT, entry: livePrice });
    console.log(`[NyopetAutoTrader] ${assetCfg.label}: Saldo ${marginAsset} penuh $${modalFull.toFixed(2)} -> modal aktif (1/5) $${modal.toFixed(2)} | leverage ${calc.leverage}x`);

    await c.setIsolatedMargin(symbol);
    await c.setLeverage(symbol, calc.leverage);
    const entryOrder = await c.placeMarketEntry({ symbol, direction, notionalUsd: calc.nilaiPosisi, livePrice });
    const qty = parseFloat(entryOrder.executedQty);
    const entryPrice = parseFloat(entryOrder.avgPrice);
    const posRisk = await c.getPositionRisk(symbol);

    const order = {
      id: 'nyopet-demo-' + Date.now(), asset: assetKey, direction, status: 'floating', mode, entryPrice,
      liqPrice: parseFloat(posRisk.liquidationPrice), tp, qty,
      leverage: calc.leverage, marginUsd: calc.margin, zonePrice: zoneCtx.price, zoneKind: zoneCtx.kind,
      zoneTouches: zoneCtx.touches, triggeredAt: new Date().toISOString(),
    };
    const journal = loadJournal();
    journal.balance = modalFull; // catatan: field balance tunggal, USDT/USDC dicampur kalau 2 aset kepake -- cukup buat sizing display, detail per-wallet ada di liveExecution tiap order kalau perlu
    journal.orders.push(order);
    journal.watchZoneByAsset[assetKey] = { price: zoneCtx.price, side: zoneCtx.side, zoneKind: zoneCtx.kind, touches: zoneCtx.touches };
    saveJournal(journal);

    const msg = formatAutoOpen({ ...order, sl: order.liqPrice, assetLabel: assetCfg.label }, new Date());
    console.log(msg + '\n');
    await notify(msg);
    emit({ entryId: order.id, type: 'open', strategy: 'nyopet', asset: assetKey, direction, entryPrice, sl: order.liqPrice, tp, leverage: calc.leverage, marginUsd: calc.margin, status: 'open', openedAt: order.triggeredAt, note: mode === 'follow' ? 'Follow (zona ditembus)' : 'Fade (zona mantul)' });
    return order;
  }

  async function closePosition(assetCfg, order, { alreadyClosed, realPnlUsd, won }) {
    const { symbol } = assetCfg;
    let pnlUsd, exitPrice, pnlPct;
    if (alreadyClosed) {
      pnlUsd = realPnlUsd;
      exitPrice = order.direction === 'buy' ? order.entryPrice + pnlUsd / order.qty : order.entryPrice - pnlUsd / order.qty;
    } else {
      const closeOrder = await c.emergencyCloseMarket({ symbol, direction: order.direction, quantity: order.qty });
      exitPrice = parseFloat(closeOrder.avgPrice) || order.tp;
      pnlUsd = order.direction === 'buy' ? (exitPrice - order.entryPrice) * order.qty : (order.entryPrice - exitPrice) * order.qty;
    }
    pnlPct = (pnlUsd / order.marginUsd) * 100;

    const journal = loadJournal();
    const target = journal.orders.find((o) => o.id === order.id);
    Object.assign(target, { status: won ? 'closed_tp' : 'closed_sl', exitPrice, pnlUsd, pnlPct, closedAt: new Date().toISOString() });
    saveJournal(journal);

    const msg = formatAutoClosed({ direction: order.direction === 'buy' ? 'long' : 'short', mode: order.mode, entryPrice: order.entryPrice, exitPrice, pnlUsd, assetLabel: assetCfg.label }, new Date())
      + (alreadyClosed ? '\n\n(⏳ Kelikuidasi PAS lagi offline -- baru kesinkronin sekarang begitu online lagi.)' : '');
    console.log(msg + '\n');
    await notify(msg);
    emit({ entryId: order.id, type: 'close', status: won ? 'closed' : 'closed', pnlUsd: target.pnlUsd, closedAt: target.closedAt });
    return target;
  }

  async function processAsset(assetCfg) {
    const { symbol, zoneSymbol, key: assetKey } = assetCfg;
    let journal = loadJournal();
    const floating = getFloatingOrder(journal, assetKey);

    if (floating) {
      const posRisk = await c.getPositionRisk(symbol);
      const stillOpen = Math.abs(parseFloat(posRisk.positionAmt)) > 0;

      if (!stillOpen) {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: posisi UDAH GAK ADA (kelikuidasi/offline) -- rekonsiliasi income history.`);
        const realPnlUsd = await fetchRealizedPnlSince(symbol, new Date(floating.triggeredAt).getTime());
        await closePosition(assetCfg, floating, { alreadyClosed: true, realPnlUsd, won: realPnlUsd >= 0 });
        journal = loadJournal();
        if (realPnlUsd >= 0) journal.watchZoneByAsset[assetKey] = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
        saveJournal(journal);
      } else {
        const livePrice = await fetchLivePrice(symbol);
        const hitTp = floating.direction === 'buy' ? livePrice >= floating.tp : livePrice <= floating.tp;
        if (hitTp) {
          console.log(`[NyopetAutoTrader] ${assetCfg.label}: target kena (${livePrice} vs TP ${floating.tp}) -- tutup untung, reverse.`);
          await closePosition(assetCfg, floating, { alreadyClosed: false, won: true });
          journal = loadJournal();
          journal.watchZoneByAsset[assetKey] = { price: floating.tp, side: floating.direction === 'buy' ? 'resistance' : 'support' };
          saveJournal(journal);
        } else {
          console.log(`[NyopetAutoTrader] ${assetCfg.label}: masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}, liq ${floating.liqPrice}) -- lanjut pantau.`);
          return;
        }
      }
    }

    const candlesStruct = await fetchCandles(zoneSymbol, '1h', 386);
    const i = candlesStruct.length - 1;
    const zones = detectZones(candlesStruct, i);
    const candles5m = await fetchCandles(zoneSymbol, '5m', 4);
    const latest5m = candles5m[candles5m.length - 1];

    const watchZone = journal.watchZoneByAsset[assetKey];
    if (watchZone) {
      const zoneAsActive = { price: watchZone.price, direction: watchZone.side === 'support' ? 'long' : 'short' };
      if (isZoneBroken(latest5m, zoneAsActive)) {
        const breakoutDirection = watchZone.side === 'support' ? 'sell' : 'buy';
        const pair = findNearestPair(latest5m.close, zones);
        const nextTarget = breakoutDirection === 'sell' ? pair.support : pair.resistance;
        if (!nextTarget) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: zona ditembus tapi belum ketemu target berikutnya -- tunggu siklus depan.`); return; }
        await openPosition(assetCfg, { direction: breakoutDirection, tp: nextTarget.price, mode: 'follow', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
        return;
      }
      const direction = watchZone.side === 'support' ? 'buy' : 'sell';
      const pair = findNearestPair(latest5m.close, zones);
      const tp = direction === 'buy' ? pair.resistance : pair.support;
      if (!tp) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: belum ketemu zona lawan buat TP -- tunggu siklus depan.`); return; }
      await openPosition(assetCfg, { direction, tp: tp.price, mode: 'fade', zoneCtx: { price: watchZone.price, kind: watchZone.zoneKind || 'swing', touches: watchZone.touches, side: watchZone.side } });
      return;
    }

    const touched = findTouchCandidate(latest5m, zones);
    if (!touched) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: belum ada zona ke-touch, dan belum ada watchZone -- tunggu siklus depan.`); return; }
    const pair = findNearestPair(latest5m.close, zones);
    const tp = touched.direction === 'long' ? pair.resistance : pair.support;
    await openPosition(assetCfg, { direction: touched.direction === 'long' ? 'buy' : 'sell', tp: tp ? tp.price : touched.price, mode: 'fade', zoneCtx: { price: touched.price, kind: touched.kind, touches: touched.touches, side: touched.direction === 'long' ? 'support' : 'resistance' } });
  }

  async function main() {
    for (const assetCfg of Object.values(NYOPET_ASSETS)) {
      try {
        await processAsset(assetCfg);
      } catch (e) {
        console.log(`[NyopetAutoTrader] ERROR ${assetCfg.label}:`, e.message);
      }
    }
  }

  return { processAsset, main, loadJournal, getFloatingOrder };
}

// ============ Wrapper backward-compatible (akun Olan sendiri) -- ZERO perubahan perilaku, path
// journal SAMA (nyopet-journal.json), kredensial/WA SAMA (binanceExecutor default + fonnte.js). ============
const _defaultTrader = createNyopetTrader({});

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[NyopetAutoTrader] Kill switch OFF -- gak ngapa-ngapain.');
    return;
  }
  await _defaultTrader.main();
}

module.exports = { createNyopetTrader, main };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR nyopetAutoTrader.js:', e.message); process.exit(1); });
}
