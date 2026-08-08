// Generate web/index.html (Dashboard: hari ini) + web/arsip.html (Arsip: hari-hari lalu, di-grup)
// dari archive.json — data di-embed langsung (gak perlu server/fetch).
// Jalankan tiap kali ada entry baru: node buildDashboard.js

const fs = require('fs');
const path = require('path');
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
const ICON_ARCHIVE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12l8 4.5 8-4.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16.5L12 21l8-4.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CALC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="5" y="2.5" width="14" height="19" rx="2" stroke-width="1.8"/><line x1="8" y1="6.5" x2="16" y2="6.5" stroke-width="1.8" stroke-linecap="round"/><circle cx="8.3" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="8.3" cy="18.7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="18.7" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="18.7" r="1" fill="currentColor" stroke="none"/></svg>';
const ICON_BOOK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 19H6a2 2 0 00-2 2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOGO_MARK = '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><defs><linearGradient id="kg" x1="0" y1="0" x2="40" y2="40"><stop offset="0" stop-color="#f7931a"/><stop offset="1" stop-color="#ffc266"/></linearGradient></defs><circle cx="20" cy="20" r="16.5" stroke="url(#kg)" stroke-width="2"/><circle cx="20" cy="20" r="8.5" stroke="url(#kg)" stroke-width="2"/><circle cx="20" cy="20" r="2.3" fill="url(#kg)"/><line x1="20" y1="1.5" x2="20" y2="7.5" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="32.5" x2="20" y2="38.5" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="1.5" y1="20" x2="7.5" y2="20" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/><line x1="32.5" y1="20" x2="38.5" y2="20" stroke="url(#kg)" stroke-width="2" stroke-linecap="round"/></svg>';

// Ikon toolbar alat gambar grafik (ala TradingView/BC.Game) -- garis tipis, konsisten sama ikon nav di atas.
// stroke="currentColor" WAJIB di root svg -- beda dari ikon nav (.bottom-nav a .icon svg) yang dapat warnanya
// dari CSS scoped, toolbar ini gak kepakein class itu jadi kalau gak diset eksplisit strokenya default "none".
const ICON_TOOL_CURSOR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 3l14 8-6 1.4L11 19 5 3z" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const ICON_TOOL_TREND = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="4" y1="19" x2="20" y2="5" stroke-width="1.8" stroke-linecap="round"/><circle cx="4" cy="19" r="1.8" fill="currentColor" stroke="none"/><circle cx="20" cy="5" r="1.8" fill="currentColor" stroke="none"/></svg>';
const ICON_TOOL_HLINE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="12" x2="21" y2="12" stroke-width="1.8" stroke-dasharray="3,2" stroke-linecap="round"/><circle cx="3" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="21" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>';
const ICON_TOOL_FIB = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="5" x2="21" y2="5" stroke-width="1.5"/><line x1="3" y1="9.7" x2="16" y2="9.7" stroke-width="1.5"/><line x1="3" y1="14.3" x2="21" y2="14.3" stroke-width="1.5"/><line x1="3" y1="19" x2="11" y2="19" stroke-width="1.5"/></svg>';
const ICON_TOOL_TEXT = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 5h16M12 5v14" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_TOOL_ERASER = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 5 kategori sinyal, 1 warna tetap per kategori -- dipakai KONSISTEN di web (border+emoji) DAN
// WA (emoji kotak warna, lihat categoryColors.js). Biar orang bisa scan cari warna tertentu tanpa
// baca teks lengkap (misal cuma mau Nyopet Market, langsung cari 🟧).
const { CATEGORY_COLOR, categoryOfType } = require('./categoryColors');

const TYPE_LABEL = {
  'report-daily': `${CATEGORY_COLOR.laporan.emoji} 📊 Laporan Harian`,
  'report-weekly': `${CATEGORY_COLOR.laporan.emoji} 📆 Laporan Mingguan`,
  'report-monthly': `${CATEGORY_COLOR.laporan.emoji} 🗓️ Laporan Bulanan`,
  'report-yearly': `${CATEGORY_COLOR.laporan.emoji} 📅 Laporan Tahunan`,
  news: `${CATEGORY_COLOR.news.emoji} 📰 Kaela News`,
  nyopet: `${CATEGORY_COLOR.nyopet.emoji} ⚡ Nyopet Market`,
  whale: `${CATEGORY_COLOR.whale.emoji} 🐋 Whale Alert`,
  'econ-calendar': `${CATEGORY_COLOR.econ.emoji} 📅 Jadwal Ekonomi`,
};

