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

async function notifyMember(phone, message) {
  try {
    return await callGas('notifyMember', { phone, message });
  } catch (e) {
    console.log('[KaelaProTraderClient] notifyMember gagal (dilewatin, gak fatal):', e.message);
    return { ok: false };
  }
}

// Heartbeat multi-mesin (25 Agu 2026) -- lihat heartbeatCoordinator.js buat logika leader/standby.
async function reportHeartbeat(machineId) {
  return callGas('reportHeartbeat', { machineId });
}

async function getHeartbeats() {
  const data = await callGas('getHeartbeats');
  return data.heartbeats; // [{ machineId, lastSeenAt }]
}

module.exports = { getTradingAccounts, recordJournalEntry, updateJournalEntry, notifyMember, getAllAccountsWithKeys, recordBalanceReport, reportHeartbeat, getHeartbeats };
