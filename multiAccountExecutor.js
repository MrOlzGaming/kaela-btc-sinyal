// multiAccountExecutor.js (23 Agu 2026) -- ORKESTRATOR "Kaela Pro Trader" multi-akun. Numpang
// cadence run-local-executor.ps1 (tiap 15 menit) SETELAH sistem Olan sendiri (localLiveExecutor/
// sniperLiveMonitor/nyopetAutoTrader) kelar, biar sniper-orders.json yang dibaca di sini UDAH
// fresh dari cycle Olan barusan.
//
// LINGKUP (23 Agu 2026, dikonfirmasi Olan):
// - Demo Olan sendiri = SISTEM LAMA yang UDAH jalan (localLiveExecutor.js dkk) -- modul ini SAMA
//   SEKALI GAK NYENTUH itu, di-skip eksplisit biar gak dobel-eksekusi 1 akun dari 2 sumber beda.
// - Real Olan (kalau diaktifin lewat Kaela Pro Trader) DIPERLAKUKAN SAMA kayak member lain --
//   jurnal personal sendiri, bukan nyambung ke sniper-orders.json/nyopet-journal.json lama.
// - Member lain BOLEH aktifin demo MAUPUN real, dua-duanya DIEKSEKUSI -- tapi jurnal PERSONAL
//   (Sheet "Journal" di GAS) CUMA ditulis buat mode REAL (demo gak usah dicatat jurnal, cukup
//   notif WA doang biar keliatan jalan pas lagi nyoba).
//
// SNIPER: sinyal (arah/SL/TP/pola) itu SATU SUMBER BERSAMA (analisa chart Olan, sniper-orders.json)
//   -- di-MIRROR ke tiap akun aktif (lihat sniperMultiAccount.js), sizing SENDIRI2 dari saldo
//   masing2 (kalkulator exposure OLZ, BUKAN copy-trade buta).
// NYOPET: logika zona-likuiditas dijalanin ULANG SENDIRI-SENDIRI per akun (data candle publik,
//   SAMA buat semua orang) -- state/journal per-akun independen (lihat nyopetAutoTrader.js).
//
// STATE per-akun disimpen di ./multi-account-state/<phone>-<mode>-{sniper,nyopet}.json -- TERPISAH
// TOTAL dari sniper-orders.json/nyopet-journal.json Olan (JANGAN PERNAH ditulis ke situ).

const fs = require('fs');
const path = require('path');
const { load: loadSniperOrders } = require('./sniperOrders');
const { ASSETS } = require('./assetConfig');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');
const { createBinanceClient } = require('./binanceExecutor');
const { createMexcClient } = require('./mexcExecutor');
const { createBinanceSpotEarnClient } = require('./binanceSpotEarnExecutor');
const { createNyopetTrader } = require('./nyopetAutoTrader');
const { createSniperAccountTrader } = require('./sniperMultiAccount');
const { createSpotDcaAltAccountTrader } = require('./spotDcaAltAccount');
const { createSpotDcaAccountTrader } = require('./spotDcaAccount');
const kaela = require('./kaelaProTraderClient');
const { isLiveTradingEnabled } = require('./killSwitch');
const { checkEmptyWallet } = require('./emptyWalletWatchdog');
const { sendWhatsApp } = require('./fonnte');
const { reconcileWibowoPositions } = require('./positionReconciler');

const STATE_DIR = path.join(__dirname, 'multi-account-state');

// Nomor Olan sendiri (owner/master Kaela Pro Trader) -- BUKAN secret, penanda dipakai di 2 tempat:
// skip "Demo Olan = sistem lama" (bawah) DAN exempt dari auto-shutoff emptyWalletWatchdog (31 Agu
// 2026, permintaan Olan: "auto tradingnya buat on terus walau saldo ga cukup, ga ada auto mati
// sendiri.. kan dia masternya.. semuanya on, spot sniper nyopet demo"). Kalau nomor Olan pernah
// ganti, update di SATU tempat ini.
const MASTER_NOMOR = '6281299303888';

// Grup WA "Wibowo Hedgefund" -- SAMA PERSIS ID yang dipakai APPS/kaela-multi-akun/gas/Pool.gs
// WIBOWO_GROUP_ID (dan secrets.js FONNTE_BROADCAST_GROUPS[1] di sini, "Sniper Fam"). Konstanta
// langsung (bukan secret) -- cuma ID grup WA, sama alasan kayak Pool.gs. Dipakai buildSendWA di
// bawah biar notif buka/tutup posisi REAL Olan (dasar saham Wibowo Hedgefund) juga nyampe ke
// grup, gak cukup DM pribadi doang (2-3 Sep 2026, permintaan Olan).
const WIBOWO_GROUP_ID = '120363430640997174@g.us';

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function safeKey(phone) { return String(phone).replace(/[^0-9]/g, ''); }

// Modal efektif per-akun (23 Agu 2026, "Sesuai Modal" vs "Sesuai Modal + Kekayaan Eksternal") --
// balanceMode='manual' -> saldo LIVE (dari client, marginAsset yang sesuai) + external override;
// balanceMode='auto' (default) -> null (caller pakai saldo live apa adanya, gak ada override).
function buildModalOverride(account, client) {
  return async (marginAsset) => {
    if (account.balanceMode !== 'manual') return null;
    const external = marginAsset === 'USDC' ? account.externalUsdc : account.externalUsdt;
    if (!external) return null;
    const live = await client.getAccountBalance(marginAsset);
    return live + external;
  };
}

// Resolusi assetKey+strategy+exchange (dari onEvent) -> symbol trading ASLI -- dipakai buat isi
// `touchedSymbols` (lihat buildJournalHook) biar positionReconciler.js bisa bedain "ini bot yang
// buka/tutup" (skip, udah dihandle notify() sendiri) vs "ini muncul/ilang tanpa event bot = manual
// Olan". Pola SAMA kayak binanceSymbols/mexcSymbols di processAccount di bawah.
function _symbolForEvent(evt) {
  const cfg = evt.strategy === 'sniper' ? ASSETS[evt.asset] : NYOPET_ASSETS[evt.asset];
  if (!cfg) return null;
  return cfg.exchange === 'mexc' ? (cfg.execSymbol || cfg.symbol) : cfg.symbol;
}

// Journal personal (23 Agu 2026) -- CUMA ditulis buat mode 'real' (permintaan Olan: "bagi member
// jurnal demo tak usah diadakan, real aja"). Demo tetap DIEKSEKUSI (WA notif tetap jalan lewat
// `sendWA`), cuma gak nyampah ke Sheet Journal.
// PENGECUALIAN (2 Sep 2026, permintaan Olan: "Jurnal Demo" tab publik di Kaela Access) -- demo
// Olan SENDIRI (MASTER_NOMOR) TETAP dijurnal, biar tab "Jurnal Demo" (keliatan buat SEMUA anggota,
// lihat gas/Journal.gs getOlanDemoJournal) punya riwayat beneran, bukan cuma posisi floating live.
// Demo member LAIN (Nirwan dkk) TETAP gak dijurnal -- gak ada yang minta itu, hindari nyampah.
// `touchedSymbols` (2-3 Sep 2026, permintaan Olan: bedain trading Kaela vs manual Olan di jurnal
// Wibowo Hedgefund) -- Set OPSIONAL, kalau dikasih bakal keisi symbol yang BENERAN disentuh bot
// siklus ini, dibaca positionReconciler.js abis processAccount kelar.
function buildJournalHook(account, touchedSymbols) {
  const journalDemoOlan = account.mode === 'demo' && safeKey(account.phone) === safeKey(MASTER_NOMOR);
  if (account.mode !== 'real' && !journalDemoOlan) return () => {};
  return function onEvent(evt) {
    if (touchedSymbols && (evt.type === 'open' || evt.type === 'close' || evt.type === 'partial')) {
      const sym = _symbolForEvent(evt);
      if (sym) touchedSymbols.add(sym);
    }
    if (evt.type === 'open') {
      kaela.recordJournalEntry(account.phone, account.mode, {
        entryId: evt.entryId, strategy: evt.strategy, asset: evt.asset, direction: evt.direction,
        entryPrice: evt.entryPrice, sl: evt.sl, tp: evt.tp, leverage: evt.leverage, marginUsd: evt.marginUsd,
        status: 'open', openedAt: evt.openedAt, note: evt.note || '',
      }).catch((e) => console.log(`[MultiAccountExecutor] recordJournalEntry gagal (${account.phone}):`, e.message));
    } else if (evt.type === 'close') {
      kaela.updateJournalEntry(evt.entryId, { status: 'closed', closedAt: evt.closedAt, pnlUsd: evt.pnlUsd })
        .catch((e) => console.log(`[MultiAccountExecutor] updateJournalEntry gagal (${account.phone}):`, e.message));
    }
  };
}

// Link PRIVAT Kaela Access disertain di notif -- TAPI CUMA buat posisi yang beneran kebuka
// otomatis lewat akun member sendiri (23 Agu 2026, logika Olan: "sinyal Kaela link tetep yang
// sekarang buat member external.. tapi kalo dia dah open posisi otomatis, infonya sertain link
// kaela yang privat itu"). Link publik sinyal grup TETAP terpisah, TIDAK diubah di sini.
const KAELA_ACCESS_URL = 'https://kaela-access.netlify.app/';