// Urutan & isi grup TETAP di Arsip -- tiap entry archive.json masuk PERSIS 1 grup, gak pernah dobel tampil.
const GROUPS = [
  { key: 'news', category: 'news', label: `${CATEGORY_COLOR.news.emoji} 📰 Berita`, match: (type) => type === 'news' },
  { key: 'laporan', category: 'laporan', label: `${CATEGORY_COLOR.laporan.emoji} 📊 Laporan`, match: (type) => type.startsWith('report-') },
  { key: 'sinyal', category: 'nyopet', label: `${CATEGORY_COLOR.nyopet.emoji} ⚡ Sinyal Nyopet Market`, match: (type) => type === 'nyopet' },
  { key: 'whale', category: 'whale', label: `${CATEGORY_COLOR.whale.emoji} 🐋 Aktivitas Whale`, match: (type) => type === 'whale' },
  { key: 'econ', category: 'econ', label: `${CATEGORY_COLOR.econ.emoji} 📅 Jadwal Ekonomi`, match: (type) => type === 'econ-calendar' },
];

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
  const pinnedBadge = pinned ? `<div class="pinned-badge">📌 POSISI NYOPET MARKET MASIH TERBUKA</div>` : '';
  const header = highlight
    ? `<div class="${labelCls}">${TYPE_LABEL[e.type] || e.type}</div><div class="${dateCls}">${new Date(e.date).toLocaleString('id-ID')}</div>`
    : `<div class="entry-header"><span class="entry-type">${TYPE_LABEL[e.type] || e.type}</span><span class="entry-date">${new Date(e.date).toLocaleString('id-ID')}</span></div>`;
  return `<div class="${cls}${pinned ? ' pinned' : ''}"${borderStyle}>${pinnedBadge}${header}<pre class="content">${linkify(escapeHtml(e.content))}</pre></div>`;
}

// entries HARUS udah terbaru-duluan (dari getAll()) -- Map jaga urutan insersi, jadi tanggal
// otomatis kekumpul terbaru-duluan juga, gak perlu sort ulang.
function groupByDate(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = localDateKey(new Date(e.date));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return map;
}

function renderGroup(group, entries) {
  const titleStyle = ` style="border-bottom-color: ${CATEGORY_COLOR[group.category].hex};"`;
  if (entries.length === 0) {
    return `<section class="arsip-group">
      <h2 class="group-title"${titleStyle}>${group.label}</h2>
      <div class="empty">Belum ada arsip.</div>
    </section>`;
  }

  const [latest, ...rest] = entries;
  const restByDate = groupByDate(rest);
  const restHtml = Array.from(restByDate.entries())
    .map(([dateKey, dateEntries]) => {
      const entriesHtml = dateEntries.map((e) => renderEntry(e)).join('\n');
      return `<details class="date-group"><summary>${dateKey} (${dateEntries.length})</summary>${entriesHtml}</details>`;
    })
    .join('\n');

  return `<section class="arsip-group">
    <h2 class="group-title"${titleStyle}>${group.label}</h2>
    ${renderEntry(latest, { highlight: true })}
    ${rest.length > 0 ? `<details class="riwayat"><summary>Riwayat (${rest.length})</summary>${restHtml}</details>` : ''}
  </section>`;
}

