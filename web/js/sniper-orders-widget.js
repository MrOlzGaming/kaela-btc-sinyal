// Hitung & tampilkan P&L LIVE buat order Sniper yang lagi FLOATING -- baca harga BTC
// live (Binance REST, sama endpoint kayak chart-widget.js) tiap 15 detik, update kartu order
// yang punya [data-order-id] di DOM (dirender statis oleh buildDashboard.js dari
// sniper-orders.json). Kalau gak ada kartu floating di halaman, script ini no-op.

(function () {
  // data-api.binance.vision -- market data publik, gak kena blokir geografis (api.binance.com
  // biasa ke-block HTTP 451 di beberapa region termasuk US -- kalau pengunjung web kita dari
  // sana, harga bakal gagal muat juga kalau masih pakai endpoint lama).
  // SYMBOLS (22 Agu 2026, upgrade multi-aset) -- dulu BTCUSDT doang, sekarang poll SEMUA simbol
  // yang lagi dipakai kartu floating di halaman (data-symbol per kartu, lihat kaela-render.js).
  function priceUrl(symbol) {
    return `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`;
  }

  function fmtUsd(n) {
    // Bug ketemu 16 Agu 2026 (kepakai bareng widget Nyopet): sign cuma diisi '+' pas positif,
    // Math.abs() buang tanda minus tanpa gantiin -- nilai rugi keliatan "$0.27" padahal
    // -$0.27 (warna merah bener, tapi angkanya sendiri menyesatkan). Sign HARUS eksplisit dua-duanya.
    const sign = n >= 0 ? '+' : '-';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function updateCards(symbol, price) {
    // Fallback ke BTCUSDT buat kartu LAMA yang belum punya data-symbol (sebelum upgrade
    // multi-aset 22 Agu 2026) -- backward-compat, jangan sampai kartu lama gak keupdate.
    document.querySelectorAll('.order-card.floating[data-order-id]').forEach((card) => {
      const cardSymbol = card.dataset.symbol || 'BTCUSDT';
      if (cardSymbol !== symbol) return;
      const entry = parseFloat(card.dataset.entry);
      const leverage = parseFloat(card.dataset.leverage) || 1;
      const margin = parseFloat(card.dataset.margin) || 0;
      const dir = card.dataset.direction === 'sell' ? -1 : 1;
      // remainingFraction (12 Agu 2026, fix abis fitur partial-exit) -- kalau posisi udah kena
      // tahap 1, cuma SEBAGIAN margin yang masih floating (sisanya udah direalisasi & dikunci
      // ke breakeven) -- tanpa ini, P&L live overstate seolah masih full posisi.
      const remFrac = card.dataset.remainingFraction !== undefined ? parseFloat(card.dataset.remainingFraction) : 1;
      const realizedPnl = parseFloat(card.dataset.realizedPnl) || 0;
      const target = card.querySelector('[data-pnl-target]');
      // Harga BTC sekarang -- baris TERPISAH & menonjol (14 Agu 2026, permintaan Olan: "biar enak
      // liatnya"), bukan cuma nempel di ujung teks P&L kayak sebelumnya.
      const priceTarget = card.querySelector('[data-price-target]');
      if (priceTarget) priceTarget.textContent = `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      if (!target || !entry) return;

      const priceMovePct = ((price - entry) / entry) * 100 * dir;
      const pnlPct = priceMovePct * leverage;
      const floatingPnlUsd = margin ? (margin * remFrac * pnlPct) / 100 : null;
      const totalPnlUsd = floatingPnlUsd !== null ? floatingPnlUsd + realizedPnl : null;

      if (totalPnlUsd !== null) {
        target.textContent = remFrac < 1
          ? `${fmtUsd(totalPnlUsd)} total (realized ${fmtUsd(realizedPnl)} + floating ${fmtUsd(floatingPnlUsd)})`
          : `${fmtUsd(totalPnlUsd)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
        target.className = 'order-pnl-live ' + (totalPnlUsd >= 0 ? 'up' : 'down');
      } else {
        target.textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
        target.className = 'order-pnl-live ' + (pnlPct >= 0 ? 'up' : 'down');
      }
    });
  }

  async function tick() {
    const cards = document.querySelectorAll('.order-card.floating[data-order-id]');
    if (cards.length === 0) return; // gak ada floating order, gak usah fetch
    const symbols = new Set();
    cards.forEach((card) => symbols.add(card.dataset.symbol || 'BTCUSDT'));
    await Promise.all([...symbols].map(async (symbol) => {
      try {
        const res = await fetch(priceUrl(symbol));
        const data = await res.json();
        updateCards(symbol, parseFloat(data.price));
      } catch (e) {
        // diam -- kartu tetap nampilin nilai terakhir yang berhasil, gak perlu ganggu user
      }
    }));
  }

  // Countup "udah kebuka berapa lama" (29 Agu 2026, permintaan Olan: "kasih countup posisi biar
  // tau dah kebuka brapa jam/hari" -- update sendiri LIVE, gak perlu reload manual). Jalan
  // terpisah dari tick() harga (gak butuh network, murni hitung Date.now() - data-opened-at).
  function fmtDuration(ms) {
    if (!(ms > 0)) return 'baru aja';
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    const parts = [];
    if (days) parts.push(days + 'h');
    if (hours || days) parts.push(hours + 'j');
    parts.push(mins + 'm');
    return 'sudah ' + parts.join(' ');
  }
  function tickDurations() {
    document.querySelectorAll('.order-card.floating[data-opened-at]').forEach((card) => {
      const iso = card.dataset.openedAt;
      if (!iso) return;
      const target = card.querySelector('[data-duration-target]');
      if (!target) return;
      const openedMs = new Date(iso).getTime();
      if (isNaN(openedMs)) { target.textContent = '-'; return; }
      target.textContent = fmtDuration(Date.now() - openedMs);
    });
  }

  tick();
  tickDurations();
  setInterval(tick, 15000);
  setInterval(tickDurations, 30000); // durasi gak butuh presisi detik, 30dtk cukup buat "live" tanpa reload
})();
