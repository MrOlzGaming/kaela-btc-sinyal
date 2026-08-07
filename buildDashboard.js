// Generate web/index.html (Dashboard: hari ini) + web/arsip.html (Arsip: hari-hari lalu, di-grup)
// dari archive.json — data di-embed langsung (gak perlu server/fetch).
// Jalankan tiap kali ada entry baru: node buildDashboard.js

const fs = require('fs');
const path = require('path');
const { getAll } = require('./archive');
const { localDateKey } = require('./config');

const NEXT_HALVING_EST = '2028-04-13T13:11:00Z'; // sumber: CoinGecko real-time countdown — cek ulang berkala
const WEB_DIR = path.join(__dirname, 'web');

const TYPE_LABEL = {
  'report-daily': '📊 Laporan Harian',
  'report-weekly': '📆 Laporan Mingguan',
  'report-monthly': '🗓️ Laporan Bulanan',
  'report-yearly': '📅 Laporan Tahunan',
  news: '📰 Kaela News',
  nyopet: '⚡ Nyopet Market',
  whale: '🐋 Whale Alert',
  'econ-calendar': '📅 Jadwal Ekonomi',
};

// Urutan & isi grup TETAP di Arsip -- tiap entry archive.json masuk PERSIS 1 grup, gak pernah dobel tampil.
const GROUPS = [
  { key: 'news', label: '📰 Berita', match: (type) => type === 'news' },
  { key: 'laporan', label: '📊 Laporan', match: (type) => type.startsWith('report-') },
  { key: 'sinyal', label: '⚡ Sinyal Nyopet Market', match: (type) => type === 'nyopet' },
  { key: 'whale', label: '🐋 Aktivitas Whale', match: (type) => type === 'whale' },
  { key: 'econ', label: '📅 Jadwal Ekonomi', match: (type) => type === 'econ-calendar' },
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

function renderEntry(e, { highlight = false } = {}) {
  const cls = highlight ? 'latest' : 'entry';
  const labelCls = highlight ? 'latest-label' : 'entry-type';
  const dateCls = highlight ? 'latest-date' : 'entry-date';
  const header = highlight
    ? `<div class="${labelCls}">${TYPE_LABEL[e.type] || e.type}</div><div class="${dateCls}">${new Date(e.date).toLocaleString('id-ID')}</div>`
    : `<div class="entry-header"><span class="entry-type">${TYPE_LABEL[e.type] || e.type}</span><span class="entry-date">${new Date(e.date).toLocaleString('id-ID')}</span></div>`;
  return `<div class="${cls}">${header}<pre class="content">${linkify(escapeHtml(e.content))}</pre></div>`;
}

function renderGroup(group, entries) {
  if (entries.length === 0) {
    return `<section class="arsip-group">
      <h2 class="group-title">${group.label}</h2>
      <div class="empty">Belum ada arsip.</div>
    </section>`;
  }

  const [latest, ...rest] = entries;
  const restHtml = rest.map((e) => renderEntry(e)).join('\n');

  return `<section class="arsip-group">
    <h2 class="group-title">${group.label}</h2>
    ${renderEntry(latest, { highlight: true })}
    ${rest.length > 0 ? `<details class="riwayat"><summary>Riwayat (${rest.length})</summary>${restHtml}</details>` : ''}
  </section>`;
}

const SHARED_STYLE = `
  h1 { font-size: 1.4rem; border-bottom: 2px solid var(--clr-border); padding-bottom: 12px; }
  nav { display: flex; gap: 10px; margin: 14px 0; }
  nav a { text-decoration: none; }
  .welcome { background: var(--clr-bg-elevated); border-radius: var(--radius-md); padding: 16px; margin: 16px 0; line-height: 1.6; }
  .welcome strong { color: var(--clr-primary); }
  .arsip-group { margin-top: 34px; }
  .group-title { font-size: 1.1rem; color: var(--clr-primary); border-bottom: 1px solid var(--clr-border); padding-bottom: 8px; margin-bottom: 14px; }
  .latest { background: var(--clr-bg-elevated); border: 2px solid var(--clr-success); border-radius: var(--radius-md); padding: 16px; margin: 10px 0; }
  .latest-label { color: var(--clr-success); font-weight: bold; font-size: 0.85rem; letter-spacing: 0.05em; }
  .latest-date, .entry-date { color: var(--clr-text-muted); font-size: 0.8rem; }
  .content { white-space: pre-wrap; font-family: inherit; margin: 10px 0 0; line-height: 1.5; word-break: break-word; }
  .content a { color: var(--clr-primary); text-decoration: underline; text-underline-offset: 2px; }
  .content a:hover { text-decoration-thickness: 2px; }
  .news-positive { color: var(--clr-success); }
  .news-negative { color: var(--clr-danger); }
  .news-neutral { color: var(--clr-text-muted); }
  .entry { background: var(--clr-bg-elevated); border: 1px solid var(--clr-border); border-radius: var(--radius-sm); padding: 14px; margin: 10px 0; }
  .entry-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .entry-type { font-weight: 600; }
  .riwayat { margin-top: 10px; }
  .riwayat summary { cursor: pointer; color: var(--clr-text-muted); font-size: 0.9rem; padding: 6px 0; }
  .empty { color: var(--clr-text-muted); text-align: center; padding: 20px; background: var(--clr-bg-elevated); border-radius: var(--radius-sm); }
  .countdown { background: linear-gradient(135deg, #1f2937, #111827); border: 2px solid var(--clr-warning); border-radius: var(--radius-lg); padding: 18px; margin: 16px 0; text-align: center; }
  .countdown-label { color: var(--clr-warning); font-weight: bold; font-size: 0.85rem; letter-spacing: 0.05em; margin-bottom: 10px; }
  .countdown-grid { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
  .countdown-box { background: var(--clr-bg); border-radius: var(--radius-sm); padding: 10px 14px; min-width: 64px; }
  .countdown-num { font-size: 1.6rem; font-weight: bold; font-variant-numeric: tabular-nums; }
  .countdown-unit { font-size: 0.7rem; color: var(--clr-text-muted); text-transform: uppercase; }
  .countdown-date { color: var(--clr-text-muted); font-size: 0.8rem; margin-top: 10px; }
  .goto-arsip { display: block; text-align: center; margin-top: 30px; padding: 14px; background: var(--clr-bg-elevated); border-radius: var(--radius-md); color: var(--clr-primary); text-decoration: none; font-weight: 600; }
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
    ${item('index.html', '🏠', 'Dashboard', 'dashboard')}
    ${item('arsip.html', '📚', 'Arsip', 'arsip')}
    ${item('kalkulator.html', '🧮', 'Kalkulator', 'kalkulator')}
    ${item('metodologi-sniper.html', '📖', 'Metodologi', 'metodologi')}
  </nav>`;
}

