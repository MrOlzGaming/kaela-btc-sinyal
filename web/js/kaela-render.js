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

(function (global) {
  'use strict';

  // ============ Konstanta (duplikat dari groupReport.js & spotDca.js -- lihat catatan di atas) ============
  const WINDOW_START = new Date('2026-10-19T00:00:00Z');
  const WINDOW_END = new Date('2026-11-17T00:00:00Z');
  const HALVING_DATE = new Date('2028-04-13T13:11:00Z');
  const SPOT_DAILY_BUY_USD = 2;
  const SELL_AFTER_HALVING_DAYS = 459; // titik tengah rentang Panen 368-549 hari, lihat spotDca.js
  function spotSellTriggerDate() {
    return new Date(HALVING_DATE.getTime() + SELL_AFTER_HALVING_DAYS * 86400000);
  }
  function daysToHalving(now) {
    return Math.round((HALVING_DATE.getTime() - now.getTime()) / 86400000);
  }

  // Duplikat dari categoryColors.js (tetap harus disinkron manual kalau warna kategori berubah).
  const CATEGORY_COLOR = {
    news: { emoji: '🟦', hex: '#3b82f6' },
    laporan: { emoji: '🟪', hex: '#a855f7' },
    sniper: { emoji: '🟧', hex: '#f7931a' },
    whale: { emoji: '🟨', hex: '#eab308' },
    econ: { emoji: '⬜', hex: '#8b949e' },
    priceAlert: { emoji: '🟫', hex: '#a16207' },
  };
  function categoryOfType(type) {
    if (type === 'news') return 'news';
    if (type.startsWith('report-')) return 'laporan';
    if (type === 'sniper') return 'sniper';
    if (type === 'whale') return 'whale';
    if (type === 'econ-calendar') return 'econ';
    if (type === 'price-alert') return 'priceAlert';
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
  function fmtDateLong(d) {
    return `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  function fmtUsdOrder(n) {
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
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
  const ASSETS_WEB = {
    btc: { symbol: 'BTCUSDT', label: 'BTC', emoji: '🟧' },
    xau: { symbol: 'PAXGUSDT', label: 'XAU/Emas', emoji: '🟡' },
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
        <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge pending">⏳ PENDING</span></div>
        <div class="order-strategy">${strategy}</div>
        <div class="order-levels"><span>Trigger: <strong>${fmtUsdOrder(o.triggerPrice)}</strong></span><span>TP: ${fmtUsdOrder(o.tp)}</span><span>SL: ${slText}</span></div>
        ${o.confirmationNote ? `<div class="order-note">📋 ${o.confirmationNote}</div>` : ''}
        ${o.leverage ? `<div class="order-meta">Exposure ${o.exposure}× · Leverage ${o.leverage}× · Margin ${fmtUsdOrder(o.marginUsd)}</div>` : ''}
      </div>`;
    }
    if (o.status === 'floating') {
      const remFrac = o.remainingFraction !== undefined && o.remainingFraction !== null ? o.remainingFraction : 1;
      const partialBadge = o.partialDone
        ? `<div class="order-partial-note">🟡 Tahap 1 diamankan: ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)} -- SL sisa di breakeven, sisa ${(remFrac * 100).toFixed(0)}% posisi di-trail</div>`
        : '';
      const volumeUsd = (o.marginUsd && o.leverage) ? o.marginUsd * o.leverage : null;
      const liqPrice = liquidationPrice(o);
      const tradeMetaLine = (o.leverage || o.marginUsd)
        ? `<div class="order-meta">Margin ${fmtUsdOrder(o.marginUsd)} · Leverage ${o.leverage}× · Volume ${volumeUsd !== null ? fmtUsdOrder(volumeUsd) : '-'}${liqPrice !== null ? ` · Liquidated @ ${fmtUsdOrder(liqPrice)}` : ''}</div>`
        : '';
      return `<div class="order-card floating" data-order-id="${o.id}" data-symbol="${asset.symbol}" data-direction="${o.direction}" data-entry="${o.entryPrice}" data-tp="${o.tp}" data-sl="${o.sl || ''}" data-leverage="${o.leverage || 1}" data-margin="${o.marginUsd || 0}" data-remaining-fraction="${remFrac}" data-realized-pnl="${o.realizedPnlUsd || 0}">
        ${idLine}
        ${assetBadge}
        <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge floating">🔵 FLOATING</span></div>
        <div class="order-strategy">${strategy}</div>
        <div class="order-live-price">Harga ${asset.label} sekarang: <strong data-price-target>memuat...</strong></div>
        <div class="order-levels"><span>Entry: <strong>${fmtUsdOrder(o.entryPrice)}</strong></span><span>TP: ${fmtUsdOrder(o.tp)}</span><span>SL: ${slText}</span></div>
        ${tradeMetaLine}
        ${partialBadge}
        <div class="order-pnl-live" data-pnl-target>Memuat P&amp;L live...</div>
      </div>`;
    }
    const won = o.status === 'closed_tp';
    const badge = o.status === 'cancelled' ? '🚫 DIBATALKAN' : (won ? '✅ TP' : '❌ SL');
    const pnlLine = (o.pnlUsd !== null && o.pnlUsd !== undefined)
      ? `<div class="order-pnl ${won ? 'up' : 'down'}">${o.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.pnlUsd)} (${o.pnlUsd >= 0 ? '+' : ''}${o.pnlPct.toFixed(2)}%)</div>` : '';
    const partialTimeline = o.partialDone
      ? `<div class="order-partial-timeline">
          <div>🟡 Tahap 1 @ ${fmtUsdOrder(o.partialTp)}${o.partialClosedAt ? ` (${fmtDateLong(new Date(o.partialClosedAt))})` : ''}: ${o.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.realizedPnlUsd || 0)}</div>
          <div>🏁 Tahap 2 (sisa) @ ${fmtUsdOrder(o.exitPrice != null ? o.exitPrice : (won ? o.tp : o.sl))}${o.closedAt ? ` (${fmtDateLong(new Date(o.closedAt))})` : ''}: ${(o.pnlUsd - (o.realizedPnlUsd || 0)) >= 0 ? '+' : ''}${fmtUsdOrder((o.pnlUsd || 0) - (o.realizedPnlUsd || 0))}</div>
        </div>`
      : '';
    return `<div class="order-card closed" data-strategy="${o.strategyType || ''}">
      ${idLine}
      ${assetBadge}
      <div class="order-header"><span class="order-dir">${dir}</span><span class="order-status-badge closed">${badge}</span></div>
      <div class="order-levels"><span>Entry: ${o.entryPrice ? fmtUsdOrder(o.entryPrice) : '-'}</span><span>Exit: ${o.status === 'closed_tp' ? fmtUsdOrder(o.tp) : o.status === 'closed_sl' ? slText : '-'}</span></div>
      ${partialTimeline}
      ${pnlLine}
    </div>`;
  }

  function renderSniperOrdersPanel(state, latestStatusEntry) {
    const active = (state.orders || []).filter((o) => o.status === 'floating');
    let activeHtml;
    if (active.length > 0) {
      activeHtml = `<div class="order-grid">${active.map(renderOrderCard).join('')}</div>`;
    } else if (latestStatusEntry) {
      activeHtml = renderEntry(latestStatusEntry, { highlight: true });
    } else {
      activeHtml = `<div class="empty">🎯 Belum ada analisa Sniper.</div>`;
    }
    return `<div class="sniper-orders-panel">
      <p class="order-disclaimer">🤖 Sinyal VALID sekarang dieksekusi OTOMATIS di akun Binance Demo (duit virtual, riset/uji coba) -- bukan cuma monitor bayangan lagi. Saldo, riwayat &amp; statistik lengkap ada di halaman <a href="jurnal.html"><strong>📓 Jurnal</strong></a>.</p>
      ${activeHtml}
    </div>`;
  }

  // Panel ringkas buat Home (23 Agu 2026) -- format senada renderSniperOrdersPanel, cuma sumber
  // datanya nyopet-journal.json. Riwayat lengkap tetap di Jurnal (link di disclaimer), Home cuma
  // nunjukkin posisi TERBUKA biar Olan langsung liat begitu buka web tanpa pindah halaman.
  function renderNyopetHomePanel(nyopetState) {
    const floating = (nyopetState.orders || []).filter((o) => o.status === 'floating');
    const posHtml = floating.length > 0
      ? `<div class="order-grid">${floating.map(renderNyopetOrderCard).join('')}</div>`
      : `<div class="empty">Gak ada posisi Nyopet yang lagi terbuka.</div>`;
    return `<div class="sniper-orders-panel">
      <p class="order-disclaimer">🥷 Nyopet Market -- ping-pong otomatis zona likuiditas di Binance Demo (USDC). Riwayat lengkap &amp; win rate ada di halaman <a href="jurnal.html"><strong>📓 Jurnal</strong></a>.</p>
      ${posHtml}
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
      ${cell('Total Trade', stats.count)}
      ${cell('Win Rate', `${stats.winRate.toFixed(0)}%`, stats.winRate >= 50 ? 'up' : 'down')}
      ${cell('Profit Factor', pfText, (stats.profitFactor === null || stats.profitFactor >= 1) ? 'up' : 'down')}
      ${cell('Expectancy/trade', fmtUsdOrder(stats.expectancy), stats.expectancy >= 0 ? 'up' : 'down')}
      ${cell('Avg R-Multiple', stats.avgR === null ? '-' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`, (stats.avgR || 0) >= 0 ? 'up' : 'down')}
      ${cell('Total P&amp;L', `${stats.totalPnl >= 0 ? '+' : ''}${fmtUsdOrder(stats.totalPnl)}`, stats.totalPnl >= 0 ? 'up' : 'down')}
    </div>`;
  }

  function renderEquityCurveSvg(trades) {
    if (trades.length < 2) return '<div class="empty">Butuh minimal 2 trade selesai buat equity curve.</div>';
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
      <div class="cal-header">${BULAN_ID[m - 1]} ${y} <span class="${monthPnl >= 0 ? 'up' : 'down'}">${monthPnl >= 0 ? '+' : ''}${fmtUsdOrder(monthPnl)}</span></div>
      <div class="cal-grid">${DOW_ID.map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>
    </div>`;
  }

  function renderFundEquitySvg(events) {
    if (events.length < 2) return '<div class="empty">Bankroll baru mulai, equity curve keisi begitu ada top-up/trade berikutnya.</div>';
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
        <div class="journal-section-title">🧪 Laporan Bankroll Kaela -- Binance Demo</div>
        <p class="order-disclaimer" style="margin-top:0;">Saldo di bawah ini duit VIRTUAL dari Binance Demo (bukan uang asli, bukan setoran) -- makanya persen "return" gak ditampilin dulu di fase ini, biar gak menyesatkan. Begitu pindah ke akun asli dengan setoran beneran, laporan lengkap ala fund manager (Total Disetor vs Return%) bakal aktif lagi.</p>
        <div class="journal-stats-grid">
          ${cell('Saldo Sekarang (Demo)', fmtUsdOrder(report.balance))}
          ${cell('P&amp;L Trading (murni)', `${report.totalRealizedPnl >= 0 ? '+' : ''}${fmtUsdOrder(report.totalRealizedPnl)}`, report.totalRealizedPnl >= 0 ? 'up' : 'down')}
          ${cell('Jumlah Trade', report.tradeCount)}
        </div>
      </div>`;
    }

    const totalGrowthUsd = report.balance - report.totalContributed;
    const totalGrowthPct = report.totalContributed > 0 ? (totalGrowthUsd / report.totalContributed) * 100 : 0;
    return `<div class="fund-report-section">
      <div class="journal-section-title">🤖 Laporan Fund Kaela</div>
      <p class="order-disclaimer" style="margin-top:0;">Dikelola &amp; dilaporkan SEPERSIS mungkin kayak fund manager asli: setoran (top-up) dipisah tegas dari performa (P&amp;L trading), biar gak menyesatkan.</p>
      <div class="journal-stats-grid">
        ${cell('Saldo Sekarang', fmtUsdOrder(report.balance))}
        ${cell('Total Disetor', fmtUsdOrder(report.totalContributed))}
        ${cell('P&amp;L Trading (murni)', `${report.totalRealizedPnl >= 0 ? '+' : ''}${fmtUsdOrder(report.totalRealizedPnl)}`, report.totalRealizedPnl >= 0 ? 'up' : 'down')}
        ${cell('Return dari Trading', `${report.returnOnContributedPct >= 0 ? '+' : ''}${report.returnOnContributedPct.toFixed(1)}%`, report.returnOnContributedPct >= 0 ? 'up' : 'down')}
        ${cell('Total Growth (gabungan)', `${totalGrowthPct >= 0 ? '+' : ''}${totalGrowthPct.toFixed(1)}%`, totalGrowthPct >= 0 ? 'up' : 'down')}
        ${cell('Jumlah Trade', report.tradeCount)}
      </div>
      <div class="journal-section-title">📈 Equity Curve Bankroll${report.startedAt ? ' (mulai ' + fmtDateLong(new Date(report.startedAt)) + ')' : ''}</div>
      ${renderFundEquitySvg(report.events)}
      <p class="order-disclaimer">🟧 Kotak oranye di grafik = momen top-up (setoran baru), BUKAN hasil trading -- biar kenaikan dari 2 sumber ini gampang dibedain sekilas.</p>
    </div>`;
  }

  function renderJurnalPanel(state, now, fundReport) {
    const closedAll = (state.orders || []).filter((o) => o.status.indexOf('closed') === 0 || o.status === 'cancelled').slice().reverse();
    const trades = closedAll.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl');
    const stats = computeJournalStats(trades);
    const fundHtml = fundReport ? renderFundReportSection(fundReport) : '';

    if (!stats) {
      return `<div class="jurnal-panel">
        ${fundHtml}
        <div class="empty">📓 Belum ada trade yang selesai. Statistik per-trade bakal keisi otomatis begitu ada order Sniper yang kena TP/SL.</div>
      </div>`;
    }

    const strategies = Array.from(new Set(closedAll.map((o) => o.strategyType).filter(Boolean)));
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
    let badgeClass, badgeText, phaseNote;
    if (spotState.btcHeld > 0) {
      if (now < HALVING_DATE) {
        badgeClass = 'phase-tanam';
        badgeText = '🌱 SEDANG DCA (Musim Tanam)';
        phaseNote = `Beli $${SPOT_DAILY_BUY_USD} BTC tiap hari sampai halving tiba (~${fmtDateLong(HALVING_DATE)}).`;
      } else {
        badgeClass = 'phase-panen';
        badgeText = '🌾 TAHAN, MENUNGGU PANEN';
        phaseNote = `Halving udah lewat, DCA berhenti. Jual otomatis semua BTC sekitar ${fmtDateLong(sellDate)}.`;
      }
    } else if (now >= WINDOW_START && now < HALVING_DATE) {
      badgeClass = 'phase-tanam';
      badgeText = '🌱 WINDOW TANAM -- DCA BERJALAN';
      phaseNote = `DCA $${SPOT_DAILY_BUY_USD}/hari lagi berjalan (posisi belum keupdate di data terakhir, nunggu tick harian berikutnya).`;
    } else {
      badgeClass = 'phase-tunai';
      badgeText = '⚪ TUNAI -- MENUNGGU WINDOW TANAM';
      phaseNote = `DCA mulai otomatis begitu window Musim Tanam tiba (${fmtDateLong(WINDOW_START)}), jalan sampai halving (~${fmtDateLong(HALVING_DATE)}).`;
    }

    const avgCost = spotState.btcHeld > 0 ? spotState.totalInvestedCurrentCycle / spotState.btcHeld : null;

    const summaryHtml = `<div class="spot-summary-grid">
      ${cell('BTC Dimiliki', spotState.btcHeld > 0 ? spotState.btcHeld.toFixed(8) + ' BTC' : '0 BTC')}
      ${cell('Modal Siklus Ini', fmtUsdOrder(spotState.totalInvestedCurrentCycle))}
      ${cell('Avg Cost', avgCost !== null ? fmtUsdOrder(avgCost) : '-')}
      ${cell('Saldo Terealisasi', fmtUsdOrder(spotState.totalRealizedCash))}
      ${cell('Siklus Selesai', spotState.completedCycles.length)}
    </div>`;

    const liveValueHtml = spotState.btcHeld > 0
      ? `<div data-spot-btc-held="${spotState.btcHeld}" data-spot-invested="${spotState.totalInvestedCurrentCycle}">
          <div class="order-live-price">Nilai sekarang: <strong data-spot-value-target>memuat...</strong></div>
          <div class="order-pnl-live" data-spot-pnl-target>Menghitung P&amp;L live...</div>
        </div>`
      : '';

    const buyLogHtml = spotState.buyLog.length > 0
      ? `<div class="spot-buy-log"><table>
          <thead><tr><th>Tanggal</th><th>Harga BTC</th><th>BTC Didapat</th></tr></thead>
          <tbody>${spotState.buyLog.slice().reverse().map((b) => `<tr><td>${fmtDateLong(new Date(b.date))}</td><td>${fmtUsdOrder(b.price)}</td><td>${b.btcBought.toFixed(8)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : `<div class="empty">Belum ada pembelian di siklus ini.</div>`;

    const cyclesHtml = spotState.completedCycles.length > 0
      ? `<table class="spot-cycle-table">
          <thead><tr><th>Mulai Beli</th><th>Terjual</th><th>Modal</th><th>Hasil Jual</th><th>P&amp;L</th></tr></thead>
          <tbody>${spotState.completedCycles.slice().reverse().map((c) => `<tr>
            <td>${c.buyWindowStart ? fmtDateLong(new Date(c.buyWindowStart)) : '-'}</td>
            <td>${fmtDateLong(new Date(c.soldAt))}</td>
            <td>${fmtUsdOrder(c.totalInvested)}</td>
            <td>${fmtUsdOrder(c.proceedsUsd)}</td>
            <td class="${c.pnlUsd >= 0 ? 'up' : 'down'}">${c.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(c.pnlUsd)} (${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%)</td>
          </tr>`).join('')}</tbody>
        </table>`
      : '';

    return `<div class="spot-panel">
      <div class="phase-badge ${badgeClass}">${badgeText}</div>
      <p class="halving-note" style="margin-top:0;">${phaseNote}</p>
      <p class="order-disclaimer">🎭 DCA Spot BAYANGAN Kaela sendiri -- modal $${SPOT_DAILY_BUY_USD}/hari FIKTIF (bukan uang beneran), terpisah total dari bankroll Sniper. Gak pernah dikirim ke WhatsApp, murni tercatat di sini.</p>
      ${summaryHtml}
      ${liveValueHtml}
      <div class="journal-section-title">🧾 Jurnal Pembelian (siklus berjalan)</div>
      ${buyLogHtml}
      ${spotState.completedCycles.length > 0 ? `<div class="journal-section-title">📜 Riwayat Siklus Selesai</div>${cyclesHtml}` : ''}
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
    const dirLabel = o.direction === 'sell' ? '🔴 SHORT' : '🟢 LONG';
    const modeLabel = NYOPET_MODE_LABEL_WEB[o.mode] || o.mode;
    if (o.status === 'floating') {
      return `<div class="order-card floating" data-order-id="${o.id}" data-direction="${o.direction}" data-entry="${o.entryPrice}" data-tp="${o.tp}" data-sl="${o.sl}" data-leverage="${o.leverage}" data-margin="${o.marginUsd}">
          <div class="order-header">
            <span class="order-dir">${dirLabel}</span>
            <span class="order-status-badge floating">🔵 FLOATING (Demo)</span>
          </div>
          <div class="order-strategy">🥷 Nyopet -- ${modeLabel}</div>
          <div class="order-live-price">Harga BTC sekarang: <strong data-price-target>memuat...</strong></div>
          <div class="order-levels">
            <span>Entry: <strong>${fmtUsdOrder(o.entryPrice)}</strong></span>
            <span>TP: ${fmtUsdOrder(o.tp)}</span>
            <span>Nyawa: ${fmtUsdOrder(o.sl)}</span>
          </div>
          <div class="order-meta">Leverage ${o.leverage}x · Margin ${fmtUsdOrder(o.marginUsd)} · Zona ${fmtUsdOrder(o.zonePrice)}</div>
          <div class="order-pnl-live" data-pnl-target>Memuat P&amp;L live...</div>
        </div>`;
    }
    const won = o.status === 'closed_tp';
    return `<div class="order-card closed">
        <div class="order-header">
          <span class="order-dir">${dirLabel}</span>
          <span class="order-status-badge closed">${won ? '✅ TARGET' : '❌ NYAWA'}</span>
        </div>
        <div class="order-strategy">🥷 Nyopet -- ${modeLabel}</div>
        <div class="order-levels"><span>Entry: ${fmtUsdOrder(o.entryPrice)}</span><span>Exit: ${fmtUsdOrder(o.exitPrice)}</span></div>
        <div class="order-pnl ${won ? 'up' : 'down'}">${o.pnlUsd >= 0 ? '+' : ''}${fmtUsdOrder(o.pnlUsd)} (${o.pnlUsd >= 0 ? '+' : ''}${(o.pnlPct || 0).toFixed(1)}%)</div>
      </div>`;
  }

  function renderNyopetJurnalPanel(nyopetState, now) {
    const cell = (label, value, cls) => `<div class="journal-stat"><div class="journal-stat-label">${label}</div><div class="journal-stat-value ${cls || ''}">${value}</div></div>`;
    const orders = nyopetState.orders || [];
    const floating = orders.filter((o) => o.status === 'floating');
    const closed = orders.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl').slice().reverse();
    const wins = closed.filter((o) => o.status === 'closed_tp').length;
    const losses = closed.filter((o) => o.status === 'closed_sl').length;
    const total = closed.length;
    const winRate = total ? (wins / total) * 100 : 0;
    // PNL $ JUJUR -- murni akumulasi hasil $ apa adanya, gak nyampur sama saldo/balance.
    const totalPnlUsd = closed.reduce((sum, o) => sum + (o.pnlUsd || 0), 0);

    const summaryHtml = `<div class="journal-stats-grid">
      ${cell('Saldo Demo (USDC)', fmtUsdOrder(nyopetState.balance || 0))}
      ${cell('Win Rate', total ? winRate.toFixed(1) + '%' : '-', total ? (winRate >= 50 ? 'up' : 'down') : '')}
      ${cell('Menang', wins, 'up')}
      ${cell('Kalah', losses, 'down')}
      ${cell('Total PNL (jujur)', total ? fmtSignedUsd(totalPnlUsd) : '-', total ? (totalPnlUsd >= 0 ? 'up' : 'down') : '')}
    </div>`;

    const posHtml = floating.length > 0
      ? `<div class="order-grid">${floating.map(renderNyopetOrderCard).join('')}</div>`
      : `<div class="empty">Gak ada posisi Nyopet yang lagi terbuka.</div>`;

    const historyHtml = closed.length > 0
      ? `<table class="spot-cycle-table">
          <thead><tr><th>Arah</th><th>Mode</th><th>Entry</th><th>Exit</th><th>Hasil</th><th>PNL</th><th>Tanggal</th></tr></thead>
          <tbody>${closed.map((o) => `<tr>
            <td>${o.direction === 'sell' ? '🔴 SHORT' : '🟢 LONG'}</td>
            <td>${NYOPET_MODE_LABEL_WEB[o.mode] || o.mode}</td>
            <td>${fmtUsdOrder(o.entryPrice)}</td>
            <td>${fmtUsdOrder(o.exitPrice)}</td>
            <td class="${o.status === 'closed_tp' ? 'up' : 'down'}">${o.status === 'closed_tp' ? 'MENANG' : 'KALAH'}</td>
            <td class="${(o.pnlUsd || 0) >= 0 ? 'up' : 'down'}">${fmtSignedUsd(o.pnlUsd || 0)}</td>
            <td>${fmtDateLong(new Date(o.closedAt))}</td>
          </tr>`).join('')}</tbody>
        </table>`
      : `<div class="empty">Belum ada trade yang selesai.</div>`;

    return `<div class="nyopet-panel">
      <p class="order-disclaimer">🥷 Nyopet Market -- ping-pong otomatis antar 2 zona likuiditas di Binance Demo (USDC, duit virtual). Trigger MURNI zona (gak pakai target R:R), nyawa 1% flat tiap posisi. Profit maupun loss ditampilin apa adanya.</p>
      ${summaryHtml}
      <div class="journal-section-title">📌 Posisi Sekarang</div>
      ${posHtml}
      <div class="journal-section-title">📋 Riwayat Trade (${total})</div>
      ${historyHtml}
    </div>`;
  }

  global.KaelaRender = {
    WINDOW_START, WINDOW_END, HALVING_DATE, daysToHalving,
    renderSiklusHalvingPanel, renderSniperOrdersPanel, renderOrderCard,
    renderJurnalPanel, computeFundReport, renderSpotJurnalPanel,
    renderNyopetJurnalPanel, renderNyopetOrderCard, renderNyopetHomePanel,
    wireStrategyFilter,
  };
})(window);
