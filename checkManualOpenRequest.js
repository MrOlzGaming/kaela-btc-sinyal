// checkManualOpenRequest.js (3 Sep 2026, permintaan Olan: "aku senior trader, mau bisa backup
// Kaela Nyopet, buka posisi manual dari web -- gak usah nunggu 15 menit") -- jadwal CEPAT (~1
// menit, numpang cadence sama kayak checkForceSyncRequest.js), TERPISAH dari siklus utama 15
// menit biar Olan (atau member lain) dapet hasil buka posisi manual-nya CEPAT, gak nunggu lama.
//
// KHUSUS Nyopet (Sniper murni Kaela -- Olan: "aku cuma bantu Kaela nyopet"). Size/leverage/margin
// SELALU dihitung kalkulator exposure (hitungExposure di dalam openPosition, SAMA PERSIS dipakai
// sinyal otomatis) dari StopLoss yang Olan/member masukin lewat web -- TIDAK PERNAH size bebas
// (permintaan tegas Olan: "ga bisa input bebas. apalagi allin!"). Arah (buy/sell) BEBAS buat
// manual -- beda dari bot yang buy-only (backtest kebukti short ngerusak), ini KEPUTUSAN SADAR
// Olan sendiri sebagai trader (dikonfirmasi eksplisit 3 Sep 2026, BUKAN diam-diam nyalain short).
//
// Notif+jurnal REUSE buildJournalHook/buildSendWA dari multiAccountExecutor.js (SATU sumber
// kebenaran) -- posisi manual dapet perlakuan SAMA PERSIS kayak posisi yang dibuka bot: DM ke
// pemilik akun, broadcast Wibowo Hedgefund kalau ini akun Real Olan, relay admin kalau nyala.

const path = require('path');
const kaela = require('./kaelaProTraderClient');
const { createBinanceClient } = require('./binanceExecutor');
const { createMexcClient } = require('./mexcExecutor');
const { createNyopetTrader } = require('./nyopetAutoTrader');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');
const { buildJournalHook, buildSendWA, safeKey, MASTER_NOMOR } = require('./multiAccountExecutor');

const STATE_DIR = path.join(__dirname, 'multi-account-state');

