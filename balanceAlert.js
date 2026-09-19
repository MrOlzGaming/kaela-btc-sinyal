// balanceAlert.js (24 Agu 2026) -- notif otomatis ke member REAL kalau sinyal (Sniper/Nyopet) gagal
// dieksekusi karena saldo real gak cukup. Sebelum ini, kegagalan macam ini cuma nyampah di log lokal
// (`Quantity kehitung 0...`/`Cross balance insufficient`) -- member REAL gak pernah tau sinyal
// kelewat, jadi keputusan Olan: kirim notif otomatis (BUKAN manual chat) tiap kejadian ini, pola SAMA
// kayak notif buka/tutup posisi yang udah otomatis dari dulu -- gak perlu approval manual tiap kali
// (beda dari SOP kirim WA manual lewat Claude, ini murni notifikasi sistem).
//
// KHUSUS mode REAL -- Demo gak dapet notif ini (beda solusi: Demo tinggal reset saldo Testnet,
// Real harus beneran isi dana, jadi pesannya beda konteks & gak worth di-otomasi buat Demo).

const fs = require('fs');
const path = require('path');

const KALKULATOR_URL = 'https://kaela-btc-sinyal.netlify.app/kalkulator.html';

// Cegah SPAM (29 Agu 2026, dilaporin Olan: "sinyal xau real spam.. dompetku memang nol.. tapi dia
// whatsap terus") -- sebelum ini, tiap sinyal gagal kirim alert TANPA cooldown sama sekali (BTC+XAU
// beda cadence zona, bisa berkali-kali sehari -- makin sering sejak eksekutor jalan di 2 mesin
// bareng, Vultr+rumah). Sekarang: max 1x per (akun, mode, strategi, aset) per HARI (WITA), pola
// dedupe SAMA kayak emptyWalletWatchdog.js.
const ALERT_STATE_PATH = path.join(__dirname, 'multi-account-state', 'insufficient-balance-alert-tracking.json');

function witaDateKey(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function loadAlertState() {
  if (!fs.existsSync(ALERT_STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf8')); } catch { return {}; }
}

function saveAlertState(s) {
  fs.mkdirSync(path.dirname(ALERT_STATE_PATH), { recursive: true });
  fs.writeFileSync(ALERT_STATE_PATH, JSON.stringify(s, null, 2));
}

// true = boleh kirim (belum pernah/beda hari) -- otomatis nyatet begitu diizinin, panggil PERSIS
// SEKALI per kandidat kirim (jangan dipanggil buat cek doang).
function shouldAlertInsufficientBalance(key) {
  const state = loadAlertState();
  const today = witaDateKey();
  if (state[key] === today) return false;
  state[key] = today;
  saveAlertState(state);
  return true;
}

// Cocokin pola error saldo-kurang yang UDAH KETEMU nyata di log (24 Agu 2026) -- kalau nemu pola
// baru di masa depan, tambahin di sini, JANGAN taro string baru di tempat lain.
//
// ⚠️ GAP ditemuin+difix 20 Sep 2026 (audit minimum funding buat kebijakan setoran bulanan) -- 2 hal:
// (1) `/kekecilan buat stepSize/i` cuma cocok pre-check LOKAL Binance (binanceExecutor.js) --
//     pre-check LOKAL MEXC (mexcExecutor.js) mesennya "kekecilan buat contractSize" (kata beda),
//     GAK PERNAH match sama sekali sebelum fix ini -- sinyal Emas yang kena modal-super-kecil
//     bisa HILANG SENYAP, bukan jatuh ke info-fallback kayak seharusnya.
// (2) Order yang LOLOS pre-check lokal (qty>0) tapi TETAP di bawah minimum EXCHANGE (LOT_SIZE/
//     MIN_NOTIONAL Binance) ditolak SAAT DIKIRIM ke API asli, kode BEDA TOTAL dari margin-
//     insufficient (-1013/-4164, bukan -4050/-2019) -- SEBELUM fix ini juga gak pernah match.
//     Ini kelas kegagalan NYATA yang bisa kejadian (lihat memori project-kaela-monthly-funding.md
//     -- Nyopet BTC modal kecil ketemu "zona bahaya" tepat di batas bracket exposure, nilai
//     posisi bisa dip di bawah minimum walau qty lolos hitung >0 lokal).
const INSUFFICIENT_BALANCE_PATTERNS = [
  /kekecilan buat (stepSize|contractSize)/i,
  /insufficient/i,
  /-4050/,
  /-2019/,
  /margin is insufficient/i,
  /-1013/, // Binance: "Filter failure: LOT_SIZE"
  /-4164/, // Binance: "Order's notional must be no smaller than X"
  /notional must be no smaller/i,
  /filter failure/i,
];

function isInsufficientBalanceError(message) {
  const m = String(message || '');
  return INSUFFICIENT_BALANCE_PATTERNS.some((re) => re.test(m));
}

// { strategy: 'Sniper'|'Nyopet', assetLabel, direction: 'buy'|'sell', entry, tp, sl }
function formatInsufficientBalanceAlert({ strategy, assetLabel, direction, entry, tp, sl }) {
  const dirLabel = direction === 'buy' ? 'LONG' : 'SHORT';
  const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const levels = [`Arah: *${dirLabel}*`, `Entry sekitar: *$${fmt(entry)}*`];
  if (tp != null) levels.push(`TP: *$${fmt(tp)}*`);
  if (sl != null) levels.push(`SL/Liq: *$${fmt(sl)}*`);

  return `🔔 *Sinyal ${strategy} ${assetLabel} kelewat -- saldo Real kurang*\n\n`
    + `Sinyal *${dirLabel}* baru muncul, tapi Kaela *gak bisa buka otomatis* di akun Real kamu -- saldo kurang buat nutup margin minimum.\n\n`
    + `💡 Kalau masih mau ikut sinyal ini: isi saldo dulu ke Binance, terus buka manual sendiri (selama harga belum geser jauh):\n`
    + levels.map((l) => `- ${l}`).join('\n') + '\n\n'
    + `🧮 Hitung volume/margin sendiri: ${KALKULATOR_URL}\n\n`
    + `Kalau gak sempat, gapapa -- sinyal berikutnya otomatis jalan begitu saldo cukup 🙏`;
}

// Cocokin error "MEXC belum disetup buat member X" (_mexcNotConfiguredStub, multiAccountExecutor.js)
// -- ini KONDISI NORMAL (member emang belum pasang API MEXC-nya sendiri), BUKAN bug yang perlu
// diperbaiki di kode. Dipakai di catch-site generik biar log-nya GAK kepake kata "error"/"gagal"
// (kalau kepake, ke-grep reportCycleErrors.js/Watchdog.gs jadi "temuan" tiap siklus 15 menit
// SELAMANYA sampai member itu setup MEXC -- Olan komplain 4 Sep 2026: "yang memang ga error jgn
// di report terus").
function isMexcNotConfiguredError(message) {
  return /MEXC belum disetup buat member/i.test(String(message || ''));
}

module.exports = { isInsufficientBalanceError, formatInsufficientBalanceAlert, shouldAlertInsufficientBalance, isMexcNotConfiguredError };
