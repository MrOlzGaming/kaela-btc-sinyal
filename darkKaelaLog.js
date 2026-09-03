// Format pesan Dark Kaela -- badge "[Dark] Kaela" + 🥷 (nyopet yang jahil/nyolong + dark yang
// misterius, permintaan Olan 15 Agu 2026: "emoticon yang sesuai... karena nyopet wkwkw dan dark").
// Cuma INFO, gak pernah eksekusi/rekomendasi keras -- disclaimer WAJIB lebih tegas dari Sniper
// (leverage jauh lebih agresif, ~100x/nyawa 1%).

// Link Liquidation Heat Map (15 Agu 2026, permintaan Olan -- lebih spesifik dari halaman
// LiquidationData biasa, langsung nampilin peta panas buat cek kelakuan candle di zona).
const COINGLASS_LINK = 'https://www.coinglass.com/pro/futures/LiquidationHeatMap';
const KALKULATOR_LINK = 'https://kaela-btc-sinyal.netlify.app/kalkulator.html';

function fmtUsd(n) {
  // ⚠️ BUG ketemu 3 Sep 2026 (test-render pesan close): angka negatif (PnL rugi) kepotong jadi
  // "$-12.4" (minus nyempil abis dollar sign) -- toLocaleString taro tanda minus di depan ANGKA,
  // bukan di depan prefix "$" yang udah ditulis manual duluan. Fix: pisahin nilai absolut dari
  // tandanya, taro "-" SEBELUM "$" (gaya standar "-$12.40"), biar konsisten sama fmtUsd lokal di
  // positionReconciler.js/sniperMultiAccount.js yang emang udah bener dari awal.
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  return (v < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { maximumFractionDigits: abs < 1000 ? 2 : 0 });
}

function fmtWita(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' WITA';
}

// 28 Agu 2026, permintaan Olan: "kaela perlu tanda buat sinyal nyopetnya, id transaksi/sinyal
// gitu" -- biar gampang dicocokin pas nanya manual ("sinyal yang mana yang bengong"). Id asli
// (`nyopet-demo-<timestamp>`) kepanjangan buat disebut lisan/WA -- ambil 6 digit terakhir timestamp
// aja, cukup unik buat referensi jangka pendek (bukan buat storage/lookup presisi).
function shortId(id) {
  const digits = String(id || '').replace(/[^0-9]/g, '');
  return '#' + (digits.slice(-6) || '000000');
}

function formatSignal(signal, now) {
  const dirLabel = signal.direction === 'long' ? '🟢 POTENSI LONG' : '🔴 POTENSI SHORT';
  const zoneDesc = signal.zoneKind === 'round'
    ? 'angka bulat psikologis'
    : `swing, disentuh ${signal.touches}x sebelumnya`;
  // Konteks jarak ke KEDUA arah (permintaan Olan, 15 Agu 2026) -- biar keliatan seberapa
  // "kejepit" harga sekarang, bukan cuma info zona yang trigger sinyal ini doang.
  const upLine = signal.nearestResistance
    ? `📈 Likuiditas ATAS: ${fmtUsd(signal.nearestResistance.price)} (${signal.nearestResistance.distPct.toFixed(2)}% dari sekarang)`
    : '📈 Likuiditas ATAS: -';
  const downLine = signal.nearestSupport
    ? `📉 Likuiditas BAWAH: ${fmtUsd(signal.nearestSupport.price)} (${signal.nearestSupport.distPct.toFixed(2)}% dari sekarang)`
    : '📉 Likuiditas BAWAH: -';
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market
${dirLabel} (zona likuiditas)

Harga sekarang: ${fmtUsd(signal.price)}
Zona likuiditas: ${fmtUsd(signal.zonePrice)} (${zoneDesc})

${upLine}
${downLine}

⚠️ JANGAN LANGSUNG ENTRY. Ini cuma DETEKSI ZONA (struktur harga), bukan data likuidasi asli -- WAJIB dicek dulu sendiri di Coinglass:
🔗 ${COINGLASS_LINK}

📊 Yang dicek: bandingin ketebalan likuidasi LONG vs SHORT di kedua sisi. Pergerakan biasanya "ditarik" ke sisi yang likuidasinya paling TEBAL (magnet buat market maker) -- kalau likuidasi di ATAS lebih tebal dari di BAWAH, itu lebih condong ke arah naik (dan sebaliknya). Baru putuskan arah ${signal.direction === 'long' ? 'LONG' : 'SHORT'} ini beneran cocok sama bacaan itu atau enggak.

🚨 Risiko JAUH lebih tinggi dari Sniper -- leverage super agresif, SL tipis nempel zona. Ini murni info titik yang layak diperhatikan, BUKAN rekomendasi atau ajakan entry. Sepenuhnya keputusan & tanggung jawab sendiri.

💡 JANGAN ALL-IN, modal SUPER KECIL aja. Pakai Kalkulator Exposure buat nentuin sizing sesuai modal sendiri, jangan asal tebak:
🔗 ${KALKULATOR_LINK}

${fmtWita(now)}`;
}

function formatBroken(activeZone, breakPrice, now) {
  const dirLabel = activeZone.direction === 'long' ? 'LONG' : 'SHORT';
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market
⚠️ ZONA ${fmtUsd(activeZone.price)} DITEMBUS

Sinyal potensi ${dirLabel} sebelumnya gak jalan sesuai rencana -- harga nembus zona, bukan mantul (closing sekarang ${fmtUsd(breakPrice)}).

Kalau sempat entry berdasar sinyal itu dan belum keluar, ini pengingat buat dicek ulang.

${fmtWita(now)}`;
}

