// Retry helper -- API publik gratis (Binance/Fonnte/Google News) kadang glitch sesaat.
// Cron job di GitHub Actions jalan TANPA ADA YANG NUNGGUIN -- kalau 1 network hiccup bikin
// seluruh run gagal, laporan/sinyal hari itu bisa lolos tanpa ada yang sadar. Retry 3x kecil
// jauh lebih murah daripada itu.

// (5 Okt 2026) Batas waktu default per PERCOBAAN -- dulu gak ada sama sekali: 1 request yang ngegantung (kejadian:
// rawblock blockchain.info di whaleDailyDigest.js) ngabisin seluruh jatah `timeout` eksekutor (exit 124, 373x di log).
// Caller yang udah ngasih `signal` sendiri dipakai apa adanya. SENGAJA gak dipasang di fetchRetryNetworkErrorOnly di bawah
// (kirim WA): abort pas server udah nerima request -> retry -> pesan bisa DOBEL.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 30000;

async function fetchWithRetry(url, options = {}, attempts = 3, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options.signal ? options : { ...options, signal: AbortSignal.timeout(DEFAULT_ATTEMPT_TIMEOUT_MS) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  throw lastErr;
}

// Versi buat operasi TIDAK IDEMPOTEN (kirim WA dsb) -- kalau server SEMPAT merespon (walau statusnya
// error), request itu UDAH nyampe & mungkin udah diproses (misal Fonnte tetap kirim pesannya walau
// responnya balik error/lambat) -- retry di kondisi itu bisa bikin pesan yang sama terkirim 2-3x.
// Cuma retry kalau request-nya BENERAN gagal nyampe server (fetch() throw, network putus/timeout
// sebelum ada respon sama sekali) -- itu satu-satunya kondisi yang aman diulang.
async function fetchRetryNetworkErrorOnly(url, options = {}, attempts = 3, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options); // apapun statusnya (termasuk non-2xx), server UDAH merespon -- gak diulang
    } catch (e) {
      lastErr = e; // fetch() throw = request gak pernah nyampe server, aman diulang
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  throw lastErr;
}

module.exports = { fetchWithRetry, fetchRetryNetworkErrorOnly };
