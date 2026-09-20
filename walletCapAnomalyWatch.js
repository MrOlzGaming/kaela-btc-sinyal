// walletCapAnomalyWatch.js (21 Sep 2026, permintaan Olan) -- tripwire keamanan: kalau TOTAL Modal
// Futures Pool (4 dompet gabungan) turun DRASTIS dalam 1 hari, WA darurat ke Olan PRIBADI. Baca
// histori web/wallet-cap-progress-history.json (ditulis walletCapProgress.js, 1 titik/hari WITA).
//
// KENAPA threshold doang, BUKAN cross-check ke journal trading (sniper-orders.json dkk) -- Olan
// nanya "kalo turun karena trading?": ambangnya (50% + minimal $50 absolut) disetel JAUH di atas
// kerugian trading NORMAL yang mungkin kejadian (tiap posisi Kaela dibatasin SL/margin risk, lihat
// calculator.js assessMarginRisk yang udah warning di atas 20% margin/modal per trade) -- yakin gak
// numbuk false-alarm dari hari trading sial biasa TANPA perlu data journal tambahan. Sengaja BUKAN
// gantung ke journal juga karena journal PERNAH kebukti punya bug sync (pnlCrossCheckMonitor.js,
// insiden 13 Sep: "sistem bilang PnL beda dari Binance") -- kalau tripwire KEAMANAN ini ikut gantung
// ke data yang sama, bug yang SAMA bisa bikin alert PENTING ini ikut bungkam diam-diam. Prinsip:
// mending sesekali WA gak perlu drpd sekali aja kelewat insiden beneran (Mandorin Semua Otomatisasi).
//
// Dedup: SEKALI per hari (WITA) -- kalau kondisi anomali masih sama besok (belum ditangani Olan),
// gak spam ulang tiap ~15 menit siklus VPS.

const fs = require('fs');
const path = require('path');
const { loadHistory } = require('./walletCapHistory');
const { sendWhatsApp } = require('./fonnte');
const { MASTER_NOMOR } = require('./multiAccountExecutor');
const { roleOpener } = require('./teamRoles');

const STATE_PATH = path.join(__dirname, 'wallet-cap-anomaly-state.json');
const PCT_DROP_THRESHOLD = 0.5; // turun >=50% dalam 1 hari -- jauh di atas kerugian trading wajar
const MIN_ABS_DROP_USD = 50; // floor absolut -- biar gak numbuk noise pas total masih kecil (awal siklus, puluhan dolar)

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastAlertedDate: null };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { lastAlertedDate: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

// Pure function biar gampang ditest -- null kalau gak ada anomali, objek detail kalau ada.
// Bandingin titik TERAKHIR vs SEBELUMNYA doang (day-over-day) -- histori 1 titik/hari, jadi ini
// otomatis "kemarin vs hari ini".
function detectAnomaly(history) {
  if (!history || history.length < 2) return null;
  const today = history[history.length - 1];
  const yesterday = history[history.length - 2];
  const drop = yesterday.totalBalance - today.totalBalance;
  if (drop <= 0) return null; // naik/diam, bukan drop -- gak relevan buat tripwire ini
  const dropPct = yesterday.totalBalance > 0 ? drop / yesterday.totalBalance : 0;
  if (dropPct < PCT_DROP_THRESHOLD || drop < MIN_ABS_DROP_USD) return null;
  return { date: today.date, yesterday: yesterday.totalBalance, today: today.totalBalance, drop, dropPct };
}

function formatAlert(a) {
  const pct = (a.dropPct * 100).toFixed(1);
  return [
    roleOpener('REED', 'ada penurunan drastis di Modal Futures Pool'),
    '',
    `Total 4 dompet trading (Sniper+Nyopet, gabungan) turun dari $${a.yesterday.toFixed(2)} ke $${a.today.toFixed(2)} -- turun $${a.drop.toFixed(2)} (${pct}%) dalam 1 hari terakhir.`,
    '',
    'Ini JAUH di atas kerugian trading normal (tiap posisi Kaela dibatasin SL/margin risk) -- worth dicek LANGSUNG ke akun Binance/MEXC: API key bocor? Ada penarikan yang bukan kamu? Atau insiden lain?',
    '',
    '⚠️ Ini cuma tripwire angka, BUKAN kepastian ada yang salah -- tapi selisih sebesar ini gak wajar dari trading biasa, cek dulu manual sebelum diabaikan.',
    '',
    '— Kaela',
  ].join('\n');
}

async function main() {
  const anomaly = detectAnomaly(loadHistory());
  if (!anomaly) return;

  const state = loadState();
  if (state.lastAlertedDate === anomaly.date) return; // udah dikirim hari ini, jangan dobel

  const msg = formatAlert(anomaly);
  console.log('[WalletCapAnomalyWatch]', msg);
  // DM Olan PRIBADI (BUKAN grup Wibowo Hedgefund) -- ini dugaan insiden keamanan, bukan info
  // trading rutin, pola SAMA kayak pnlCrossCheckMonitor.js.
  const sendResult = await sendWhatsApp(msg, MASTER_NOMOR);
  if (sendResult && sendResult.ok === false) {
    console.log('[WalletCapAnomalyWatch] Kirim WA GAGAL -- state belum ditandai, dicoba lagi siklus berikutnya.');
    return;
  }
  saveState({ lastAlertedDate: anomaly.date });
}

module.exports = { main, detectAnomaly, PCT_DROP_THRESHOLD, MIN_ABS_DROP_USD };
if (require.main === module) { main().catch((e) => console.log('[WalletCapAnomalyWatch] ERROR:', e.message)); }
