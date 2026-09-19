// wallet-cap-widget.js (20 Sep 2026) -- render progress 4 dompet trading Kaela (Sniper/Nyopet
// BTC/Emas) menuju cap $1000/dompet, dipasang di dashboard Kaela Access (tab Developer, kartu
// WIBOWO HEDGE FUND, owner-only -- lihat memori project-kaela-monthly-funding.md). No-op kalau
// elemen target gak ada di halaman (dashboard lain yang numpang <script> ini gak kena efek apapun).
//
// Data dari wallet-cap-progress.json, ditulis walletCapProgress.js TIAP SIKLUS (~15 menit) di
// Trading Engine. raw.githubusercontent.com (BUKAN jsDelivr) -- pola SAMA kayak sniper-orders.json
// di dashboard-load.js: data berubah tiap siklus, jsDelivr purge kadang telat/gak mempan.
(function () {
  const URL = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/web/wallet-cap-progress.json';

  function fmtUsd(n) { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  function renderRow(w) {
    const capped = w.balance >= w.cap;
    const barColor = capped ? 'var(--up, #4ade80)' : 'var(--primary, #2dd4f0)';
    return `<div style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:3px;">
        <span>${w.label}</span>
        <span>${fmtUsd(w.balance)} / ${fmtUsd(w.cap)}${capped ? ' ✅' : ''}</span>
      </div>
      <div style="background:var(--border,#1c3040); border-radius:6px; height:8px; overflow:hidden;">
        <div style="width:${Math.min(100, w.pct)}%; background:${barColor}; height:100%;"></div>
      </div>
    </div>`;
  }

  async function main() {
    const box = document.getElementById('walletCapProgressBox');
    if (!box) return;
    try {
      const res = await fetch(URL + '?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      box.innerHTML = data.wallets.map(renderRow).join('')
        + `<p class="sub" style="font-size:0.68rem; margin-top:4px;">Update terakhir: ${new Date(data.updatedAt).toLocaleString('id-ID')}</p>`;
    } catch (e) {
      box.innerHTML = `<p class="sub">Gagal muat progress dompet (${e.message}).</p>`;
    }
  }

  main();
})();