const SHARED_STYLE = `
  h1 { font-size: 1.4rem; margin: 0; }
  .brand { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--clr-border-soft); padding-bottom: 16px; margin-bottom: 4px; }
  nav { display: flex; gap: 10px; margin: 14px 0; }
  nav a { text-decoration: none; }
  .welcome { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 18px; margin: 18px 0; line-height: 1.6; }
  .welcome strong { color: var(--clr-primary); }
  .arsip-group { margin-top: 38px; }
  .group-title { font-size: 1.05rem; font-weight: 700; color: var(--clr-primary); border-bottom: 2px solid var(--clr-border); padding-bottom: 9px; margin-bottom: 14px; }
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
  .riwayat { margin-top: 10px; }
  .riwayat summary { cursor: pointer; color: var(--clr-text-muted); font-size: 0.9rem; padding: 6px 0; }
  .empty { color: var(--clr-text-muted); text-align: center; padding: 22px; background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-md); }
  .countdown { background: var(--gradient-surface), linear-gradient(150deg, #1a2130, #0d1219); border: 1px solid var(--clr-warning); box-shadow: var(--shadow-card), 0 0 32px -8px rgba(240,136,62,0.25); border-radius: var(--radius-lg); padding: 20px; margin: 18px 0; text-align: center; }
  .countdown-label { color: var(--clr-warning); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.05em; margin-bottom: 12px; }
  .countdown-grid { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
  .countdown-box { background: rgba(0,0,0,0.25); border: 1px solid var(--clr-border-soft); border-radius: var(--radius-sm); padding: 10px 16px; min-width: 64px; }
  .countdown-num { font-size: 1.7rem; font-weight: 800; font-variant-numeric: tabular-nums; }
  .countdown-unit { font-size: 0.7rem; color: var(--clr-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .countdown-date { color: var(--clr-text-muted); font-size: 0.8rem; margin-top: 12px; }
  .goto-arsip { display: block; text-align: center; margin-top: 32px; padding: 15px; background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-md); color: var(--clr-primary); text-decoration: none; font-weight: 700; transition: box-shadow 0.2s ease, transform 0.2s ease; }
  .goto-arsip:hover { box-shadow: var(--shadow-card-hover); transform: translateY(-1px); }
  .price-widget { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 18px; margin: 18px 0; }
  .price-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .price-live { font-size: 1.9rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .price-change { font-size: 0.9rem; font-weight: 700; }
  .price-change.up { color: var(--clr-success); }
  .price-change.down { color: var(--clr-danger); }
  .live-dot { color: var(--clr-danger); font-size: 0.7rem; font-weight: 700; animation: pulse-live 1.4s ease-in-out infinite; }
  @keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .mode-toggle-btn { margin-left: auto; background: var(--clr-bg); border: 1px solid var(--clr-border); color: var(--clr-text-muted); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease; }
  .mode-toggle-btn:hover { border-color: var(--clr-primary); color: var(--clr-text); }
  .tf-selector { display: flex; gap: 5px; margin: 14px 0 10px; flex-wrap: wrap; }
  .tf-btn { flex: 1; min-width: 40px; background: var(--clr-bg); border: 1px solid var(--clr-border); color: var(--clr-text-muted); border-radius: var(--radius-sm); padding: 7px 4px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
  .tf-btn:hover { border-color: var(--clr-primary); color: var(--clr-text); }
  .tf-btn.active { background: linear-gradient(180deg, var(--clr-primary), var(--clr-primary-dim)); color: #14100a; border-color: var(--clr-primary); }
  .indicator-row { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0 10px; font-size: 0.8rem; color: var(--clr-text-muted); }
  .indicator-row label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .indicator-row input[type="checkbox"] { accent-color: var(--clr-primary); width: 14px; height: 14px; }
  .chart-area { display: flex; gap: 8px; align-items: stretch; }
  .chart-toolbar { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; background: var(--clr-bg); border: 1px solid var(--clr-border); border-radius: var(--radius-sm); padding: 5px; height: fit-content; }
  .chart-tool-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--clr-text-muted); border-radius: var(--radius-sm); cursor: pointer; padding: 0; flex-shrink: 0; transition: background 0.15s ease, color 0.15s ease; }
  .chart-tool-btn:hover { background: var(--clr-bg-elevated); color: var(--clr-text); }
  .chart-tool-btn.active { background: var(--clr-primary); color: #14100a; }
  .chart-tool-sep { height: 1px; background: var(--clr-border); margin: 3px 2px; }
  #btc-chart-wrap { position: relative; width: 100%; min-width: 0; }
  #btc-chart { width: 100%; height: 320px; border-radius: var(--radius-sm); background: var(--clr-bg); }
  #btc-chart-draw { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; touch-action: none; }
  @media (max-width: 520px) {
    .chart-area { flex-direction: column; }
    .chart-toolbar { flex-direction: row; width: 100%; overflow-x: auto; }
    .chart-tool-sep { width: 1px; height: 20px; margin: 0 2px; }
  }
  .draw-hint { color: var(--clr-text-muted); font-size: 0.75rem; margin-top: 8px; }
  .tv-attribution { text-align: right; font-size: 0.68rem; color: var(--clr-text-muted); opacity: 0.6; margin-top: 4px; }
  .tv-attribution a { color: inherit; }
  .dash-tabs { display: flex; gap: 6px; margin: 24px 0 14px; overflow-x: auto; padding-bottom: 2px; }
  .dash-tab-btn { flex-shrink: 0; background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border); color: var(--clr-text-muted); border-radius: var(--radius-md); padding: 9px 14px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease; }
  .dash-tab-btn:hover { color: var(--clr-text); border-color: var(--clr-border-soft); transform: translateY(-1px); }
  .dash-tab-btn.active { background: linear-gradient(180deg, var(--clr-primary), var(--clr-primary-dim)); color: #14100a; border-color: var(--clr-primary); box-shadow: 0 2px 12px var(--clr-primary-glow); }
  .dash-panel { display: none; animation: fade-in 0.25s ease; }
  .dash-panel.active { display: block; }
  @keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .halving-panel { background: var(--gradient-surface), var(--clr-bg-elevated); border: 1px solid var(--clr-border-soft); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 14px; line-height: 1.65; }
  .phase-badge { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 0.8rem; margin-bottom: 12px; }
  .phase-tanam { background: rgba(63,185,80,0.15); color: var(--clr-success); }
  .phase-panen { background: rgba(240,136,62,0.15); color: var(--clr-warning); }
  .phase-tunai { background: rgba(139,148,158,0.15); color: var(--clr-text-muted); }
  .halving-note { color: var(--clr-text-muted); font-size: 0.85rem; margin-top: 12px; }
  .pinned-badge { color: var(--clr-warning); font-weight: 700; font-size: 0.8rem; margin-bottom: 8px; }
  .latest.pinned, .entry.pinned { border-color: var(--clr-warning); box-shadow: var(--shadow-card), 0 0 0 1px rgba(240,136,62,0.12); }
  .riwayat-label { color: var(--clr-text-muted); font-size: 0.9rem; margin: 14px 0 6px; }
  .date-group { margin: 6px 0; border: 1px solid var(--clr-border); border-radius: var(--radius-md); overflow: hidden; background: var(--clr-bg-elevated); }
  .date-group summary { cursor: pointer; padding: 10px 14px; color: var(--clr-text); font-size: 0.85rem; font-weight: 600; background: var(--gradient-surface), var(--clr-bg-elevated-2); list-style: none; transition: background 0.15s ease; }
  .date-group summary:hover { filter: brightness(1.1); }
  .date-group summary::-webkit-details-marker { display: none; }
  .date-group summary::before { content: '▸ '; color: var(--clr-primary); }
  .date-group[open] summary::before { content: '▾ '; }
  .date-group .entry { margin: 8px 10px; box-shadow: none; }
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
    ${item('arsip.html', ICON_ARCHIVE, 'Arsip', 'arsip')}
    ${item('kalkulator.html', ICON_CALC, 'Kalkulator', 'kalkulator')}
    ${item('metodologi-sniper.html', ICON_BOOK, 'Metodologi', 'metodologi')}
  </nav>`;
}

