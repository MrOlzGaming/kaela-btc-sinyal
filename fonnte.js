// Kirim pesan ke grup WA "BTC Sniper Club" lewat Fonnte.
// Searah total: Kaela cuma KIRIM ke 1 Group ID spesifik, gak pernah baca command atau balas DM.
// Tanpa secrets.js (belum di-setup di mesin ini), fungsi ini otomatis no-op -- aman buat dev/testing lokal.

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

  const res = await fetch(FONNTE_URL, {
    method: 'POST',
    headers: { Authorization: secrets.FONNTE_TOKEN },
    body,
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.status === false) {
    console.error('[Fonnte] Gagal kirim WA:', JSON.stringify(data));
    return { ok: false, data };
  }
  console.log('[Fonnte] Terkirim ke grup WA.');
  return { ok: true, data };
}

module.exports = { sendWhatsApp };