// 28 Agu 2026, permintaan Olan: "khusus olan master admin, baik demo dan real info aja ke olan"
// -- relay COPY notif ke Olan (toggle-able di Setting, lihat Config.gs getAdminNotifySettings),
// TERPISAH dari notif ke member itu sendiri. `adminRelay` = { masterNomor, notifyReal, notifyDemo }
// diambil SEKALI per siklus (bukan per-akun) di main(), biar gak spam GAS call berkali-kali.
function buildSendWA(account, adminRelay) {
  return async (message) => {
    // 3 Sep 2026: pesan Sniper/Nyopet/Reconciler SEKARANG udah selalu nyelipin link sendiri di
    // body (desain terpadu, lihat darkKaelaLog.js) -- kalau udah ada, JANGAN tambahin trailer lagi
    // (dobel link). Pesan LAIN (saldo kosong/DCA/dst) yang belum bawa link sendiri tetep dapet
    // trailer ini seperti biasa.
    const hasOwnLink = message.includes('kaela-access.netlify.app');
    const full = hasOwnLink
      ? `[Kaela Access -- ${account.mode.toUpperCase()}]\n\n${message}`
      : `[Kaela Access -- ${account.mode.toUpperCase()}]\n\n${message}\n\nCek jurnal/status posisi kamu: ${KAELA_ACCESS_URL}`;
    // 29 Agu 2026, permintaan Olan: "ga semua minta notif demo" -- opt-out PRIBADI per member
    // (account.notifyDemo, default true, lihat Sheet.gs getActiveTradingUsers). Real TIDAK di-gate --
    // itu duit sungguhan, semua member wajib tau tanpa kecuali.
    if (account.mode !== 'demo' || account.notifyDemo !== false) {
      await kaela.notifyMember(account.phone, full);
    }

    const isSelf = adminRelay && safeKey(account.phone) === safeKey(adminRelay.masterNomor);
    const relayOn = adminRelay && (account.mode === 'real' ? adminRelay.notifyReal : adminRelay.notifyDemo);
    if (adminRelay && relayOn && !isSelf) {
      const adminCopy = `[Kaela Access -- INFO ADMIN, ${account.mode.toUpperCase()}]\n\nMember: ${account.name} (${account.phone})\n\n${message}`;
      await kaela.notifyMember(adminRelay.masterNomor, adminCopy).catch((e) =>
        console.log(`[MultiAccountExecutor] Relay notif admin gagal (${account.phone}):`, e.message));
    }

    // 2-3 Sep 2026, permintaan Olan: buka/tutup posisi REAL Olan sendiri (dasar saham Wibowo
    // Hedgefund) WAJIB nyampe ke grup Wibowo Hedgefund juga -- pemegang saham transparan liat
    // aktivitas trading yang jadi dasar nilai saham mereka, gak cukup DM pribadi Olan doang.
    // Demo TIDAK ikut (bukan uang beneran, gak relevan buat pemegang saham).
    if (isSelf && account.mode === 'real') {
      await sendWhatsApp(message, WIBOWO_GROUP_ID).catch((e) =>
        console.log(`[MultiAccountExecutor] Broadcast Wibowo Hedgefund gagal:`, e.message));
    }
  };
}

// ⚠️ BAHAYA yang DICEGAH DI SINI (30 Agu 2026): nyopetAutoTrader.js/sniperMultiAccount.js punya
// fallback DEFAULT ke mexcExecutor.js singleton (akun REAL Olan sendiri) kalau `mexcClient` gak
// dikirim SAMA SEKALI (undefined) -- itu bener buat proses Olan sendiri (CLI), tapi FATAL kalau
// kepake buat MEMBER LAIN yang belum pasang MEXC: member demo/real siapapun bisa diam-diam
// eksekusi order MEXC pakai duit REAL Olan tanpa sadar. Fix: kalau member ini gak punya `mexcAccount`,
// JANGAN kirim undefined -- kirim STUB yang setiap methodnya throw error jelas, biar SELALU gagal
// aman ("belum disetup buat member ini") tanpa PERNAH numpang default Olan.
function _mexcNotConfiguredStub(name) {
  // ⚠️ BUG ketemu 30 Agu 2026 (dari tes manual -- error Abdu "MEXC belum disetup" nyampe sampe
  // GUGURIN recordMemberStatus, padahal harusnya cuma skip Emas): `err` WAJIB async. Fungsi
  // SYNC yang `throw` langsung throw ke caller (bukan reject Promise) -- `.catch()` di caller
  // (multiAccountExecutor.js dkk) gak nangkep apa-apa, error nembus ke try/catch LUAR yang lebih
  // gede lingkupnya (nge-gugurin seluruh laporan saldo, bukan cuma Emas doang). `async () => {
  // throw }` balikin Promise REJECTED, itu yang bisa di-`.catch()` per-panggilan dengan benar.
  const err = async () => { throw new Error(`MEXC belum disetup buat member "${name}" -- skip Emas, BTC tetap jalan normal.`); };
  return { getAccountBalance: err, setLeverage: err, setIsolatedMargin: err, placeMarketEntry: err, placeStopLoss: err, placeTakeProfit: err, getPositionRisk: err, cancelAllOpenOrders: err, getSymbolInfo: err, emergencyCloseMarket: err };
}

