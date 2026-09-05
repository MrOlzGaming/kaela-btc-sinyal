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

// 3 Sep 2026, permintaan Olan: "untuk pnl sertakan idr nya bisa?" -- SUMBER SATU-SATUNYA dipindah
// ke sini dari positionReconciler.js (yang duluan punya ini) biar Sniper/Nyopet PnL juga kebagian,
// bukan cuma Reconciler. `idrRate` dioper dari caller (kaelaProTraderClient.getUsdIdrRate(),
// dipanggil SEKALI per siklus di multiAccountExecutor.js, BUKAN per-pesan) -- gagal/null -> fallback
// USD doang, JANGAN gugurin pesan cuma gara-gara kurs gagal kebaca.
function fmtUsdWithIdr(n, idrRate) {
  const usdText = fmtUsd(n);
  if (!idrRate) return usdText;
  const idr = Math.round((Number(n) || 0) * idrRate);
  return `${usdText} (${idr < 0 ? '-Rp' : 'Rp'}${Math.abs(idr).toLocaleString('id-ID')})`;
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
// econ_reaction (5 Sep 2026, permintaan Olan: "izinkan long/short otomatis dari hasil kalender
// ekonomi") -- METODE BARU Nyopet, beda karakter dari chart-pattern/FVG di atas (news-reaction
// scalp, exit dipaksa ~30 menit, lihat econCalendarLiveMonitor.js + backtest/econReactionBacktest.js).
const PATTERN_TAG_LABEL = {
  flag_bull: 'Flag', pennant_bull: 'Pennant', wedge_falling: 'Wedge', fvg_bounce: 'FVG',
  econ_reaction: 'Econ Reaction', fed_dovish_grid: 'Fed Dovish Grid',
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
  econ_reaction: 'Reaksi Kalender Ekonomi -- BTC bereaksi searah abis rilis data high-impact, ikut kelanjutannya (exit paksa ~30 menit, jendela tervalidasi backtest)',
  fed_dovish_grid: 'Fed Dovish Grid -- BTC bereaksi NAIK abis rilis FOMC/NFP (sinyal dovish) + tren jangka pendek masih naik, nyicil stacking sampai TP/SL agregat atau 7 hari (tervalidasi backtest, LONG-only)',
};
function patternReason(mode) { return PATTERN_REASON_LABEL[mode] || patternTag(mode); }

// Kode close-reason internal (nyopetAutoTrader.js) -> teks manusia, dipakai baris "Alasan:" pas
// nutup posisi OTOMATIS (bukan manual Olan -- itu pakai teks yang DIA TULIS SENDIRI, lihat caller).
const CLOSE_REASON_LABEL = {
  SL: 'Stop Loss kena', SL_BREAKEVEN: 'SL breakeven kena (abis partial TP tahap 1)',
  TRAIL: 'Trend patah (trailing SMA)', OFFLINE: 'Kelikuidasi/tertutup pas eksekutor offline, baru kesinkron sekarang',
  // (5 Sep 2026, Fed Dovish Grid) -- TP/SL di sini beda dari chart-pattern (agregat % modal dari
  // basket, bukan harga tunggal) tapi teksnya sengaja tetap simpel/sama gaya biar konsisten dibaca.
  TP: 'Take Profit agregat kena', TIMEOUT_GRID: 'Hold maksimal 7 hari kesentuh, tutup basket',
  REVERSAL: 'Sinyal balik arah (hawkish) muncul, tutup duluan biar aman',
};

function _isManual(pos) { return pos.mode === 'manual' || pos.patternType === 'manual'; }
function _nyopetBadge(pos, isDemo) {
  return `🥷 NYOPET${_isManual(pos) ? ' · Manual Olan' : ''} ${pos.assetLabel || 'BTC'}${isDemo ? ' (Demo)' : ''}`;
}

// (5 Sep 2026, permintaan Olan: "nilai investasi juga ada dalam kurung rupiah.. lalu rapikan
// lagi semua pesan trading ini karena buat WhatsApp") -- 3 template di bawah (Buka/Partial/Tutup)
// DIRAPIKAN bareng: *bold* WhatsApp di bagian yang paling penting buat di-skim cepat di grup rame
// (aksi/label baris pertama, arah LONG/SHORT, angka PnL final) -- field lain TETAP polos biar gak
// kebanyakan bold (kontras ilang kalau semua ditebelin). `idrRate` null/gagal -> fmtUsdWithIdr
// sendiri fallback USD doang, gak pernah gugurin pesan gara-gara kurs gagal kebaca.
function formatAutoOpen(pos, now, dxyLine, isDemo, idrRate) {
  const dirLabel = pos.direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const alasan = _isManual(pos) ? (pos.manualReason || 'Manual Olan (gak diisi alasan)') : patternReason(pos.mode);
  return `${_nyopetBadge(pos, isDemo)} ${shortId(pos.id)} — *Buka Posisi*
${dirLabel} @ ${fmtUsd(pos.entryPrice)}

TP1: ${fmtUsd(pos.tp)} · SL: ${fmtUsd(pos.sl)}
Margin: ${fmtUsdWithIdr(pos.marginUsd, idrRate)} (${pos.leverage}x)
Nilai Investasi: ${fmtUsdWithIdr(pos.nilaiPosisi, idrRate)}
Alasan: ${alasan}${dxyLine ? '\n' + dxyLine : ''}

🔗 ${KAELA_ACCESS_URL}`;
}

// (5 Sep 2026, method baru "Fed Dovish Grid") -- notif TIAP KALI nambah layer stacking (basket
// masih floating, BUKAN posisi baru/tutup posisi). `pos.layers` = jumlah layer SETELAH ditambah.
function formatAutoAddLayer(pos, now, isDemo, idrRate) {
  return `${_nyopetBadge(pos, isDemo)} ${shortId(pos.id)} — *Nambah Posisi* (Layer ${pos.layers})
🟢 *LONG* rata-rata baru @ ${fmtUsd(pos.entryPrice)}

Margin total: ${fmtUsdWithIdr(pos.marginUsd, idrRate)} (${pos.leverage}x)
Nilai Investasi: ${fmtUsdWithIdr(pos.nilaiPosisi, idrRate)}
Alasan: Harga bergerak lawan arah, nyicil sesuai rencana stacking (masih dalam batas SL agregat)

🔗 ${KAELA_ACCESS_URL}`;
}

// Tahap 1 (30 Agu 2026, Nyopet v2 -- exit 2-tahap sama kayak Sniper) -- separuh posisi diamankan,
// SL sisa geser breakeven, posisi TETAP floating (belum ditutup penuh).
function formatAutoPartial(pos, now, isDemo, idrRate) {
  const sign = pos.realizedPnlUsd >= 0 ? '+' : '';
  return `${_nyopetBadge(pos, isDemo)} ${shortId(pos.id)} — *Partial TP Diamankan*
🟡 Tahap 1: *${sign}${fmtUsdWithIdr(pos.realizedPnlUsd, idrRate)}*

SL sisa digeser breakeven, separuh posisi di-trail.

🔗 ${KAELA_ACCESS_URL}`;
}

// `alasanText` (3 Sep 2026) -- WAJIB dioper caller (nyopetAutoTrader.js), sumbernya beda
// tergantung KENAPA ditutup: kode close-reason (SL/TRAIL/dst, lewat CLOSE_REASON_LABEL) buat
// otomatis, teks yang Olan TULIS SENDIRI buat manual -- fungsi ini gak nebak-nebak sendiri.
function formatAutoClosed(trade, now, isDemo, alasanText, idrRate) {
  const won = trade.pnlUsd >= 0;
  const dirLabel = trade.direction === 'long' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const sign = trade.pnlUsd >= 0 ? '+' : '';
  const pctLine = trade.pnlPct !== undefined && trade.pnlPct !== null ? ` (${sign}${trade.pnlPct.toFixed(1)}%)` : '';
  return `${_nyopetBadge(trade, isDemo)} ${shortId(trade.id)} — *Tutup Posisi*
${won ? '✅' : '❌'} ${dirLabel} ${fmtUsd(trade.entryPrice)} → ${fmtUsd(trade.exitPrice)}

PnL: *${sign}${fmtUsdWithIdr(trade.pnlUsd, idrRate)}${pctLine}*
Alasan: ${alasanText || '-'}

🔗 ${KAELA_ACCESS_URL}`;
}

// ============ Manual di luar sistem (positionReconciler.js) -- (5 Sep 2026, permintaan Olan:
// "semua pesan broadcast trading perlu disamakan semua kerangkanya") ============
// SEBELUMNYA punya template SENDIRI (beda struktur, beda fmtUsd lokal) dari formatAutoOpen/dst di
// atas -- sekarang DISATUKAN ke sini (badge, bold, urutan field, fmtUsd/fmtUsdWithIdr) SAMA PERSIS
// gayanya, cuma badge sumbernya beda ("🙋 MANUAL (luar sistem)" + badge exchange) biar shareholder
// tetap bisa bedain "kedetect di exchange" vs "posisi bot/manual lewat web" (KEPUTUSAN SADAR,
// bukan kebetulan belum diseragamin -- exchange gak ngasih tau ALASAN posisi ini, beda dari semua
// method lain yang SELALU punya alasan tercatat).
const MANUAL_BADGE = '🙋 MANUAL (luar sistem)';
const MANUAL_ALASAN = 'Manual di luar sistem (kedetect di exchange, bukan lewat web -- exchange gak ngasih tau alasannya)';

function formatManualOpen({ exchangeBadge, symbol, direction, entryPrice, leverage, marginUsd, nilaiPosisi }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Buka Posisi*
${dirLabel} @ ${fmtUsd(entryPrice)}

Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

function formatManualClose({ exchangeBadge, symbol, direction, prevEntryPrice, pnlUsd }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.'
    : `PnL: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Tutup Posisi*
${dirLabel} @ ${fmtUsd(prevEntryPrice)} → ditutup

${pnlLine}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

function formatManualAdd({ exchangeBadge, symbol, direction, entryPrice, prevEntryPrice, leverage, marginUsd, nilaiPosisi }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Nambah Posisi*
${dirLabel} rata-rata baru @ ${fmtUsd(entryPrice)} (sebelumnya ${fmtUsd(prevEntryPrice)})

Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

function formatManualReduce({ exchangeBadge, symbol, direction, entryPrice, pnlUsd }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL bagian ini belum kebaca otomatis -- cek manual di exchange.'
    : `PnL bagian yang ditutup: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Kurangin Posisi*
${dirLabel} sisa @ ${fmtUsd(entryPrice)}

${pnlLine}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

function formatManualFlip({ exchangeBadge, symbol, prevDirection, direction, entryPrice, leverage, pnlUsd }, idrRate) {
  const oldLabel = prevDirection === 'buy' ? '🟢 LONG' : '🔴 SHORT';
  const newLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL posisi lama belum kebaca otomatis -- cek manual di exchange.'
    : `PnL posisi lama: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Balik Arah*
${oldLabel} → ${newLabel} @ ${fmtUsd(entryPrice)}

${pnlLine}
Leverage: ${leverage || '-'}x
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

module.exports = {
  formatSignal, formatBroken, formatAutoOpen, formatAutoPartial, formatAutoClosed, formatAutoAddLayer,
  formatManualOpen, formatManualClose, formatManualAdd, formatManualReduce, formatManualFlip,
  COINGLASS_LINK, KALKULATOR_LINK, KAELA_ACCESS_URL, CLOSE_REASON_LABEL,
  // 3 Sep 2026 -- diexpose biar sniperMultiAccount.js/positionReconciler.js bisa REUSE (desain
  // pesan terpadu, 1 sumber format/helper, gak duplikat fmtUsd/shortId versi masing-masing file).
  fmtUsd, shortId, fmtUsdWithIdr,
};
