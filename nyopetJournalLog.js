// Format pesan posisi Nyopet REAL (bukan sinyal info kayak darkKaelaLog.js -- ini soal POSISI
// beneran yang lagi jalan, dibuka manual sama Olan di exchange). Badge sama ("[Dark] Kaela")
// biar konsisten identitas di grup WA.

function fmtUsd(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}
function fmtWita(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' WITA';
}
function dirLabel(direction) {
  return direction === 'short' ? '🔴 SHORT' : '🟢 LONG';
}

function formatOpened(pos, now) {
  return `🥷 [Dark] Kaela — 📌 Posisi Nyopet DIBUKA
${dirLabel(pos.direction)} @ ${fmtUsd(pos.entryPrice)} | Leverage ${pos.leverage}x | Margin ${fmtUsd(pos.marginUsd)} | Ukuran ${fmtUsd(pos.sizeUsd)}
Harga likuidasi: ${fmtUsd(pos.liqPrice)}
${pos.notes ? '\n' + pos.notes + '\n' : ''}
Ini posisi REAL Olan sendiri, dibuka manual di exchange -- Kaela cuma mantau (cek likuidasi/profit 100%) & catat ke jurnal, gak pernah eksekusi apapun.

${fmtWita(now)}`;
}

function formatLiquidated(trade, summary, now) {
  return `🥷 [Dark] Kaela — 💥 POSISI NYOPET KENA LIKUIDASI
${dirLabel(trade.direction)} @ ${fmtUsd(trade.entryPrice)} -> likuidasi @ ${fmtUsd(trade.exitPrice)}

Rekor jurnal: ${summary.total}/${summary.targetTrades} trade | Win rate ${summary.winRate.toFixed(1)}% (${summary.wins}W-${summary.losses}L)

${fmtWita(now)}`;
}

function formatProfit100(pos, price, roiPct, now) {
  return `🥷 [Dark] Kaela — 🎉 POSISI NYOPET UDAH +${roiPct.toFixed(0)}% ROI
${dirLabel(pos.direction)} @ ${fmtUsd(pos.entryPrice)} | Harga sekarang ${fmtUsd(price)}

Udah tembus 100% ROI -- keputusan close/tahan sepenuhnya di tangan Olan, ini cuma pengingat otomatis.

${fmtWita(now)}`;
}

function formatManualClosed(trade, summary, now) {
  return `🥷 [Dark] Kaela — ✅ Posisi Nyopet DITUTUP manual
${dirLabel(trade.direction)} @ ${fmtUsd(trade.entryPrice)} -> ditutup @ ${fmtUsd(trade.exitPrice)} (${trade.result === 'win' ? 'MENANG' : 'KALAH'})

Rekor jurnal: ${summary.total}/${summary.targetTrades} trade | Win rate ${summary.winRate.toFixed(1)}% (${summary.wins}W-${summary.losses}L)

${fmtWita(now)}`;
}

function format100TradeEvaluasi(summary, now) {
  return `🥷 [Dark] Kaela — 📊 100 TRADE NYOPET TERCAPAI, WAKTUNYA EVALUASI
Total: ${summary.total} trade | Menang: ${summary.wins} | Kalah: ${summary.losses}
Win rate: ${summary.winRate.toFixed(1)}%

Ini titik yang udah disepakati buat evaluasi jujur apa strategi Nyopet (sinyal zona likuiditas + konfirmasi manual heatmap) beneran punya edge atau enggak.

${fmtWita(now)}`;
}

module.exports = { formatOpened, formatLiquidated, formatProfit100, formatManualClosed, format100TradeEvaluasi };