// ============ Auto-trader ping-pong (23 Agu 2026) -- BEDA dari formatSignal/formatBroken di atas
// (yang murni ALERT, v1 lama "kaela ga usah open posisi") -- dua fungsi di bawah ini buat era BARU
// Nyopet Binance Demo: Kaela BENERAN buka/tutup posisi sendiri (nyopetAutoTrader.js), pesan ini
// ngasih tau APA YANG BARU DILAKUKAN + KENAPA (bukan cuma info titik kayak dulu). Wajib jelasin
// alasan tiap sinyal (lihat memory feedback-selalu-ada-alasan) + link kalkulator di tiap pesan.
// 29 Agu 2026, permintaan Olan: "nyopet ga usah kepanjangan -- posisi kebuka Kaela sendiri UDAH
// jadi sinyalnya, ikut/enggak tinggal aktifin toggle di web" -- pesan ini SENGAJA dipangkas (buang
// alasan panjang/disclaimer/link kalkulator yang dulu wajib tiap pesan, lihat memory
// feedback-selalu-ada-alasan) -- keputusan sadar Olan buat KHUSUS pesan ping-pong Nyopet ini,
// bukan pembatalan aturan itu buat sinyal lain. Tag mode (Fade/Follow) tetap ditinggal 1 kata
// biar masih ada KONTEKS minimal tanpa balik panjang.
// PATTERN_TAG_LABEL (30 Agu 2026, Nyopet v2 -- ganti mesin zona-ping-pong ke chart pattern+FVG,
// lihat memori project-dark-kaela) -- `pos.mode` sekarang `patternType` dari
// chartPatterns.js/fvgDetector.js (mis. 'flag_bull', 'wedge_falling', 'fvg_bounce_long'), BUKAN
// lagi 'fade'/'follow'. Label singkat buat pesan WA (tetap ringkas, "nyopet ga usah kepanjangan").
const PATTERN_TAG_LABEL = {
  flag_bull: 'Flag', pennant_bull: 'Pennant', wedge_falling: 'Wedge', fvg_bounce: 'FVG',
};
function patternTag(mode) { return PATTERN_TAG_LABEL[mode] || mode || '-'; }

// 3 Sep 2026, permintaan Olan ("bedakan badge dan emojinya.. perbagus text.. desain konsisten")
// -- desain TERPADU dipakai Sniper (sniperMultiAccount.js)/Nyopet (di bawah)/Reconciler
// (positionReconciler.js), badge beda per SUMBER tapi struktur SAMA: header 1 baris + body
// terlabel + "Alasan:" WAJIB ada + link Kaela Access WAJIB ada. Label lebih deskriptif dari
// `patternTag` (dipakai di baris "Alasan:", bukan cuma tag singkat).
const KAELA_ACCESS_URL = 'https://kaela-access.netlify.app';
const PATTERN_REASON_LABEL = {
  flag_bull: 'Chart Pattern (Bull Flag) -- breakout tiang+bendera terkonfirmasi',
  pennant_bull: 'Chart Pattern (Pennant) -- breakout tiang+segitiga terkonfirmasi',
  wedge_falling: 'Chart Pattern (Falling Wedge) -- breakout wedge turun terkonfirmasi',
  fvg_bounce: 'FVG Bounce -- harga pantul dari Fair Value Gap (zona belum keisi), deket zona (gak nge-chase)',
};
function patternReason(mode) { return PATTERN_REASON_LABEL[mode] || patternTag(mode); }

