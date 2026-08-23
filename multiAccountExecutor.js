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
const { createBinanceClient } = require('./binanceExecutor');
const { createNyopetTrader } = require('./nyopetAutoTrader');
const { createSniperAccountTrader } = require('./sniperMultiAccount');
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

function buildSendWA(account) {
  return async (message) => {
    const full = `[Kaela Access -- ${account.mode.toUpperCase()}]\n\n${message}\n\nCek jurnal/status posisi kamu: ${KAELA_ACCESS_URL}`;
    await kaela.notifyMember(account.phone, full);
  };
}

async function processAccount(account, sharedSniperOrders) {
  console.log(`\n[MultiAccountExecutor] === ${account.name} (${account.phone}) -- ${account.mode.toUpperCase()} ===`);
  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' });
  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: account.mode === 'demo' };
  const modalOverride = buildModalOverride(account, client);
  const journalHook = buildJournalHook(account);
  const sendWA = buildSendWA(account);
  const key = safeKey(account.phone) + '-' + account.mode;

  try {
    const nyopetTrader = createNyopetTrader({
      client, journalPath: path.join(STATE_DIR, `${key}-nyopet.json`),
      sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook,
    });
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
}

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[MultiAccountExecutor] Kill switch OFF -- gak ngapa-ngapain.');
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

  for (const account of active) {
    await processAccount(account, sharedSniperOrders);
  }
  console.log('\n[MultiAccountExecutor] Selesai.');
}

module.exports = { main };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR multiAccountExecutor.js:', e.message); process.exit(1); });
}
