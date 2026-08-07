// Retry helper -- API publik gratis (Binance/Fonnte/Google News) kadang glitch sesaat.
// Cron job di GitHub Actions jalan TANPA ADA YANG NUNGGUIN -- kalau 1 network hiccup bikin
// seluruh run gagal, laporan/sinyal hari itu bisa lolos tanpa ada yang sadar. Retry 3x kecil
// jauh lebih murah daripada itu.

async function fetchWithRetry(url, options = {}, attempts = 3, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  throw lastErr;
}

module.exports = { fetchWithRetry };
