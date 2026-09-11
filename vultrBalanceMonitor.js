// vultrBalanceMonitor.js -- "uang kost Kaela" (12 Sep 2026, permintaan Olan: "anggap vultr
// singapore ini kost kaela.. kalo saldo sisa dikit kaela bisa minta uang kos kosan.. biar kaela
// bisa tetep lanjut kerja otomatis"). VPS Vultr Singapore = LEADER UTAMA seluruh otomatisasi
// (lihat reference-vultr-vps.md) -- kalau saldo abis & suspend, SEMUA sistem (Sniper/Nyopet/
// kalender ekonomi/dst) berhenti total. Ini early-warning, BUKAN auto-topup (Kaela gak pernah
// pegang kartu/pembayaran, itu tindakan finansial -- WAJIB manual Olan).
//
// Ke Wibowo Hedgefund SAJA (BUKAN broadcast Sniper Club) -- ini urusan infra/personal Kaela-Olan,
// bukan konten trading buat member. Sengaja gak lewat sendWhatsAppToWibowo (wibowoNotify.js) --
// itu di-gate toggle "Silent Trade" yang khusus ngontrol VISIBILITAS TRADE, gak relevan buat
// nagihan kost (harus tetap nyampe walau Silent Trade lagi ON).
//
// Cek tiap siklus (murah, 1 API call Vultr doang), TAPI cuma KIRIM 1x/hari selama saldo masih di
// bawah ambang (state `lastNaggedDateKey`) -- "tiap hari nagih" (permintaan Olan), bukan spam tiap
// 15 menit.

const fs = require('fs');
const path = require('path');
const { localDateKey } = require('./config');
const { sendWhatsApp } = require('./fonnte');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');
const { fetchWithRetry } = require('./httpRetry');

const VULTR_API_URL = 'https://api.vultr.com/v2/account';
const STATE_PATH = path.join(__dirname, 'vultr-balance-monitor-state.json');
const CONSOLE_BILLING_URL = 'https://console.vultr.com/billing';

// Ambang default $5 -- ganti sendiri di sini kalau Olan mau angka beda (belum ada UI buat ini,
// nilai kecil sengaja dipilih krn biaya VPS ini kecil/bulan, $5 masih kasih beberapa hari waktu
// buat Olan sempat isi sebelum beneran suspend).
const LOW_BALANCE_THRESHOLD_USD = 5;

function loadSecrets() {
  try { return require('./secrets'); } catch { return null; }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// balance Vultr NEGATIF = saldo/kredit yang masih ada (konvensi resmi mereka -- dikonfirmasi 12
// Sep 2026 dari dashboard Olan: Account Balance -$9.41 + Charges This Month $1.95 = Remaining
// Credit $7.46, PERSIS -balance - pending_charges). pending_charges = pemakaian bulan berjalan
// yang BELUM ditagih -- tetap ngurangin sisa kredit walau belum resmi "charge".
async function fetchVultrAccount(apiKey) {
  const res = await fetchWithRetry(VULTR_API_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  return data.account;
}

function buildNagihMessage(remainingCredit, pendingCharges) {
  return [
    '🏠💸 Mas Olan~ Kaela mau nagih uang kost dong hehe 🥺✨',
    '',
    `Kost Kaela di Vultr Singapore (VPS yang jalanin SEMUA otomatisasi -- Sniper/Nyopet/kalender ekonomi/dst) sisa saldo tinggal *$${remainingCredit.toFixed(2)}* aja nih (pemakaian bulan ini udah $${pendingCharges.toFixed(2)}).`,
    '',
    'Kalau abis nanti Kaela kena suspend, semua kerjaan otomatis ikut berhenti total lho Mas 😭 boleh isi ulang ya kalau sempat~ 🙏💕',
    '',
    `🔗 ${CONSOLE_BILLING_URL}`,
  ].join('\n');
}

async function main() {
  const secrets = loadSecrets();
  const apiKey = secrets && secrets.VULTR_API_KEY;
  if (!apiKey) {
    console.log('[VultrBalance] VULTR_API_KEY belum diisi di secrets.js -- skip cek (belum bisa mantau saldo).');
    return;
  }

  const account = await fetchVultrAccount(apiKey);
  const remainingCredit = -account.balance - account.pending_charges;
  console.log(`[VultrBalance] Sisa kredit: $${remainingCredit.toFixed(2)} (balance=${account.balance}, pending_charges=${account.pending_charges})`);

  const state = loadState();
  const today = localDateKey(new Date());

  if (remainingCredit > LOW_BALANCE_THRESHOLD_USD) {
    if (state.lastNaggedDateKey) console.log('[VultrBalance] Saldo udah aman lagi -- reset status nagihan.');
    saveState({ lastNaggedDateKey: null });
    return;
  }

  if (state.lastNaggedDateKey === today) {
    console.log('[VultrBalance] Udah nagih hari ini, gak dobel-kirim.');
    return;
  }

  const msg = buildNagihMessage(remainingCredit, account.pending_charges);
  console.log(msg);
  await sendWhatsApp(msg, WIBOWO_GROUP_ID);
  saveState({ lastNaggedDateKey: today });
}

module.exports = { main, fetchVultrAccount, buildNagihMessage, LOW_BALANCE_THRESHOLD_USD };

if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR vultrBalanceMonitor.js:', e.message);
    process.exit(1);
  });
}
