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
const { createBinanceClient } = require('./binanceExecutor');
const { createBinanceSpotEarnClient } = require('./binanceSpotEarnExecutor');
const { createNyopetTrader } = require('./nyopetAutoTrader');
const { createSniperAccountTrader } = require('./sniperMultiAccount');
const { createSpotDcaAltAccountTrader } = require('./spotDcaAltAccount');
const kaela = require('./kaelaProTraderClient');
const { isLiveTradingEnabled } = require('./killSwitch');

const STATE_DIR = path.join(__dirname, 'multi-account-state');

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

// Journal personal (23 Agu 2026) -- CUMA ditulis buat mode 'real' (permintaan Olan: "bagi member
// jurnal demo tak usah diadakan, real aja"). Demo tetap DIEKSEKUSI (WA notif tetap jalan lewat
// `sendWA`), cuma gak nyampah ke Sheet Journal.
function buildJournalHook(account) {
  if (account.mode !== 'real') return () => {};
  return function onEvent(evt) {
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
    const full = `[Kaela Access -- ${account.mode.toUpperCase()}]\n\n${message}\n\nCek jurnal/status posisi kamu: ${KAELA_ACCESS_URL}`;
    await kaela.notifyMember(account.phone, full);

    const isSelf = adminRelay && safeKey(account.phone) === safeKey(adminRelay.masterNomor);
    const relayOn = adminRelay && (account.mode === 'real' ? adminRelay.notifyReal : adminRelay.notifyDemo);
    if (adminRelay && relayOn && !isSelf) {
      const adminCopy = `[Kaela Access -- INFO ADMIN, ${account.mode.toUpperCase()}]\n\nMember: ${account.name} (${account.phone})\n\n${message}`;
      await kaela.notifyMember(adminRelay.masterNomor, adminCopy).catch((e) =>
        console.log(`[MultiAccountExecutor] Relay notif admin gagal (${account.phone}):`, e.message));
    }
  };
}

async function processAccount(account, sharedSniperOrders, adminRelay, closeRequests) {
  console.log(`\n[MultiAccountExecutor] === ${account.name} (${account.phone}) -- ${account.mode.toUpperCase()} ===`);
  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' });
  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' };
  const modalOverride = buildModalOverride(account, client);
  const journalHook = buildJournalHook(account);
  const sendWA = buildSendWA(account, adminRelay);
  const key = safeKey(account.phone) + '-' + account.mode;

  try {
    const nyopetTrader = createNyopetTrader({
      client, journalPath: path.join(STATE_DIR, `${key}-nyopet.json`),
      sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook,
    });
    // 28 Agu 2026 -- eksekusi antrian tutup posisi manual DULUAN, sebelum siklus normal (biar
    // kalau ada sinyal baru abis ditutup, "nonstop posisi" tetep jalan alami di main() bawahnya).
    const myCloseRequests = (closeRequests || []).filter((r) => safeKey(r.phone) === safeKey(account.phone) && r.mode === account.mode);
    for (const req of myCloseRequests) {
      const result = await nyopetTrader.forceClosePosition(req.asset, req.requestedBy);
      console.log(`[MultiAccountExecutor] Tutup manual ${req.asset} (${account.phone}/${account.mode}):`, result.ok ? 'OK' : result.error);
    }
    await nyopetTrader.main();
  } catch (e) {
    console.log(`[MultiAccountExecutor] Nyopet ERROR (${account.phone}/${account.mode}):`, e.message);
  }

  try {
    const sniperTrader = createSniperAccountTrader({
      client, statePath: path.join(STATE_DIR, `${key}-sniper.json`),
      sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook,
    });
    await sniperTrader.runCycle(sharedSniperOrders);
  } catch (e) {
    console.log(`[MultiAccountExecutor] Sniper ERROR (${account.phone}/${account.mode}):`, e.message);
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
    const positionsRaw = await Promise.all(
      Object.values(ASSETS).map((a) => client.getPositionRisk(a.symbol).catch(() => null))
    );
    const positions = positionsRaw
      .filter((p) => p && Math.abs(parseFloat(p.positionAmt)) > 0)
      .map((p) => ({
        symbol: p.symbol, positionAmt: p.positionAmt, entryPrice: p.entryPrice,
        markPrice: p.markPrice, unRealizedProfit: p.unRealizedProfit,
        leverage: p.leverage, liquidationPrice: p.liquidationPrice,
        marginType: p.marginType, notional: p.notional,
      }));
    await kaela.recordMemberStatus(account.phone, account.mode, balanceUsdt, balanceUsdc, positions);
    console.log(`[MultiAccountExecutor] recordMemberStatus OK (${account.phone}/${account.mode}) -- $${balanceUsdt.toFixed(2)} USDT, $${balanceUsdc.toFixed(2)} USDC, ${positions.length} posisi.`);
  } catch (e) {
    console.log(`[MultiAccountExecutor] recordMemberStatus ERROR (${account.phone}/${account.mode}):`, e.message);
  }

  // Compound Alt DCA (25 Agu 2026) -- TOGGLE TERPISAH (account.compoundAltEnabled), beda dari
  // Sniper/Nyopet yang jalan otomatis buat SEMUA akun aktif -- member wajib opt-in eksplisit ke
  // strategi ini (dana ngendon ~1,5 tahun/siklus). Client-nya BEDA (Spot+Earn, bukan Futures) tapi
  // API key/secret SAMA (1 API key Binance bisa punya izin Spot+Futures sekaligus).
  if (account.compoundAltEnabled) {
    try {
      const spotEarnClient = createBinanceSpotEarnClient({ apiKey: account.apiKey, apiSecret: account.apiSecret });
      const compoundAltTrader = createSpotDcaAltAccountTrader({
        client: spotEarnClient, statePath: path.join(STATE_DIR, `${key}-compoundalt.json`),
        sendWA, onEvent: journalHook,
      });
      await compoundAltTrader.runCycle(new Date());
    } catch (e) {
      console.log(`[MultiAccountExecutor] Compound Alt DCA ERROR (${account.phone}/${account.mode}):`, e.message);
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
      await kaela.recordBalanceReport(acc.phone, acc.name, { balanceUsdt, balanceUsdc, transferTotal, tradingTotal, days });
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

  ensureStateDir();

  // Nomor Olan sendiri (owner/MASTER_NOMOR Kaela Pro Trader) -- BUKAN secret, cuma penanda buat
  // skip-rule "Demo Olan = sistem lama" di atas. Kalau nomor Olan pernah ganti, update di sini.
  const masterNomor = '6281299303888';
  const active = accounts.filter((a) => {
    if (safeKey(a.phone) === masterNomor && a.mode === 'demo') {
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
  const adminRelay = { masterNomor, notifyReal: adminNotify.notifyReal, notifyDemo: adminNotify.notifyDemo };
  const closeRequests = await kaela.getPendingCloseRequests();
  if (closeRequests.length) console.log(`[MultiAccountExecutor] ${closeRequests.length} permintaan tutup posisi manual di antrian.`);

  for (const account of active) {
    await processAccount(account, sharedSniperOrders, adminRelay, closeRequests);
  }
  console.log('\n[MultiAccountExecutor] Selesai.');
}

module.exports = { main };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR multiAccountExecutor.js:', e.message); process.exit(1); });
}
