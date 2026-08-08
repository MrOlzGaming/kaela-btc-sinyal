// Hitung & tampilkan P&L LIVE buat order Nyopet Market yang lagi FLOATING -- baca harga BTC
// live (Binance REST, sama endpoint kayak chart-widget.js) tiap 15 detik, update kartu order
// yang punya [data-order-id] di DOM (dirender statis oleh buildDashboard.js dari
// nyopet-orders.json). Kalau gak ada kartu floating di halaman, script ini no-op.

(function () {
  // data-api.binance.vision -- market data publik, gak kena blokir geografis (api.binance.com
  // biasa ke-block HTTP 451 di beberapa region termasuk US -- kalau pengunjung web kita dari
  // sana, harga bakal gagal muat juga kalau masih pakai endpoint lama).
  const PRICE_URL = 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT';

  function fmtUsd(n) {
    const sign = n >= 0 ? '+' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function updateCards(price) {
    document.querySelectorAll('.order-card.floating[data-order-id]').forEach((card) => {
      const entry = parseFloat(card.dataset.entry);
      const leverage = parseFloat(card.dataset.leverage) || 1;
      const margin = parseFloat(card.dataset.margin) || 0;
      const dir = card.dataset.direction === 'sell' ? -1 : 1;
      const target = card.querySelector('[data-pnl-target]');
      if (!target || !entry) return;

      const priceMovePct = ((price - entry) / entry) * 100 * dir;
      const pnlPct = priceMovePct * leverage;
      const pnlUsd = margin ? (margin * pnlPct) / 100 : null;

      target.textContent = pnlUsd !== null
        ? `${fmtUsd(pnlUsd)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%) @ $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% @ $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      target.className = 'order-pnl-live ' + (pnlPct >= 0 ? 'up' : 'down');
    });
  }

  async function tick() {
    if (!document.querySelector('.order-card.floating[data-order-id]')) return; // gak ada floating order, gak usah fetch
    try {
      const res = await fetch(PRICE_URL);
      const data = await res.json();
      updateCards(parseFloat(data.price));
    } catch (e) {
      // diam -- kartu tetap nampilin nilai terakhir yang berhasil, gak perlu ganggu user
    }
  }

  tick();
  setInterval(tick, 15000);
})();
