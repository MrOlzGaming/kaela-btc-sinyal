// Kirim pesan WA lewat Fonnte -- broadcast ke SEMUA grup terdaftar (default), atau bisa override
// `target` buat DM ke nomor/grup spesifik (dipakai nyopetOtp.js buat kirim kode OTP ke WA pribadi
// Olan doang, 22 Agu 2026). Searah total: Kaela cuma KIRIM, gak pernah baca command atau balas
// apapun masuk. Tanpa secrets.js (belum di-setup di mesin ini), fungsi ini otomatis no-op --
// aman buat dev/testing lokal.
//
// MULTI-GRUP (31 Agu 2026, permintaan Olan: "grup keluarga baru, kerjanya sama kek grup sekarang,
// tanpa bentrok") -- broadcast (target kosong) sekarang kirim ke SEMUA grup di
// `secrets.FONNTE_BROADCAST_GROUPS` (array), BUKAN cuma 1 grup lagi. `FONNTE_GROUP_ID` lama
// TETAP dipertahanin sbg fallback tunggal (backward-compat kalau BROADCAST_GROUPS belum diisi
// di suatu mesin) -- 0 breaking change buat yang belum sempat update secrets.js-nya.
const { fetchRetryNetworkErrorOnly } = require('./httpRetry');

const FONNTE_URL = 'https://api.fonnte.com/send';

function loadSecrets() {
  try {
    return require('./secrets');
  } catch {
    // fallback buat GitHub Actions -- secrets.js ditulis ulang tiap run dari GitHub Secrets,
    // tapi jaga-jaga kalau suatu saat langsung dari env var (CI lain / testing manual)
    if (process.env.FONNTE_TOKEN) {
      return {
        FONNTE_TOKEN: process.env.FONNTE_TOKEN,
        FONNTE_GROUP_ID: process.env.FONNTE_GROUP_ID,
        // CSV di 1 env var (bukan array) -- env var GitHub Actions cuma bisa string polos.
        FONNTE_BROADCAST_GROUPS: process.env.FONNTE_BROADCAST_GROUPS
          ? process.env.FONNTE_BROADCAST_GROUPS.split(',').map((s) => s.trim()).filter(Boolean)
          : null,
      };
    }
    return null;
  }
}

// Daftar target broadcast -- FONNTE_BROADCAST_GROUPS (array, secrets.js) diutamain, fallback ke
// FONNTE_GROUP_ID tunggal (mesin/workflow yang belum di-update sama sekali) biar gak ada yang
// tiba-tiba berhenti kirim WA cuma gara-gara field baru ini belum keisi di suatu tempat.
function resolveBroadcastTargets(secrets) {
  if (Array.isArray(secrets.FONNTE_BROADCAST_GROUPS) && secrets.FONNTE_BROADCAST_GROUPS.length > 0) {
    return secrets.FONNTE_BROADCAST_GROUPS;
  }
  return secrets.FONNTE_GROUP_ID ? [secrets.FONNTE_GROUP_ID] : [];
}

async function sendOne(message, target, secrets) {
  const body = new URLSearchParams({ target, message });
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
      console.error(`[Fonnte] Fonnte nolak pesan ke ${target}:`, JSON.stringify(data));
      return { ok: false, data };
    }
    console.log(`[Fonnte] Terkirim ke ${target}.`);
    return { ok: true, data };
  } catch (e) {
    console.error(`[Fonnte] Gagal kirim WA ke ${target} setelah retry:`, e.message);
    return { ok: false, error: e.message };
  }
}

