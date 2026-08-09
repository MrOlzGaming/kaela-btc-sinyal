// Kirim pesan ke grup WA "BTC Sniper Club" lewat Fonnte.
// Searah total: Kaela cuma KIRIM ke 1 Group ID spesifik, gak pernah baca command atau balas DM.
// Tanpa secrets.js (belum di-setup di mesin ini), fungsi ini otomatis no-op -- aman buat dev/testing lokal.

const { fetchRetryNetworkErrorOnly } = require('./httpRetry');

const FONNTE_URL = 'https://api.fonnte.com/send';

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    // fallback buat GitHub Actions -- secrets.js ditulis ulang tiap run dari GitHub Secrets,
    // tapi jaga-jaga kalau suatu saat langsung dari env var (CI lain / testing manual)
    if (process.env.FONNTE_TOKEN) {
      return { FONNTE_TOKEN: process.env.FONNTE_TOKEN, FONNTE_GROUP_ID: process.env.FONNTE_GROUP_ID };
    }
    return null;
  }
}

async function sendWhatsApp(message, target) {
  const secrets = loadSecrets();
  if (!secrets || !secrets.FONNTE_TOKEN) {
    console.log('[Fonnte] secrets.js belum ada / FONNTE_TOKEN kosong -- skip kirim WA (tetap jalan, cuma console+arsip).');
    return { skipped: true };
  }

  const body = new URLSearchParams({
    target: target || secrets.FONNTE_GROUP_ID,
    message,
  });

  // Gagal kirim WA gak boleh gugurin seluruh run (arsip web tetap harus jalan) -- retry dulu,
  // kalau tetap gagal, cukup dicatat, jangan throw ke pemanggil. PAKAI fetchRetryNetworkErrorOnly
  // (BUKAN fetchWithRetry biasa) -- kirim WA itu TIDAK IDEMPOTEN, retry pas server sempat merespon
  // (walau error) bisa bikin Fonnte kirim pesan yang SAMA 2-3x ke grup (bug nyata, ketauan 9 Agu 2026:
  // whale alert sama persis -- tx id, jam, jumlah BTC sama -- kekirim berulang).
  try {
    const res = await fetchRetryNetworkErrorOnly(FONNTE_URL, {
      method: 'POST',
      headers: { Authorization: secrets.FONNTE_TOKEN },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (data.status === false) {
      console.error('[Fonnte] Fonnte nolak pesan:', JSON.stringify(data));
      return { ok: false, data };
    }
    console.log('[Fonnte] Terkirim ke grup WA.');
    return { ok: true, data };
  } catch (e) {
    console.error('[Fonnte] Gagal kirim WA setelah retry:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendWhatsApp };
