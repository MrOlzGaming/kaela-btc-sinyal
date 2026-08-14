// Fetch data mentah dari GitHub (repo publik, gratis, no-deploy-needed) terus render panel
// Musiman + Sniper LANGSUNG di browser -- lihat kaela-render.js buat fungsi render-nya.
// Ini yang bikin dashboard SELALU fresh tanpa perlu Netlify deploy tiap ada sinyal/posisi baru.

(function () {
  const RAW_BASE = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/';

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
    const [state, ordersState, archive] = await Promise.all([
      fetchJson('state.json', { status: 'TUNAI', position: null }),
      fetchJson('sniper-orders.json', { balance: 0, orders: [] }),
      fetchJson('archive.json', []),
    ]);

    const musimanEl = document.getElementById('musiman-container');
    if (musimanEl) musimanEl.innerHTML = KaelaRender.renderSiklusHalvingPanel(now, state);

    const sniperEntries = archive.filter((e) => e.type === 'sniper').slice().reverse();
    const latestSniperEntry = sniperEntries[0] || null;
    const sniperEl = document.getElementById('sniper-container');
    if (sniperEl) sniperEl.innerHTML = KaelaRender.renderSniperOrdersPanel(ordersState, latestSniperEntry);
  }

  main();
})();
