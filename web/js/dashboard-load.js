// Fetch data mentah dari GitHub (repo publik, gratis, no-deploy-needed) terus render panel
// Musiman + Sniper LANGSUNG di browser -- lihat kaela-render.js buat fungsi render-nya.
// Ini yang bikin dashboard SELALU fresh tanpa perlu Netlify deploy tiap ada sinyal/posisi baru.

(function () {
  // jsDelivr (BUKAN raw.githubusercontent.com langsung, 17 Agu 2026) -- raw.githubusercontent
  // ternyata kena rate-limit (HTTP 429) kalau di-fetch berkali-kali dalam waktu singkat (Olan
  // reload halaman pas mantau posisi Nyopet real-time + testing sesi ini gabung numpuk). jsDelivr
  // itu CDN publik resmi yang mirror repo GitHub apa adanya, limit jauh lebih longgar -- dipakai
  // luas buat kasus PERSIS ini. Cache-nya di-purge otomatis oleh workflow abis push data berubah
  // (lihat .github/workflows/*.yml step "Purge jsDelivr"), jadi tetap fresh.
  const RAW_BASE = 'https://cdn.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/';

  async function fetchJson(file, fallback) {
    try {
      const res = await fetch(RAW_BASE + file + '?t=' + Date.now()); // cache-bust ringan
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.error('[DashboardLoad] Gagal ambil ' + file + ':', e.message);
      return fallback;
    }
  }

  async function main() {
    const now = new Date();
    const [state, ordersState, archive, nyopetState] = await Promise.all([
      fetchJson('state.json', { status: 'TUNAI', position: null }),
      fetchJson('sniper-orders.json', { balance: 0, orders: [] }),
      fetchJson('archive.json', []),
      fetchJson('nyopet-journal.json', { openPosition: null, trades: [] }),
    ]);

    const musimanEl = document.getElementById('musiman-container');
    if (musimanEl) musimanEl.innerHTML = KaelaRender.renderSiklusHalvingPanel(now, state);

    const sniperEntries = archive.filter((e) => e.type === 'sniper').slice().reverse();
    const latestSniperEntry = sniperEntries[0] || null;
    const sniperEl = document.getElementById('sniper-container');
    if (sniperEl) sniperEl.innerHTML = KaelaRender.renderSniperOrdersPanel(ordersState, latestSniperEntry);

    // Nyopet muncul di Home juga (23 Agu 2026, permintaan Olan: "floatingnya juga muncul di
    // home dan di jurnal") -- sebelumnya cuma ada di tab Jurnal.
    const nyopetEl = document.getElementById('nyopet-container');
    if (nyopetEl) nyopetEl.innerHTML = KaelaRender.renderNyopetHomePanel(nyopetState);
  }

  main();
})();
