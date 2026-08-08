// Header harga ringkas di atas widget TradingView -- chart utamanya sendiri udah ditangani
// PENUH oleh widget resmi TradingView (lihat script embed di buildDashboard.js), ini cuma
// angka ringkas $harga + %perubahan 24 jam biar keliatan cepat tanpa buka chart-nya.

(function () {
  // data-api.binance.vision -- market data publik, gak kena blokir geografis (api.binance.com
  // biasa ke-block HTTP 451 di beberapa region termasuk US).
  const PRICE_URL = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT';
  const priceEl = document.getElementById('btc-price');
  const changeEl = document.getElementById('btc-change');
  if (!priceEl) return;

  function fmtUsd(n) {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
  }

  async function updatePrice() {
    try {
      const res = await fetch(PRICE_URL);
      const data = await res.json();
      const price = parseFloat(data.lastPrice);
      const changePct = parseFloat(data.priceChangePercent);
      priceEl.textContent = fmtUsd(price);
      changeEl.textContent = (changePct >= 0 ? '📈 +' : '📉 ') + changePct.toFixed(2) + '% (24j)';
      changeEl.className = 'price-change ' + (changePct >= 0 ? 'up' : 'down');
    } catch (e) {
      priceEl.textContent = 'Gagal muat';
    }
  }

  updatePrice();
  setInterval(updatePrice, 15000);
})();
