// Fetch data mentah dari GitHub (repo publik, gratis) terus render tab Spot + Sniper halaman
// Jurnal LANGSUNG di browser -- lihat kaela-render.js. Sama filosofi dashboard-load.js: SELALU
// fresh tanpa perlu deploy Netlify tiap ada buy/trade baru.

(function () {
  // jsDelivr, bukan raw.githubusercontent.com langsung -- lihat catatan di dashboard-load.js
  // (17 Agu 2026, ketemu HTTP 429 rate-limit pas Olan mantau posisi Nyopet real-time).
  const RAW_BASE = 'https://cdn.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/';
  // GitHub langsung buat file POSISI -- lihat catatan lengkap di dashboard-load.js (29 Agu 2026).
  const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/';

  async function fetchJson(file, fallback, opts) {
    const base = (opts && opts.freshOnly) ? GITHUB_RAW_BASE : RAW_BASE;
    try {
      const res = await fetch(base + file + '?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.error('[JurnalLoad] Gagal ambil ' + file + ':', e.message);
      return fallback;
    }
  }

  // Default kosong buat kaela-spot-alt.json -- 1 sub-objek per koin (SAMA bentuknya kayak
  // spotDcaAlt.js load()), dipakai kalau file belum ada di repo (belum sempat commit pertama).
  function defaultAltState() {
    const coins = {};
    KaelaRender.ALT10_SYMBOLS.forEach((s) => {
      coins[s] = { heldQty: 0, totalInvestedCurrentCycle: 0, cycleStartedAt: null, totalRealizedCash: 0, completedCycles: [], buyLog: [] };
    });
    return { coins, lastBuyMonthKey: null, halvingStopNotified: false };
  }

  async function main() {
    const now = new Date();
    const [ordersState, bankrollState, spotState, altState, nyopetState, liveConfig] = await Promise.all([
      fetchJson('sniper-orders.json', { balance: 0, orders: [] }, { freshOnly: true }),
      fetchJson('kaela-bankroll.json', { balance: 100, startedAt: null, topUpHistory: [], pnlHistory: [] }, { freshOnly: true }),
      fetchJson('kaela-spot.json', { btcHeld: 0, totalInvestedCurrentCycle: 0, totalRealizedCash: 0, completedCycles: [], buyLog: [] }),
      fetchJson('kaela-spot-alt.json', defaultAltState()),
      fetchJson('nyopet-journal.json', { openPosition: null, trades: [] }, { freshOnly: true }),
      fetchJson('live-trading-config.json', { enabled: false, testnet: true }),
    ]);

    const spotEl = document.querySelector('[data-panel="spot"]');
    if (spotEl) spotEl.innerHTML = KaelaRender.renderSpotJurnalPanel(spotState, now);

    const altEl = document.querySelector('[data-panel="compoundalt"]');
    if (altEl) altEl.innerHTML = KaelaRender.renderSpotAltJurnalPanel(altState, now);

    // isDemoMode (22 Agu 2026) -- selama testnet=true (Binance Demo, duit virtual), framing
    // "fund manager" (Total Disetor/Return%) DIMATIKAN -- saldo demo dari faucet BUKAN setoran
    // beneran, bandingin ke situ bikin angka % menyesatkan (bisa keliatan puluhan ribu persen).
    const fundReport = KaelaRender.computeFundReport(bankrollState, { isDemoMode: liveConfig.testnet !== false });
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
