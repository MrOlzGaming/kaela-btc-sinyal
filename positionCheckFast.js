// positionCheckFast.js -- versi RINGAN+CEPAT (5 menit) KHUSUS akun REAL Olan sendiri (Nyopet
// BTC+Emas), TERPISAH dari run-vultr-executor.sh (15 menit, nyakup SEMUA member+whale+econ+news).
// 13 Sep 2026, permintaan Olan ("tambah posisi reconciler buat jadi per 5 menit") -- biar deteksi
// posisi manual dia sendiri lebih cepat kekirim ke Wibowo Hedgefund, gak nunggu sampai 15 menit.
//
// ⚠️ SENGAJA REPLIKASI urutan+logic yang SAMA PERSIS kayak multiAccountExecutor.js buat akun
// Olan-real (BUKAN reconciler doang) -- kalau reconciler dijalanin SENDIRIAN tanpa Nyopet duluan,
// ada risiko NYATA: TP/SL bot yang kena PAS di antara 2 siklus 15-menit bisa KESALAH-ATRIBUSI jadi
// "MANUAL CLOSE" (reconciler gak akan tau `touchedSymbols` kalau Nyopet gak sempat jalan bareng di
// SIKLUS YANG SAMA) -- persis kelas bug pesan-salah-arah yang dibenerin hari ini juga. Fix:
// `nyopetTrader.main()` jalan DULU (isi touchedSymbols yang benar kalau ada TP/SL/sinyal bot),
// BARU reconciler -- URUTAN SAMA PERSIS kayak processAccount() di multiAccountExecutor.js.
//
// REUSE helper dari multiAccountExecutor.js (buildJournalHook/buildSendWA/buildModalOverride/
// safeKey/MASTER_NOMOR) -- BUKAN reimplementasi, biar gak ada 2 sumber logic yang bisa ketinggalan
// sinkron. require() AMAN (file itu punya `require.main===module` guard).
//
// ⛔ CUMA buat Olan real -- BUKAN pengganti run-vultr-executor.sh (member lain, whale, econ, news
// TETAP di siklus 15 menit yang lama, gak perlu secepat ini, hemat API call).
//
// State file (nyopet-journal, wibowo-reconciler-state) DIPAKAI BARENG sama run-vultr-executor.sh
// -- run-position-check-fast.sh (wrapper cron) WAJIB pakai flock lock SAMA (`/tmp/kaela-executor.lock`)
// biar 2 proses gak overlap nulis file yang sama.

const path = require('path');
const kaela = require('./kaelaProTraderClient');
const { createBinanceClient } = require('./binanceExecutor');
const { createMexcClient } = require('./mexcExecutor');
const { createRangerTrader } = require('./rangerAutoTrader');
const { reconcileWibowoPositions } = require('./positionReconciler');
const { buildJournalHook, buildSendWA, buildModalOverride, safeKey, MASTER_NOMOR, _mexcNotConfiguredStub } = require('./multiAccountExecutor');

const STATE_DIR = path.join(__dirname, 'multi-account-state');

async function main() {
  const [binanceAccounts, mexcAccounts, adminNotify, idrRate] = await Promise.all([
    kaela.getTradingAccounts('binance'),
    kaela.getTradingAccounts('mexc').catch(() => []),
    kaela.getAdminNotifySettings(),
    kaela.getUsdIdrRate().catch(() => null),
  ]);

  const account = binanceAccounts.find((a) => safeKey(a.phone) === MASTER_NOMOR && a.mode === 'real');
  if (!account) { console.log('[PositionCheckFast] Akun real Olan gak ketemu, skip siklus ini.'); return; }
  const mexcAccount = (mexcAccounts || []).find((a) => safeKey(a.phone) === MASTER_NOMOR && a.mode === 'real');

  const client = createBinanceClient({ apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false });
  const mexcClient = mexcAccount
    ? createMexcClient({ apiKey: mexcAccount.apiKey, apiSecret: mexcAccount.apiSecret })
    : _mexcNotConfiguredStub(account.name);
  const apiCreds = { apiKey: account.apiKey, apiSecret: account.apiSecret, testnet: false };
  const modalOverride = buildModalOverride(account, client);
  const touchedSymbols = new Set();
  const journalHook = buildJournalHook(account, touchedSymbols);
  const adminRelay = { masterNomor: MASTER_NOMOR, notifyReal: adminNotify.notifyReal, notifyDemo: adminNotify.notifyDemo };
  const sendWA = buildSendWA(account, adminRelay);
  const key = safeKey(account.phone) + '-' + account.mode;
  const reconcilerStatePath = path.join(STATE_DIR, 'wibowo-reconciler-state.json');

  const nyopetTrader = createRangerTrader({
    client, mexcClient, journalPath: path.join(STATE_DIR, `${key}-nyopet.json`),
    sendWA, getModalBase: modalOverride, apiCreds, onEvent: journalHook, idrRate, phone: account.phone,
    reconcilerStatePath,
  });

  try {
    await nyopetTrader.main();
  } catch (e) {
    console.log('[PositionCheckFast] Nyopet ERROR:', e.message);
  }

  try {
    await reconcileWibowoPositions({
      phone: account.phone, client, mexcClient, touchedSymbols,
      statePath: reconcilerStatePath, idrRate,
    });
  } catch (e) {
    console.log('[PositionCheckFast] PositionReconciler ERROR:', e.message);
  }

  console.log('[PositionCheckFast] Selesai.');
}

module.exports = { main };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR positionCheckFast.js:', e.message); process.exit(1); });
}
