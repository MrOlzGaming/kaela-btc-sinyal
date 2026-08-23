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

async function notifyMember(phone, message) {
  try {
    return await callGas('notifyMember', { phone, message });
  } catch (e) {
    console.log('[KaelaProTraderClient] notifyMember gagal (dilewatin, gak fatal):', e.message);
    return { ok: false };
  }
}

module.exports = { getTradingAccounts, recordJournalEntry, updateJournalEntry, notifyMember };