async function processRequest(req, adminRelay) {
  const assetCfg = NYOPET_ASSETS[req.asset];
  if (!assetCfg) {
    await kaela.resolveManualOpenRequest(req.requestId, 'failed', `Asset "${req.asset}" gak dikenal.`);
    return;
  }

  const binanceAccounts = await kaela.getTradingAccounts('binance');
  const account = binanceAccounts.find((a) => safeKey(a.phone) === safeKey(req.phone) && a.mode === req.mode);
  if (!account) {
    await kaela.resolveManualOpenRequest(req.requestId, 'failed', 'Akun/API key Binance gak ketemu -- pasang API key dulu di Setting.');
    return;
  }

  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: req.mode === 'demo' });
  let mexcClient = null;
  if (assetCfg.exchange === 'mexc') {
    const mexcAccounts = await kaela.getTradingAccounts('mexc');
    const mexcAccount = mexcAccounts.find((a) => safeKey(a.phone) === safeKey(req.phone) && a.mode === req.mode);
    if (!mexcAccount) {
      await kaela.resolveManualOpenRequest(req.requestId, 'failed', 'API MEXC belum dipasang -- Emas butuh itu, pasang dulu di Setting.');
      return;
    }
    mexcClient = createMexcClient({ apiKey: mexcAccount.apiKey, apiSecret: mexcAccount.apiSecret });
  }

  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: req.mode === 'demo' };
  const key = safeKey(req.phone) + '-' + req.mode;
  const journalHook = buildJournalHook(account, null); // touchedSymbols null -- gak dipakai di jalur ini
  const sendWA = buildSendWA(account, adminRelay);

  const trader = createNyopetTrader({
    client, mexcClient, journalPath: path.join(STATE_DIR, `${key}-nyopet.json`),
    apiCreds, onEvent: journalHook, sendWA,
  });

  const journal = trader.loadJournal();
  const existing = trader.getFloatingOrder(journal, req.asset);
  if (existing) {
    await kaela.resolveManualOpenRequest(req.requestId, 'failed', `Udah ada posisi floating buat ${assetCfg.label} -- tutup dulu sebelum buka baru.`);
    return;
  }
  // ⚠️ BUG BAHAYA ketemu 3 Sep 2026 (Olan nyoba fitur ini, GAGAL "Leverage reduction is not
  // supported... with open positions") -- journal LOKAL (di atas) bisa GAK TAU posisi yang
  // BENERAN ada di exchange (kemungkinan abis leader pindah mesin, multi-account-state/ sengaja
  // gak disinkron git). Cek LANGSUNG ke exchange sebelum lanjut -- lebih bisa dipercaya drpd file
  // lokal yang bisa basi.
  const execForCheck = assetCfg.exchange === 'mexc' ? mexcClient : client;
  const liveCheckPos = execForCheck ? await execForCheck.getPositionRisk(assetCfg.symbol).catch(() => null) : null;
  if (liveCheckPos && Math.abs(parseFloat(liveCheckPos.positionAmt)) > 0) {
    await kaela.resolveManualOpenRequest(req.requestId, 'failed', `Udah ada posisi LIVE di exchange buat ${assetCfg.label} (entry ${liveCheckPos.entryPrice}) yang gak kecatat di jurnal -- tutup dulu posisi itu (bisa lewat Binance/MEXC langsung) sebelum buka baru.`);
    return;
  }

  try {
    // Dua mode input (Olan: "nyawa dalam persen ATAU harga sl") -- kalau nyawaPct yang diisi,
    // konversi ke harga SL ASLI pakai harga live SAAT INI (bukan pas Olan submit form -- bisa
    // beda beberapa menit), harga yang SAMA ini juga dioper ke openPosition biar SL & entry
    // konsisten dari 1 harga, bukan 2 fetch beda waktu.
    let sl = req.stopLoss ? Number(req.stopLoss) : null;
    let livePrice = null;
    if (!sl && req.nyawaPct) {
      livePrice = await trader.fetchLivePrice(assetCfg.symbol, assetCfg.exchange);
      const nyawaPct = Number(req.nyawaPct);
      sl = req.direction === 'buy' ? livePrice * (1 - nyawaPct / 100) : livePrice * (1 + nyawaPct / 100);
    }
    const order = await trader.openPosition(assetCfg, { direction: req.direction, sl, patternType: 'manual' }, livePrice);
    if (!order) {
      await kaela.resolveManualOpenRequest(req.requestId, 'failed', 'Gagal buka posisi -- SL sama persis harga entry (jarak nyawa nol), coba ulang dengan SL beda.');
      return;
    }
    await kaela.resolveManualOpenRequest(req.requestId, 'success', JSON.stringify({
      entryPrice: order.entryPrice, leverage: order.leverage, marginUsd: order.marginUsd,
      nilaiPosisi: order.nilaiPosisi, tp: order.tp, sl: order.sl, direction: order.direction,
    }));
    console.log(`[CheckManualOpen] Sukses -- ${req.phone}/${req.mode} ${assetCfg.label} ${req.direction} @ ${order.entryPrice}, leverage ${order.leverage}x`);
  } catch (e) {
    await kaela.resolveManualOpenRequest(req.requestId, 'failed', `Gagal eksekusi di exchange: ${e.message}`);
    console.log(`[CheckManualOpen] GAGAL -- ${req.phone}/${req.mode} ${assetCfg.label}:`, e.message);
  }
}

async function main() {
  const requests = await kaela.getPendingManualOpenRequests();
  if (!requests.length) { console.log('[CheckManualOpen] Gak ada permintaan.'); return; }
  console.log(`[CheckManualOpen] ${requests.length} permintaan buka posisi manual.`);
  const adminNotify = await kaela.getAdminNotifySettings();
  const adminRelay = { masterNomor: MASTER_NOMOR, notifyReal: adminNotify.notifyReal, notifyDemo: adminNotify.notifyDemo };
  for (const req of requests) {
    await processRequest(req, adminRelay).catch((e) => {
      console.log('[CheckManualOpen] ERROR gak ketangkep di processRequest:', e.message);
      kaela.resolveManualOpenRequest(req.requestId, 'failed', `Error internal: ${e.message}`).catch(() => {});
    });
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR checkManualOpenRequest.js:', e.message); process.exit(1); });
}

module.exports = { main };
