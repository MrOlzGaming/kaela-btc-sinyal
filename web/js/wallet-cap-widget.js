// wallet-cap-widget.js (20 Sep 2026) -- render progress 4 dompet trading Kaela (Sniper/Nyopet
// BTC/Emas) menuju cap $1000/dompet. DUA target elemen, DUA level detail (lihat memori
// project-kaela-monthly-funding.md):
//   #walletCapProgressBox   -- tab Developer (owner-only), breakdown PENUH per dompet.
//   #walletCapAggregateBox  -- tab Saham Saya (SEMUA shareholder), CUMA total gabungan vs $4000
//                              (Olan eksplisit TOLAK expose breakdown/pola setoran pribadi ke
//                              anggota lain, 20 Sep 2026) -- pola setoran/prioritas dompet mana
//                              duluan TETAP privat, cuma "berapa total modal futures pool sekarang"
//                              yang dibagi ke shareholder.
// No-op per elemen kalau gak ada di halaman (dashboard lain yang numpang <script> ini gak kena
// efek apapun, dan halaman yang cuma punya salah satu tetap jalan normal).
//
// Data dari wallet-cap-progress.json, ditulis walletCapProgress.js TIAP SIKLUS (~15 menit) di
// Trading Engine. raw.githubusercontent.com (BUKAN jsDelivr) -- pola SAMA kayak sniper-orders.json
// di dashboard-load.js: data berubah tiap siklus, jsDelivr purge kadang telat/gak mempan.
(function () {
  const URL = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/web/wallet-cap-progress.json';

  function fmtUsd(n) { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  function updatedAtLine(updatedAt) {
    return `<p class="sub" style="font-size:0.68rem; margin-top:4px;">Update terakhir: ${new Date(updatedAt).toLocaleString('id-ID')}</p>`;
  }

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

  // Agregat -- SATU angka gabungan (total balance vs total cap), gak nyebut label dompet mana pun.
  function renderAggregate(wallets) {
    const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);
    const totalCap = wallets.reduce((s, w) => s + w.cap, 0);
    const pct = totalCap > 0 ? Math.min(100, Math.round((totalBalance / totalCap) * 1000) / 10) : 0;
    const capped = totalBalance >= totalCap;
    return `<div style="margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;">
        <span>Modal Futures</span>
        <span>${fmtUsd(totalBalance)} / ${fmtUsd(totalCap)}${capped ? ' ✅' : ''}</span>
      </div>
      <div style="background:var(--border,#1c3040); border-radius:6px; height:10px; overflow:hidden;">
        <div style="width:${pct}%; background:var(--primary,#2dd4f0); height:100%;"></div>
      </div>
    </div>`;
  }

  async function main() {
    const detailBox = document.getElementById('walletCapProgressBox');
    const aggBox = document.getElementById('walletCapAggregateBox');
    if (!detailBox && !aggBox) return;
    try {
      const res = await fetch(URL + '?t=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (detailBox) detailBox.innerHTML = data.wallets.map(renderRow).join('') + updatedAtLine(data.updatedAt);
      if (aggBox) aggBox.innerHTML = renderAggregate(data.wallets) + updatedAtLine(data.updatedAt);
    } catch (e) {
      const msg = `<p class="sub">Gagal muat progress dompet (${e.message}).</p>`;
      if (detailBox) detailBox.innerHTML = msg;
      if (aggBox) aggBox.innerHTML = msg;
    }
  }

  main();
})();
