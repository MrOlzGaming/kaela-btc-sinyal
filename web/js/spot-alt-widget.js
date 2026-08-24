// Hitung & tampilkan nilai LIVE buat 10 dompet Compound Alt DCA (tab Compound Alt halaman Jurnal)
// -- baca harga live batch (1 request, bukan 10x) tiap 15 detik, sama pola kayak spot-widget.js
// (BTC-only). No-op kalau gak ada kartu wallet yang lagi held (heldQty>0) di halaman ini.

(function () {
  const PRICE_URL_BASE = 'https://data-api.binance.vision/api/v3/ticker/price?symbols=';

  function fmtUsd(n) {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function heldCards() {
    return Array.from(document.querySelectorAll('[data-wallet-qty]')).filter((el) => parseFloat(el.dataset.walletQty) > 0);
  }

  async function tick() {
    const cards = heldCards();
    if (!cards.length) return;
    const symbols = cards.map((el) => el.dataset.walletSymbol);
    try {
      const res = await fetch(PRICE_URL_BASE + encodeURIComponent(JSON.stringify(symbols)));
      const data = await res.json();
      const priceBySymbol = {};
      data.forEach((d) => { priceBySymbol[d.symbol] = parseFloat(d.price); });

      cards.forEach((el) => {
        const qty = parseFloat(el.dataset.walletQty);
        const price = priceBySymbol[el.dataset.walletSymbol];
        if (!price) return;
        el.textContent = fmtUsd(qty * price) + ' (' + qty.toFixed(6) + ')';
      });
    } catch (e) {
      // diam -- kartu tetap nampilin nilai terakhir yang berhasil
    }
  }

  tick();
  setInterval(tick, 15000);
})();
