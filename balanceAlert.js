// balanceAlert.js (24 Agu 2026) -- notif otomatis ke member REAL kalau sinyal (Sniper/Nyopet) gagal
// dieksekusi karena saldo real gak cukup. Sebelum ini, kegagalan macam ini cuma nyampah di log lokal
// (`Quantity kehitung 0...`/`Cross balance insufficient`) -- member REAL gak pernah tau sinyal
// kelewat, jadi keputusan Olan: kirim notif otomatis (BUKAN manual chat) tiap kejadian ini, pola SAMA
// kayak notif buka/tutup posisi yang udah otomatis dari dulu -- gak perlu approval manual tiap kali
// (beda dari SOP kirim WA manual lewat Claude, ini murni notifikasi sistem).
//
// KHUSUS mode REAL -- Demo gak dapet notif ini (beda solusi: Demo tinggal reset saldo Testnet,
// Real harus beneran isi dana, jadi pesannya beda konteks & gak worth di-otomasi buat Demo).

const KALKULATOR_URL = 'https://kaela-btc-sinyal.netlify.app/kalkulator.html';

// Cocokin pola error saldo-kurang yang UDAH KETEMU nyata di log (24 Agu 2026) -- kalau nemu pola
// baru di masa depan, tambahin di sini, JANGAN taro string baru di tempat lain.
const INSUFFICIENT_BALANCE_PATTERNS = [
  /kekecilan buat stepSize/i,
  /insufficient/i,
  /-4050/,
  /-2019/,
  /margin is insufficient/i,
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

module.exports = { isInsufficientBalanceError, formatInsufficientBalanceAlert };
