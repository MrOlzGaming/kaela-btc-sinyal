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
//   #walletCapGrowthChart   -- (21 Sep 2026) grafik area pertumbuhan TOTAL modal futures dari
//                              waktu ke waktu, di tab Saham Saya (di bawah kartu agregat). Data
//                              dari wallet-cap-progress-history.json (1 titik/hari). Reuse library
//                              Lightweight Charts yang UDAH di-load global di dashboard.html (buat
//                              chart NAV Saham) -- no-op kalau library itu somehow belum ke-load
//                              (urutan <script> di dashboard.html WAJIB taro lightweight-charts
//                              SEBELUM file ini, sama kayak kaela-render.js/sniper-orders-widget.js).
//
// Data dari wallet-cap-progress.json, ditulis walletCapProgress.js TIAP SIKLUS (~15 menit) di
// Trading Engine. raw.githubusercontent.com (BUKAN jsDelivr) -- pola SAMA kayak sniper-orders.json
// di dashboard-load.js: data berubah tiap siklus, jsDelivr purge kadang telat/gak mempan.
(function () {
  const URL = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/web/wallet-cap-progress.json';
  const HISTORY_URL = 'https://raw.githubusercontent.com/MrOlzGaming/kaela-btc-sinyal/master/web/wallet-cap-progress-history.json';

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

  // Chart area pertumbuhan Modal Futures (history = [{date:'yyyy-MM-dd', totalBalance, totalCap}]).
  // 'yyyy-MM-dd' dipakai LANGSUNG sbg `time` (Lightweight Charts terima string tanggal buat bar
  // harian native, gak perlu trik konversi UTC/WITA kayak _witaLabelToChartTime di kaela-access-app.js
  // -- itu buat data INTRADAY, punya kita udah 1 titik/hari).
  function renderChart(el, history) {
    if (typeof LightweightCharts === 'undefined') { el.innerHTML = ''; return; } // library belum ke-load, no-op diam2 (bukan error user)
    if (!history || history.length < 2) {
      el.innerHTML = '<p class="sub">Belum cukup data histori -- baru mulai kecatat, cek lagi beberapa hari ke depan.</p>';
      return;
    }
    el.innerHTML = '';
    const trendUp = history[history.length - 1].totalBalance >= history[0].totalBalance;
    const color = trendUp ? '#4ade80' : '#f87171';
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth, height: 200,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#6f8fa3', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(28,48,64,0.4)' }, horzLines: { color: 'rgba(28,48,64,0.4)' } },
      rightPriceScale: { borderColor: '#1c3040' },
      timeScale: { borderColor: '#1c3040' },
    });
    const series = chart.addSeries(LightweightCharts.AreaSeries, {
      lineColor: color, lineWidth: 2,
      topColor: trendUp ? 'rgba(74,222,128,0.28)' : 'rgba(248,113,113,0.28)',
      bottomColor: 'rgba(5,10,16,0)',
      priceFormat: { type: 'custom', formatter: fmtUsd, minMove: 1 },
    });
    series.setData(history.map((h) => ({ time: h.date, value: h.totalBalance })));
    // Garis putus-putus di $4000 (total cap 4 dompet) -- konteks target, BUKAN data bergerak.
    const totalCap = history[history.length - 1].totalCap;
    series.createPriceLine({ price: totalCap, color: '#6f8fa3', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Cap' });
    chart.timeScale().fitContent();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { if (el.clientWidth > 0) chart.resize(el.clientWidth, 200); }).observe(el);
    }
  }

  async function main() {
    const detailBox = document.getElementById('walletCapProgressBox');
    const aggBox = document.getElementById('walletCapAggregateBox');
    const chartBox = document.getElementById('walletCapGrowthChart');
    if (!detailBox && !aggBox && !chartBox) return;
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

    if (chartBox) {
      try {
        const res = await fetch(HISTORY_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        renderChart(chartBox, await res.json());
      } catch (e) {
        chartBox.innerHTML = `<p class="sub">Gagal muat histori pertumbuhan (${e.message}).</p>`;
      }
    }
  }

  main();
})();
