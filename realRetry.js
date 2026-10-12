// realRetry.js (12 Okt 2026) -- aturan COBA ULANG buka leg REAL yang gagal karena saldo kurang. Olan:
//   "di hari yang sama ketika posisi gagal buka boleh terus retry (pas ada notif aku sempet isi saldo dulu), ketika 2x24 jam gak bisa
//    buka terus, sistem boleh berhenti mencoba (mungkin belum ada duit). Notif hari ke-1 1x, hari ke-2 1x, sisanya silent.
//    Info ke grup Hedgefund (japri malah gak kebaca)."
// Dipakai Sniper BTC / Ranger BTC (Binance) & Ranger Rotasi (Bybit). Retry cuma selama leg DEMO sinyal itu masih kebuka & harga
// belum lari jauh ke arah untung (maks maxFavorR x jarak SL dari entry demo) -- biar real gak masuk telat di harga jelek.
const DAY = 864e5;
const WINDOW_MS = 2 * DAY;

function startRetry(now = Date.now()) { return { since: now, alerted: [1], tries: 1, lastTry: now }; } // gagal pertama = notif hari-1 udah dikirim

// { expired } | { day: 1|2, alert: bool }
function retryStep(rr, now = Date.now()) {
  if (!rr || rr.expired) return { expired: true };
  const age = now - rr.since;
  if (age >= WINDOW_MS) { rr.expired = true; return { expired: true }; }
  const day = age < DAY ? 1 : 2;
  const alerted = rr.alerted || (rr.alerted = []);
  const alert = !alerted.includes(day);
  if (alert) alerted.push(day);
  rr.tries = (rr.tries || 0) + 1; rr.lastTry = now;
  return { day, alert };
}

// harga masih layak buat masuk real? (belum kena SL, belum lari > maxFavorR x risiko ke arah untung)
function priceStillValid({ direction, entry, sl, live, maxFavorR = 0.5 }) {
  if (!(live > 0) || !(entry > 0) || !(sl > 0)) return false;
  const risk = Math.abs(entry - sl);
  if (direction === 'buy') return live > sl && live <= entry + risk * maxFavorR;
  return live < sl && live >= entry - risk * maxFavorR;
}

const fmtWita = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' WITA';
// baris tambahan buat pesan notif
function retryNote(rr, day) {
  const until = rr.since + WINDOW_MS;
  return day === 1
    ? `🔁 Kaela coba buka ulang tiap siklus sampai ${fmtWita(until)} -- isi saldo sebelum itu, posisi Real langsung nyusul (selama harga masih layak).`
    : `🔁 Hari ke-2 (terakhir): masih dicoba sampai ${fmtWita(until)}. Lewat itu Kaela berhenti nyoba sinyal ini (mungkin belum ada dana) -- gak ada notif lagi.`;
}

module.exports = { startRetry, retryStep, priceStillValid, retryNote, WINDOW_MS };
