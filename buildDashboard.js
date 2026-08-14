// Generate web/index.html (Dashboard, satu-satunya halaman data) dari archive.json --
// data di-embed langsung (gak perlu server/fetch).
// Jalankan tiap kali ada entry baru: node buildDashboard.js
//
// Arsip (arsip.html) DIBUANG (keputusan Olan 9 Agu 2026) -- setelah News/Whale/Econ/Laporan
// Harian dibuang dari web, satu-satunya isi Arsip yang tersisa cuma log teks mentah Nyopet
// Market (RENCANA/INVALID dst) yang gak nambah nilai lagi -- riwayat yang BENERAN berharga
// (trade selesai, profit/loss) udah ditangani rapi sama tab Jurnal.

const fs = require('fs');
const path = require('path');
const { getFundReport } = require('./kaelaBankroll');
const { getAll } = require('./archive');
const { localDateKey } = require('./config');
const {
  WINDOW_START, WINDOW_END, NEXT_HALVING_EST: HALVING_DATE, daysToHalving,
} = require('./groupReport');

const NEXT_HALVING_EST = '2028-04-13T13:11:00Z'; // sumber: CoinGecko real-time countdown — cek ulang berkala
const WEB_DIR = path.join(__dirname, 'web');

// Ikon SVG garis tipis (bukan emoji) -- konsisten di semua halaman (dashboard, arsip, kalkulator,
// metodologi). Sama persis dipakai ulang di web/kalkulator.html & web/metodologi-*.html (statis).
const ICON_HOME = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3.5 10.5L12 3l8.5 7.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 9.5V20a1 1 0 001 1h11a1 1 0 001-1V9.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 21v-6a1 1 0 011-1h3a1 1 0 011 1v6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CALC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="5" y="2.5" width="14" height="19" rx="2" stroke-width="1.8"/><line x1="8" y1="6.5" x2="16" y2="6.5" stroke-width="1.8" stroke-linecap="round"/><circle cx="8.3" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="8.3" cy="18.7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="18.7" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="18.7" r="1" fill="currentColor" stroke="none"/></svg>';
const ICON_BOOK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 19H6a2 2 0 00-2 2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CHART = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 20V4" stroke-width="1.8" stroke-linecap="round"/><path d="M4 20h16" stroke-width="1.8" stroke-linecap="round"/><path d="M7.5 16.5l3.5-4 3 2.5L18.5 9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOGO_MARK = '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><defs><linearGradient id="kg" x1="0" y1="0" x2="40" y2="40"><stop offset="0" stop-color="#f7931a"/><stop offset="1" stop-color="#ffc266"/></linearGradient></defs><circle cx="20" cy="20" r="16.5" stroke="url(#kg)" stroke-width="2"/><circle cx="20" cy="20" r="8.5" stroke="url(#kg)" stroke-width="2"/><circle cx="20" cy="20" r="2.3" fill="url(#kg)"/><line x1="20" y1="1.5" x2="20" y2="7.5" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="32.5" x2="20" y2="38.5" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="1.5" y1="20" x2="7.5" y2="20" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="32.5" y1="20" x2="38.5" y2="20" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/></svg>';

// 5 kategori sinyal, 1 warna tetap per kategori -- dipakai KONSISTEN di web (border+emoji) DAN
// WA (emoji kotak warna, lihat categoryColors.js). Biar orang bisa scan cari warna tertentu tanpa
// baca teks lengkap (misal cuma mau Sniper, langsung cari 🟧).
const { CATEGORY_COLOR, categoryOfType } = require('./categoryColors');

