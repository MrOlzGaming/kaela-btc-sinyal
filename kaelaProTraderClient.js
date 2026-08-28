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
// dititip tiap siklus 15 menit, GAS gak bisa manggil Binance langsung (lihat catatan geo-block).
// `positions` array biasa, di-JSON.stringify di sini (GAS Main.gs yang parse balik).
async function recordMemberStatus(phone, mode, balanceUsdt, balanceUsdc, positions) {
  return callGas('recordMemberStatus', { phone, mode, balanceUsdt, balanceUsdc, positions: JSON.stringify(positions || []) });
}

module.exports = { getTradingAccounts, recordJournalEntry, updateJournalEntry, notifyMember, getAllAccountsWithKeys, recordBalanceReport, claimLeadership, recordMemberStatus, getAdminNotifySettings };
