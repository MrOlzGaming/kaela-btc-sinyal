// Kaela Render Lib -- SATU-SATUNYA tempat logika render konten dinamis (Musiman/Sniper/Jurnal/
// Spot), jalan DI BROWSER pengunjung (bukan di server pas build). Diisi ulang tiap ada
// perubahan data (sinyal baru, posisi baru, DCA baru) TANPA perlu deploy Netlify apapun --
// index.html/jurnal.html cuma shell KOSONG (lihat buildDashboard.js), file INI yang fetch data
// mentah dari GitHub (repo publik, lihat kaela-data.js) terus render ke DOM.
//
// PENTING: fungsi-fungsi di sini adalah PORT dari buildDashboard.js (dulu jalan di Node pas
// build) -- kalau ubah logika tampilan di sini, JANGAN LUPA cek apa perubahan sejenis perlu di
// buildDashboard.js juga (cuma shell/CSS yang masih di sana) atau sebaliknya. Konstanta
// WINDOW_START/HALVING_DATE/dst DIDUPLIKASI dari groupReport.js/spotDca.js (Node, gak bisa
// diimpor langsung ke browser tanpa bundler) -- kalau tanggal itu berubah, update di 2 tempat.
//
// I18N (30 Agu 2026, Olan: "bahasa khususnya inggris masih ada yang campur indonesia.. deep cek
// coba") -- SEBELUM ini, seluruh file ZERO terjemahan (cuma teks statis di SEKITAR kartu yang
// diterjemahin lewat data-i18n di HTML shell -- kartu/label/badge yang di-render DI SINI selalu
// Indonesia walau bahasa udah dipindah ke Inggris). Fix: `rt(key)` di bawah baca bahasa aktif dari
// SIAPAPUN host yang lagi pakai (i18n-meta.js set `window.currentMetaLang`, dashboard.html Kaela
// Access set `window.currentLang` -- 2 sistem beda, SATU helper ini baca dua-duanya, gak perlu
// host page nambah apapun). Data PER-TRADE yang genuinely dinamis/bebas isi manusia
// (confirmationNote, tpReasoning, dll dari sinyal individual) TETAP Indonesia apa adanya --
// itu bukan label UI, itu KONTEN, diakui jujur di catatan halaman ("belum ada terjemahan
// otomatis buat bagian itu"). Yang diterjemahin di sini KHUSUS label/badge/judul/statistik UI
// TETAP yang sama persis di semua kartu, bukan isi tiap sinyal.
(function (global) {
  'use strict';

  // ============ i18n helper ============
  function lang() {
    try {
      if (global.currentMetaLang) return global.currentMetaLang; // i18n-meta.js (web publik)
      if (global.currentLang) return global.currentLang; // dashboard.html (Kaela Access)
    } catch (e) {}
    return 'id';
  }
  // Dictionary SINGKAT (label/badge/judul yang dipakai berkali-kali) -- paragraf panjang/dinamis
  // (fase Musiman, disclaimer) ditulis inline pakai lang()==='en' ? ... : ... di fungsi masing2,
  // gak worth dimasukin dictionary krn cuma dipakai 1x/fungsi dan isinya beda-beda per kondisi.
  const RT = {
    badge_open: { id: '🌾 POSISI TERBUKA', en: '🌾 POSITION OPEN' },
    badge_tanam: { id: '🌱 SEDANG MUSIM TANAM', en: '🌱 PLANTING SEASON ACTIVE' },
    badge_review: { id: '⚠️ WINDOW LEWAT, PERLU DITINJAU', en: '⚠️ WINDOW PASSED, NEEDS REVIEW' },
    badge_waiting: { id: '⚪ TUNAI — MENUNGGU', en: '⚪ CASH — WAITING' },
    halving_next: { id: '⏳ Halving berikutnya:', en: '⏳ Next halving:' },
    hari_lagi: { id: 'hari lagi', en: 'days left' },
    pending: { id: '⏳ PENDING', en: '⏳ PENDING' },
    floating: { id: '🔵 FLOATING', en: '🔵 FLOATING' },
    trigger: { id: 'Trigger:', en: 'Trigger:' },
    tp: { id: 'TP:', en: 'TP:' },
    sl: { id: 'SL:', en: 'SL:' },
    entry: { id: 'Entry:', en: 'Entry:' },
    exit: { id: 'Exit:', en: 'Exit:' },
    exposure: { id: 'Exposure', en: 'Exposure' },
    leverage: { id: 'Leverage', en: 'Leverage' },
    margin: { id: 'Margin', en: 'Margin' },
    volume: { id: 'Volume', en: 'Volume' },
    liquidated: { id: 'Liquidated @', en: 'Liquidated @' },
    stage1_secured: { id: 'Tahap 1 diamankan:', en: 'Stage 1 secured:' },
    sl_rest_be: { id: 'SL sisa di breakeven, sisa', en: 'remaining SL at breakeven,' },
    of_position_trailed: { id: '% posisi di-trail', en: '% of position trailed' },
    demo: { id: 'DEMO', en: 'DEMO' },
    real: { id: 'REAL', en: 'REAL' },
    not_executed_yet: { id: 'belum dieksekusi', en: 'not executed yet' },
    opened: { id: '🕐 Dibuka', en: '🕐 Opened' },
    calculating: { id: 'menghitung...', en: 'calculating...' },
    price_now: { id: 'Harga', en: 'Price of' },
    now_suffix: { id: 'sekarang:', en: 'right now:' },
    loading: { id: 'memuat...', en: 'loading...' },
    loading_pnl: { id: 'Memuat P&amp;L live...', en: 'Loading live P&amp;L...' },
    cancelled: { id: '🚫 DIBATALKAN', en: '🚫 CANCELLED' },
    stage1_at: { id: 'Tahap 1 @', en: 'Stage 1 @' },
    stage2_rest_at: { id: 'Tahap 2 (sisa) @', en: 'Stage 2 (remainder) @' },
    positions_open: { id: '📡 Posisi Terbuka', en: '📡 Open Positions' },
    sniper_positions_open: { id: 'posisi Sniper lagi terbuka', en: 'Sniper position(s) currently open' },
    detail_full_at: { id: 'detail lengkap di', en: 'full details in' },
    journal: { id: '📓 Jurnal', en: '📓 Journal' },
    no_open_position_last_analysis: { id: '📡 Belum ada posisi terbuka -- analisa terakhir: lihat di', en: '📡 No open positions -- latest analysis: see' },
    no_sniper_analysis: { id: '🎯 Belum ada analisa Sniper.', en: '🎯 No Sniper analysis yet.' },
    sniper_disclaimer: { id: '🤖 Sinyal VALID sekarang dieksekusi OTOMATIS di akun Binance Demo (duit virtual, riset/uji coba) -- bukan cuma monitor bayangan lagi.', en: '🤖 VALID signals are now executed AUTOMATICALLY on a Binance Demo account (virtual money, research/testing) -- no longer just shadow monitoring.' },
    nyopet_positions_open: { id: 'posisi Nyopet lagi terbuka', en: 'Nyopet position(s) currently open' },
    no_nyopet_open: { id: 'Gak ada posisi Nyopet yang lagi terbuka.', en: 'No open Nyopet positions right now.' },
    nyopet_home_disclaimer: { id: '🥷 Nyopet Market -- ping-pong otomatis zona likuiditas di Binance Demo (USDC).', en: '🥷 Nyopet Market -- automatic ping-pong between liquidity zones on Binance Demo (USDC).' },
    total_trade: { id: 'Total Trade', en: 'Total Trades' },
    win_rate: { id: 'Win Rate', en: 'Win Rate' },
    profit_factor: { id: 'Profit Factor', en: 'Profit Factor' },
    expectancy_trade: { id: 'Expectancy/trade', en: 'Expectancy/trade' },
    avg_r: { id: 'Avg R-Multiple', en: 'Avg R-Multiple' },
    total_pnl: { id: 'Total P&amp;L', en: 'Total P&amp;L' },
    need_2_trades_equity: { id: 'Butuh minimal 2 trade selesai buat equity curve.', en: 'Needs at least 2 completed trades for an equity curve.' },
    bankroll_new: { id: 'Bankroll baru mulai, equity curve keisi begitu ada top-up/trade berikutnya.', en: 'Bankroll just started, the equity curve fills in once there\'s a top-up/trade.' },
    bankroll_demo_title: { id: '🧪 Laporan Bankroll Kaela -- Binance Demo', en: '🧪 Kaela Bankroll Report -- Binance Demo' },
    bankroll_demo_disclaimer: { id: 'Saldo di bawah ini duit VIRTUAL dari Binance Demo (bukan uang asli, bukan setoran) -- makanya persen "return" gak ditampilin dulu di fase ini, biar gak menyesatkan. Begitu pindah ke akun asli dengan setoran beneran, laporan lengkap ala fund manager (Total Disetor vs Return%) bakal aktif lagi.', en: 'The balance below is VIRTUAL money from Binance Demo (not real money, not a deposit) -- that\'s why a "return" percentage isn\'t shown at this stage, to avoid being misleading. Once it moves to a real account with actual deposits, the full fund-manager-style report (Total Deposited vs Return%) will be active again.' },
    balance_now_demo: { id: 'Saldo Sekarang (Demo)', en: 'Current Balance (Demo)' },
    pnl_trading_pure: { id: 'P&amp;L Trading (murni)', en: 'P&amp;L Trading (pure)' },
    trade_count: { id: 'Jumlah Trade', en: 'Number of Trades' },
    fund_report_title: { id: '🤖 Laporan Fund Kaela', en: '🤖 Kaela Fund Report' },
    fund_report_disclaimer: { id: 'Dikelola &amp; dilaporkan SEPERSIS mungkin kayak fund manager asli: setoran (top-up) dipisah tegas dari performa (P&amp;L trading), biar gak menyesatkan.', en: 'Managed &amp; reported as closely as possible to a real fund manager: deposits (top-ups) are strictly separated from performance (trading P&amp;L), to avoid being misleading.' },
    balance_now: { id: 'Saldo Sekarang', en: 'Current Balance' },
    total_deposited: { id: 'Total Disetor', en: 'Total Deposited' },
    return_from_trading: { id: 'Return dari Trading', en: 'Return from Trading' },
    total_growth_combined: { id: 'Total Growth (gabungan)', en: 'Total Growth (combined)' },
    equity_curve_bankroll: { id: '📈 Equity Curve Bankroll', en: '📈 Bankroll Equity Curve' },
    started: { id: 'mulai', en: 'started' },
    topup_marker_note: { id: '🟧 Kotak oranye di grafik = momen top-up (setoran baru), BUKAN hasil trading -- biar kenaikan dari 2 sumber ini gampang dibedain sekilas.', en: '🟧 Orange squares on the chart = top-up moments (new deposits), NOT trading results -- so growth from these 2 sources is easy to tell apart at a glance.' },
    no_trade_done_sniper: { id: '📓 Belum ada trade yang selesai. Statistik per-trade bakal keisi otomatis begitu ada order Sniper yang kena TP/SL.', en: '📓 No completed trades yet. Per-trade statistics will fill in automatically once a Sniper order hits TP/SL.' },
    strategy_all: { id: 'Semua', en: 'All' },
    summary_held_back: { id: 'statistik ringkasan (win rate, profit factor, equity curve, dll) baru ditampilin begitu minimal 2 trade, biar gak menyesatkan dari sampel kekecilan.', en: 'summary statistics (win rate, profit factor, equity curve, etc.) only show once there are at least 2 trades, to avoid misleading results from too small a sample.' },
    new_trades_done: { id: 'Baru', en: 'Only' },
    trades_done: { id: 'trade selesai --', en: 'trade(s) completed --' },
    equity_curve_pertrade: { id: '📈 Equity Curve (per-trade P&amp;L)', en: '📈 Equity Curve (per-trade P&amp;L)' },
    pnl_calendar_month: { id: '🗓️ Kalender P&amp;L Bulan Ini', en: '🗓️ This Month\'s P&amp;L Calendar' },
    trade_history: { id: '📋 Riwayat Trade', en: '📋 Trade History' },
    phase_tanam_dca: { id: '🌱 SEDANG DCA (Musim Tanam)', en: '🌱 DCA IN PROGRESS (Planting Season)' },
    phase_hold_wait_harvest: { id: '🌾 TAHAN, MENUNGGU PANEN', en: '🌾 HOLDING, WAITING FOR HARVEST' },
    phase_window_dca_running: { id: '🌱 WINDOW TANAM -- DCA BERJALAN', en: '🌱 PLANTING WINDOW -- DCA RUNNING' },
    phase_cash_waiting: { id: '⚪ TUNAI -- MENUNGGU WINDOW TANAM', en: '⚪ CASH -- WAITING FOR PLANTING WINDOW' },
    btc_held: { id: 'BTC Dimiliki', en: 'BTC Held' },
    capital_this_cycle: { id: 'Modal Siklus Ini', en: 'This Cycle\'s Capital' },
    avg_cost: { id: 'Avg Cost', en: 'Avg Cost' },
    realized_balance: { id: 'Saldo Terealisasi', en: 'Realized Balance' },
    cycles_completed: { id: 'Siklus Selesai', en: 'Cycles Completed' },
    cycle_started: { id: '🕐 Siklus dimulai', en: '🕐 Cycle started' },
    value_now: { id: 'Nilai sekarang:', en: 'Current value:' },
    calculating_live_pnl: { id: 'Menghitung P&amp;L live...', en: 'Calculating live P&amp;L...' },
    date: { id: 'Tanggal', en: 'Date' },
    btc_price: { id: 'Harga BTC', en: 'BTC Price' },
    btc_received: { id: 'BTC Didapat', en: 'BTC Received' },
    no_buys_this_cycle: { id: 'Belum ada pembelian di siklus ini.', en: 'No purchases in this cycle yet.' },
    buy_start: { id: 'Mulai Beli', en: 'Buy Start' },
    sold: { id: 'Terjual', en: 'Sold' },
    capital: { id: 'Modal', en: 'Capital' },
    sale_proceeds: { id: 'Hasil Jual', en: 'Sale Proceeds' },
    purchase_journal_cycle: { id: '🧾 Jurnal Pembelian (siklus berjalan)', en: '🧾 Purchase Journal (current cycle)' },
    completed_cycle_history: { id: '📜 Riwayat Siklus Selesai', en: '📜 Completed Cycle History' },
    spot_demo_disclaimer: { id: 'DCA Spot $$AMT/hari sekarang dieksekusi OTOMATIS di akun Binance Demo (Spot Testnet, duit virtual) -- bukan cuma catatan bayangan lagi, terpisah total dari bankroll Sniper.', en: 'Spot DCA $$AMT/day is now executed AUTOMATICALLY on a Binance Demo account (Spot Testnet, virtual money) -- no longer just a shadow record, fully separate from the Sniper bankroll.' },
    wait_next_tanam_allin: { id: 'Nunggu Tanam berikutnya (all-in)', en: 'Waiting for next Planting (all-in)' },
    not_started: { id: 'Belum mulai', en: 'Not started yet' },
    amount: { id: 'Jumlah', en: 'Amount' },
    price: { id: 'Harga', en: 'Price' },
    qty: { id: 'Qty', en: 'Qty' },
    no_buys_of: { id: 'Belum ada pembelian', en: 'No purchases of' },
    in_this_cycle: { id: 'di siklus ini.', en: 'in this cycle yet.' },
    wallet_purchase_journal: { id: '🧾 Dompet', en: '🧾 Wallet' },
    purchase_journal: { id: 'Jurnal Pembelian', en: 'Purchase Journal' },
    wallet_cycle_history: { id: '📜 Dompet', en: '📜 Wallet' },
    cycle_history: { id: 'Riwayat Siklus', en: 'Cycle History' },
    total_cycles_lots: { id: 'Total Lot Siklus Selesai', en: 'Total Completed Cycle Lots' },
    capital_this_cycle_10coin: { id: 'Modal Siklus Ini (10 koin)', en: 'This Cycle\'s Capital (10 coins)' },
    realized_balance_waiting: { id: 'Saldo Terealisasi (nunggu Tanam)', en: 'Realized Balance (waiting for Planting)' },
    wallets_10_click: { id: '👛 10 Dompet (klik buat lihat riwayat)', en: '👛 10 Wallets (click to see history)' },
    short: { id: '🔴 SHORT', en: '🔴 SHORT' },
    long: { id: '🟢 LONG', en: '🟢 LONG' },
    target_hit: { id: '✅ TARGET', en: '✅ TARGET' },
    nyawa_hit: { id: '❌ NYAWA', en: '❌ STOP' },
    nyawa: { id: 'Nyawa:', en: 'Stop:' },
    zona: { id: 'Zona', en: 'Zone' },
    no_trade_done_nyopet: { id: '📓 Belum ada trade yang selesai. Statistik bakal keisi otomatis begitu ada posisi Nyopet yang kena target/nyawa.', en: '📓 No completed trades yet. Statistics will fill in automatically once a Nyopet position hits its target/stop.' },
    no_trade_done_short: { id: 'Belum ada trade yang selesai.', en: 'No completed trades yet.' },
    asset: { id: 'Aset', en: 'Asset' },
    direction: { id: 'Arah', en: 'Direction' },
    mode: { id: 'Mode', en: 'Mode' },
    result: { id: 'Hasil', en: 'Result' },
    win: { id: 'MENANG', en: 'WIN' },
    lose: { id: 'KALAH', en: 'LOSS' },
  };
  function rt(key) {
    const entry = RT[key];
    if (!entry) return key;
    return entry[lang()] || entry.id;
  }

  // ============ Konstanta (duplikat dari groupReport.js & spotDca.js -- lihat catatan di atas) ============
  const WINDOW_START = new Date('2026-10-19T00:00:00Z');
  const WINDOW_END = new Date('2026-11-17T00:00:00Z');
  const HALVING_DATE = new Date('2028-04-13T13:11:00Z');
  // 29 Agu 2026: $2 -> $5 (Binance Spot minimum notional $5/order buat BTCUSDT, $2 ketolak terus
  // pas dites live) -- mirror manual dari spotDca.js (Node, gak bisa di-require() di browser).
  const SPOT_DAILY_BUY_USD = 5;
  const SELL_AFTER_HALVING_DAYS = 459; // titik tengah rentang Panen 368-549 hari, lihat spotDca.js
  function spotSellTriggerDate() {
    return new Date(HALVING_DATE.getTime() + SELL_AFTER_HALVING_DAYS * 86400000);
  }
  function daysToHalving(now) {
    return Math.round((HALVING_DATE.getTime() - now.getTime()) / 86400000);
  }

  // Compound Alt DCA (25 Agu 2026) -- duplikat dari spotDcaAltShared.js (Node), sumber kebenaran
  // ada DI SANA, di sini cuma buat render. WINDOW_START/HALVING_DATE dipakai bareng sama Spot BTC
  // di atas (siklus halving yang sama), PANEN_SELL_DAYS beda (536, bukan 459) krn dihitung dari
  // rata-rata hari puncak HISTORIS (lihat _findpeaks.js), bukan titik tengah rentang.
  // BTC dicabut (29 Agu 2026, permintaan Olan: udah punya jalur sendiri di Musiman, double-exposure
  // kalau ikut di sini) -- diganti SOL. Mirror manual dari spotDcaAltShared.js (Node, gak bisa
  // di-require() di browser) -- JAGA DUA-DUANYA SINKRON kalau ada perubahan basket.
  const ALT10_SYMBOLS = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'DOGEUSDT', 'ZILUSDT', 'TRXUSDT', 'XLMUSDT', 'SOLUSDT'];
  const PER_COIN_USD = 10;
  const ALT_PANEN_SELL_DAYS = 536;
  function altSellTriggerDate() {
    return new Date(HALVING_DATE.getTime() + ALT_PANEN_SELL_DAYS * 86400000);
  }

  // Duplikat dari categoryColors.js (tetap harus disinkron manual kalau warna kategori berubah).
  const CATEGORY_COLOR = {
    news: { emoji: '🟦', hex: '#3b82f6' },
    laporan: { emoji: '🟪', hex: '#a855f7' },
    sniper: { emoji: '🟧', hex: '#f7931a' },
    whale: { emoji: '🟨', hex: '#eab308' },
    econ: { emoji: '⬜', hex: '#8b949e' },
    priceAlert: { emoji: '🟫', hex: '#a16207' },
    dxy: { emoji: '💵', hex: '#16a34a' },
  };
  function categoryOfType(type) {
    if (type === 'news') return 'news';
    if (type.startsWith('report-')) return 'laporan';
    if (type === 'sniper') return 'sniper';
    if (type === 'whale') return 'whale';
    if (type === 'econ-calendar') return 'econ';
    if (type === 'price-alert') return 'priceAlert';
    if (type === 'dxy-zone') return 'dxy';
    return null;
  }
  const TYPE_LABEL = {
    'report-daily': `${CATEGORY_COLOR.laporan.emoji} 📊 Laporan Harian`,
    'report-weekly': `${CATEGORY_COLOR.laporan.emoji} 📆 Laporan Mingguan`,
    'report-monthly': `${CATEGORY_COLOR.laporan.emoji} 🗓️ Laporan Bulanan`,
    'report-yearly': `${CATEGORY_COLOR.laporan.emoji} 📅 Laporan Tahunan`,
    news: `${CATEGORY_COLOR.news.emoji} 📰 Kaela News`,
    sniper: `${CATEGORY_COLOR.sniper.emoji} 🎯 Sniper`,
    whale: `${CATEGORY_COLOR.whale.emoji} 🐋 Whale Alert`,
    'econ-calendar': `${CATEGORY_COLOR.econ.emoji} 📅 Jadwal Ekonomi`,
    'dxy-zone': `${CATEGORY_COLOR.dxy.emoji} 💵 Zona DXY`,
  };

  // localDateKey (duplikat config.js) -- WITA (+8), dipakai kalender P&L bulan ini.
  function toLocal(date) {
    return new Date(date.getTime() + 8 * 3600 * 1000);
  }
  function localDateKey(date) {
    return toLocal(date).toISOString().slice(0, 10);
  }

  // ============ Format helpers ============
  const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const BULAN_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function bulanNames() { return lang() === 'en' ? BULAN_EN : BULAN_ID; }
  function fmtDateLong(d) {
    return `${d.getUTCDate()} ${bulanNames()[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  function fmtUsdOrder(n) {
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
  }
  // Tanggal+jam WITA posisi kebuka (29 Agu 2026, permintaan Olan: "kasih tanggal dan jam buka
  // biar tau dari kapan itu buka") -- statis, dirender sekali. Durasi count-up-nya (jalan terus,
  // update tiap menit) ada di sniper-orders-widget.js lewat [data-duration-target].
  function fmtOpenedDate(iso) {
    try {
      const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000); // WITA = UTC+8
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WITA`;
    } catch (e) { return '-'; }
  }
  // Angka BERTANDA (PNL dst) -- fmtUsdOrder polos taruh minus SETELAH '$' ("$-1.81", dari
  // toLocaleString), gak lazim dibaca. Sign WAJIB di depan "$" ("-$1.81").
  function fmtSignedUsd(n) {
    const num = Number(n);
    return (num >= 0 ? '+' : '-') + fmtUsdOrder(Math.abs(num));
  }
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function colorizeSentiment(line) {
    const m = line.match(/^(🟢|🔴|⚪) (.+)$/);
    if (!m) return line;
    const emoji = m[1], text = m[2];
    const cls = emoji === '🟢' ? 'news-positive' : emoji === '🔴' ? 'news-negative' : 'news-neutral';
    return `${emoji} <span class="${cls}">${text}</span>`;
  }
  function linkify(escapedText) {
    return escapedText
      .split('\n')
      .map((line) => {
        line = colorizeSentiment(line);
        const sourceMatch = line.match(/^(\s*)(.+?) — (https?:\/\/\S+)$/);
        if (sourceMatch) {
          return `${sourceMatch[1]}<a href="${sourceMatch[3]}" target="_blank" rel="noopener noreferrer">${sourceMatch[2]}</a>`;
        }
        const webMatch = line.match(/^(🔗 )(https?:\/\/\S+)$/);
        if (webMatch) {
          return `${webMatch[1]}<a href="${webMatch[2]}" target="_blank" rel="noopener noreferrer">${webMatch[2]}</a>`;
        }
        return line;
      })
      .join('\n');
  }

  function renderEntry(e, opts) {
    opts = opts || {};
    const highlight = !!opts.highlight;
    const cls = highlight ? 'latest' : 'entry';
    const labelCls = highlight ? 'latest-label' : 'entry-type';
    const dateCls = highlight ? 'latest-date' : 'entry-date';
    const cat = categoryOfType(e.type);
    const borderStyle = cat ? ` style="border-left: 4px solid ${CATEGORY_COLOR[cat].hex};"` : '';
    const header = highlight
      ? `<div class="${labelCls}">${TYPE_LABEL[e.type] || e.type}</div><div class="${dateCls}">${new Date(e.date).toLocaleString('id-ID')}</div>`
      : `<div class="entry-header"><span class="entry-type">${TYPE_LABEL[e.type] || e.type}</span><span class="entry-date">${new Date(e.date).toLocaleString('id-ID')}</span></div>`;
    return `<div class="${cls}"${borderStyle}>${header}<pre class="content">${linkify(escapeHtml(e.content))}</pre></div>`;
  }

  // ============ Musiman ============
  function renderSiklusHalvingPanel(now, state) {
    state = state || { status: 'TUNAI', position: null };
    const windowLabel = `${fmtDateLong(WINDOW_START)} – ${fmtDateLong(WINDOW_END)}`;
    const daysToWindow = Math.round((WINDOW_START.getTime() - now.getTime()) / 86400000);
    const en = lang() === 'en';
    let badgeClass, badgeText, bodyHtml;

    if (state.status === 'OPEN' && state.position) {
      badgeClass = 'phase-panen';
      badgeText = rt('badge_open');
      bodyHtml = en
        ? `<p>Kaela entered Planting Season on <strong>${state.position.entryDate}</strong> @ <strong>$${Number(state.position.entryPrice).toLocaleString('en-US')}</strong>.
        Plan: <strong>hold, and if there's extra capital, keep adding slowly (DCA)</strong> until approaching the cycle peak
        (368–549 days after halving, based on 3 historical cycles), then Harvest Season is planned. Kaela will start
        <strong>nagging daily reminders via WhatsApp</strong> as the Harvest Season moment approaches.</p>`
        : `<p>Kaela udah masuk Musim Tanam di <strong>${state.position.entryDate}</strong> @ <strong>$${Number(state.position.entryPrice).toLocaleString('en-US')}</strong>.
        Rencana: <strong>tahan, dan kalau ada dana lebih boleh nambah pelan-pelan (DCA) terus</strong> sampai mendekati puncak siklus
        (368–549 hari setelah halving, berdasar 3 siklus historis), baru direncanakan Musim Panen. Kaela bakal mulai
        <strong>rewel ingetin tiap hari lewat WhatsApp</strong> begitu momen Musim Panen mendekat.</p>`;
    } else if (now >= WINDOW_START && now <= WINDOW_END) {
      badgeClass = 'phase-tanam';
      badgeText = rt('badge_tanam');
      bodyHtml = en
        ? `<p>The Planting Season window <strong>${windowLabel}</strong> is HAPPENING RIGHT NOW. Default: buy spot.
        Not just a one-time buy-and-hold — <strong>if there's capital, keep adding slowly (DCA)</strong> throughout
        this window until halving arrives, then Harvest Season is planned. Kaela sends reminders to the WA group
        <strong>every day during this window</strong> — not just once.</p>`
        : `<p>Window Musim Tanam <strong>${windowLabel}</strong> SEDANG BERLANGSUNG SEKARANG. Default: beli spot.
        Bukan sekadar beli-lalu-diamkan — <strong>kalau ada dana, boleh terus masuk pelan-pelan (DCA)</strong> sepanjang
        window ini sampai halving tiba, baru direncanakan Musim Panen. Kaela ngirim pengingat ke grup WA
        <strong>tiap hari selama window ini berlangsung</strong> — bukan cuma sekali.</p>`;
    } else if (now > WINDOW_END) {
      badgeClass = 'phase-tunai';
      badgeText = rt('badge_review');
      bodyHtml = en
        ? `<p>Planting Season (${windowLabel}) has passed but there's no recorded open position — needs manual review.</p>`
        : `<p>Musim Tanam (${windowLabel}) udah lewat tapi belum ada catatan posisi terbuka — perlu ditinjau ulang manual.</p>`;
    } else {
      badgeClass = 'phase-tunai';
      badgeText = rt('badge_waiting');
      bodyHtml = en
        ? `<p><strong>Kaela's plan:</strong> start Planting Season around <strong>${windowLabel}</strong> (~${daysToWindow} days left).
        Not just a one-time buy — <strong>during the Planting Season window until halving arrives, if there's capital, keep
        adding slowly (DCA)</strong>, then Harvest Season is planned around 368–549 days after halving
        (~${fmtDateLong(HALVING_DATE)}). Once Planting or Harvest Season arrives, Kaela will
        <strong>nag reminders for days via the WhatsApp group</strong> until that window ends.</p>`
        : `<p><strong>Rencana Kaela:</strong> mulai Musim Tanam sekitar <strong>${windowLabel}</strong> (~${daysToWindow} hari lagi).
        Bukan cuma beli sekali lalu diam — <strong>selama window Musim Tanam sampai halving tiba, kalau ada dana boleh terus
        masuk pelan-pelan (DCA)</strong>, baru direncanakan Musim Panen di sekitar 368–549 hari setelah halving
        (~${fmtDateLong(HALVING_DATE)}). Begitu Musim Tanam maupun Musim Panen tiba, Kaela bakal
        <strong>rewel ingetin berhari-hari lewat WhatsApp grup</strong> sampai window itu berakhir.</p>`;
    }

    return `<div class="halving-panel">
      <div class="phase-badge ${badgeClass}">${badgeText}</div>
      ${bodyHtml}
      <p class="halving-note">${rt('halving_next')} <strong>${daysToHalving(now)} ${rt('hari_lagi')}</strong> (~${fmtDateLong(HALVING_DATE)})</p>
    </div>`;
  }

  // ============ Sniper ============
  const DIR_LABEL_WEB = { buy: '🟢 BUY', sell: '🔴 SELL' };
  const STRATEGY_LABEL_WEB = { range: 'Range Trading', breakout: 'Breakout', trend: 'Trend Following' };

  function liquidationPrice(o) {
    if (!o.leverage || !o.entryPrice) return null;
    const distPct = 100 / o.leverage;
    return o.direction === 'buy' ? o.entryPrice * (1 - distPct / 100) : o.entryPrice * (1 + distPct / 100);
  }

  // ASSETS_WEB (22 Agu 2026, upgrade multi-aset) -- mirror manual dari assetConfig.js (Node,
  // gak bisa di-require() di browser) -- JAGA DUA-DUANYA SINKRON kalau ada perubahan.
  // Label = PERSIS simbol Binance (29 Agu 2026, Olan: "kalo di akun binance pasang paxg ya di
  // web paxg juga bukan malah xau, biar ga muter muter kepalaku") -- gak ada nama cantik/
  // terjemahan lagi, SATU nama = ticker asli, sama persis kayak yang keliatan di app Binance.
  const ASSETS_WEB = {
    btc: { symbol: 'BTCUSDT', label: 'BTCUSDT', emoji: '🟧' },
    xau: { symbol: 'PAXGUSDT', label: 'PAXGUSDT', emoji: '🟡' },
  };
  // Mirror TERPISAH khusus Nyopet -- Nyopet BTC pakai wallet USDC (ticker BTCUSDC), BEDA dari
  // Sniper (BTCUSDT) -- pakai ASSETS_WEB biasa bikin kartu Nyopet salah nunjukkin ticker (dan
  // salah poll harga live-nya, sniper-orders-widget.js baca data-symbol dari sini).
  const NYOPET_ASSETS_WEB = {
    btc: { symbol: 'BTCUSDC', label: 'BTCUSDC', emoji: '🟧' },
    xau: { symbol: 'PAXGUSDT', label: 'PAXGUSDT', emoji: '🟡' },
  };
  const MODE_LABEL_WEB = { fvg: 'FVG', sniper: 'Pola Chart' };

  function renderOrderCard(o) {
    const dir = DIR_LABEL_WEB[o.direction] || o.direction;
    const strategy = STRATEGY_LABEL_WEB[o.strategyType] || '';
    const slText = (o.sl !== null && o.sl !== undefined) ? fmtUsdOrder(o.sl) : '-';
    const idLine = o.signalId ? `<div class="order-id">🆔 ${o.signalId}</div>` : '';
    const asset = ASSETS_WEB[o.asset] || ASSETS_WEB.btc;
    const assetBadge = `<span class="order-asset-badge">${asset.emoji} ${asset.label} · ${MODE_LABEL_WEB[o.mode] || 'Pola Chart'}</span>`;
    if (o.status === 'pending') {
      return `<div class="order-card pending">
        ${idLine}
        ${assetBadge}
        <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge pending">${rt('pending')}</span></div>
        <div class="order-strategy">${strategy}</div>
        <div class="order-levels"><span>${rt('trigger')} <strong>${fmtUsdOrder(o.triggerPrice)}</strong></span><span>${rt('tp')} ${fmtUsdOrder(o.tp)}</span><span>${rt('sl')} ${slText}</span></div>
        ${o.confirmationNote ? `<div class="order-note">📋 ${o.confirmationNote}</div>` : ''}
        ${o.leverage ? `<div class="order-meta">${rt('exposure')} ${o.exposure}× · ${rt('leverage')} ${o.leverage}× · ${rt('margin')} ${fmtUsdOrder(o.marginUsd)}</div>` : ''}
      </div>`;
    }
    if (o.status === 'floating') {
      const remFrac = o.remainingFraction !== undefined && o.remainingFraction !== null ? o.remainingFraction : 1;
      const partialBadge = o.partialDone
        ? `<div class="order-partial-note">🟡 ${rt('stage1_secured')} ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)} -- ${rt('sl_rest_be')} ${(remFrac * 100).toFixed(0)}${rt('of_position_trailed')}</div>`
        : '';
      const volumeUsd = (o.marginUsd && o.leverage) ? o.marginUsd * o.leverage : null;
      const liqPrice = liquidationPrice(o);
      const tradeMetaLine = (o.leverage || o.marginUsd)
        ? `<div class="order-meta">${rt('margin')} ${fmtUsdOrder(o.marginUsd)} · ${rt('leverage')} ${o.leverage}× · ${rt('volume')} ${volumeUsd !== null ? fmtUsdOrder(volumeUsd) : '-'}${liqPrice !== null ? ` · ${rt('liquidated')} ${fmtUsdOrder(liqPrice)}` : ''}</div>`
        : '';
      // Demo/Real (29 Agu 2026, permintaan Olan: "tandai mana yang real mana yang demo") --
      // liveExecution.testnet cuma keisi SETELAH localLiveExecutor.js beneran eksekusi; sebelum
      // itu (masih di GitHub Actions, blm sempat dieksekusi lokal) fallback ke label netral.
      const modeBadge = o.liveExecution
        ? (o.liveExecution.testnet ? `<span class="order-mode-badge demo">${rt('demo')}</span>` : `<span class="order-mode-badge real">${rt('real')}</span>`)
        : `<span class="order-mode-badge pending-exec">${rt('not_executed_yet')}</span>`;
      return `<div class="order-card floating" data-order-id="${o.id}" data-symbol="${asset.symbol}" data-direction="${o.direction}" data-entry="${o.entryPrice}" data-tp="${o.tp}" data-sl="${o.sl || ''}" data-leverage="${o.leverage || 1}" data-margin="${o.marginUsd || 0}" data-remaining-fraction="${remFrac}" data-realized-pnl="${o.realizedPnlUsd || 0}" data-opened-at="${o.triggeredAt || ''}">
        ${idLine}
        ${assetBadge}
        <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge floating">${rt('floating')}</span>${modeBadge}</div>
        <div class="order-strategy">${strategy}</div>
        ${o.triggeredAt ? `<div class="order-opened-since">${rt('opened')} ${fmtOpenedDate(o.triggeredAt)} · <span data-duration-target>${rt('calculating')}</span></div>` : ''}
        <div class="order-live-price">${rt('price_now')} ${asset.label} ${rt('now_suffix')} <strong data-price-target>${rt('loading')}</strong></div>
        <div class="order-levels"><span>${rt('entry')} <strong>${fmtUsdOrder(o.entryPrice)}</strong></span><span>${rt('tp')} ${fmtUsdOrder(o.tp)}</span><span>${rt('sl')} ${slText}</span></div>
        ${tradeMetaLine}
        ${partialBadge}
        <div class="order-pnl-live" data-pnl-target>${rt('loading_pnl')}</div>
      </div>`;
    }
    const won = o.status === 'closed_tp';
    const badge = o.status === 'cancelled' ? rt('cancelled') : (won ? '✅ TP' : '❌ SL');
    const pnlLine = (o.pnlUsd !== null && o.pnlUsd !== undefined)
      ? `<div class="order-pnl ${won ? 'up' : 'down'}">${o.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.pnlUsd)} (${o.pnlUsd >= 0 ? '+' : ''}${o.pnlPct.toFixed(2)}%)</div>` : '';
    const partialTimeline = o.partialDone
      ? `<div class="order-partial-timeline">
          <div>🟡 ${rt('stage1_at')} ${fmtUsdOrder(o.partialTp)}${o.partialClosedAt ? ` (${fmtDateLong(new Date(o.partialClosedAt))})` : ''}: ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)}</div>
          <div>🏁 ${rt('stage2_rest_at')} ${fmtUsdOrder(o.exitPrice != null ? o.exitPrice : (won ? o.tp : o.sl))}${o.closedAt ? ` (${fmtDateLong(new Date(o.closedAt))})` : ''}: ${(o.pnlUsd - (o.realizedPnlUsd || 0)) >= 0 ? '+' : ''}${fmtUsdOrder((o.pnlUsd || 0) - (o.realizedPnlUsd || 0))}</div>
        </div>`
      : '';
    return `<div class="order-card closed" data-strategy="${o.strategyType || ''}">
      ${idLine}
      ${assetBadge}
      <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge closed">${badge}</span></div>
      <div class="order-levels"><span>${rt('entry')} ${o.entryPrice ? fmtUsdOrder(o.entryPrice) : '-'}</span><span>${rt('exit')} ${o.status === 'closed_tp' ? fmtUsdOrder(o.tp) : o.status === 'closed_sl' ? slText : '-'}</span></div>
      ${partialTimeline}
      ${pnlLine}
    </div>`;
  }

  // Ringkasan doang buat Home (29 Agu 2026, permintaan Olan: "kartu posisi floating bagusnya
  // semua pindah ke jurnal aja" -- biar gak kepisah 2 halaman/2 tampilan beda). Home cuma nunjukkin
  // JUMLAH posisi aktif + link, kartu detail lengkap (badge arah/mode/countup/P&L live) SEKARANG
  // CUMA ada di Jurnal, satu tempat, satu timeline (floating -> closed).
  function renderSniperOrdersPanel(state, latestStatusEntry) {
    const active = (state.orders || []).filter((o) => o.status === 'floating');
    const summaryLine = active.length > 0
      ? `📡 <strong>${active.length} ${rt('sniper_positions_open')}</strong> -- ${rt('detail_full_at')} <a href="jurnal.html"><strong>${rt('journal')}</strong></a>.`
      : (latestStatusEntry
        ? `${rt('no_open_position_last_analysis')} <a href="jurnal.html"><strong>${rt('journal')}</strong></a>.`
        : rt('no_sniper_analysis'));
    return `<div class="sniper-orders-panel">
      <p class="order-disclaimer">${rt('sniper_disclaimer')}</p>
      <div class="empty">${summaryLine}</div>
    </div>`;
  }

  // Ringkasan doang buat Home (29 Agu 2026) -- sama alasan kayak renderSniperOrdersPanel di atas.
  function renderNyopetHomePanel(nyopetState) {
    const floating = (nyopetState.orders || []).filter((o) => o.status === 'floating');
    const summaryLine = floating.length > 0
      ? `📡 <strong>${floating.length} ${rt('nyopet_positions_open')}</strong> -- ${rt('detail_full_at')} <a href="jurnal.html"><strong>${rt('journal')}</strong></a>.`
      : rt('no_nyopet_open');
    return `<div class="sniper-orders-panel">
      <p class="order-disclaimer">${rt('nyopet_home_disclaimer')}</p>
      <div class="empty">${summaryLine}</div>
    </div>`;
  }

  // ============ Jurnal Sniper: statistik + equity curve + kalender ============
  function computeJournalStats(trades) {
    if (trades.length === 0) return null;
    const wins = trades.filter((o) => o.status === 'closed_tp');
    const losses = trades.filter((o) => o.status === 'closed_sl');
    const winRate = (wins.length / trades.length) * 100;
    const grossWin = wins.reduce((s, o) => s + (o.pnlUsd || 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, o) => s + (o.pnlUsd || 0), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);
    const totalPnl = trades.reduce((s, o) => s + (o.pnlUsd || 0), 0);
    const expectancy = totalPnl / trades.length;
    const rMultiples = trades.filter((o) => o.marginUsd).map((o) => o.pnlUsd / o.marginUsd);
    const avgR = rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null;
    return { count: trades.length, wins: wins.length, losses: losses.length, winRate, profitFactor, totalPnl, expectancy, avgR };
  }

  function renderJournalStatsGrid(stats) {
    const pfText = stats.profitFactor === null ? '∞' : stats.profitFactor.toFixed(2);
    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;
    return `<div class="journal-stats-grid">
      ${cell(rt('total_trade'), stats.count)}
      ${cell(rt('win_rate'), `${stats.winRate.toFixed(0)}%`, stats.winRate >= 50 ? 'up' : 'down')}
      ${cell(rt('profit_factor'), pfText, (stats.profitFactor === null || stats.profitFactor >= 1) ? 'up' : 'down')}
      ${cell(rt('expectancy_trade'), fmtUsdOrder(stats.expectancy), stats.expectancy >= 0 ? 'up' : 'down')}
      ${cell(rt('avg_r'), stats.avgR === null ? '-' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`, (stats.avgR || 0) >= 0 ? 'up' : 'down')}
      ${cell(rt('total_pnl'), `${stats.totalPnl >= 0 ? '+' : ''}${fmtUsdOrder(stats.totalPnl)}`, stats.totalPnl >= 0 ? 'up' : 'down')}
    </div>`;
  }

  function renderEquityCurveSvg(trades) {
    if (trades.length < 2) return `<div class="empty">${rt('need_2_trades_equity')}</div>`;
    const chronological = trades.slice().reverse();
    let cum = 0;
    const points = [0].concat(chronological.map((o) => (cum += (o.pnlUsd || 0))));
    const w = 600, h = 160, pad = 10;
    const min = Math.min.apply(null, points), max = Math.max.apply(null, points);
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

  const DOW_ID = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];
  const DOW_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  function dowNames() { return lang() === 'en' ? DOW_EN : DOW_ID; }

  function renderPnlCalendar(trades, now) {
    const monthKey = localDateKey(now).slice(0, 7);
    const daily = {};
    trades.forEach((o) => {
      if (!o.closedAt) return;
      const key = localDateKey(new Date(o.closedAt));
      if (key.slice(0, 7) !== monthKey) return;
      daily[key] = (daily[key] || 0) + (o.pnlUsd || 0);
    });
    const parts = monthKey.split('-').map(Number);
    const y = parts[0], m = parts[1];
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
      <div class="cal-header">${bulanNames()[m - 1]} ${y} <span class="${monthPnl >= 0 ? 'up' : 'down'}">${monthPnl >= 0 ? '+' : ''}${fmtUsdOrder(monthPnl)}</span></div>
      <div class="cal-grid">${dowNames().map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>
    </div>`;
  }

  function renderFundEquitySvg(events) {
    if (events.length < 2) return `<div class="empty">${rt('bankroll_new')}</div>`;
    const w = 600, h = 160, pad = 10;
    const values = events.map((e) => e.balanceAfter);
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const range = (max - min) || 1;
    const stepX = (w - pad * 2) / (values.length - 1);
    const coords = values.map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
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

  // getFundReport client-side (port dari kaelaBankroll.js getFundReport, ambil bankrollState mentah)
  // isDemoMode (22 Agu 2026, permintaan Olan) -- START_BALANCE gak lagi HARDCODE $100 di sini
  // (itu penyebab bug: begitu Node-side kaelaBankroll.js START_BALANCE diganti, sisi web ini
  // ketinggalan, hasilnya "Total Disetor" $100 dibandingin ke saldo Binance Demo $18rban =
  // Return % keliatan puluhan ribu persen, menyesatkan). START_BALANCE sekarang dihitung MUNDUR
  // dari balance sekarang minus semua topup+pnl yang tercatat -- selalu konsisten sama data asli,
  // gak pernah nge-drift dari sumber kebenaran (kaela-bankroll.json).
  function computeFundReport(bankrollState, opts = {}) {
    const totalTopUp = bankrollState.topUpHistory.reduce((s, t) => s + t.amount, 0);
    const totalRealizedPnl = bankrollState.pnlHistory.reduce((s, p) => s + p.pnlUsd, 0);
    const startBalance = bankrollState.balance - totalTopUp - totalRealizedPnl;
    const totalContributed = startBalance + totalTopUp;
    const returnOnContributedPct = totalContributed > 0 ? (totalRealizedPnl / totalContributed) * 100 : 0;
    const events = [
      { date: bankrollState.startedAt || new Date().toISOString(), type: 'start', balanceAfter: startBalance },
    ].concat(
      bankrollState.topUpHistory.map((t) => Object.assign({}, t, { type: 'topup' })),
      bankrollState.pnlHistory.map((p) => Object.assign({}, p, { type: 'pnl' })),
    ).sort((a, b) => new Date(a.date) - new Date(b.date));
    return {
      balance: bankrollState.balance,
      startedAt: bankrollState.startedAt,
      startBalance,
      totalContributed,
      totalRealizedPnl,
      returnOnContributedPct,
      tradeCount: bankrollState.pnlHistory.length,
      events,
      isDemoMode: opts.isDemoMode !== false,
    };
  }

  // isDemoMode (22 Agu 2026) -- selama akun masih Binance Demo, saldo itu duit virtual dari
  // faucet, BUKAN setoran beneran. Tampilin "Total Disetor"/"Return%" di sini bakal menyesatkan
  // (itu persis bug yang dilaporin Olan: "$100 disetor" vs saldo demo $18rban = ribuan persen).
  // Jadi selama demo, cuma tampilin angka polos dolar -- Saldo + P&L trading. Framing fund-manager
  // lengkap (Total Disetor/Return%) balik lagi otomatis begitu isDemoMode false (udah uang asli).
  function renderFundReportSection(report) {
    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;

    if (report.isDemoMode) {
      return `<div class="fund-report-section">
        <div class="journal-section-title">${rt('bankroll_demo_title')}</div>
        <p class="order-disclaimer" style="margin-top:0;">${rt('bankroll_demo_disclaimer')}</p>
        <div class="journal-stats-grid">
          ${cell(rt('balance_now_demo'), fmtUsdOrder(report.balance))}
          ${cell(rt('pnl_trading_pure'), `${report.totalRealizedPnl >= 0 ? '+' : ''}${fmtUsdOrder(report.totalRealizedPnl)}`, report.totalRealizedPnl >= 0 ? 'up' : 'down')}
          ${cell(rt('trade_count'), report.tradeCount)}
        </div>
      </div>`;
    }

    const totalGrowthUsd = report.balance - report.totalContributed;
    const totalGrowthPct = report.totalContributed > 0 ? (totalGrowthUsd / report.totalContributed) * 100 : 0;
    return `<div class="fund-report-section">
      <div class="journal-section-title">${rt('fund_report_title')}</div>
      <p class="order-disclaimer" style="margin-top:0;">${rt('fund_report_disclaimer')}</p>
      <div class="journal-stats-grid">
        ${cell(rt('balance_now'), fmtUsdOrder(report.balance))}
        ${cell(rt('total_deposited'), fmtUsdOrder(report.totalContributed))}
        ${cell(rt('pnl_trading_pure'), `${report.totalRealizedPnl >= 0 ? '+' : ''}${fmtUsdOrder(report.totalRealizedPnl)}`, report.totalRealizedPnl >= 0 ? 'up' : 'down')}
        ${cell(rt('return_from_trading'), `${report.returnOnContributedPct >= 0 ? '+' : ''}${report.returnOnContributedPct.toFixed(1)}%`, report.returnOnContributedPct >= 0 ? 'up' : 'down')}
        ${cell(rt('total_growth_combined'), `${totalGrowthPct >= 0 ? '+' : ''}${totalGrowthPct.toFixed(1)}%`, totalGrowthPct >= 0 ? 'up' : 'down')}
        ${cell(rt('trade_count'), report.tradeCount)}
      </div>
      <div class="journal-section-title">${rt('equity_curve_bankroll')}${report.startedAt ? ' (' + rt('started') + ' ' + fmtDateLong(new Date(report.startedAt)) + ')' : ''}</div>
      ${renderFundEquitySvg(report.events)}
      <p class="order-disclaimer">${rt('topup_marker_note')}</p>
    </div>`;
  }

  function renderJurnalPanel(state, now, fundReport) {
    // Kartu posisi FLOATING (29 Agu 2026, permintaan Olan: "kartu posisi floating semua pindah
    // ke jurnal aja" -- gak lagi kepisah Home/Jurnal, satu timeline utuh floating->closed di sini).
    const active = (state.orders || []).filter((o) => o.status === 'floating');
    const floatingHtml = active.length > 0
      ? `<div class="journal-section-title">${rt('positions_open')} (${active.length})</div><div class="order-grid">${active.map(renderOrderCard).join('')}</div>`
      : '';

    const closedAll = (state.orders || []).filter((o) => o.status.indexOf('closed') === 0 || o.status === 'cancelled').slice().reverse();
    const trades = closedAll.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl');
    const stats = computeJournalStats(trades);
    const fundHtml = fundReport ? renderFundReportSection(fundReport) : '';

    if (!stats) {
      return `<div class="jurnal-panel">
        ${fundHtml}
        ${floatingHtml}
        <div class="empty">${rt('no_trade_done_sniper')}</div>
      </div>`;
    }

    const strategies = Array.from(new Set(closedAll.map((o) => o.strategyType).filter(Boolean)));
    const filterHtml = strategies.length > 1
      ? `<div class="strategy-filter">
          <button class="strategy-filter-btn active" data-strategy="all">${rt('strategy_all')}</button>
          ${strategies.map((s) => `<button class="strategy-filter-btn" data-strategy="${s}">${STRATEGY_LABEL_WEB[s] || s}</button>`).join('')}
        </div>`
      : '';

    // Statistik ringkasan (Win Rate/Profit Factor/dll) baru ditampilin kalau minimal 2 trade
    // (29 Agu 2026, konsisten sama syarat Equity Curve yang emang udah nolak render di bawah 2
    // titik) -- n=1 bikin angka kayak "Win Rate 100%"/"Profit Factor 0.00" MENYESATKAN (keliatan
    // definitif padahal cuma 1 sampel). Riwayat Trade tetap SELALU ditampilin (trade tunggal itu
    // tetap valid buat dilihat), cuma bungkus statistik+equity+kalender yang ditahan dulu.
    const summaryHtml = trades.length < 2
      ? `<div class="empty">📓 ${rt('new_trades_done')} ${trades.length} ${rt('trades_done')} ${rt('summary_held_back')}</div>`
      : `${renderJournalStatsGrid(stats)}
      <div class="journal-section-title">${rt('equity_curve_pertrade')}</div>
      ${renderEquityCurveSvg(trades)}
      <div class="journal-section-title">${rt('pnl_calendar_month')}</div>
      ${renderPnlCalendar(trades, now)}`;

    return `<div class="jurnal-panel">
      ${fundHtml}
      ${floatingHtml}
      ${summaryHtml}
      <div class="journal-section-title">${rt('trade_history')} (${closedAll.length})</div>
      ${filterHtml}
      <div class="order-grid" id="jurnal-trade-grid">${closedAll.map(renderOrderCard).join('')}</div>
    </div>`;
  }

  function wireStrategyFilter() {
    document.querySelectorAll('.strategy-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.strategy-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const s = btn.dataset.strategy;
        document.querySelectorAll('#jurnal-trade-grid .order-card').forEach(function (card) {
          card.style.display = (s === 'all' || card.dataset.strategy === s) ? '' : 'none';
        });
      });
    });
  }

  // ============ Spot (DCA Musiman) ============
  function renderSpotJurnalPanel(spotState, now) {
    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;
    const sellDate = spotSellTriggerDate();
    const en = lang() === 'en';
    let badgeClass, badgeText, phaseNote;
    if (spotState.btcHeld > 0) {
      if (now < HALVING_DATE) {
        badgeClass = 'phase-tanam';
        badgeText = rt('phase_tanam_dca');
        phaseNote = en
          ? `Buying $${SPOT_DAILY_BUY_USD} of BTC every day until halving arrives (~${fmtDateLong(HALVING_DATE)}).`
          : `Beli $${SPOT_DAILY_BUY_USD} BTC tiap hari sampai halving tiba (~${fmtDateLong(HALVING_DATE)}).`;
      } else {
        badgeClass = 'phase-panen';
        badgeText = rt('phase_hold_wait_harvest');
        phaseNote = en
          ? `Halving has passed, DCA stopped. All BTC will auto-sell around ${fmtDateLong(sellDate)}.`
          : `Halving udah lewat, DCA berhenti. Jual otomatis semua BTC sekitar ${fmtDateLong(sellDate)}.`;
      }
    } else if (now >= WINDOW_START && now < HALVING_DATE) {
      badgeClass = 'phase-tanam';
      badgeText = rt('phase_window_dca_running');
      phaseNote = en
        ? `DCA $${SPOT_DAILY_BUY_USD}/day is running (position not yet reflected in the latest data, waiting for the next daily tick).`
        : `DCA $${SPOT_DAILY_BUY_USD}/hari lagi berjalan (posisi belum keupdate di data terakhir, nunggu tick harian berikutnya).`;
    } else {
      badgeClass = 'phase-tunai';
      badgeText = rt('phase_cash_waiting');
      phaseNote = en
        ? `DCA starts automatically once the Planting Season window arrives (${fmtDateLong(WINDOW_START)}), running until halving (~${fmtDateLong(HALVING_DATE)}).`
        : `DCA mulai otomatis begitu window Musim Tanam tiba (${fmtDateLong(WINDOW_START)}), jalan sampai halving (~${fmtDateLong(HALVING_DATE)}).`;
    }

    const avgCost = spotState.btcHeld > 0 ? spotState.totalInvestedCurrentCycle / spotState.btcHeld : null;

    const summaryHtml = `<div class="spot-summary-grid">
      ${cell(rt('btc_held'), spotState.btcHeld > 0 ? spotState.btcHeld.toFixed(8) + ' BTC' : '0 BTC')}
      ${cell(rt('capital_this_cycle'), fmtUsdOrder(spotState.totalInvestedCurrentCycle))}
      ${cell(rt('avg_cost'), avgCost !== null ? fmtUsdOrder(avgCost) : '-')}
      ${cell(rt('realized_balance'), fmtUsdOrder(spotState.totalRealizedCash))}
      ${cell(rt('cycles_completed'), spotState.completedCycles.length)}
    </div>`;

    // Countup "udah jalan berapa lama" (29 Agu 2026, permintaan Olan: "cara jurnal di nyopet.. itu
    // tiru buat semua") -- DCA gak punya TP/SL/liq kayak Sniper/Nyopet, tapi konsep "dibuka sejak
    // + durasi live" tetap relevan (siklus Tanam ini udah jalan berapa lama). Reuse data-opened-at
    // + tickDurations() yang UDAH ADA di sniper-orders-widget.js (query GLOBAL, otomatis kepakai).
    const startedSince = spotState.cycleStartedAt
      ? `<div class="order-opened-since">${rt('cycle_started')} ${fmtOpenedDate(spotState.cycleStartedAt)} · <span data-duration-target>${rt('calculating')}</span></div>`
      : '';
    const liveValueHtml = spotState.btcHeld > 0
      ? `<div data-opened-at="${spotState.cycleStartedAt || ''}" data-spot-btc-held="${spotState.btcHeld}" data-spot-invested="${spotState.totalInvestedCurrentCycle}">
          ${startedSince}
          <div class="order-live-price">${rt('value_now')} <strong data-spot-value-target>${rt('loading')}</strong></div>
          <div class="order-pnl-live" data-spot-pnl-target>${rt('calculating_live_pnl')}</div>
        </div>`
      : '';

    const buyLogHtml = spotState.buyLog.length > 0
      ? `<div class="spot-buy-log"><table>
          <thead><tr><th>${rt('date')}</th><th>${rt('btc_price')}</th><th>${rt('btc_received')}</th></tr></thead>
          <tbody>${spotState.buyLog.slice().reverse().map((b) => `<tr><td>${fmtDateLong(new Date(b.date))}</td><td>${fmtUsdOrder(b.price)}</td><td>${b.btcBought.toFixed(8)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : `<div class="empty">${rt('no_buys_this_cycle')}</div>`;

    const cyclesHtml = spotState.completedCycles.length > 0
      ? `<table class="spot-cycle-table">
          <thead><tr><th>${rt('buy_start')}</th><th>${rt('sold')}</th><th>${rt('capital')}</th><th>${rt('sale_proceeds')}</th><th>P&amp;L</th></tr></thead>
          <tbody>${spotState.completedCycles.slice().reverse().map((c) => `<tr>
            <td>${c.buyWindowStart ? fmtDateLong(new Date(c.buyWindowStart)) : '-'}</td>
            <td>${fmtDateLong(new Date(c.soldAt))}</td>
            <td>${fmtUsdOrder(c.totalInvested)}</td>
            <td>${fmtUsdOrder(c.proceedsUsd)}</td>
            <td class="${c.pnlUsd >= 0 ? 'up' : 'down'}">${c.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(c.pnlUsd)} (${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%)</td>
          </tr>`).join('')}</tbody>
        </table>`
      : '';

    const spotDisclaimer = rt('spot_demo_disclaimer').replace('$AMT', String(SPOT_DAILY_BUY_USD));
    return `<div class="spot-panel">
      <div class="phase-badge ${badgeClass}">${badgeText}</div>
      <p class="halving-note" style="margin-top:0;">${phaseNote}</p>
      <p class="order-disclaimer">🧪 <strong>${rt('demo')}</strong> -- ${spotDisclaimer}</p>
      ${summaryHtml}
      ${liveValueHtml}
      <div class="journal-section-title">${rt('purchase_journal_cycle')}</div>
      ${buyLogHtml}
      ${spotState.completedCycles.length > 0 ? `<div class="journal-section-title">${rt('completed_cycle_history')}</div>${cyclesHtml}` : ''}
    </div>`;
  }

  // ============ Compound Alt DCA (10 dompet, 25 Agu 2026) ============
  // Olan: "buat 10 dompet kaela itu biar aku dan temen-temen tiru.. tiap dompet bakal keisi berapa
  // dan tiap dompet bisa diklik history DCA". Tiap koin PUNYA dompet SENDIRI (independen, gak
  // dipool -- lihat spotDcaAltShared.js) -- kartu grid, klik toggle buka riwayat beli+siklus per koin.
  function coinLabelAlt(symbol) { return symbol.replace('USDT', ''); }

  function renderWalletCard(symbol, coinState) {
    const label = coinLabelAlt(symbol);
    const held = coinState.heldQty > 0;
    const valueLabel = held ? `${coinState.heldQty.toFixed(6)} ${label}` : (coinState.totalRealizedCash > 0 ? fmtUsdOrder(coinState.totalRealizedCash) : '$0');
    const subLabel = held ? `${rt('capital')}: ${fmtUsdOrder(coinState.totalInvestedCurrentCycle)}` : (coinState.totalRealizedCash > 0 ? rt('wait_next_tanam_allin') : rt('not_started'));
    // Countup durasi (29 Agu 2026, "cara jurnal di nyopet.. itu tiru buat semua") -- dompet ini
    // udah nyicil berapa lama, sama konsep kayak "Dibuka sejak" Sniper/Nyopet.
    const startedSince = held && coinState.cycleStartedAt
      ? `<div class="wallet-sub" data-opened-at="${coinState.cycleStartedAt}">🕐 <span data-duration-target>${rt('calculating')}</span></div>`
      : '';
    return `<div class="wallet-card" id="wallet-card-${symbol}" onclick="KaelaRender.toggleWalletDetail('${symbol}')">
      <div class="wallet-coin">${label}</div>
      <div class="wallet-value" data-wallet-qty="${coinState.heldQty}" data-wallet-symbol="${symbol}USDT">${valueLabel}</div>
      <div class="wallet-sub">${subLabel}</div>
      ${startedSince}
    </div>`;
  }

  function renderWalletDetail(symbol, coinState) {
    const label = coinLabelAlt(symbol);
    const buyLogHtml = coinState.buyLog.length > 0
      ? `<div class="spot-buy-log"><table>
          <thead><tr><th>${rt('date')}</th><th>${rt('amount')}</th><th>${rt('price')}</th><th>${rt('qty')}</th></tr></thead>
          <tbody>${coinState.buyLog.slice().reverse().map((b) => `<tr><td>${fmtDateLong(new Date(b.date))}</td><td>${fmtUsdOrder(b.usdAmount)}</td><td>${fmtUsdOrder(b.price)}</td><td>${b.qty.toFixed(6)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : `<div class="empty">${rt('no_buys_of')} ${label} ${rt('in_this_cycle')}</div>`;
    const cyclesHtml = coinState.completedCycles.length > 0
      ? `<table class="spot-cycle-table">
          <thead><tr><th>${rt('buy_start')}</th><th>${rt('sold')}</th><th>${rt('capital')}</th><th>${rt('sale_proceeds')}</th><th>P&amp;L</th></tr></thead>
          <tbody>${coinState.completedCycles.slice().reverse().map((c) => `<tr>
            <td>${c.buyWindowStart ? fmtDateLong(new Date(c.buyWindowStart)) : '-'}</td>
            <td>${fmtDateLong(new Date(c.soldAt))}</td>
            <td>${fmtUsdOrder(c.totalInvested)}</td>
            <td>${fmtUsdOrder(c.proceedsUsd)}</td>
            <td class="${c.pnlUsd >= 0 ? 'up' : 'down'}">${c.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(c.pnlUsd)} (${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%)</td>
          </tr>`).join('')}</tbody>
        </table>`
      : '';
    return `<div class="wallet-detail" id="wallet-detail-${symbol}">
      <div class="journal-section-title">${rt('wallet_purchase_journal')} ${label} — ${rt('purchase_journal')}</div>
      ${buyLogHtml}
      ${coinState.completedCycles.length > 0 ? `<div class="journal-section-title">${rt('wallet_cycle_history')} ${label} — ${rt('cycle_history')}</div>${cyclesHtml}` : ''}
    </div>`;
  }

  function renderSpotAltJurnalPanel(altState, now) {
    const sellDate = altSellTriggerDate();
    const en = lang() === 'en';
    let badgeClass, badgeText, phaseNote;
    const anyHeld = ALT10_SYMBOLS.some((s) => altState.coins[s] && altState.coins[s].heldQty > 0);
    if (anyHeld) {
      if (now < HALVING_DATE) {
        badgeClass = 'phase-tanam';
        badgeText = rt('phase_tanam_dca');
        phaseNote = en
          ? `Buying $${PER_COIN_USD}/coin (10 coins) every 5th of the month until halving arrives (~${fmtDateLong(HALVING_DATE)}).`
          : `Beli $${PER_COIN_USD}/koin (10 koin) tiap tanggal 5 sampai halving tiba (~${fmtDateLong(HALVING_DATE)}).`;
      } else {
        badgeClass = 'phase-panen';
        badgeText = rt('phase_hold_wait_harvest');
        phaseNote = en
          ? `Halving has passed, DCA stopped. All coins will auto-sell around ${fmtDateLong(sellDate)} (historical average cycle peak day).`
          : `Halving udah lewat, DCA berhenti. Jual otomatis semua koin sekitar ${fmtDateLong(sellDate)} (rata-rata historis hari puncak siklus).`;
      }
    } else if (now >= WINDOW_START && now < HALVING_DATE) {
      badgeClass = 'phase-tanam';
      badgeText = rt('phase_window_dca_running');
      phaseNote = en
        ? `DCA $${PER_COIN_USD}/coin every 5th is running (position not yet reflected in latest data, waiting for the next tick).`
        : `DCA $${PER_COIN_USD}/koin tiap tanggal 5 lagi berjalan (posisi belum keupdate di data terakhir, nunggu tick berikutnya).`;
    } else {
      badgeClass = 'phase-tunai';
      badgeText = rt('phase_cash_waiting');
      phaseNote = en
        ? `DCA starts automatically once the Planting Season window arrives (${fmtDateLong(WINDOW_START)}), on the 5th of every month until halving (~${fmtDateLong(HALVING_DATE)}).`
        : `DCA mulai otomatis begitu window Musim Tanam tiba (${fmtDateLong(WINDOW_START)}), tanggal 5 tiap bulan sampai halving (~${fmtDateLong(HALVING_DATE)}).`;
    }

    const totalInvested = ALT10_SYMBOLS.reduce((sum, s) => sum + ((altState.coins[s] && altState.coins[s].totalInvestedCurrentCycle) || 0), 0);
    const totalRealized = ALT10_SYMBOLS.reduce((sum, s) => sum + ((altState.coins[s] && altState.coins[s].totalRealizedCash) || 0), 0);
    const totalCyclesDone = ALT10_SYMBOLS.reduce((sum, s) => sum + ((altState.coins[s] && altState.coins[s].completedCycles.length) || 0), 0);

    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;
    const summaryHtml = `<div class="spot-summary-grid">
      ${cell(rt('capital_this_cycle_10coin'), fmtUsdOrder(totalInvested))}
      ${cell(rt('realized_balance_waiting'), fmtUsdOrder(totalRealized))}
      ${cell(rt('total_cycles_lots'), totalCyclesDone)}
    </div>`;

    const walletCardsHtml = ALT10_SYMBOLS.map((s) => renderWalletCard(s, altState.coins[s] || { heldQty: 0, totalInvestedCurrentCycle: 0, totalRealizedCash: 0, buyLog: [], completedCycles: [] })).join('');
    const walletDetailsHtml = ALT10_SYMBOLS.map((s) => renderWalletDetail(s, altState.coins[s] || { heldQty: 0, totalInvestedCurrentCycle: 0, totalRealizedCash: 0, buyLog: [], completedCycles: [] })).join('');

    const altDisclaimer = en
      ? `Compound Alt DCA $${PER_COIN_USD}/coin/month (10 coins, $${PER_COIN_USD * 10}/month total) is now executed AUTOMATICALLY on a Binance Demo account (Spot Testnet, virtual money), fully separate from the Sniper/Nyopet/Spot BTC bankroll. Kaela reports each action (buy/stop/sell) to the WA group so it can be followed manually. Starting October 19, 2026.`
      : `Compound Alt DCA $${PER_COIN_USD}/koin/bulan (10 koin, total $${PER_COIN_USD * 10}/bulan) sekarang dieksekusi OTOMATIS di akun Binance Demo (Spot Testnet, duit virtual), terpisah total dari bankroll Sniper/Nyopet/Spot BTC. Kaela info tiap aksi (beli/stop/jual) ke grup WA biar bisa diikutin manual. Mulai 19 Oktober 2026.`;
    return `<div class="spot-panel">
      <div class="phase-badge ${badgeClass}">${badgeText}</div>
      <p class="halving-note" style="margin-top:0;">${phaseNote}</p>
      <p class="order-disclaimer">🧪 <strong>${rt('demo')}</strong> -- ${altDisclaimer}</p>
      ${summaryHtml}
      <div class="journal-section-title">${rt('wallets_10_click')}</div>
      <div class="wallet-grid">${walletCardsHtml}${walletDetailsHtml}</div>
    </div>`;
  }

  // ============ Nyopet Market (Dark Kaela, posisi REAL) ============
  // 16 Agu 2026, permintaan Olan: "trading jujur kita nyopet market.. buat jurnal jujur..
  // tracking winrate 100 trade ke depan" -- BEDA dari Spot/Sniper (bankroll bayangan): posisi
  // Nyopet REAL, dibuka manual di exchange asli, saldo/bankroll SENGAJA gak dihitung ("cuma
  // mini game") -- yang ditrack cuma menang/kalah per trade jadi win rate.
  const NYOPET_MODE_LABEL_WEB = { fade: 'Fade (asumsi mantul)', follow: 'Follow (ikutin tembusan)' };

  // Skema disamain 100% sama sniper-orders.json 23 Agu 2026 (permintaan Olan: "nyopet ga dibatasi
  // 100 trade.. 100% sama kayak sniper pencatatanya") -- {balance, orders[]}, tiap order punya
  // `status` (floating/closed_tp/closed_sl) + `direction` (buy/sell), BUKAN openPosition+trades[]
  // terpisah kayak versi lama. Kartu posisi REUSE kontrak class/data-attribute `order-card
  // floating` Sniper -- sniper-orders-widget.js (query GLOBAL, gak di-scope ke 1 container)
  // otomatis nyalain live price+PNL di kartu ini juga tanpa widget baru.
  function renderNyopetOrderCard(o) {
    const dirLabel = o.direction === 'sell' ? rt('short') : rt('long');
    const modeLabel = NYOPET_MODE_LABEL_WEB[o.mode] || o.mode;
    // BUG KETEMU 25 Agu 2026 (Olan: "Nyawa: $NaN") -- order Nyopet gak punya field `sl` sama
    // sekali (skema-nya pakai `liqPrice`, beda dari sniper-orders.json yang emang punya `sl`),
    // jadi `fmtUsdOrder(o.sl)` SELALU NaN buat kartu Nyopet. Fix: baca `liqPrice` (field yang
    // BENERAN ada), fallback ke `sl` doang buat jaga-jaga skema lama, guard null/undefined kayak
    // pola aman yang UDAH ADA di renderOrderCard (Sniper) baris ~185.
    const nyawaVal = o.liqPrice != null ? o.liqPrice : o.sl;
    const nyawaText = nyawaVal != null ? fmtUsdOrder(nyawaVal) : '-';
    // Label harga hidup asset-aware (25 Agu 2026) -- sebelumnya hardcode "Harga BTC sekarang"
    // padahal Nyopet udah multi-aset (BTC+PAXG/XAU), salah buat posisi XAU.
    const assetInfo = NYOPET_ASSETS_WEB[o.asset] || NYOPET_ASSETS_WEB.btc;
    if (o.status === 'floating') {
      // Badge (Demo)/(Real) (29 Agu 2026, bug ketemu: dulu hardcode "(Demo)" -- gak masalah
      // selama Nyopet publik SELALU Demo, tapi kartu ini SEKARANG dipakai bareng Kaela Access
      // buat posisi Real member juga (renderNyopetOrderCard dipanggil langsung dari sana, "kenapa
      // ga copy 100%"), jadi WAJIB dinamis. Default Demo kalau liveExecution gak diisi (publik).
      const floatingModeLabel = o.liveExecution && o.liveExecution.testnet === false ? rt('real') : rt('demo');
      return `<div class="order-card floating" data-order-id="${o.id}" data-symbol="${assetInfo.symbol}" data-direction="${o.direction}" data-entry="${o.entryPrice}" data-tp="${o.tp}" data-sl="${nyawaVal != null ? nyawaVal : ''}" data-leverage="${o.leverage}" data-margin="${o.marginUsd}" data-opened-at="${o.triggeredAt || ''}">
          <div class="order-header">
            <span class="order-dir">${dirLabel}</span>
            <span class="order-status-badge floating">${rt('floating')} (${floatingModeLabel})</span>
          </div>
          <div class="order-strategy">🥷 Nyopet -- ${modeLabel}</div>
          ${o.triggeredAt ? `<div class="order-opened-since">${rt('opened')} ${fmtOpenedDate(o.triggeredAt)} · <span data-duration-target>${rt('calculating')}</span></div>` : ''}
          <div class="order-live-price">${rt('price_now')} ${assetInfo.label} ${rt('now_suffix')} <strong data-price-target>${rt('loading')}</strong></div>
          <div class="order-levels">
            <span>${rt('entry')} <strong>${fmtUsdOrder(o.entryPrice)}</strong></span>
            <span>${rt('tp')} ${fmtUsdOrder(o.tp)}</span>
            <span>${rt('nyawa')} ${nyawaText}</span>
          </div>
          <div class="order-meta">${rt('leverage')} ${o.leverage}x · ${rt('margin')} ${fmtUsdOrder(o.marginUsd)} · ${rt('zona')} ${fmtUsdOrder(o.zonePrice)}</div>
          <div class="order-pnl-live" data-pnl-target>${rt('loading_pnl')}</div>
        </div>`;
    }
    const won = o.status === 'closed_tp';
    return `<div class="order-card closed">
        <div class="order-header">
          <span class="order-dir">${dirLabel}</span>
          <span class="order-status-badge closed">${won ? rt('target_hit') : rt('nyawa_hit')}</span>
        </div>
        <div class="order-strategy">🥷 Nyopet -- ${modeLabel}</div>
        <div class="order-levels"><span>${rt('entry')} ${fmtUsdOrder(o.entryPrice)}</span><span>${rt('exit')} ${fmtUsdOrder(o.exitPrice)}</span></div>
        <div class="order-pnl ${won ? 'up' : 'down'}">${o.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.pnlUsd)} (${o.pnlUsd >= 0 ? '+' : ''}${(o.pnlPct || 0).toFixed(1)}%)</div>
      </div>`;
  }

  // Diseragamkan sama renderJurnalPanel Sniper (23 Agu 2026, permintaan Olan: "samain jurnal
  // sniper dan nyopet") -- reuse LANGSUNG computeJournalStats/renderJournalStatsGrid/
  // renderEquityCurveSvg/renderPnlCalendar Sniper, aman dipakai karena skema data udah 100% sama
  // (status/pnlUsd/marginUsd/closedAt). Posisi FLOATING SEKARANG DITAMPILIN di sini (29 Agu 2026,
  // dicabut dari Home -- "kartu posisi floating semua pindah ke jurnal aja"), satu timeline utuh.
  // `opts` (30 Agu 2026, OPSIONAL -- default undefined jaga behavior lama 100% sama buat caller
  // lama yang gak kirim, spt jurnal-load.js/demo publik) -- dibutuhin krn kaela-multi-akun
  // dashboard.html manggil fungsi ini juga buat kartu REAL member (bukan cuma demo publik Olan
  // sendiri), dan pasca migrasi Emas ke MEXC label+sumber saldo wallet-2 BEDA per mode/exchange
  // (Demo tetap Binance PAXGUSDT, Real sekarang MEXC PAXG_USDC) -- lihat memori
  // project-kaela-multi-exchange. opts: { wallet1Label, wallet1Value, wallet2Label, wallet2Value,
  // disclaimer, disclaimerFull }.
  function renderNyopetJurnalPanel(nyopetState, now, opts) {
    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;
    const orders = nyopetState.orders || [];
    const floating = orders.filter((o) => o.status === 'floating');
    const floatingHtml = floating.length > 0
      ? `<div class="journal-section-title">${rt('positions_open')} (${floating.length})</div><div class="order-grid">${floating.map(renderNyopetOrderCard).join('')}</div>`
      : '';
    const closed = orders.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl').slice().reverse();
    const stats = computeJournalStats(closed);

    // 2 wallet terpisah (29 Agu 2026, fix bug saldo stale -- lihat nyopetAutoTrader.js
    // syncBalances) -- BTCUSDC buat posisi BTC, PAXGUSDT buat posisi PAXG, JANGAN digabung 1
    // angka lagi (dulu ketuker/nimpa satu sama lain tergantung aset mana yang terakhir buka posisi).
    const en = lang() === 'en';
    const wallet1Label = (opts && opts.wallet1Label) || (en ? 'Demo Balance BTCUSDC' : 'Saldo Demo BTCUSDC');
    const wallet1Value = (opts && opts.wallet1Value !== undefined) ? opts.wallet1Value : (nyopetState.balanceUsdc || 0);
    const wallet2Label = (opts && opts.wallet2Label) || (en ? 'Demo Balance PAXGUSDT' : 'Saldo Demo PAXGUSDT');
    const wallet2Value = (opts && opts.wallet2Value !== undefined) ? opts.wallet2Value : (nyopetState.balanceUsdt || 0);
    const saldoCell = cell(wallet1Label, fmtUsdOrder(wallet1Value)) + cell(wallet2Label, fmtUsdOrder(wallet2Value));
    const disclaimer = (opts && opts.disclaimer) || (en
      ? '🥷 Nyopet Market -- automatic ping-pong between 2 liquidity zones on Binance Demo. PURE zone trigger (no R:R target), flat 2% stop per position.'
      : '🥷 Nyopet Market -- ping-pong otomatis antar 2 zona likuiditas di Binance Demo. Trigger MURNI zona (gak pakai target R:R), nyawa 2% flat tiap posisi.');

    if (!stats) {
      return `<div class="nyopet-panel">
        <p class="order-disclaimer">${disclaimer}</p>
        <div class="journal-stats-grid">${saldoCell}</div>
        ${floatingHtml}
        <div class="empty">${rt('no_trade_done_nyopet')}</div>
      </div>`;
    }

    const historyHtml = closed.length > 0
      ? `<table class="spot-cycle-table">
          <thead><tr><th>${rt('asset')}</th><th>${rt('direction')}</th><th>${rt('mode')}</th><th>${rt('entry').replace(':', '')}</th><th>${rt('exit').replace(':', '')}</th><th>${rt('result')}</th><th>PNL</th><th>${rt('date')}</th></tr></thead>
          <tbody>${closed.map((o) => `<tr>
            <td>${NYOPET_ASSETS_WEB[o.asset] ? NYOPET_ASSETS_WEB[o.asset].emoji + ' ' + NYOPET_ASSETS_WEB[o.asset].label : '🟧 BTCUSDC'}</td>
            <td>${o.direction === 'sell' ? rt('short') : rt('long')}</td>
            <td>${NYOPET_MODE_LABEL_WEB[o.mode] || o.mode}</td>
            <td>${fmtUsdOrder(o.entryPrice)}</td>
            <td>${fmtUsdOrder(o.exitPrice)}</td>
            <td class="${o.status === 'closed_tp' ? 'up' : 'down'}">${o.status === 'closed_tp' ? rt('win') : rt('lose')}</td>
            <td class="${(o.pnlUsd || 0) >= 0 ? 'up' : 'down'}">${fmtSignedUsd(o.pnlUsd || 0)}</td>
            <td>${fmtDateLong(new Date(o.closedAt))}</td>
          </tr>`).join('')}</tbody>
        </table>`
      : `<div class="empty">${rt('no_trade_done_short')}</div>`;

    // Sama kayak fix renderJurnalPanel Sniper (29 Agu 2026) -- statistik ringkasan ditahan dulu
    // di bawah 2 trade, biar Win Rate/Profit Factor gak keliatan definitif dari 1 sampel doang.
    const nyopetSummaryHtml = closed.length < 2
      ? `<div class="empty">📓 ${rt('new_trades_done')} ${closed.length} ${rt('trades_done')} ${rt('summary_held_back')}</div>`
      : `${renderJournalStatsGrid(stats)}
      <div class="journal-section-title">${rt('equity_curve_pertrade')}</div>
      ${renderEquityCurveSvg(closed)}
      <div class="journal-section-title">${rt('pnl_calendar_month')}</div>
      ${renderPnlCalendar(closed, now)}`;

    const disclaimerFull = (opts && opts.disclaimerFull) || (en
      ? '🥷 Nyopet Market -- automatic ping-pong between 2 liquidity zones on Binance Demo (BTC in USDC, PAXG on USDT). PURE zone trigger (no R:R target), flat 2% stop per position. Profit and loss shown as-is.'
      : '🥷 Nyopet Market -- ping-pong otomatis antar 2 zona likuiditas di Binance Demo (BTC di USDC, PAXG numpang USDT). Trigger MURNI zona (gak pakai target R:R), nyawa 2% flat tiap posisi. Profit maupun loss ditampilin apa adanya.');
    return `<div class="nyopet-panel">
      <p class="order-disclaimer">${disclaimerFull}</p>
      <div class="journal-stats-grid">${saldoCell}</div>
      ${floatingHtml}
      ${nyopetSummaryHtml}
      <div class="journal-section-title">${rt('trade_history')} (${closed.length})</div>
      ${historyHtml}
    </div>`;
  }

  // Buka/tutup riwayat 1 dompet (kartu wallet-grid) -- toggle simpel, 1 dompet kebuka di satu
  // waktu gak dipaksa (boleh banyak kebuka bareng, biar gampang bandingin).
  function toggleWalletDetail(symbol) {
    const card = document.getElementById(`wallet-card-${symbol}`);
    const detail = document.getElementById(`wallet-detail-${symbol}`);
    if (!card || !detail) return;
    const willOpen = !detail.classList.contains('open');
    card.classList.toggle('open', willOpen);
    detail.classList.toggle('open', willOpen);
  }

  global.KaelaRender = {
    WINDOW_START, WINDOW_END, HALVING_DATE, daysToHalving,
    renderSiklusHalvingPanel, renderSniperOrdersPanel, renderOrderCard,
    renderJurnalPanel, computeFundReport, renderSpotJurnalPanel,
    renderSpotAltJurnalPanel, toggleWalletDetail, ALT10_SYMBOLS,
    renderNyopetJurnalPanel, renderNyopetOrderCard, renderNyopetHomePanel,
    wireStrategyFilter,
  };
})(window);