async function processAccount(account, sharedSniperOrders, adminRelay, closeRequests, mexcAccount, idrRate) {
  console.log(`\n[MultiAccountExecutor] === ${account.name} (${account.phone}) -- ${account.mode.toUpperCase()} ===`);
  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' });
  const mexcClient = mexcAccount
    ? createMexcClient({ apiKey: mexcAccount.apiKey, apiSecret: mexcAccount.apiSecret })
    : _mexcNotConfiguredStub(account.name);
  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' };
  const modalOverride = buildModalOverride(account, client);
  // touchedSymbols (2-3 Sep 2026) -- keisi symbol yang BENERAN disentuh bot siklus ini, dibaca
  // positionReconciler.js di ujung fungsi ini (cuma dipakai buat akun Real Olan, lihat bawah).
  const touchedSymbols = new Set();
  const journalHook = buildJournalHook(account, touchedSymbols);
  const sendWA = buildSendWA(account, adminRelay);
  const key = safeKey(account.phone) + '-' + account.mode;

  try {
    const nyopetTrader = createNyopetTrader({
      client, mexcClient, journalPath: path.join(STATE_DIR, `${key}-nyopet.json`),
      sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook, idrRate,
    });
    // 28 Agu 2026 -- eksekusi antrian tutup posisi manual DULUAN, sebelum siklus normal (biar
    // kalau ada sinyal baru abis ditutup, "nonstop posisi" tetep jalan alami di main() bawahnya).
    // 29 Agu 2026: difilter `strategy === 'nyopet'` (dulu semua request diasumsikan Nyopet -- field
    // Strategy baru ditambahin biar Sniper juga bisa ditutup manual, lihat blok Sniper di bawah).
    const myNyopetCloseRequests = (closeRequests || []).filter((r) => safeKey(r.phone) === safeKey(account.phone) && r.mode === account.mode && r.strategy === 'nyopet');
    for (const req of myNyopetCloseRequests) {
      const result = await nyopetTrader.forceClosePosition(req.asset, req.requestedBy, req.reason);
      console.log(`[MultiAccountExecutor] Tutup manual Nyopet ${req.asset} (${account.phone}/${account.mode}):`, result.ok ? 'OK' : result.error);
    }
    await nyopetTrader.main();
  } catch (e) {
    console.log(`[MultiAccountExecutor] Nyopet ERROR (${account.phone}/${account.mode}):`, e.message);
  }

  // BUG BAHAYA ketemu+fix 3 Sep 2026 (Olan nanya "menurut Kaela gimana?" soal temuan ini) --
  // Sniper akun OLAN SENDIRI (demo MAUPUN real) itu SISTEM LAMA yang UDAH jalan penuh
  // (localLiveExecutor.js buka posisi + sniperOrderMonitor.js pantau tutup, lihat memori
  // project-kaela-btc-sinyal) -- modul mirror multi-akun ini TUJUANNYA buat member LAIN (Nirwan
  // dkk) numpang sinyal chart pattern yang SAMA, BUKAN buat Olan sendiri. Demo Olan UDAH di-skip
  // total dari `active` (lihat filter di main()) dengan alasan PERSIS ini ("gak dobel-eksekusi 1
  // akun dari 2 sumber beda") -- tapi Real Olan KELEWAT gak ikut, karena pas ditulis (23 Agu
  // 2026) Real Sniper Olan belum jadi concern aktif. Nyopet AMAN dari celah ini (nyopetAutoTrader.js
  // versi standalone Olan SELALU demo, gak pernah nyentuh real) -- CUMA Sniper yang beresiko,
  // karena localLiveExecutor.js bisa demo ATAU real tergantung kill-switch. Fix: skip blok
  // Sniper ini TOTAL buat Olan (demo+real, walau demo praktiknya udah gak pernah nyampe sini),
  // biar akun dia CUMA punya SATU jalur eksekusi Sniper, gak pernah 2 sumber bisa buka posisi
  // yang sama bareng tanpa saling tau.
  if (safeKey(account.phone) === MASTER_NOMOR) {
    console.log(`[MultiAccountExecutor] Skip Sniper mirror buat Olan (master) -- Sniper punya dia ditangani localLiveExecutor.js/sniperOrderMonitor.js, JANGAN dobel.`);
  } else {
    try {
      const sniperTrader = createSniperAccountTrader({
        client, mexcClient, statePath: path.join(STATE_DIR, `${key}-sniper.json`),
        sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook, idrRate,
      });
      // 29 Agu 2026 -- sama pola kayak antrian tutup manual Nyopet di atas, DULUAN sebelum runCycle
      // normal (permintaan Olan: "tombol close manual baik sniper dan nyopet").
      const mySniperCloseRequests = (closeRequests || []).filter((r) => safeKey(r.phone) === safeKey(account.phone) && r.mode === account.mode && r.strategy === 'sniper');
      for (const req of mySniperCloseRequests) {
        const result = await sniperTrader.forceClosePosition(req.asset, req.requestedBy);
        console.log(`[MultiAccountExecutor] Tutup manual Sniper ${req.asset} (${account.phone}/${account.mode}):`, result.ok ? 'OK' : result.error);
      }
      await sniperTrader.runCycle(sharedSniperOrders);
    } catch (e) {
      console.log(`[MultiAccountExecutor] Sniper ERROR (${account.phone}/${account.mode}):`, e.message);
    }
  }

  // Saldo + posisi kebuka (25 Agu 2026, "member minta liat saldo sendiri di web") -- dititip ke
  // Sheet MemberStatus tiap siklus, sama pola kayak laporan saldo admin (BinanceAdmin.gs) --
  // GAS gak bisa manggil Binance langsung. USDT = wallet Sniper, USDC = wallet Nyopet (BEDA
  // collateral per strategi, lihat assetConfig.js/nyopetAutoTrader.js). Posisi dicek dari 2
  // simbol yang dipakai Sniper+Nyopet (SAMA-SAMA BTCUSDT/PAXGUSDT, cuma beda margin asset).
  try {
    const [balanceUsdt, balanceUsdc] = await Promise.all([
      client.getAccountBalance('USDT'),
      client.getAccountBalance('USDC'),
    ]);
    // MEXC (30 Agu 2026) -- fail-safe TERPISAH: kalau mexcClient stub (belum disetup) ATAU
    // beneran error, JANGAN gugurin laporan Binance -- default 0, log doang.
    // 30 Agu 2026 -- 4 dompet independen: MEXC USDT (Sniper Emas) + MEXC USDC (Nyopet Emas),
    // sama pola kayak Binance USDT/USDC di atas -- BUKAN 1 saldo gabungan lagi.
    const [mexcBalanceUsdt, mexcBalanceUsdc] = await Promise.all([
      mexcClient.getAccountBalance('USDT').catch((e) => {
        console.log(`[MultiAccountExecutor] Saldo MEXC USDT (${account.phone}/${account.mode}) gak kebaca:`, e.message);
        return 0;
      }),
      mexcClient.getAccountBalance('USDC').catch((e) => {
        console.log(`[MultiAccountExecutor] Saldo MEXC USDC (${account.phone}/${account.mode}) gak kebaca:`, e.message);
        return 0;
      }),
    ]);

    // Bug ketemu 29 Agu 2026 (Olan: "jurnal versi real tampilan ngarang") -- loop ini CUMA cek
    // symbol Sniper (assetConfig.js: BTCUSDT+PAXGUSDT), Nyopet BTC pakai symbol BEDA (BTCUSDC,
    // nyopetAssetConfig.js) -- posisi Nyopet BTC real gak PERNAH kecek/muncul di "Posisi Kebuka".
    // 30 Agu 2026 -- dipisah per exchange (Binance symbol vs execSymbol MEXC), Set biar gak
    // double-fetch simbol yang overlap (mis. dulu PAXGUSDT dipakai 2 strategi, sekarang XAUT_USDT
    // dipakai Sniper MEXC + PAXG_USDT dipakai Nyopet MEXC -- beda simbol, gak overlap lagi).
    const binanceSymbols = [...new Set([...Object.values(ASSETS), ...Object.values(NYOPET_ASSETS)].filter((a) => (a.exchange || 'binance') === 'binance').map((a) => a.symbol))];
    const mexcSymbols = [...new Set([...Object.values(ASSETS), ...Object.values(NYOPET_ASSETS)].filter((a) => a.exchange === 'mexc').map((a) => a.execSymbol))];
    const [binancePositionsRaw, mexcPositionsRaw] = await Promise.all([
      Promise.all(binanceSymbols.map((symbol) => client.getPositionRisk(symbol).catch(() => null))),
      Promise.all(mexcSymbols.map((symbol) => mexcClient.getPositionRisk(symbol).catch(() => null))),
    ]);
    const positions = [...binancePositionsRaw, ...mexcPositionsRaw]
      .filter((p) => p && Math.abs(parseFloat(p.positionAmt)) > 0)
      .map((p) => ({
        symbol: p.symbol, positionAmt: p.positionAmt, entryPrice: p.entryPrice,
        markPrice: p.markPrice, unRealizedProfit: p.unRealizedProfit,
        leverage: p.leverage, liquidationPrice: p.liquidationPrice,
        marginType: p.marginType, notional: p.notional,
      }));
    await kaela.recordMemberStatus(account.phone, account.mode, balanceUsdt, balanceUsdc, positions, mexcBalanceUsdt, mexcBalanceUsdc);
    console.log(`[MultiAccountExecutor] recordMemberStatus OK (${account.phone}/${account.mode}) -- $${balanceUsdt.toFixed(2)} USDT (Binance), $${balanceUsdc.toFixed(2)} USDC (Binance), $${mexcBalanceUsdt.toFixed(2)} USDT (MEXC), $${mexcBalanceUsdc.toFixed(2)} USDC (MEXC), ${positions.length} posisi.`);

    // Pengawas posisi manual (2-3 Sep 2026, permintaan Olan) -- KHUSUS akun Real Olan sendiri
    // (dasar saham Wibowo Hedgefund). `positions` di atas UDAH difetch (gak fetch dobel).
    if (safeKey(account.phone) === MASTER_NOMOR && account.mode === 'real') {
      try {
        // idrRate (3 Sep 2026) -- PAKAI yang UDAH difetch SEKALI di main() (parameter fungsi ini),
        // JANGAN fetch ulang GAS di sini (dulu fetch sendiri, sekarang numpang biar gak dobel call).
        await reconcileWibowoPositions({
          phone: account.phone, client, touchedSymbols,
          statePath: path.join(STATE_DIR, 'wibowo-reconciler-state.json'),
          idrRate,
        });
      } catch (e) {
        console.log('[MultiAccountExecutor] positionReconciler ERROR:', e.message);
      }
    }

    // 28 Agu 2026, permintaan Olan: "dompet kosong, japri -- 3 hari beruntun gak diisi, matiin
    // otomatis" -- numpang saldo yang UDAH DIAMBIL di atas, gak fetch Binance lagi.
    // ⛔ EXEMPT buat Olan sendiri (31 Agu 2026): "auto tradingnya buat on terus walau saldo ga
    // cukup, ga ada auto mati sendiri.. kan dia masternya.. semuanya on, spot sniper nyopet demo"
    // -- SEMUA mode (Real+Demo) punya Olan SAMA SEKALI gak pernah kena auto-shutoff, siapapun
    // member lain (Abdu/Nirwan/dst) TETAP kena aturan 3-hari seperti biasa.
    if (safeKey(account.phone) === MASTER_NOMOR) {
      console.log(`[MultiAccountExecutor] Skip emptyWalletWatchdog buat Olan (master) -- exempt permanen dari auto-shutoff.`);
    } else {
      await checkEmptyWallet({ phone: account.phone, mode: account.mode, name: account.name, balanceUsdt, balanceUsdc, sendWA })
        .catch((e) => console.log(`[MultiAccountExecutor] emptyWalletWatchdog ERROR (${account.phone}/${account.mode}):`, e.message));
    }
  } catch (e) {
    console.log(`[MultiAccountExecutor] recordMemberStatus ERROR (${account.phone}/${account.mode}):`, e.message);
  }

  // Compound Alt DCA (25 Agu 2026) -- TOGGLE TERPISAH (account.compoundAltEnabled), beda dari
  // Sniper/Nyopet yang jalan otomatis buat SEMUA akun aktif -- member wajib opt-in eksplisit ke
  // strategi ini (dana ngendon ~1,5 tahun/siklus). Client-nya BEDA (Spot+Earn, bukan Futures) tapi
  // API key/secret SAMA (1 API key Binance bisa punya izin Spot+Futures sekaligus).
  //
  // BUG BAHAYA ketemu 29 Agu 2026: `testnet` gak pernah dioper ke sini -- createBinanceSpotEarnClient
  // defaultnya MAINNET ASLI (lihat binanceSpotEarnExecutor.js), jadi akun mode 'demo' pun bakal
  // KENA UANG ASLI kalau toggle ini nyala. Fix: SEMENTARA account.mode==='real' doang yang boleh
  // (mainnet Spot Earn) -- 'demo' DIBLOKIR TOTAL (bukan diarahin ke Spot Testnet, itu butuh API key
  // TERPISAH member per-orang yang belum ada UI-nya, testnet.binance.vision beda sistem dari
  // account.apiKey member yang emang buat Futures Demo/Real). Compound Alt demo Kaela Access buat
  // member nanti perlu onboarding key testnet sendiri dulu (belum dibangun) -- BUKAN skip diam-diam,
  // notify + skip biar Olan sadar kalau ada member nyalain toggle sebelum itu siap.
  if (account.compoundAltEnabled && account.mode !== 'real') {
    console.log(`[MultiAccountExecutor] Compound Alt DCA SKIP (${account.phone}/${account.mode}): mode demo belum didukung (butuh API key Spot Testnet terpisah, belum ada onboarding-nya).`);
  } else if (account.compoundAltEnabled) {
    try {
      const spotEarnClient = createBinanceSpotEarnClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false });
      const compoundAltTrader = createSpotDcaAltAccountTrader({
        client: spotEarnClient, statePath: path.join(STATE_DIR, `${key}-compoundalt.json`),
        sendWA, onEvent: journalHook,
      });
      await compoundAltTrader.runCycle(new Date());
    } catch (e) {
      console.log(`[MultiAccountExecutor] Compound Alt DCA ERROR (${account.phone}/${account.mode}):`, e.message);
    }
  }

  // Musiman/Spot BTC DCA (29 Agu 2026, "copy sistem demo semua ke real, siapin") -- TOGGLE
  // TERPISAH (account.musimanEnabled), pola SAMA PERSIS kayak Compound Alt di atas (termasuk
  // gerbang demo-belum-didukung yang sama -- Spot Testnet butuh API key terpisah per-member,
  // belum ada onboarding UI-nya).
  if (account.musimanEnabled && account.mode !== 'real') {
    console.log(`[MultiAccountExecutor] Musiman DCA SKIP (${account.phone}/${account.mode}): mode demo belum didukung (butuh API key Spot Testnet terpisah, belum ada onboarding-nya).`);
  } else if (account.musimanEnabled) {
    try {
      const spotEarnClient = createBinanceSpotEarnClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false });
      const musimanTrader = createSpotDcaAccountTrader({
        client: spotEarnClient, statePath: path.join(STATE_DIR, `${key}-musiman.json`),
        sendWA, onEvent: journalHook,
      });
      await musimanTrader.runCycle(new Date());
    } catch (e) {
      console.log(`[MultiAccountExecutor] Musiman DCA ERROR (${account.phone}/${account.mode}):`, e.message);
    }
  }
}