async function sendWhatsApp(message, target) {
  const secrets = loadSecrets();
  if (!secrets || !secrets.FONNTE_TOKEN) {
    console.log('[Fonnte] secrets.js belum ada / FONNTE_TOKEN kosong -- skip kirim WA (tetap jalan, cuma console+arsip).');
    return { skipped: true };
  }

  // `target` eksplisit (DM/nomor spesifik) -- SATU tujuan doang, perilaku LAMA, gak ikut broadcast.
  if (target) {
    return sendOne(message, target, secrets);
  }

  // Broadcast -- ke SEMUA grup terdaftar, satu-satu (bukan Promise.all -- biar gak keburu-buru
  // kena rate limit Fonnte, dan biar 1 grup gagal gak ganggu urutan kirim ke grup lain).
  const targets = resolveBroadcastTargets(secrets);
  if (targets.length === 0) {
    console.log('[Fonnte] Gak ada grup broadcast terdaftar (FONNTE_BROADCAST_GROUPS/FONNTE_GROUP_ID kosong) -- skip.');
    return { skipped: true };
  }
  const results = [];
  for (const t of targets) {
    results.push(await sendOne(message, t, secrets));
  }
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results };
}

// 3 Sep 2026, bug ketemu Olan (screenshot WA): sniperAutoAnalysis.js ("posisi bayangan, murni
// perhitungan" -- teaser publik buat grup "BTC Sniper Club", SENGAJA gak pernah pegang uang
// beneran, lihat header komentarnya) ikut ke-broadcast ke grup Wibowo Hedgefund juga (`target`
// kosong = SEMUA grup di FONNTE_BROADCAST_GROUPS, gak ada cara exclude 1 grup). Grup Hedgefund
// isinya keluarga yang beneran nitip modal REAL -- liat "posisi bayangan" di situ bikin bingung/
// gak percaya (padahal posisi REAL Wibowo Hedgefund aman, gak kesentuh sama sekali). Fix: helper
// broadcast baru yang bisa EXCLUDE grup tertentu, dipakai sniperAutoAnalysis.js buat nge-skip
// Wibowo Hedgefund doang -- grup publik/teman lain tetap dapat kayak biasa.
async function sendWhatsAppExcept(message, excludeIds) {
  const secrets = loadSecrets();
  if (!secrets || !secrets.FONNTE_TOKEN) {
    console.log('[Fonnte] secrets.js belum ada / FONNTE_TOKEN kosong -- skip kirim WA (tetap jalan, cuma console+arsip).');
    return { skipped: true };
  }
  const exclude = new Set(excludeIds || []);
  const targets = resolveBroadcastTargets(secrets).filter((t) => !exclude.has(t));
  if (targets.length === 0) {
    console.log('[Fonnte] Gak ada grup broadcast tersisa setelah exclude -- skip.');
    return { skipped: true };
  }
  const results = [];
  for (const t of targets) {
    results.push(await sendOne(message, t, secrets));
  }
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results };
}

// (5 Sep 2026, permintaan Olan: "tradingan Olan hanya broadcast ke Wibowo hedgefund.. bukan japri
// Olan, bukan ke grup lain juga" -- buat trading REAL. Buat trading DEMO Olan sendiri, jawabannya:
// "cuma masuk grup btc sniper club") -- FONNTE_GROUP_ID historis ITU grup "BTC Sniper Club" (grup
// tunggal SEBELUM Wibowo Hedgefund dipisah 31 Agu 2026, lihat komentar konsisten di
// nyopetMonitor.js/whaleMonitor.js/econCalendarMonitor.js dst yang semua nyebut grup ini). Target
// TUNGGAL (bukan broadcast-semua lagi), pola SATU-TITIK sama kayak sendWhatsAppToWibowo di
// wibowoNotify.js.
async function sendWhatsAppToSniperClub(message) {
  const secrets = loadSecrets();
  if (!secrets || !secrets.FONNTE_TOKEN || !secrets.FONNTE_GROUP_ID) {
    console.log('[Fonnte] secrets.js belum ada / FONNTE_GROUP_ID kosong -- skip kirim WA BTC Sniper Club.');
    return { skipped: true };
  }
  return sendOne(message, secrets.FONNTE_GROUP_ID, secrets);
}

module.exports = { sendWhatsApp, sendWhatsAppExcept, sendWhatsAppToSniperClub };