const TYPE_LABEL = {
  'report-daily': `${CATEGORY_COLOR.laporan.emoji} 📊 Laporan Harian`,
  'report-weekly': `${CATEGORY_COLOR.laporan.emoji} 📆 Laporan Mingguan`,
  'report-monthly': `${CATEGORY_COLOR.laporan.emoji} 🗓️ Laporan Bulanan`,
  'report-yearly': `${CATEGORY_COLOR.laporan.emoji} 📅 Laporan Tahunan`,
  news: `${CATEGORY_COLOR.news.emoji} 📰 Kaela News`,
  sniper: `${CATEGORY_COLOR.sniper.emoji} 🎯 Sniper`,
  whale: `${CATEGORY_COLOR.whale.emoji} 🐋 Whale Alert`,
  'econ-calendar': `${CATEGORY_COLOR.econ.emoji} 📅 Jadwal Ekonomi`,
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Warnai baris headline berita sesuai tag sentimen yang udah ada (🟢 bagus / 🔴 buruk / ⚪ netral-ragu)
// -- di WA cuma emoji, di web ditambah warna teks biar lebih jelas ketauan mana yang mana.
function colorizeSentiment(line) {
  const m = line.match(/^(🟢|🔴|⚪) (.+)$/);
  if (!m) return line;
  const [, emoji, text] = m;
  const cls = emoji === '🟢' ? 'news-positive' : emoji === '🔴' ? 'news-negative' : 'news-neutral';
  return `${emoji} <span class="${cls}">${text}</span>`;
}

// Ubah 2 pola baris yang dipakai semua formatter pesan jadi hyperlink beneran (bisa diklik):
//   "   SumberBerita — https://url-panjang..."  -> teks link = nama sumber (bukan URL mentah)
//   "🔗 https://kaela-btc-sinyal.netlify.app"    -> URL itu sendiri jadi teks link
// Diproses per baris (bukan regex 1 kalimat) biar gak ke-double-wrap.
function linkify(escapedText) {
  return escapedText
    .split('\n')
    .map((line) => {
      line = colorizeSentiment(line);
      const sourceMatch = line.match(/^(\s*)(.+?) — (https?:\/\/\S+)$/);
      if (sourceMatch) {
        const [, indent, label, url] = sourceMatch;
        return `${indent}<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      const webMatch = line.match(/^(🔗 )(https?:\/\/\S+)$/);
      if (webMatch) {
        const [, prefix, url] = webMatch;
        return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      }
      return line;
    })
    .join('\n');
}

function renderEntry(e, { highlight = false, pinned = false } = {}) {
  const cls = highlight ? 'latest' : 'entry';
  const labelCls = highlight ? 'latest-label' : 'entry-type';
  const dateCls = highlight ? 'latest-date' : 'entry-date';
  const cat = categoryOfType(e.type);
  const borderStyle = cat ? ` style="border-left: 4px solid ${CATEGORY_COLOR[cat].hex};"` : '';
  const pinnedBadge = pinned ? `<div class="pinned-badge">📌 POSISI SNIPER MASIH TERBUKA</div>` : '';
  const header = highlight
    ? `<div class="${labelCls}">${TYPE_LABEL[e.type] || e.type}</div><div class="${dateCls}">${new Date(e.date).toLocaleString('id-ID')}</div>`
    : `<div class="entry-header"><span class="entry-type">${TYPE_LABEL[e.type] || e.type}</span><span class="entry-date">${new Date(e.date).toLocaleString('id-ID')}</span></div>`;
  return `<div class="${cls}${pinned ? ' pinned' : ''}"${borderStyle}>${pinnedBadge}${header}<pre class="content">${linkify(escapeHtml(e.content))}</pre></div>`;
}

const SHARED_STYLE = `
  h1 { font-size: 1.4rem; margin: 0; }
  .brand { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--clr-border-soft); padding-bottom: 16px; margin-bottom: 4px; }
  nav { display: flex; gap: 10px; margin: 14px 0; }
  nav a { text-decoration: none; }
  .welcome { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 18px; margin: 18px 0; line-height: 1.6; }
  .welcome strong { color: var(--clr-primary); }
  .latest { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-success); box-shadow: var(--shadow-card), 0 0 0 1px rgba(63,185,80,0.08); border-radius: var(--radius-lg); padding: 18px; margin: 10px 0; transition: box-shadow 0.2s ease, transform 0.2s ease; }
  .latest:hover { box-shadow: var(--shadow-card-hover), 0 0 0 1px rgba(63,185,80,0.12); }
  .latest-label { color: var(--clr-success); font-weight: 700; font-size: 0.82rem; letter-spacing: 0.04em; }
  .latest-date, .entry-date { color: var(--clr-text-muted); font-size: 0.8rem; }
  .content { white-space: pre-wrap; font-family: inherit; margin: 10px 0 0; line-height: 1.55; word-break: break-word; }
  .content a { color: var(--clr-primary); text-decoration: underline; text-underline-offset: 2px; }
  .content a:hover { text-decoration-thickness: 2px; }
  .news-positive { color: var(--clr-success); }
  .news-negative { color: var(--clr-danger); }
  .news-neutral { color: var(--clr-text-muted); }
  .entry { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border); box-shadow: var(--shadow-card); border-radius: var(--radius-md); padding: 14px; margin: 10px 0; transition: box-shadow 0.2s ease, border-color 0.2s ease; }
  .entry:hover { box-shadow: var(--shadow-card-hover); border-color: var(--clr-border-soft); }
  .entry-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .entry-type { font-weight: 700; }
  .empty { color: var(--clr-text-muted); text-align: center; padding: 22px; background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-md); }
  .countdown { background: var(--gradient-surface), linear-gradient(150deg, #1a2130, #0d1219); border: 1px solid var(--clr-warning); box-shadow: var(--shadow-card), 0 0 32px -8px rgba(240,136,62,0.25); border-radius: var(--radius-lg); padding: 20px; margin: 18px 0; text-align: center; }
  .countdown-label { color: var(--clr-warning); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.05em; margin-bottom: 12px; }
  .countdown-grid { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
  .countdown-box { background: rgba(0,0,0,0.25); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-sm); padding: 10px 16px; min-width: 64px; }
  .countdown-num { font-size: 1.7rem; font-weight: 800; font-variant-numeric: tabular-nums; }
  .countdown-unit { font-size: 0.7rem; color: var(--clr-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .countdown-date { color: var(--clr-text-muted); font-size: 0.8rem; margin-top: 12px; }
  .price-widget { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 18px; margin: 18px 0; }
  .price-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .price-live { font-size: 1.9rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .price-change { font-size: 0.9rem; font-weight: 700; }
  .price-change.up { color: var(--clr-success); }
  .price-change.down { color: var(--clr-danger); }
  .live-dot { color: var(--clr-danger); font-size: 0.7rem; font-weight: 700; animation: pulse-live 1.4s ease-in-out infinite; }
  @keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  /* Chart utama = widget resmi TradingView Advanced Chart (embed, bukan self-hosted) -- toolbar
     gambar/indikator BAWAAN MEREKA (fx Indicators, drawing tools lengkap), bukan tiruan kita lagi.
     Tinggi dikasih eksplisit (autosize:true widget-nya ngikut TINGGI CONTAINER, bukan bikin sendiri). */
  .tv-full-chart { height: 560px; margin-top: 14px; border-radius: var(--radius-md); overflow: hidden; }
  @media (max-width: 520px) {
    .tv-full-chart { height: 460px; }
  }
  .sniper-orders-panel { margin-bottom: 18px; }
  .order-balance { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 10px; font-size: 0.95rem; }
  .order-balance-date { color: var(--clr-text-muted); font-size: 0.78rem; }
  .order-disclaimer { color: var(--clr-text-muted); font-size: 0.78rem; background: var(--clr-bg-elevated); border-left: 3px solid var(--clr-warning); padding: 8px 12px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; margin-bottom: 12px; }
  .order-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .order-card { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-md); padding: 14px; }
  .order-card.floating { border-color: var(--clr-primary); }
  .order-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .order-dir { font-weight: 700; }
  .order-status-badge { font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: var(--clr-bg); }
  .order-status-badge.floating { color: var(--clr-primary); }
  .order-id { color: var(--clr-text-muted); font-size: 0.72rem; font-family: var(--font-mono); margin-bottom: 4px; }
  .order-strategy { color: var(--clr-text-muted); font-size: 0.82rem; margin-bottom: 8px; }
  .order-levels { display: flex; flex-direction: column; gap: 3px; font-size: 0.85rem; margin-bottom: 6px; }
  .order-note { font-size: 0.78rem; color: var(--clr-text-muted); font-style: italic; margin-bottom: 6px; }
  .order-meta { font-size: 0.75rem; color: var(--clr-text-muted); }
  .order-live-price { font-size: 0.85rem; color: var(--clr-text-muted); margin-bottom: 6px; }
  .order-live-price strong { color: var(--clr-text); font-variant-numeric: tabular-nums; }
  .order-pnl-live { font-weight: 700; font-size: 1.05rem; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .order-pnl-live.up { color: var(--clr-success); }
  .order-pnl-live.down { color: var(--clr-danger); }
  .order-pnl { font-weight: 700; margin-top: 4px; }
  .order-pnl.up { color: var(--clr-success); }
  .order-pnl.down { color: var(--clr-danger); }
  .order-history { margin-top: 10px; }
  .order-history summary { cursor: pointer; color: var(--clr-text-muted); font-size: 0.85rem; padding: 6px 0; }
  .order-journal-summary { display: flex; gap: 16px; flex-wrap: wrap; background: var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-sm); padding: 10px 14px; margin: 8px 0 12px; font-size: 0.85rem; }
  .order-journal-summary .up { color: var(--clr-success); }
  .order-journal-summary .down { color: var(--clr-danger); }
  .dash-section-title { font-weight: 800; font-size: 1.05rem; margin: 30px 0 12px; color: var(--clr-primary); border-bottom: 1px solid var(--clr-border-soft); padding-bottom: 8px; }
  .halving-panel { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 14px; line-height: 1.65; }
  .phase-badge { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 0.8rem; margin-bottom: 12px; }
  .phase-tanam { background: rgba(63,185,80,0.15); color: var(--clr-success); }
  .phase-panen { background: rgba(240,136,62,0.15); color: var(--clr-warning); }
  .phase-tunai { background: rgba(139,148,158,0.15); color: var(--clr-text-muted); }
  .halving-note { color: var(--clr-text-muted); font-size: 0.85rem; margin-top: 12px; }
  .pinned-badge { color: var(--clr-warning); font-weight: 700; font-size: 0.8rem; margin-bottom: 8px; }
  .latest.pinned, .entry.pinned { border-color: var(--clr-warning); box-shadow: var(--shadow-card), 0 0 0 1px rgba(240,136,62,0.12); }

  /* Tab Jurnal -- statistik, equity curve, kalender P/L (ala trading journal profesional) */
  .journal-stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 6px; }
  .journal-stat { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-sm); padding: 10px 12px; }
  .journal-stat-label { color: var(--clr-text-muted); font-size: 0.72rem; margin-bottom: 4px; }
  .journal-stat-value { font-weight: 700; font-size: 1.05rem; font-variant-numeric: tabular-nums; }
  .journal-stat-value.up { color: var(--clr-success); }
  .journal-stat-value.down { color: var(--clr-danger); }
  .journal-section-title { font-weight: 700; font-size: 0.95rem; margin: 22px 0 10px; color: var(--clr-text); }
  .equity-svg { width: 100%; height: 160px; display: block; background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-md); }
  .pnl-calendar { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-md); padding: 14px; }
  .cal-header { font-weight: 700; margin-bottom: 10px; }
  .cal-header .up { color: var(--clr-success); } .cal-header .down { color: var(--clr-danger); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .cal-dow { text-align: center; color: var(--clr-text-muted); font-size: 0.68rem; padding-bottom: 4px; }
  .cal-cell { aspect-ratio: 1; border-radius: 6px; background: var(--clr-bg); display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.7rem; }
  .cal-cell-empty { background: transparent; }
  .cal-cell.up { background: rgba(34, 197, 94, 0.16); color: var(--clr-success); }
  .cal-cell.down { background: rgba(248, 81, 73, 0.16); color: var(--clr-danger); }
  .cal-day { font-size: 0.68rem; opacity: 0.7; }
  .cal-pnl { font-weight: 700; font-variant-numeric: tabular-nums; }
  .strategy-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .strategy-filter-btn { background: var(--clr-bg-elevated); border: 1px solid var(--clr-border); color: var(--clr-text-muted); border-radius: 999px; padding: 5px 12px; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
  .strategy-filter-btn.active { background: var(--clr-primary); color: #14100a; border-color: var(--clr-primary); }
`;

function countdownHtml() {
  return `<div class="countdown">
    <div class="countdown-label">⏳ COUNTDOWN HALVING BERIKUTNYA</div>
    <div class="countdown-grid">
      <div class="countdown-box"><div class="countdown-num" id="cd-days">-</div><div class="countdown-unit">Hari</div></div>
      <div class="countdown-box"><div class="countdown-num" id="cd-hours">-</div><div class="countdown-unit">Jam</div></div>
      <div class="countdown-box"><div class="countdown-num" id="cd-mins">-</div><div class="countdown-unit">Menit</div></div>
      <div class="countdown-box"><div class="countdown-num" id="cd-secs">-</div><div class="countdown-unit">Detik</div></div>
    </div>
    <div class="countdown-date">Estimasi: ${new Date(NEXT_HALVING_EST).toISOString().slice(0, 10)} (sumber: CoinGecko)</div>
  </div>`;
}

function countdownScript() {
  return `
    const HALVING_TARGET = new Date('${NEXT_HALVING_EST}').getTime();
    function updateCountdown() {
      const diff = Math.max(0, HALVING_TARGET - Date.now());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      document.getElementById('cd-days').textContent = d;
      document.getElementById('cd-hours').textContent = String(h).padStart(2, '0');
      document.getElementById('cd-mins').textContent = String(m).padStart(2, '0');
      document.getElementById('cd-secs').textContent = String(s).padStart(2, '0');
    }
    updateCountdown();
    setInterval(updateCountdown, 1000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  `;
}

function navHtml(activePage) {
  const item = (href, icon, label, key) =>
    `<a href="${href}"${key === activePage ? ' class="active"' : ''}><span class="icon">${icon}</span>${label}</a>`;
  return `<nav class="bottom-nav">
    ${item('index.html', ICON_HOME, 'Dashboard', 'dashboard')}
    ${item('jurnal.html', ICON_CHART, 'Jurnal', 'jurnal')}
    ${item('kalkulator.html', ICON_CALC, 'Kalkulator', 'kalkulator')}
    ${item('metodologi-musiman.html', ICON_BOOK, 'Metodologi', 'metodologi')}
  </nav>`;
}

// ============ DASHBOARD (index.html) — hari ini aja + countdown + sambutan ============

function fmtDateShort(d) {
  return d.toISOString().slice(0, 10);
}

const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function fmtDateLong(d) {
  return `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Status TENANG, non-noisy, selalu up-to-date -- ini yang disuguhkan pertama kali (default tab)
// biar user gak dibanjiri info begitu buka Dashboard. Baca state.json (status Siklus Halving
// SEBENARNYA, bukan cuma tebakan tanggal) buat nentuin fase yang bener.
function renderSiklusHalvingPanel(now) {
  const statePath = path.join(__dirname, 'state.json');
  let state = { status: 'TUNAI', position: null };
  if (fs.existsSync(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* pakai default */ }
  }

  const windowLabel = `${fmtDateLong(WINDOW_START)} – ${fmtDateLong(WINDOW_END)}`;
  const daysToWindow = Math.round((WINDOW_START.getTime() - now.getTime()) / 86400000);
  let badgeClass, badgeText, bodyHtml;

  if (state.status === 'OPEN' && state.position) {
    badgeClass = 'phase-panen';
    badgeText = '🌾 POSISI TERBUKA';
    bodyHtml = `<p>Kaela udah masuk Musim Tanam di <strong>${state.position.entryDate}</strong> @ <strong>$${Number(state.position.entryPrice).toLocaleString('en-US')}</strong>.
      Rencana: <strong>tahan, dan kalau ada dana lebih boleh nambah pelan-pelan (DCA) terus</strong> sampai mendekati puncak siklus
      (368–549 hari setelah halving, berdasar 3 siklus historis), baru direncanakan Musim Panen. Kaela bakal mulai
      <strong>rewel ingetin tiap hari lewat WhatsApp</strong> begitu momen Musim Panen mendekat.</p>`;
  } else if (now >= WINDOW_START && now <= WINDOW_END) {
    badgeClass = 'phase-tanam';
    badgeText = '🌱 SEDANG MUSIM TANAM';
    bodyHtml = `<p>Window Musim Tanam <strong>${windowLabel}</strong> SEDANG BERLANGSUNG SEKARANG. Default: beli spot.
      Bukan sekadar beli-lalu-diamkan — <strong>kalau ada dana, boleh terus masuk pelan-pelan (DCA)</strong> sepanjang
      window ini sampai halving tiba, baru direncanakan Musim Panen. Kaela ngirim pengingat ke grup WA
      <strong>tiap hari selama window ini berlangsung</strong> — bukan cuma sekali.</p>`;
  } else if (now > WINDOW_END) {
    badgeClass = 'phase-tunai';
    badgeText = '⚠️ WINDOW LEWAT, PERLU DITINJAU';
    bodyHtml = `<p>Musim Tanam (${windowLabel}) udah lewat tapi belum ada catatan posisi terbuka — perlu ditinjau ulang manual.</p>`;
  } else {
    badgeClass = 'phase-tunai';
    badgeText = '⚪ TUNAI — MENUNGGU';
    bodyHtml = `<p><strong>Rencana Kaela:</strong> mulai Musim Tanam sekitar <strong>${windowLabel}</strong> (~${daysToWindow} hari lagi).
      Bukan cuma beli sekali lalu diam — <strong>selama window Musim Tanam sampai halving tiba, kalau ada dana boleh terus
      masuk pelan-pelan (DCA)</strong>, baru direncanakan Musim Panen di sekitar 368–549 hari setelah halving
      (~${fmtDateLong(HALVING_DATE)}). Begitu Musim Tanam maupun Musim Panen tiba, Kaela bakal
      <strong>rewel ingetin berhari-hari lewat WhatsApp grup</strong> sampai window itu berakhir.</p>`;
  }

  return `<div class="halving-panel">
    <div class="phase-badge ${badgeClass}">${badgeText}</div>
    ${bodyHtml}
    <p class="halving-note">⏳ Halving berikutnya: <strong>${daysToHalving(now)} hari lagi</strong> (~${fmtDateLong(HALVING_DATE)})</p>
  </div>`;
}

// ============ Sniper MANUAL: monitor order live (sniper-orders.json) ============
// Beda dari log teks lama (sniperLog.js) -- ini KARTU LIVE per order: pending (nunggu trigger),
// floating (P&L live dihitung DI BROWSER dari harga live, lihat web/js/sniper-orders-widget.js),
// closed (histori). Order dibuat MANUAL pas Olan+Kaela analisa bareng (bukan auto-decide algoritma
// lagi) -- lihat sniperOrders.js/sniperOrderMonitor.js. Saldo publik SENGAJA (konfirmasi user).

const DIR_LABEL_WEB = { buy: '🟢 BUY', sell: '🔴 SELL' };
const STRATEGY_LABEL_WEB = { range: 'Range Trading', breakout: 'Breakout', trend: 'Trend Following' };
function fmtUsdOrder(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}

// Harga LIKUIDASI (14 Agu 2026, permintaan Olan: "ada liquidated dimana") -- BEDA dari SL, walau
// sering deket/sama. Margin abis kalau harga gerak 100/leverage persen lawan posisi -- SL biasanya
// dipasang SEDIKIT lebih deket dari titik ini (floor(leverage) di calculator.js ngasih buffer
// kecil), jadi SL harusnya kena DULUAN sebelum beneran liquidated -- tapi titik likuidasi
// sesungguhnya tetap perlu ditampilkan terpisah, jangan disamain sama SL biar gak nyesatin.
function liquidationPrice(o) {
  if (!o.leverage || !o.entryPrice) return null;
  const distPct = 100 / o.leverage;
  return o.direction === 'buy' ? o.entryPrice * (1 - distPct / 100) : o.entryPrice * (1 + distPct / 100);
}

function renderOrderCard(o) {
  const dir = DIR_LABEL_WEB[o.direction] || o.direction;
  const strategy = STRATEGY_LABEL_WEB[o.strategyType] || '';
  // sl bisa null/undefined buat order "main liq" (gak ada SL formal) -- WAJIB fallback '-',
  // jangan langsung fmtUsdOrder(undefined) (hasilnya "$NaN", ketauan pas audit anomali).
  const slText = (o.sl !== null && o.sl !== undefined) ? fmtUsdOrder(o.sl) : '-';
  const idLine = o.signalId ? `<div class="order-id">🆔 ${o.signalId}</div>` : '';
  if (o.status === 'pending') {
    return `<div class="order-card pending">
      ${idLine}
      <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge pending">⏳ PENDING</span></div>
      <div class="order-strategy">${strategy}</div>
      <div class="order-levels"><span>Trigger: <strong>${fmtUsdOrder(o.triggerPrice)}</strong></span><span>TP: ${fmtUsdOrder(o.tp)}</span><span>SL: ${slText}</span></div>
      ${o.confirmationNote ? `<div class="order-note">📋 ${o.confirmationNote}</div>` : ''}
      ${o.leverage ? `<div class="order-meta">Exposure ${o.exposure}× · Leverage ${o.leverage}× · Margin ${fmtUsdOrder(o.marginUsd)}</div>` : ''}
    </div>`;
  }
  if (o.status === 'floating') {
    // remainingFraction (12 Agu 2026, fix widget P&L live abis partial-exit) -- posisi yang
    // udah kena tahap 1 cuma sisa SEBAGIAN (biasanya 0.5) yang masih floating, widget WAJIB
    // tau ini biar gak overstate P&L pakai margin penuh.
    const remFrac = o.remainingFraction !== undefined && o.remainingFraction !== null ? o.remainingFraction : 1;
    const partialBadge = o.partialDone
      ? `<div class="order-partial-note">🟡 Tahap 1 diamankan: ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)} -- SL sisa di breakeven, sisa ${(remFrac * 100).toFixed(0)}% posisi di-trail</div>`
      : '';
    // Volume tradingan (nilai posisi/notional) = margin x leverage -- BUKAN field tersendiri di
    // data, dihitung on-the-fly (14 Agu 2026, permintaan Olan: "ada volume tradingnya").
    const volumeUsd = (o.marginUsd && o.leverage) ? o.marginUsd * o.leverage : null;
    const liqPrice = liquidationPrice(o);
    const tradeMetaLine = (o.leverage || o.marginUsd)
      ? `<div class="order-meta">Margin ${fmtUsdOrder(o.marginUsd)} · Leverage ${o.leverage}× · Volume ${volumeUsd !== null ? fmtUsdOrder(volumeUsd) : '-'}${liqPrice !== null ? ` · Liquidated @ ${fmtUsdOrder(liqPrice)}` : ''}</div>`
      : '';
    return `<div class="order-card floating" data-order-id="${o.id}" data-direction="${o.direction}" data-entry="${o.entryPrice}" data-tp="${o.tp}" data-sl="${o.sl || ''}" data-leverage="${o.leverage || 1}" data-margin="${o.marginUsd || 0}" data-remaining-fraction="${remFrac}" data-realized-pnl="${o.realizedPnlUsd || 0}">
      ${idLine}
      <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge floating">🔵 FLOATING</span></div>
      <div class="order-strategy">${strategy}</div>
      <div class="order-live-price">Harga BTC sekarang: <strong data-price-target>memuat...</strong></div>
      <div class="order-levels"><span>Entry: <strong>${fmtUsdOrder(o.entryPrice)}</strong></span><span>TP: ${fmtUsdOrder(o.tp)}</span><span>SL: ${slText}</span></div>
      ${tradeMetaLine}
      ${partialBadge}
      <div class="order-pnl-live" data-pnl-target>Memuat P&amp;L live...</div>
    </div>`;
  }
  // closed_tp / closed_sl / cancelled
  const won = o.status === 'closed_tp';
  const badge = o.status === 'cancelled' ? '🚫 DIBATALKAN' : (won ? '✅ TP' : '❌ SL');
  const pnlLine = (o.pnlUsd !== null && o.pnlUsd !== undefined)
    ? `<div class="order-pnl ${won ? 'up' : 'down'}">${o.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.pnlUsd)} (${o.pnlUsd >= 0 ? '+' : ''}${o.pnlPct.toFixed(2)}%)</div>` : '';
  // Timeline 2-tahap (12 Agu 2026, permintaan Olan: "partial di jurnal juga") -- kalau order ini
  // sempat kena tahap 1 sebelum full closed, tunjukkin timeline-nya, jangan cuma hasil akhir gabungan.
  const partialTimeline = o.partialDone
    ? `<div class="order-partial-timeline">
        <div>🟡 Tahap 1 @ ${fmtUsdOrder(o.partialTp)}${o.partialClosedAt ? ` (${fmtDateLong(new Date(o.partialClosedAt))})` : ''}: ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)}</div>
        <div>🏁 Tahap 2 (sisa) @ ${fmtUsdOrder(o.exitPrice ?? (won ? o.tp : o.sl))}${o.closedAt ? ` (${fmtDateLong(new Date(o.closedAt))})` : ''}: ${(o.pnlUsd - (o.realizedPnlUsd || 0)) >= 0 ? '+' : ''}${fmtUsdOrder((o.pnlUsd || 0) - (o.realizedPnlUsd || 0))}</div>
      </div>`
    : '';
  return `<div class="order-card closed" data-strategy="${o.strategyType || ''}">
    ${idLine}
    <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge closed">${badge}</span></div>
    <div class="order-levels"><span>Entry: ${o.entryPrice ? fmtUsdOrder(o.entryPrice) : '-'}</span><span>Exit: ${o.status === 'closed_tp' ? fmtUsdOrder(o.tp) : o.status === 'closed_sl' ? slText : '-'}</span></div>
    ${partialTimeline}
    ${pnlLine}
  </div>`;
}

function loadSniperOrdersState() {
  const ordersPath = path.join(__dirname, 'sniper-orders.json');
  // Belum ada file = belum pernah ada order sama sekali (sistem manual baru mulai) -- BUKAN
  // berarti panelnya kosong dari tampilan, tetap render empty-state yang jelas, jangan blank.
  return fs.existsSync(ordersPath) ? JSON.parse(fs.readFileSync(ordersPath, 'utf8')) : { balance: 0, balanceUpdatedAt: null, orders: [] };
}

// Tab Sniper = status TERKINI doang, SATU kartu (permintaan Olan 9 Agu 2026 -- sebelumnya
// numpuk semua entry hari ini, bingung). Kalau ada order aktif (floating), itu yang tampil.
// Kalau enggak, tampilkan 1 status TERAKHIR (biasanya "INVALID, masih nunggu" dari
// sniperAutoAnalysis.js) -- BUKAN daftar riwayat, cuma snapshot kondisi sekarang. Riwayat lengkap
// yang UDAH SELESAI (closed_tp/closed_sl) itu tugas tab Jurnal, bukan di sini.
function renderSniperOrdersPanel(state, latestStatusEntry) {
  // Cuma FLOATING yang ditampilkan -- PENDING (belum ketrigger, belum valid) SENGAJA gak
  // ditampilkan di web publik sama sekali (permintaan Olan: "sinyal yang dikirim harus valid",
  // berlaku juga buat web bukan cuma WA). Rencana pending tetap tersimpan di sniper-orders.json
  // (dipantau sniperOrderMonitor.js), cuma gak dirender ke publik sampai beneran valid.
  const active = (state.orders || []).filter((o) => o.status === 'floating');

  // Saldo bankroll Kaela DIPINDAH ke halaman Jurnal (14 Agu 2026, instruksi Olan: "jurnal
  // isinya saldo berjalan kaela, jurnal trading dan grafik") -- section ini sekarang murni
  // posisi live doang, gak dobel nampilin saldo yang udah ada di Jurnal.
  let activeHtml;
  if (active.length > 0) {
    activeHtml = `<div class="order-grid">${active.map(renderOrderCard).join('')}</div>`;
  } else if (latestStatusEntry) {
    activeHtml = renderEntry(latestStatusEntry, { highlight: true });
  } else {
    activeHtml = `<div class="empty">🎯 Belum ada analisa Sniper.</div>`;
  }

  return `<div class="sniper-orders-panel">
    <p class="order-disclaimer">🚨 Ini MONITOR/TRACKER doang -- gak ada eksekusi otomatis. Eksekusi asli tetap manual oleh Olan di Binance. Bankroll Bayangan Kaela itu MURNI perhitungan buat sizing &amp; tracking performa Sniper sendiri -- gak ada uang bergerak, aman ditampilkan apa adanya. Saldo, riwayat &amp; statistik lengkap ada di halaman <a href="jurnal.html"><strong>📓 Jurnal</strong></a>.</p>
    ${activeHtml}
  </div>`;
}

// ============ Tab Jurnal: statistik + equity curve + kalender P/L ala trading journal profesional
// (RR Metrics/TradeZella dsb) -- SEMUA dihitung dari sniper-orders.json yang udah ada, gak ada
// field baru. R-multiple pakai marginUsd sebagai 1R (itu resiko riil per trade di sistem exposure
// kita -- lihat KNOWLEDGE/metodologi-analisa-teknikal.md §5, margin = 100% loss kalau SL kena).

function computeJournalStats(trades) {
  if (trades.length === 0) return null;
  const wins = trades.filter((o) => o.status === 'closed_tp');
  const losses = trades.filter((o) => o.status === 'closed_sl');
  const winRate = (wins.length / trades.length) * 100;
  const grossWin = wins.reduce((s, o) => s + (o.pnlUsd || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, o) => s + (o.pnlUsd || 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0); // null = "tak terhingga" (belum pernah rugi)
  const totalPnl = trades.reduce((s, o) => s + (o.pnlUsd || 0), 0);
  const expectancy = totalPnl / trades.length;
  const rMultiples = trades.filter((o) => o.marginUsd).map((o) => o.pnlUsd / o.marginUsd);
  const avgR = rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null;
  return { count: trades.length, wins: wins.length, losses: losses.length, winRate, profitFactor, totalPnl, expectancy, avgR };
}

function renderJournalStatsGrid(stats) {
  const pfText = stats.profitFactor === null ? '∞' : stats.profitFactor.toFixed(2);
  const cell = (label, value, cls = '') => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls}">${value}</div></div>`;
  return `<div class="journal-stats-grid">
    ${cell('Total Trade', stats.count)}
    ${cell('Win Rate', `${stats.winRate.toFixed(0)}%`, stats.winRate >= 50 ? 'up' : 'down')}
    ${cell('Profit Factor', pfText, (stats.profitFactor === null || stats.profitFactor >= 1) ? 'up' : 'down')}
    ${cell('Expectancy/trade', fmtUsdOrder(stats.expectancy), stats.expectancy >= 0 ? 'up' : 'down')}
    ${cell('Avg R-Multiple', stats.avgR === null ? '-' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`, (stats.avgR || 0) >= 0 ? 'up' : 'down')}
    ${cell('Total P&amp;L', `${stats.totalPnl >= 0 ? '+' : ''}${fmtUsdOrder(stats.totalPnl)}`, stats.totalPnl >= 0 ? 'up' : 'down')}
  </div>`;
}

// trades: newest-first (konsisten sama urutan lain di file ini) -- dibalik dulu buat kronologis
function renderEquityCurveSvg(trades) {
  if (trades.length < 2) return '<div class="empty">Butuh minimal 2 trade selesai buat equity curve.</div>';
  const chronological = [...trades].reverse();
  let cum = 0;
  const points = [0, ...chronological.map((o) => (cum += (o.pnlUsd || 0)))];
  const w = 600, h = 160, pad = 10;
  const min = Math.min(...points), max = Math.max(...points);
  const range = (max - min) || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  const strokeVar = last >= 0 ? 'var(--clr-success)' : 'var(--clr-danger)';
  const zeroY = (pad + (h - pad * 2) * (1 - (0 - min) / range)).toFixed(1);
  return `<svg class="equity-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" style="stroke:var(--clr-border);stroke-width:1" stroke-dasharray="4 4"/>
    <polyline points="${coords.join(' ')}" fill="none" style="stroke:${strokeVar};stroke-width:2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

const DOW_ID = ['M', 'S', 'S', 'R', 'K', 'J', 'S']; // Minggu Senin Selasa Rabu Kamis Jumat Sabtu

function renderPnlCalendar(trades, now) {
  const monthKey = localDateKey(now).slice(0, 7); // 'YYYY-MM'
  const daily = {};
  trades.forEach((o) => {
    if (!o.closedAt) return;
    const key = localDateKey(new Date(o.closedAt));
    if (!key.startsWith(monthKey)) return;
    daily[key] = (daily[key] || 0) + (o.pnlUsd || 0);
  });
  const [y, m] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const monthPnl = Object.values(daily).reduce((a, b) => a + b, 0);
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell cal-cell-empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthKey}-${String(d).padStart(2, '0')}`;
    const pnl = daily[key];
    const cls = pnl == null ? '' : pnl >= 0 ? 'up' : 'down';
    const pnlText = pnl == null ? '' : `<span class="cal-pnl">${pnl >= 0 ? '+' : ''}${Math.round(pnl)}</span>`;
    cells.push(`<div class="cal-cell ${cls}"><span class="cal-day">${d}</span>${pnlText}</div>`);
  }
  return `<div class="pnl-calendar">
    <div class="cal-header">${BULAN_ID[m - 1]} ${y} <span class="${monthPnl >= 0 ? 'up' : 'down'}">${monthPnl >= 0 ? '+' : ''}${fmtUsdOrder(monthPnl)}</span></div>
    <div class="cal-grid">${DOW_ID.map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>
  </div>`;
}

// Equity curve SALDO BENERAN Kaela (14 Agu 2026, beda dari renderEquityCurveSvg di atas yang
// mulai dari 0/kumulatif P&L trade doang) -- ini titik awal $100, naik dari top-up MAUPUN
// trading, biar keliatan trajectory bankroll yang sesungguhnya kalau berjalan bertahun-tahun.
function renderFundEquitySvg(events) {
  if (events.length < 2) return '<div class="empty">Bankroll baru mulai, equity curve keisi begitu ada top-up/trade berikutnya.</div>';
  const w = 600, h = 160, pad = 10;
  const values = events.map((e) => e.balanceAfter);
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Tandai titik top-up (kotak kecil) biar keliatan mana kenaikan dari SETORAN, beda dari trading.
  const topUpMarkers = events
    .map((e, i) => (e.type === 'topup' || e.type === 'start' ? { x: pad + i * stepX, y: pad + (h - pad * 2) * (1 - (e.balanceAfter - min) / range) } : null))
    .filter(Boolean)
    .map((p) => `<rect x="${(p.x - 2.5).toFixed(1)}" y="${(p.y - 2.5).toFixed(1)}" width="5" height="5" style="fill:var(--clr-primary)"/>`)
    .join('');
  return `<svg class="equity-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${coords.join(' ')}" fill="none" style="stroke:var(--clr-success);stroke-width:2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${topUpMarkers}
  </svg>`;
}

// Kartu ringkasan ala FUND REPORT (14 Agu 2026, permintaan Olan: "Kaela langsung jadi fund
// manajer, harus bekerja seperti fund manajer beneran") -- pemisahan WAJIB: pertumbuhan dari
// SETORAN (top-up, bukan prestasi) vs dari PERFORMA TRADING (P&L beneran, ini yang nunjukkin
// skill). "Total Growth" digabung DIPERBOLEHKAN ditampilkan, tapi HARUS ada pecahannya juga --
// jangan biarin pembaca ngira semua kenaikan itu dari skill trading kalau sebagiannya cuma setoran.
function renderFundReportSection(report) {
  const cell = (label, value, cls = '') => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls}">${value}</div></div>`;
  const totalGrowthUsd = report.balance - report.totalContributed;
  const totalGrowthPct = report.totalContributed > 0 ? (totalGrowthUsd / report.totalContributed) * 100 : 0;
  return `<div class="fund-report-section">
    <div class="journal-section-title">🤖 Laporan Fund Kaela -- Bankroll Bayangan</div>
    <p class="order-disclaimer" style="margin-top:0;">Murni perhitungan (posisi bayangan), gak ada uang bergerak beneran -- tapi dikelola &amp; dilaporkan SEPERSIS mungkin kayak fund manager asli: setoran (top-up) dipisah tegas dari performa (P&amp;L trading), biar gak menyesatkan.</p>
    <div class="journal-stats-grid">
      ${cell('Saldo Sekarang', fmtUsdOrder(report.balance))}
      ${cell('Total Disetor', fmtUsdOrder(report.totalContributed), '')}
      ${cell('P&amp;L Trading (murni)', `${report.totalRealizedPnl >= 0 ? '+' : ''}${fmtUsdOrder(report.totalRealizedPnl)}`, report.totalRealizedPnl >= 0 ? 'up' : 'down')}
      ${cell('Return dari Trading', `${report.returnOnContributedPct >= 0 ? '+' : ''}${report.returnOnContributedPct.toFixed(1)}%`, report.returnOnContributedPct >= 0 ? 'up' : 'down')}
      ${cell('Total Growth (gabungan)', `${totalGrowthPct >= 0 ? '+' : ''}${totalGrowthPct.toFixed(1)}%`, totalGrowthPct >= 0 ? 'up' : 'down')}
      ${cell('Jumlah Trade', report.tradeCount)}
    </div>
    <div class="journal-section-title">📈 Equity Curve Bankroll (mulai $100${report.startedAt ? ', ' + fmtDateLong(new Date(report.startedAt)) : ''})</div>
    ${renderFundEquitySvg(report.events)}
    <p class="order-disclaimer">🟧 Kotak oranye di grafik = momen top-up (setoran baru), BUKAN hasil trading -- biar kenaikan dari 2 sumber ini gampang dibedain sekilas.</p>
  </div>`;
}

function renderJurnalPanel(state, now, fundReport) {
  // cancelled TIDAK dihitung ke statistik (batal sebelum jadi posisi beneran, bukan hasil trade),
  // tapi tetap muncul di daftar riwayat biar jejaknya keliatan.
  const closedAll = (state.orders || []).filter((o) => o.status.startsWith('closed') || o.status === 'cancelled').reverse();
  const trades = closedAll.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl');
  const stats = computeJournalStats(trades);

  // Fund report (14 Agu 2026) tampil DULUAN, TERPISAH dari statistik per-trade -- muncul begitu
  // bankroll mulai (top-up pertama), gak perlu nunggu ada trade selesai kayak statistik di bawahnya.
  const fundHtml = fundReport ? renderFundReportSection(fundReport) : '';

  if (!stats) {
    return `<div class="jurnal-panel">
      ${fundHtml}
      <div class="empty">📓 Belum ada trade yang selesai. Statistik per-trade bakal keisi otomatis begitu ada order Sniper yang kena TP/SL.</div>
    </div>`;
  }

  const strategies = [...new Set(closedAll.map((o) => o.strategyType).filter(Boolean))];
  const filterHtml = strategies.length > 1
    ? `<div class="strategy-filter">
        <button class="strategy-filter-btn active" data-strategy="all">Semua</button>
        ${strategies.map((s) => `<button class="strategy-filter-btn" data-strategy="${s}">${STRATEGY_LABEL_WEB[s] || s}</button>`).join('')}
      </div>`
    : '';

  return `<div class="jurnal-panel">
    ${fundHtml}
    ${renderJournalStatsGrid(stats)}
    <div class="journal-section-title">📈 Equity Curve (per-trade P&amp;L)</div>
    ${renderEquityCurveSvg(trades)}
    <div class="journal-section-title">🗓️ Kalender P&amp;L Bulan Ini</div>
    ${renderPnlCalendar(trades, now)}
    <div class="journal-section-title">📋 Riwayat Trade (${closedAll.length})</div>
    ${filterHtml}
    <div class="order-grid" id="jurnal-trade-grid">${closedAll.map(renderOrderCard).join('')}</div>
  </div>
  <script>
    document.querySelectorAll('.strategy-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.strategy-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var s = btn.dataset.strategy;
        document.querySelectorAll('#jurnal-trade-grid .order-card').forEach(function (card) {
          card.style.display = (s === 'all' || card.dataset.strategy === s) ? '' : 'none';
        });
      });
    });
  </script>`;
}

// Dashboard (14 Agu 2026, permintaan Olan: "gausah dipisah tab, biarin ngalir") -- SATU halaman
// mengalir, urutan tetap: Selamat datang -> Chart BTC -> Countdown Halving -> Musiman -> Sniper
// -> (nanti nyopet, Dark Kaela). Jurnal DIPISAH ke halaman sendiri (jurnal.html) -- lihat
// buildJurnalHtml() di bawah.
function buildDashboardHtml() {
  const now = new Date();

  // Status LIVE Siklus Halving (state.json), gak berisik. Laporan Harian teks SENGAJA gak
  // ditampilin lagi di sini (keputusan Olan 9 Agu 2026) -- WA aja udah cukup.
  const musimanHtml = renderSiklusHalvingPanel(now);

  // Sniper -- status TERKINI doang, 1 kartu (permintaan Olan 9 Agu 2026, lihat
  // renderSniperOrdersPanel). Order aktif kalau ada, kalau enggak baru status terakhir. Sengaja
  // gak pakai banner terpisah di atas chart lagi -- sekarang halaman ngalir tanpa tab, jadi posisi
  // floating udah otomatis kelihatan pas scroll turun dikit, gak perlu klik apa-apa.
  const ordersState = loadSniperOrdersState();
  const latestSniperEntry = getAll('sniper')[0] || null; // terbaru duluan
  const sniperHtml = renderSniperOrdersPanel(ordersState, latestSniperEntry);

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Kaela BTC Sinyal — Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1fae6c">
<meta name="description" content="Dashboard Kaela BTC Sinyal — countdown halving & info hari ini.">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon.svg">
<link rel="stylesheet" href="css/variables.css">
<style>${SHARED_STYLE}</style>
</head>
<body>
  <div class="brand"><span class="brand-mark">${LOGO_MARK}</span><h1>Kaela BTC Sinyal</h1></div>

  <div class="welcome">
    👋 <strong>Selamat datang di Kaela BTC Sinyal</strong> — sistem Musiman otomatis untuk BTC: Siklus Halving
    (strategi utama, ~2 aksi per 4 tahun) + Sniper (sinyal pelengkap opsional). Murni data & kalender,
    tidak pernah dipengaruhi opini atau tebakan. <a href="metodologi-musiman.html">Baca metodologi lengkap →</a>
  </div>

  <div class="price-widget">
    <div class="price-header">
      <span class="price-live" id="btc-price">Memuat...</span>
      <span class="price-change" id="btc-change"></span>
    </div>
    <div class="tv-full-chart">
      <div class="tradingview-widget-container" style="height:100%;width:100%">
        <div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div>
        <div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/BINANCE-BTCUSDT/" rel="noopener nofollow" target="_blank"><span class="blue-text">BTCUSDT chart</span></a><span class="trademark"> by TradingView</span></div>
        <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
        {
          "autosize": true,
          "symbol": "BINANCE:BTCUSDT",
          "interval": "60",
          "timezone": "Asia/Makassar",
          "theme": "dark",
          "style": "1",
          "locale": "en",
          "backgroundColor": "#0a0e14",
          "gridColor": "rgba(139, 150, 163, 0.08)",
          "hide_top_toolbar": false,
          "hide_side_toolbar": false,
          "hide_legend": false,
          "hide_volume": false,
          "allow_symbol_change": false,
          "save_image": true,
          "calendar": false,
          "hotlist": false,
          "details": false,
          "withdateranges": true,
          "compareSymbols": [],
          "studies": [],
          "watchlist": []
        }
        </script>
      </div>
    </div>
  </div>

  ${countdownHtml()}

  <div class="dash-section-title">🌾 Musiman</div>
  ${musimanHtml}

  <div class="dash-section-title">🎯 Sniper</div>
  ${sniperHtml}

  <script>${countdownScript()}</script>
  <script src="js/price-ticker.js"></script>
  <script src="js/sniper-orders-widget.js"></script>

  ${navHtml('dashboard')}
</body>
</html>`;
}

// Jurnal (14 Agu 2026, permintaan Olan: "taruh halaman sendiri isinya saldo berjalan kaela,
// jurnal trading dan grafik perkembangan saldo") -- halaman terpisah, isi PERSIS renderJurnalPanel
// yang dulu jadi tab (fund report saldo + statistik trade + equity curve + kalender P/L +
// riwayat). Profit MAUPUN loss ditampilkan apa adanya (gak disaring) -- lihat renderFundReportSection.
function buildJurnalHtml() {
  const now = new Date();
  const ordersState = loadSniperOrdersState();
  const jurnalHtml = renderJurnalPanel(ordersState, now, getFundReport());

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Kaela BTC Sinyal — Jurnal</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1fae6c">
<meta name="description" content="Jurnal trading Kaela — saldo bankroll, riwayat trade, dan grafik pertumbuhan saldo.">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon.svg">
<link rel="stylesheet" href="css/variables.css">
<style>${SHARED_STYLE}</style>
</head>
<body>
  <div class="brand"><span class="brand-mark">${LOGO_MARK}</span><h1>Kaela BTC Sinyal</h1></div>

  <div class="welcome">
    📓 <strong>Jurnal Trading Kaela</strong> — saldo bankroll bayangan yang berjalan, riwayat lengkap tiap
    trade, dan grafik pertumbuhan saldo dari waktu ke waktu. Profit maupun loss ditampilkan apa adanya,
    jujur, gak disaring atau dipilih-pilih.
  </div>

  ${jurnalHtml}

  ${navHtml('jurnal')}
</body>
</html>`;
}

if (!fs.existsSync(WEB_DIR)) fs.mkdirSync(WEB_DIR, { recursive: true });
fs.writeFileSync(path.join(WEB_DIR, 'index.html'), buildDashboardHtml());
fs.writeFileSync(path.join(WEB_DIR, 'jurnal.html'), buildJurnalHtml());
console.log('web/index.html (Dashboard) + web/jurnal.html dibuat.');