// Laporan saldo admin (23-24 Agu 2026, permintaan Olan: "aku mau bisa lihat saldo memberku, biar
// bisa deteksi trading Kaela vs trading di luar Kaela vs setor/tarik") -- jalan di KOMPUTER OLAN
// (IP Indonesia, gak diblokir Binance -- GAS langsung diblokir HTTP 451, ketauan pas tes live 23
// Agu 2026, sama pola kayak GitHub Actions dulu). CUMA REAL yang dilaporin, JALAN TERUS regardless
// kill switch (ini monitoring read-only, bukan eksekusi -- Olan tetap mau bisa pantau walau lagi
// mode kill-switch off). "Trading Kaela" vs "di luar Kaela" DIPISAHIN DI SISI GAS (baca Sheet
// Journal langsung) -- di sini cuma kirim angka MENTAH hasil Binance.
async function runBalanceReports() {
  console.log('\n[MultiAccountExecutor] === Laporan Saldo Member (owner) ===');
  let accountsWithKeys;
  try {
    accountsWithKeys = await kaela.getAllAccountsWithKeys();
  } catch (e) {
    console.log('[MultiAccountExecutor] Gagal ambil daftar akun+key buat laporan saldo (skip):', e.message);
    return;
  }
  if (!accountsWithKeys || accountsWithKeys.length === 0) {
    console.log('[MultiAccountExecutor] Belum ada akun dgn API key buat dilaporin.');
    return;
  }

  const days = 7;
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const acc of accountsWithKeys) {
    try {
      const client = createBinanceClient({ apiKey: acc.apiKey, apiSecret: acc.apiSecret, testnet: false }); // REAL doang -- yang beneran perlu diawasi
      const [balanceUsdt, balanceUsdc, income] = await Promise.all([
        client.getAccountBalance('USDT'),
        client.getAccountBalance('USDC'),
        client.getIncomeHistory(sinceMs),
      ]);
      let transferTotal = 0, tradingTotal = 0;
      income.forEach((inc) => {
        const amt = Number(inc.income) || 0;
        if (inc.incomeType === 'TRANSFER') transferTotal += amt;
        else tradingTotal += amt; // REALIZED_PNL + FUNDING_FEE + COMMISSION + dst
      });

      // MEXC (31 Agu 2026) -- OPSIONAL, beda dari Binance. mexcConfigured=false kalau member
      // belum pasang MEXC (bukan error, cukup umum -- lihat memori project-kaela-multi-exchange).
      // Belum ada endpoint income-history MEXC (riset belum dilakuin) -- jadi CUMA saldo
      // dilaporin, gak ada breakdown transfer/trading kayak Binance.
      let mexcConfigured = false, mexcBalanceUsdt = 0, mexcBalanceUsdc = 0;
      if (acc.mexcApiKey && acc.mexcApiSecret) {
        mexcConfigured = true;
        try {
          const mexcClient = createMexcClient({ apiKey: acc.mexcApiKey, apiSecret: acc.mexcApiSecret });
          [mexcBalanceUsdt, mexcBalanceUsdc] = await Promise.all([
            mexcClient.getAccountBalance('USDT'),
            mexcClient.getAccountBalance('USDC'),
          ]);
        } catch (e) {
          console.log(`[MultiAccountExecutor] Gagal ambil saldo MEXC ${acc.name} (skip bagian MEXC laporan ini):`, e.message);
          mexcConfigured = false; // gagal fetch -- lebih aman anggap "belum setup" drpd nulis saldo 0 palsu
        }
      }

      await kaela.recordBalanceReport(acc.phone, acc.name, { balanceUsdt, balanceUsdc, transferTotal, tradingTotal, days, mexcConfigured, mexcBalanceUsdt, mexcBalanceUsdc });
      console.log(`[MultiAccountExecutor] Laporan saldo ${acc.name} tersimpan.`);
    } catch (e) {
      await kaela.recordBalanceReport(acc.phone, acc.name, { error: e.message }).catch(() => {});
      console.log(`[MultiAccountExecutor] Laporan saldo ${acc.name} GAGAL:`, e.message);
    }
  }
}

