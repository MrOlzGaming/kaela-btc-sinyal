// Fetch analyst-dashboard.json dari jsDelivr (sama pola kayak dashboard-load.js) terus render
// Kaela Analyst Terminal (analis-render.js) di halaman analis.html.

(function () {
  const RAW_BASE = 'https://cdn.jsdelivr.net/gh/MrOlzGaming/kaela-btc-sinyal@master/';

  async function fetchJson(file, fallback) {
    try {
      const res = await fetch(RAW_BASE + file + '?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.error('[AnalisLoad] Gagal ambil ' + file + ':', e.message);
      return fallback;
    }
  }

  async function main() {
    const dashboardData = await fetchJson('analyst-dashboard.json', {});
    const el = document.getElementById('analis-container');
    if (el) el.innerHTML = KaelaAnalisRender.renderAnalystTerminal(dashboardData);
  }

  main();
})();