// ============ DASHBOARD (index.html) — hari ini aja + countdown + sambutan ============

// Kalau posisi Nyopet Market lagi OPEN, entry ENTRY-nya WAJIB nempel di Dashboard (gak pindah ke
// Arsip) sampai kena SL/TP -- gak peduli udah berapa hari lewat. Sistem cuma 1 posisi/waktu, jadi
// entry ENTRY BARU paling baru = entry yang lagi buka itu (gak mungkin ambigu).
function getOpenNyopetSignal() {
  const statePath = path.join(__dirname, 'nyopet-state.json');
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state.position) return null;
  const allNyopet = getAll('nyopet'); // terbaru duluan
  return allNyopet.find((e) => e.content.includes('ENTRY BARU')) || null;
}

function sameEntry(a, b) {
  return a && b && a.date === b.date && a.type === b.type;
}

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

function todayOfType(allEntries, todayKey, matchType) {
  return allEntries.filter((e) => matchType(e.type) && localDateKey(new Date(e.date)) === todayKey);
}

function buildDashboardHtml() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const allEntries = getAll();
  const openSignal = getOpenNyopetSignal();

  // Tab Siklus Halving (default) -- panel status TENANG + Laporan hari ini (kalau ada), gak berisik
  const todayLaporan = todayOfType(allEntries, todayKey, (t) => t.startsWith('report-'));
  const halvingTabHtml = renderSiklusHalvingPanel(now) + todayLaporan.map((e) => renderEntry(e, { highlight: true })).join('\n');

  // Tab Nyopet Market -- posisi OPEN (pinned) menang, baru entry hari ini, baru placeholder "belum ada"
  const todayNyopet = todayOfType(allEntries, todayKey, (t) => t === 'nyopet').filter((e) => !sameEntry(e, openSignal));
  let nyopetTabHtml;
  if (openSignal) {
    nyopetTabHtml = renderEntry(openSignal, { highlight: true, pinned: true }) + todayNyopet.map((e) => renderEntry(e, { highlight: true })).join('\n');
  } else if (todayNyopet.length > 0) {
    nyopetTabHtml = todayNyopet.map((e) => renderEntry(e, { highlight: true })).join('\n');
  } else {
    nyopetTabHtml = `<div class="empty">⚡ Belum ada sinyal Nyopet Market hari ini. Status: sedang mengumpulkan data.</div>`;
  }

  // Tab Berita
  const todayNews = todayOfType(allEntries, todayKey, (t) => t === 'news');
  const newsTabHtml = todayNews.length > 0
    ? todayNews.map((e) => renderEntry(e, { highlight: true })).join('\n')
    : `<div class="empty">📰 Belum ada berita baru hari ini.</div>`;

  // Tab Whale Alert
  const todayWhale = todayOfType(allEntries, todayKey, (t) => t === 'whale');
  const whaleTabHtml = todayWhale.length > 0
    ? todayWhale.map((e) => renderEntry(e, { highlight: true })).join('\n')
    : `<div class="empty">🐋 Belum ada pergerakan besar terdeteksi hari ini.</div>`;

  // Tab Jadwal Ekonomi
  const todayEcon = todayOfType(allEntries, todayKey, (t) => t === 'econ-calendar');
  const econTabHtml = todayEcon.length > 0
    ? todayEcon.map((e) => renderEntry(e, { highlight: true })).join('\n')
    : `<div class="empty">📅 Gak ada event ekonomi dampak tinggi hari ini.</div>`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Kaela BTC Sinyal — Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7931a">
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
    👋 <strong>Selamat datang di Kaela BTC Sinyal</strong> — sistem Sniper otomatis untuk BTC: Siklus Halving
    (strategi utama, ~2 aksi per 4 tahun) + Nyopet Market (sinyal pelengkap opsional). Murni data & kalender,
    tidak pernah dipengaruhi opini atau tebakan. <a href="metodologi-sniper.html">Baca metodologi lengkap →</a>
  </div>

  <div class="price-widget">
    <div class="price-header">
      <span class="price-live" id="btc-price">Memuat...</span>
      <span class="price-change" id="btc-change"></span>
      <span id="live-dot" class="live-dot" title="Live update aktif" style="display:none;">● LIVE</span>
      <button class="mode-toggle-btn" id="chart-mode-toggle">📊 Candle</button>
    </div>
    <div class="tf-selector">
      <button class="tf-btn" data-tf="1m">1m</button>
      <button class="tf-btn" data-tf="15m">15m</button>
      <button class="tf-btn active" data-tf="1h">1H</button>
      <button class="tf-btn" data-tf="4h">4H</button>
      <button class="tf-btn" data-tf="1d">1D</button>
      <button class="tf-btn" data-tf="1w">1W</button>
      <button class="tf-btn" data-tf="all">ALL</button>
    </div>
    <div class="indicator-row">
      <label><input type="checkbox" id="indicator-sma"> <span style="color:#4f9dff;">●</span> SMA 20</label>
      <label><input type="checkbox" id="indicator-ema"> <span style="color:#c77dff;">●</span> EMA 50</label>
    </div>
    <div class="chart-area">
      <div class="chart-toolbar" id="chart-toolbar">
        <button class="chart-tool-btn active" data-tool="cursor" title="Kursor (geser/zoom)">${ICON_TOOL_CURSOR}</button>
        <button class="chart-tool-btn" data-tool="trend" title="Garis Tren">${ICON_TOOL_TREND}</button>
        <button class="chart-tool-btn" data-tool="hline" title="Garis Horizontal">${ICON_TOOL_HLINE}</button>
        <button class="chart-tool-btn" data-tool="fib" title="Fibonacci Retracement">${ICON_TOOL_FIB}</button>
        <button class="chart-tool-btn" data-tool="text" title="Teks">${ICON_TOOL_TEXT}</button>
        <div class="chart-tool-sep"></div>
        <button class="chart-tool-btn" id="clear-draw" title="Hapus semua gambar">${ICON_TOOL_ERASER}</button>
      </div>
      <div id="btc-chart-wrap">
        <div id="btc-chart"></div>
        <canvas id="btc-chart-draw"></canvas>
      </div>
    </div>
    <div class="draw-hint">✏️ Pilih alat di kiri buat gambar analisa (tren/horizontal/fibonacci/teks) -- tersimpan otomatis di browser ini per timeframe</div>
    <div class="tv-attribution">Grafik oleh <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a></div>
  </div>

  ${countdownHtml()}

  <div class="dash-tabs">
    <button class="dash-tab-btn active" data-tab="halving">🎯 Siklus Halving</button>
    <button class="dash-tab-btn" data-tab="nyopet">⚡ Nyopet Market</button>
    <button class="dash-tab-btn" data-tab="news">📰 Berita</button>
    <button class="dash-tab-btn" data-tab="whale">🐋 Whale Alert</button>
    <button class="dash-tab-btn" data-tab="econ">📅 Jadwal Ekonomi</button>
  </div>
  <div class="dash-panel active" data-panel="halving">${halvingTabHtml}</div>
  <div class="dash-panel" data-panel="nyopet">${nyopetTabHtml}</div>
  <div class="dash-panel" data-panel="news">${newsTabHtml}</div>
  <div class="dash-panel" data-panel="whale">${whaleTabHtml}</div>
  <div class="dash-panel" data-panel="econ">${econTabHtml}</div>

  <a class="goto-arsip" href="arsip.html">📚 Lihat Arsip Lengkap (hari-hari sebelumnya) →</a>

  <script>${countdownScript()}</script>
  <script src="js/lightweight-charts.standalone.production.js"></script>
  <script src="js/chart-widget.js"></script>
  <script>
    document.querySelectorAll('.dash-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.dash-tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.dash-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelector('.dash-panel[data-panel="' + btn.dataset.tab + '"]').classList.add('active');
      });
    });
  </script>

  ${navHtml('dashboard')}