async function main() {
  await runBalanceReports().catch((e) => console.log('[MultiAccountExecutor] runBalanceReports ERROR:', e.message));

  if (!isLiveTradingEnabled()) {
    console.log('[MultiAccountExecutor] Kill switch OFF -- skip bagian eksekusi trading.');
    return;
  }

  let accounts;
  try {
    accounts = await kaela.getTradingAccounts('binance');
  } catch (e) {
    console.log('[MultiAccountExecutor] Gagal ambil daftar akun (SERVICE_KEY belum diisi/GAS belum siap?) -- skip run ini:', e.message);
    return;
  }
  if (!accounts || accounts.length === 0) {
    console.log('[MultiAccountExecutor] Gak ada akun member yang aktif trading saat ini.');
    return;
  }

  // MEXC (30 Agu 2026, migrasi eksekusi Emas -- lihat memori project-kaela-multi-exchange) --
  // FAIL-SAFE: kalau gagal/kosong, JANGAN gugurin seluruh run (BTC di Binance tetap harus jalan).
  // Map by phone+mode -- member yang belum pasang API MEXC gak ketemu di map ini, wajar (skip Emas
  // buat mereka, ditangkep nanti di execFor/mexcClient undefined check).
  let mexcAccountsByKey = {};
  try {
    const mexcAccounts = await kaela.getTradingAccounts('mexc');
    (mexcAccounts || []).forEach((a) => { mexcAccountsByKey[safeKey(a.phone) + '-' + a.mode] = a; });
  } catch (e) {
    console.log('[MultiAccountExecutor] Gagal ambil daftar akun MEXC (dilewatin, Emas skip siklus ini buat semua member):', e.message);
  }

  ensureStateDir();

  const active = accounts.filter((a) => {
    if (safeKey(a.phone) === MASTER_NOMOR && a.mode === 'demo') {
      console.log('[MultiAccountExecutor] Skip Demo Olan sendiri -- itu sistem lama (localLiveExecutor.js dkk), bukan tanggung jawab modul ini.');
      return false;
    }
    return true;
  });
  if (active.length === 0) {
    console.log('[MultiAccountExecutor] Gak ada akun (selain Demo Olan) yang perlu diproses.');
    return;
  }

  const sniperState = loadSniperOrders();
  const sharedSniperOrders = (sniperState.orders || []).filter((o) => o.liveExecution && o.liveExecution.ok && !o.liveExecution.fullyClosedAt);
  console.log(`[MultiAccountExecutor] ${active.length} akun aktif, ${sharedSniperOrders.length} sinyal Sniper live buat di-mirror.`);

  const adminNotify = await kaela.getAdminNotifySettings();
  const adminRelay = { masterNomor: MASTER_NOMOR, notifyReal: adminNotify.notifyReal, notifyDemo: adminNotify.notifyDemo };
  const closeRequests = await kaela.getPendingCloseRequests();
  if (closeRequests.length) console.log(`[MultiAccountExecutor] ${closeRequests.length} permintaan tutup posisi manual di antrian.`);
  // 3 Sep 2026, permintaan Olan: "untuk pnl sertakan idr nya bisa?" -- fetch SEKALI per siklus
  // (bukan per-pesan/per-akun, hemat panggilan GAS), dioper ke Sniper/Nyopet tiap akun. Gagal/null
  // -> semua pesan fallback USD doang (fmtUsdWithIdr null-safe), TIDAK gugurin siklus.
  const idrRate = await kaela.getUsdIdrRate();

  for (const account of active) {
    await processAccount(account, sharedSniperOrders, adminRelay, closeRequests, mexcAccountsByKey[safeKey(account.phone) + '-' + account.mode], idrRate);
  }
  console.log('\n[MultiAccountExecutor] Selesai.');
}

// runBalanceReports diekspor TERPISAH (31 Agu 2026) -- dipakai checkForceSyncRequest.js buat
// tarik saldo doang (BUKAN full cycle termasuk eksekusi trading), jadi aman dijalanin lebih
// sering (~1 menit) tanpa resiko dobel-eksekusi order.
// buildJournalHook/buildSendWA/safeKey/MASTER_NOMOR diekspor (3 Sep 2026) -- dipakai
// checkManualOpenRequest.js biar posisi manual dari web (Jurnal Saya) DAPET notif+jurnal PERSIS
// sama kayak posisi yang dibuka bot (DM member + broadcast Wibowo buat Olan + relay admin) --
// SATU sumber kebenaran, bukan reimplementasi/logic dobel yang bisa ketinggalan sinkron.
module.exports = { main, runBalanceReports, buildJournalHook, buildSendWA, safeKey, MASTER_NOMOR };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR multiAccountExecutor.js:', e.message); process.exit(1); });
}
