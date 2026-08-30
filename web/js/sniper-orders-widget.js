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
  // 29 Agu 2026, permintaan Olan: "count up live.. minggu, hari, jam, menit, detik" -- dipertajam
  // dari cuma hari/jam/menit (update tiap 30dtk) jadi lengkap sampai detik, tick tiap 1 detik biar
  // beneran keliatan "hidup" (bukan diem 30dtk baru gerak).
  // 30 Agu 2026 (Olan: "deep cek" bahasa) -- unit durasi ('mgg'/'h'/'j'/'m'/'d', prefix 'sudah')
  // dulu hardcode Indonesia, gak pernah ikut kepindah pas bahasa EN dipilih. Baca bahasa dari
  // SIAPAPUN host yang lagi pakai (sama pola kayak kaela-render.js) -- i18n-meta.js (web publik)
  // set `window.currentMetaLang`, dashboard.html Kaela Access set `window.currentLang`.
  function isEnglish() {
    try {
      if (window.currentMetaLang) return window.currentMetaLang === 'en';
      if (window.currentLang) return window.currentLang === 'en';
    } catch (e) {}
    return false;
  }
  function fmtDuration(ms) {
    const en = isEnglish();
    if (!(ms > 0)) return en ? 'just now' : 'baru aja';
    const totalSec = Math.floor(ms / 1000);
    const weeks = Math.floor(totalSec / (7 * 86400));
    const days = Math.floor((totalSec % (7 * 86400)) / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const units = en ? { w: 'w', d: 'd', h: 'h', m: 'm', s: 's' } : { w: 'mgg', d: 'h', h: 'j', m: 'm', s: 'd' };
    const parts = [];
    if (weeks) parts.push(weeks + units.w);
    if (weeks || days) parts.push(days + units.d);
    if (weeks || days || hours) parts.push(hours + units.h);
    if (weeks || days || hours || mins) parts.push(mins + units.m);
    parts.push(secs + units.s);
    return (en ? '' : 'sudah ') + parts.join(' ');
  }
  function tickDurations() {
    // Selector dilebarin dari '.order-card.floating[data-opened-at]' jadi bare '[data-opened-at]'
    // (29 Agu 2026) -- Musiman/Compound Alt sekarang juga pakai countup durasi (siklus DCA jalan
    // berapa lama), bukan cuma floating position Sniper/Nyopet. Attribute-nya udah cukup spesifik,
    // aman dilebarin.
    document.querySelectorAll('[data-opened-at]').forEach((card) => {
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
  setInterval(tickDurations, 1000); // 29 Agu 2026: dipercepat dari 30dtk -- sekarang nunjukkin detik juga, wajib tick tiap detik biar beneran "live"
})();