// ============ DASHBOARD (index.html) — hari ini aja + countdown + sambutan ============

function buildDashboardHtml() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const allEntries = getAll();
  const todayEntries = allEntries.filter((e) => localDateKey(new Date(e.date)) === todayKey);

  const todayHtml = todayEntries.length > 0
    ? todayEntries.map((e) => renderEntry(e, { highlight: true })).join('\n')
    : `<div class="empty">Belum ada info baru hari ini. Kaela masih memantau -- cek lagi nanti.</div>`;

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
  <h1>🎯 Kaela BTC Sinyal</h1>

  <div class="welcome">
    👋 <strong>Selamat datang di Kaela BTC Sinyal</strong> — sistem Sniper otomatis untuk BTC: Siklus Halving
    (strategi utama, ~2 aksi per 4 tahun) + Nyopet Market (sinyal pelengkap opsional). Murni data & kalender,
    tidak pernah dipengaruhi opini atau tebakan. <a href="metodologi-sniper.html">Baca metodologi lengkap →</a>
  </div>

  ${countdownHtml()}

  <h2 class="group-title" style="margin-top:30px;">📌 Hari Ini</h2>
  ${todayHtml}

  <a class="goto-arsip" href="arsip.html">📚 Lihat Arsip Lengkap (hari-hari sebelumnya) →</a>

  <script>${countdownScript()}</script>

  ${navHtml('dashboard')}
</body>
</html>`;
}

// ============ ARSIP (arsip.html) — hari-hari lalu, di-grup per tipe ============

function buildArsipHtml() {
  const now = new Date();
  const todayKey = localDateKey(now);
  const allEntries = getAll(); // terbaru duluan
  const pastEntries = allEntries.filter((e) => localDateKey(new Date(e.date)) !== todayKey);

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
  <h1>📚 Kaela BTC Sinyal — Arsip</h1>
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