</body>
</html>`;
}

// ============ ARSIP (arsip.html) — hari-hari lalu, di-grup per tipe ============

function buildArsipHtml() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const allEntries = getAll(); // terbaru duluan
  const openSignal = getOpenNyopetSignal();
  // Sinyal ENTRY yang posisinya masih OPEN nempel permanen di Dashboard (pinned) -- jangan
  // ikut ditampilin di Arsip juga (biar gak dobel), berapapun hari udah lewat sejak entry itu.
  // Heartbeat "belum ada sinyal hari ini" juga gak masuk Arsip -- itu bukan sinyal beneran,
  // cuma status harian, relevan pas "hari ini" doang (di Dashboard), gak perlu jadi riwayat.
  const pastEntries = allEntries.filter(
    (e) =>
      localDateKey(new Date(e.date)) !== todayKey &&
      !sameEntry(e, openSignal) &&
      !(e.type === 'nyopet' && e.content.includes('Tidak ada sinyal Nyopet Market hari ini'))
  );

  const groupsHtml = GROUPS.map((group) => {
    const groupEntries = pastEntries.filter((e) => group.match(e.type));
    return renderGroup(group, groupEntries);
  }).join('\n');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Kaela BTC Sinyal — Arsip</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7931a">
<meta name="description" content="Arsip laporan & berita Kaela BTC Sinyal — sistem Sniper siklus halving Bitcoin.">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon.svg">
<link rel="stylesheet" href="css/variables.css">
<style>${SHARED_STYLE}</style>
</head>
<body>
  <div class="brand"><span class="brand-mark">${LOGO_MARK}</span><h1>Kaela BTC Sinyal — Arsip</h1></div>
  <p style="color:var(--clr-text-muted);font-size:0.9rem;">Info hari ini ada di tab <a href="index.html">🏠 Dashboard</a>. Halaman ini isinya hari-hari sebelumnya, dikelompokkan per jenis.</p>

  ${groupsHtml}

  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  </script>

  ${navHtml('arsip')}
</body>
</html>`;
}

if (!fs.existsSync(WEB_DIR)) fs.mkdirSync(WEB_DIR, { recursive: true });
fs.writeFileSync(path.join(WEB_DIR, 'index.html'), buildDashboardHtml());
fs.writeFileSync(path.join(WEB_DIR, 'arsip.html'), buildArsipHtml());
console.log('web/index.html (Dashboard) + web/arsip.html (Arsip) dibuat.');
