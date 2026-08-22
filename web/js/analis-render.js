// Render Kaela Analyst Terminal (analis.html) -- konsumsi analyst-dashboard.json yang ditulis
// groupMonitor.js tiap Senin (lihat memori project-kaela-analyst-tier). Semua fungsi murni
// (data in, HTML string out), gak nyentuh DOM langsung -- konsisten sama kaela-render.js.

(function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function verdictClass(verdict) {
    if (verdict.includes('BULLISH KUAT')) return 'v-strong-bull';
    if (verdict.includes('Bullish')) return 'v-bull';
    if (verdict.includes('BEARISH KUAT')) return 'v-strong-bear';
    if (verdict.includes('Bearish')) return 'v-bear';
    return 'v-neutral';
  }

  function renderConvictionCard(assetLabel, assetEmoji, data) {
    if (!data) {
      return `<div class="card analis-card"><div class="analis-empty">${esc(assetEmoji)} ${esc(assetLabel)} -- belum ada data (verdict pertama muncul Senin, setelah laporan mingguan pertama jalan).</div></div>`;
    }
    const { conviction, trackRecord, price } = data;
    const factorRows = conviction.factors.map((f) => {
      const tag = f.v > 0 ? '🟢' : f.v < 0 ? '🔴' : '⚪';
      return `<div class="analis-factor"><span class="analis-factor-tag">${tag}</span><span class="analis-factor-label">${esc(f.label)}</span><span class="analis-factor-reason">${esc(f.reason)}</span></div>`;
    }).join('');
    const trackLine = trackRecord
      ? `${trackRecord.correct}/${trackRecord.total} verdict tepat arah (${trackRecord.winRatePct.toFixed(0)}%)`
      : 'belum cukup data (verdict pertama butuh 7 hari buat dinilai)';
    return `
      <div class="card analis-card">
        <div class="analis-card-header">
          <span class="analis-asset">${esc(assetEmoji)} ${esc(assetLabel)}</span>
          <span class="analis-price">$${Number(price).toLocaleString('en-US')}</span>
        </div>
        <div class="analis-verdict ${verdictClass(conviction.verdict)}">${esc(conviction.verdict)}</div>
        <div class="analis-score">Skor: ${conviction.score >= 0 ? '+' : ''}${conviction.score} dari ${conviction.totalFactors} faktor</div>
        <div class="analis-factors">${factorRows}</div>
        <div class="analis-track">📈 Track Record: ${esc(trackLine)}</div>
      </div>`;
  }

  function macroRow(label, valueStr, insight) {
    return `<div class="analis-macro-row"><span class="analis-macro-label">${esc(label)}</span><span class="analis-macro-value">${esc(valueStr)}</span><span class="analis-macro-insight">${esc(insight || '')}</span></div>`;
  }

  function renderMacroPanel(dashboardData) {
    const adv = dashboardData.btc?.advancedMacro;
    const goldMacro = dashboardData.xau?.macro;
    const cot = dashboardData.xau?.cot;
    const rows = [];
    if (adv?.dvol) rows.push(macroRow('DVOL (BTC)', adv.dvol.value.toFixed(1), 'Volatilitas implisit 30 hari (opsi)'));
    if (adv?.fedRate) rows.push(macroRow('Fed Funds Rate', adv.fedRate.value.toFixed(2) + '%', (adv.fedRate.changeBps || 0).toFixed(0) + ' bps / 90 hari'));
    if (adv?.creditSpread) rows.push(macroRow('Credit Spread (HY)', adv.creditSpread.value.toFixed(2) + '%', (adv.creditSpread.changeBps || 0).toFixed(0) + ' bps / 30 hari'));
    if (adv?.yieldCurve) rows.push(macroRow('Yield Curve 10Y-2Y', adv.yieldCurve.value.toFixed(2), adv.yieldCurve.inverted ? 'TERBALIK -- sinyal resesi' : 'Normal'));
    if (adv?.m2) rows.push(macroRow('M2 Money Supply', (adv.m2.changePctYoY || 0).toFixed(1) + '% YoY', 'Likuiditas global'));
    if (adv?.stablecoin) rows.push(macroRow('Stablecoin Supply', (adv.stablecoin.changePct || 0).toFixed(2) + '% / 7 hari', 'USDT+USDC beredar'));
    if (goldMacro?.dxy) rows.push(macroRow('DXY (Dolar)', goldMacro.dxy.latest.value.toFixed(1), goldMacro.dxy.trend.arah));
    if (goldMacro?.realYield) rows.push(macroRow('Real Yield 10Y', goldMacro.realYield.latest.value.toFixed(2) + '%', goldMacro.realYield.trend.arah));
    if (cot) rows.push(macroRow('COT Smart Money (Gold)', cot.netPctOi.toFixed(0) + '% net-long', cot.label.split(' -- ')[0]));
    if (rows.length === 0) return '';
    return `<div class="card analis-card"><div class="analis-card-header"><span class="analis-asset">📊 Indikator Makro</span></div>${rows.join('')}</div>`;
  }

  function renderRegimePanel(dashboardData) {
    const btcRegime = dashboardData.btc?.regime;
    const goldRegime = dashboardData.xau?.regime;
    if (!btcRegime && !goldRegime) return '';
    const rows = [];
    if (btcRegime) rows.push(macroRow('BTC vs Nasdaq (90h)', btcRegime.corr90.toFixed(2), btcRegime.label90));
    if (goldRegime) rows.push(macroRow('Emas vs DXY (90h)', goldRegime.corr90.toFixed(2), goldRegime.label90));
    return `<div class="card analis-card"><div class="analis-card-header"><span class="analis-asset">🔗 Regime / Korelasi</span></div>${rows.join('')}</div>`;
  }

  function renderAnalystTerminal(dashboardData) {
    if (!dashboardData || !dashboardData.updatedAt) {
      return '<div class="empty">Belum ada data analisa -- verdict pertama Kaela Conviction Score muncul hari Senin (laporan mingguan pertama).</div>';
    }
    const updated = new Date(dashboardData.updatedAt);
    const updatedStr = updated.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <div class="analis-updated">Terakhir diperbarui: ${esc(updatedStr)} (tiap Senin)</div>
      <div class="analis-grid">
        ${renderConvictionCard('BTC', '🟧', dashboardData.btc)}
        ${renderConvictionCard('XAU/Emas', '🟡', dashboardData.xau)}
      </div>
      ${renderMacroPanel(dashboardData)}
      ${renderRegimePanel(dashboardData)}
    `;
  }

  window.KaelaAnalisRender = { renderAnalystTerminal };
})();
