// emptyWalletWatchdog.js (28 Agu 2026, permintaan Olan: "yang aktifin auto trading tapi dompet
// kosong, kasih pesan japri. 3 hari beruntun gak diisi, matiin otomatis auto trading-nya, baik
// demo maupun real") -- dipanggil dari multiAccountExecutor.js pakai saldo yang UDAH DIAMBIL buat
// recordMemberStatus (gak fetch ulang Binance). Cek SEKALI PER HARI per (phone,mode) -- dedupe
// by tanggal WITA, biar gak ngirim WA berkali-kali tiap siklus 15 menit dalam hari yang sama.

const fs = require('fs');
const path = require('path');
const kaela = require('./kaelaProTraderClient');

const STATE_PATH = path.join(__dirname, 'multi-account-state', 'empty-wallet-tracking.json');
const EMPTY_THRESHOLD_USD = 1; // di bawah ini dianggap "gak ada isinya", bukan sekadar tipis
const SHUTOFF_AFTER_DAYS = 3;

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function witaDateKey(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// { phone, mode, name, balanceUsdt, balanceUsdc, sendWA } -- `sendWA` = fungsi notify AKUN ITU
// SENDIRI (buildSendWA dari multiAccountExecutor.js), biar pesan otomatis nyampe ke nomor yang
// bener + format konsisten sama notif lain (prefix [Kaela Access -- MODE], link jurnal, dst).
async function checkEmptyWallet({ phone, mode, name, balanceUsdt, balanceUsdc, sendWA }) {
  const key = `${String(phone).replace(/[^0-9]/g, '')}-${mode}`;
  const state = loadState();
  const today = witaDateKey();
  const entry = state[key] || { streak: 0, lastCheckedDate: null };

  const totalBalance = (balanceUsdt || 0) + (balanceUsdc || 0);
  const isEmpty = totalBalance < EMPTY_THRESHOLD_USD;

  if (entry.lastCheckedDate === today) return; // udah dicek hari ini, jangan dobel

  if (!isEmpty) {
    if (entry.streak > 0) delete state[key]; // reset diam-diam, gak perlu notif "udah aman" -- kabar baik gak perlu diributin
    saveState(state);
    return;
  }

  entry.streak += 1;
  entry.lastCheckedDate = today;

  if (entry.streak >= SHUTOFF_AFTER_DAYS) {
    await kaela.setTradingToggleForExecutor(phone, mode, false).catch((e) =>
      console.log(`[EmptyWalletWatchdog] Gagal matiin toggle ${mode} (${phone}):`, e.message));
    const msg = `🔌 Auto trading ${mode.toUpperCase()} kamu **DIMATIIN OTOMATIS** -- dompet kosong ${SHUTOFF_AFTER_DAYS} hari beruntun (saldo $${totalBalance.toFixed(2)}) tanpa diisi.\n\nGak masalah, tinggal isi saldo terus nyalain lagi sendiri kapan aja dari Setting.`;
    console.log(`[EmptyWalletWatchdog] ${name} (${phone}/${mode}) DIMATIIN -- kosong ${entry.streak} hari beruntun.`);
    await sendWA(msg);
    delete state[key]; // reset -- kalau nanti dinyalain lagi & kosong lagi, hitung ulang dari 0
  } else {
    const sisaHari = SHUTOFF_AFTER_DAYS - entry.streak;
    const msg = `⚠️ Dompet ${mode.toUpperCase()} kamu kosong (saldo $${totalBalance.toFixed(2)}) -- auto trading gak bisa jalan.\n\nIsi saldo dalam ${sisaHari} hari lagi, atau otomatis DIMATIIN biar gak nyampah siklus terus (hari ke-${entry.streak}/${SHUTOFF_AFTER_DAYS}).`;
    console.log(`[EmptyWalletWatchdog] ${name} (${phone}/${mode}) kosong hari ke-${entry.streak}/${SHUTOFF_AFTER_DAYS}.`);
    await sendWA(msg);
    state[key] = entry;
  }
  saveState(state);
}

module.exports = { checkEmptyWallet };