// Kode close-reason internal (nyopetAutoTrader.js) -> teks manusia, dipakai baris "Alasan:" pas
// nutup posisi OTOMATIS (bukan manual Olan -- itu pakai teks yang DIA TULIS SENDIRI, lihat caller).
const CLOSE_REASON_LABEL = {
  SL: 'Stop Loss kena', SL_BREAKEVEN: 'SL breakeven kena (abis partial TP tahap 1)',
  TRAIL: 'Trend patah (trailing SMA)', OFFLINE: 'Kelikuidasi/tertutup pas eksekutor offline, baru kesinkron sekarang',
};

function _isManual(pos) { return pos.mode === 'manual' || pos.patternType === 'manual'; }
function _nyopetBadge(pos, isDemo) {
  return `🥷 NYOPET${_isManual(pos) ? ' · Manual Olan' : ''} ${pos.assetLabel || 'BTC'}${isDemo ? ' (Demo)' : ''}`;
}

function formatAutoOpen(pos, now, dxyLine, isDemo) {
  const dirLabel = pos.direction === 'buy' ? '🟢 LONG' : '🔴 SHORT';
  const alasan = _isManual(pos) ? (pos.manualReason || 'Manual Olan (gak diisi alasan)') : patternReason(pos.mode);
  return `${_nyopetBadge(pos, isDemo)} ${shortId(pos.id)} — Buka Posisi

${dirLabel} @ ${fmtUsd(pos.entryPrice)}
TP1 ${fmtUsd(pos.tp)} · SL ${fmtUsd(pos.sl)}
Alasan: ${alasan}${dxyLine ? '\n' + dxyLine : ''}

🔗 ${KAELA_ACCESS_URL}`;
}

// Tahap 1 (30 Agu 2026, Nyopet v2 -- exit 2-tahap sama kayak Sniper) -- separuh posisi diamankan,
// SL sisa geser breakeven, posisi TETAP floating (belum ditutup penuh).
function formatAutoPartial(pos, now, isDemo) {
  return `${_nyopetBadge(pos, isDemo)} ${shortId(pos.id)} — Partial TP Diamankan

🟡 Tahap 1: ${pos.realizedPnlUsd >= 0 ? '+' : ''}${fmtUsd(pos.realizedPnlUsd)}
SL sisa digeser breakeven, separuh posisi di-trail.

🔗 ${KAELA_ACCESS_URL}`;
}

// `alasanText` (BARU, 3 Sep 2026) -- WAJIB dioper caller (nyopetAutoTrader.js), sumbernya beda
// tergantung KENAPA ditutup: kode close-reason (SL/TRAIL/dst, lewat CLOSE_REASON_LABEL) buat
// otomatis, teks yang Olan TULIS SENDIRI buat manual -- fungsi ini gak nebak-nebak sendiri.
function formatAutoClosed(trade, now, isDemo, alasanText) {
  const won = trade.pnlUsd >= 0;
  const dirLabel = trade.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
  const pctLine = trade.pnlPct !== undefined && trade.pnlPct !== null
    ? ` (${trade.pnlUsd >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%)` : '';
  return `${_nyopetBadge(trade, isDemo)} ${shortId(trade.id)} — Tutup Posisi

${won ? '✅' : '❌'} ${dirLabel} ${fmtUsd(trade.entryPrice)}→${fmtUsd(trade.exitPrice)}
PnL: ${trade.pnlUsd >= 0 ? '+' : ''}${fmtUsd(trade.pnlUsd)}${pctLine}
Alasan: ${alasanText || '-'}

🔗 ${KAELA_ACCESS_URL}`;
}

module.exports = {
  formatSignal, formatBroken, formatAutoOpen, formatAutoPartial, formatAutoClosed,
  COINGLASS_LINK, KALKULATOR_LINK, KAELA_ACCESS_URL, CLOSE_REASON_LABEL,
  // 3 Sep 2026 -- diexpose biar sniperMultiAccount.js/positionReconciler.js bisa REUSE (desain
  // pesan terpadu, 1 sumber format/helper, gak duplikat fmtUsd/shortId versi masing-masing file).
  fmtUsd, shortId,
};
