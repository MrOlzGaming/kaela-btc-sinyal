// Hitung & tampilkan nilai LIVE + P&L buat BTC Spot yang lagi dipegang (tab Spot halaman
// Jurnal) -- baca harga BTC live (Binance REST, sama endpoint kayak sniper-orders-widget.js)
// tiap 15 detik. Kalau gak ada elemen [data-spot-btc-held] (belum ada BTC dipegang), no-op.

(function () {
  const PRICE_URL = 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT';

  function fmtUsd(n) {
    const sign = n >= 0 ? '+' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function updateValue(price) {
    const el = document.querySelector('[data-spot-btc-held]');
    if (!el) return;
    const btcHeld = parseFloat(el.dataset.spotBtcHeld);
    const invested = parseFloat(el.dataset.spotInvested) || 0;
    if (!btcHeld) return;

    const valueUsd = btcHeld * price;
    const pnlUsd = valueUsd - invested;
    const pnlPct = invested > 0 ? (pnlUsd / invested) * 100 : 0;

    const valueTarget = el.querySelector('[data-spot-value-target]');
    if (valueTarget) valueTarget.textContent = `$${valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

    const pnlTarget = el.querySelector('[data-spot-pnl-target]');
    if (pnlTarget) {
      pnlTarget.textContent = `${fmtUsd(pnlUsd)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
      pnlTarget.className = 'order-pnl-live ' + (pnlUsd >= 0 ? 'up' : 'down');
    }
  }

  async function tick() {
    if (!document.querySelector('[data-spot-btc-held]')) return; // gak ada BTC dipegang, gak usah fetch
    try {
      const res = await fetch(PRICE_URL);
      const data = await res.json();
      updateValue(parseFloat(data.price));
    } catch (e) {
      // diam -- kartu tetap nampilin nilai terakhir yang berhasil
    }
  }

  tick();
  setInterval(tick, 15000);
})();
