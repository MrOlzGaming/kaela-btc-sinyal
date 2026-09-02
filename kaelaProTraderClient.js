// Klien HTTP ke backend GAS "Kaela Pro Trader" (APPS/kaela-multi-akun/) -- dipakai
// multiAccountExecutor.js buat: (1) tarik daftar akun aktif+API key terenkripsi (gerbang
// SERVICE_KEY), (2) tulis jurnal personal per member, (3) kirim notif WA ke member sendiri.
// Panggilan TANPA param `callback` -- Main.gs (_jsonp) balikin JSON polos kalau gitu, gak perlu
// parsing JSONP dari sisi Node.

function loadConfig() {
  const secrets = require('./secrets');
  const url = secrets.KAELA_MULTI_AKUN_URL || process.env.KAELA_MULTI_AKUN_URL;
  const serviceKey = secrets.KAELA_MULTI_AKUN_SERVICE_KEY || process.env.KAELA_MULTI_AKUN_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error('KAELA_MULTI_AKUN_URL/KAELA_MULTI_AKUN_SERVICE_KEY belum diisi di secrets.js (harus SAMA PERSIS sama Script Property SERVICE_KEY di GAS).');
  }
  return { url, serviceKey };
}

async function callGas(aksi, params = {}) {
  const { url, serviceKey } = loadConfig();
  const qs = new URLSearchParams({ aksi, serviceKey, ...params }).toString();
  const res = await fetch(`${url}?${qs}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`GAS ${aksi} gagal: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function getTradingAccounts(exchange = 'binance') {
  const data = await callGas('getTradingAccounts', { exchange });
  return data.accounts; // [{ phone, name, mode, apiKey, apiSecret, balanceMode, externalUsdt, externalUsdc }]
}

async function recordJournalEntry(phone, mode, entry) {
  return callGas('recordJournalEntry', { phone, mode, entry: JSON.stringify(entry) });
}

async function updateJournalEntry(entryId, patch) {
  return callGas('updateJournalEntry', { entryId, patch: JSON.stringify(patch) });
}

// Laporan saldo admin (23-24 Agu 2026) -- GAS gak bisa manggil Binance langsung (diblokir server
// Google, lihat catatan BinanceAdmin.gs) -- komputer Olan yang ambil datanya, GAS tinggal simpen.
async function getAllAccountsWithKeys() {
  const data = await callGas('getAllAccountsWithKeys');
  return data.accounts; // [{ phone, name, apiKey, apiSecret }]
}

async function recordBalanceReport(phone, name, report) {
  return callGas('recordBalanceReport', { phone, name, report: JSON.stringify(report) });
}

// 28 Agu 2026 -- toggle notif master admin ("info trading real/demo ke Olan"). Fail-safe: kalau
// GAS error/belum ke-deploy, anggap dua2nya OFF (jangan spam Olan kalau settingnya gak kebaca).
async function getAdminNotifySettings() {
  try {
    const data = await callGas('getAdminNotifySettingsForExecutor');
    return data.settings;
  } catch (e) {
    console.log('[KaelaProTraderClient] getAdminNotifySettings gagal (dianggap OFF):', e.message);
    return { notifyReal: false, notifyDemo: false };
  }
}

// 28 Agu 2026 -- antrian tutup posisi manual (member sendiri ATAU owner bantu member lain, lihat
// Sheet.gs requestClosePosition). Fail-safe: kalau gagal, anggap KOSONG (bukan fatal, coba lagi
// siklus berikutnya -- permintaan gak ilang krn GAS baru NGOSONGIN abis berhasil dibaca).
async function getPendingCloseRequests() {
  try {
    const data = await callGas('getPendingCloseRequests');
    return data.requests || [];
  } catch (e) {
    console.log('[KaelaProTraderClient] getPendingCloseRequests gagal (dilewatin):', e.message);
    return [];
  }
}

async function notifyMember(phone, message) {
  try {
    return await callGas('notifyMember', { phone, message });
  } catch (e) {
    console.log('[KaelaProTraderClient] notifyMember gagal (dilewatin, gak fatal):', e.message);
    return { ok: false };
  }
}

// Heartbeat multi-mesin (25 Agu 2026, HARDENED -- lihat catatan panjang di claimLeadership()
// Sheet.gs) -- 1 panggilan ATOMIK (LockService di sisi GAS), gantiin pola lama reportHeartbeat+
// getHeartbeats terpisah yang punya celah race condition teoretis kalau 2 mesin manggil hampir
// bersamaan PERSIS. reportHeartbeat/getHeartbeats TETAP ada (dipakai claimLeadership secara
// internal di GAS), tapi Node TIDAK PERNAH manggil dua itu lagi buat nentuin leader -- SELALU
// claimLeadership.
async function claimLeadership(machineId) {
  const data = await callGas('claimLeadership', { machineId });
  return { isLeader: data.isLeader, leaderId: data.leaderId, myId: data.myId };
}

// Status member (25 Agu 2026, "mau lihat saldo sendiri + posisi kebuka langsung di web") --
// dititip tiap siklus 15 menit, GAS gak bisa manggil Binance/MEXC langsung (lihat catatan geo-block).
// `positions` array biasa, di-JSON.stringify di sini (GAS Main.gs yang parse balik).
// `mexcBalanceUsdt`/`mexcBalanceUsdc` (30 Agu 2026, migrasi Emas -- lihat memori
// project-kaela-multi-exchange, "4 dompet independen": Sniper Emas=USDT, Nyopet Emas=USDC) --
// OPSIONAL, default 0 (dipetakan otomatis di GAS kalau gak dikirim), buat member yang belum
// pasang API MEXC.
async function recordMemberStatus(phone, mode, balanceUsdt, balanceUsdc, positions, mexcBalanceUsdt, mexcBalanceUsdc) {
  return callGas('recordMemberStatus', { phone, mode, balanceUsdt, balanceUsdc, positions: JSON.stringify(positions || []), mexcBalanceUsdt: mexcBalanceUsdt || 0, mexcBalanceUsdc: mexcBalanceUsdc || 0 });
}

// 28 Agu 2026 -- matiin toggle trading member SECARA OTOMATIS (dompet kosong 3 hari beruntun,
// lihat emptyWalletWatchdog.js). BUKAN dipanggil dari aksi member sendiri.
async function setTradingToggleForExecutor(phone, mode, enabled) {
  return callGas('setTradingToggleForExecutor', { phone, mode, enabled: enabled ? 'true' : 'false' });
}

// 31 Agu 2026, one-off buat akun Olan sendiri: "semuanya on.. spot sniper nyopet demo" -- nyalain
// Demo+Real+CompoundAlt+Musiman sekaligus (Sheet.gs setAllTogglesForExecutor).
async function setAllTogglesForExecutor(phone) {
  return callGas('setAllTogglesForExecutor', { phone });
}

// 30 Agu 2026 -- "japri aku kalo ada error diam-diam, biar bisa segera diperbaiki" (Olan, abis
// insiden lock Vultr macet 14 jam). Dipanggil run-local-executor.ps1/run-vultr-executor.sh di
// UJUNG tiap siklus, kirim baris2 log yang match ERROR/GAGAL cycle INI SAJA -- dedup+cooldown per
// baris ada di sisi GAS (Watchdog.gs reportCycleErrors), biar error yang sama gak nge-spam WA
// tiap 15 menit selama belum kefix. Fail-safe DI SINI JUGA (bukan cuma caller) -- reporting error
// gagal BUKAN alasan buat gagalin cycle utama.
async function reportCycleErrors(machineId, errorsText) {
  try {
    return await callGas('reportCycleErrors', { machineId, errors: errorsText });
  } catch (e) {
    console.log('[KaelaProTraderClient] reportCycleErrors gagal (dilewatin, gak fatal):', e.message);
    return { ok: false };
  }
}

// 31 Agu 2026 -- "Minta Sinkron Sekarang" (tombol Developer Kaela Access). Dicek checkForceSyncRequest.js
// tiap ~1 menit (jadwal khusus, lihat Pool.gs buat penjelasan lengkap kenapa gak bisa instan).
async function checkAndClearForceSyncRequest() {
  return callGas('checkAndClearForceSyncRequest', {});
}

// 2-3 Sep 2026 -- dipakai positionReconciler.js buat nampilin PnL manual Olan sekalian dalam Rp
// (permintaan Olan: "pnl yang betul dalam dolar dan dalam kurung rupiah"). Fail-safe: gagal ambil
// kurs -> null (caller fallback USD doang), JANGAN gagalin laporan cuma gara-gara kurs gak kebaca.
async function getUsdIdrRate() {
  try {
    const data = await callGas('getUsdIdrRate', {});
    return data.rate || null;
  } catch (e) {
    console.log('[KaelaProTraderClient] getUsdIdrRate gagal (fallback USD doang):', e.message);
    return null;
  }
}

// 3 Sep 2026 -- buka posisi manual Nyopet dari web (Jurnal Saya). Fail-safe: gagal ambil daftar
// -> array kosong (coba lagi siklus berikutnya), BUKAN fatal (sama pola getPendingCloseRequests).
async function getPendingManualOpenRequests() {
  try {
    const data = await callGas('getPendingManualOpenRequests');
    return data.requests || [];
  } catch (e) {
    console.log('[KaelaProTraderClient] getPendingManualOpenRequests gagal (dilewatin):', e.message);
    return [];
  }
}
async function resolveManualOpenRequest(requestId, status, resultMessage) {
  return callGas('resolveManualOpenRequest', { requestId, status, resultMessage: resultMessage || '' });
}

module.exports = { getTradingAccounts, recordJournalEntry, updateJournalEntry, notifyMember, getAllAccountsWithKeys, recordBalanceReport, claimLeadership, recordMemberStatus, getAdminNotifySettings, getPendingCloseRequests, setTradingToggleForExecutor, setAllTogglesForExecutor, reportCycleErrors, checkAndClearForceSyncRequest, getUsdIdrRate, getPendingManualOpenRequests, resolveManualOpenRequest };
