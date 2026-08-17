// Fetch data mentah dari GitHub (repo publik, gratis) terus render tab Spot + Sniper halaman
// Jurnal LANGSUNG di browser -- lihat kaela-render.js. Sama filosofi dashboard-load.js: SELALU
// fresh tanpa perlu deploy Netlify tiap ada buy/trade baru.

(function () {
  // jsDelivr, bukan raw.githubusercontent.com langsung -- lihat catatan di dashboard-load.js
  // (17 Agu 2026, ketemu HTTP 429 rate-limit pas Olan mantau posisi Nyopet real-time).
  const RAW_BASE = 'https://cdn.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/';

  async function fetchJson(file, fallback) {
    try {
      const res = await fetch(RAW_BASE + file + '?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.error('[JurnalLoad] Gagal ambil ' + file + ':', e.message);
      return fallback;
    }
  }

  async function main() {
    const now = new Date();
    const [ordersState, bankrollState, spotState, nyopetState] = await Promise.all([
      fetchJson('sniper-orders.json', { balance: 0, orders: [] }),
      fetchJson('kaela-bankroll.json', { balance: 100, startedAt: null, topUpHistory: [], pnlHistory: [] }),
      fetchJson('kaela-spot.json', { btcHeld: 0, totalInvestedCurrentCycle: 0, totalRealizedCash: 0, completedCycles: [], buyLog: [] }),
      fetchJson('nyopet-journal.json', { openPosition: null, trades: [] }),
    ]);

    const spotEl = document.querySelector('[data-panel="spot"]');
    if (spotEl) spotEl.innerHTML = KaelaRender.renderSpotJurnalPanel(spotState, now);

    const fundReport = KaelaRender.computeFundReport(bankrollState);
    const sniperEl = document.querySelector('[data-panel="sniper"]');
    if (sniperEl) {
      sniperEl.innerHTML = KaelaRender.renderJurnalPanel(ordersState, now, fundReport);
      KaelaRender.wireStrategyFilter();
    }

    const nyopetEl = document.querySelector('[data-panel="nyopet"]');
    if (nyopetEl) nyopetEl.innerHTML = KaelaRender.renderNyopetJurnalPanel(nyopetState, now);
  }

  main();
})();
