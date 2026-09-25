// Format pesan Dark Kaela -- 🥷 (nyopet yang jahil/nyolong + dark yang misterius, permintaan Olan
// 15 Agu 2026: "emoticon yang sesuai... karena nyopet wkwkw dan dark"). Badge teks awalnya
// "[Dark] Kaela", DISAMAIN 13 Sep 2026 ke konvensi terkini "🥷 NYOPET · Kaela" (sinyal)/
// "🥷 NYOPET · Manual Olan" (manual) biar auto/manual/sinyal satu bahasa badge yang sama.
// formatSignal/formatBroken CUMA INFO, gak pernah eksekusi/rekomendasi keras -- disclaimer WAJIB
// lebih tegas dari Sniper (leverage jauh lebih agresif, ~100x/nyawa 1%).

// Link Liquidation Heat Map (15 Agu 2026, permintaan Olan -- lebih spesifik dari halaman
// LiquidationData biasa, langsung nampilin peta panas buat cek kelakuan candle di zona).
const { roleOpener } = require('./teamRoles');

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
// `signalId` (25 Sep 2026, unifikasi desain Sniper) -- Sniper punya id sendiri format base36
// (bukan timestamp murni kayak Ranger/Ninja), digit-extraction di atas jadi gak berarti buat dia --
// Sniper sebenarnya udah punya identifier manusiawi SENDIRI yang LEBIH BAIK (dayKey+urutan harian,
// mis. "2026092501", lihat sniperOrders.js createOrder) -- kalau caller ngasih ini, PAKAI ITU
// LANGSUNG (gak perlu digit-extraction sama sekali), gak nebak-nebak dari id.
function shortId(id, signalId) {
  if (signalId) return '#' + signalId;
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
  return `🏹 RANGER · Kaela — 💸 Sinyal Ranger Market
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
  return `🏹 RANGER · Kaela — 💸 Sinyal Ranger Market
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
  // ninjaTrader.js (23 Sep 2026) -- alasan BUKA ke-3 (setelah chart-pattern/FVG), SAMA
  // badge "NYOPET" (Olan eksplisit: "mode ada Sniper ada Nyopet.. channel breakout itu alasan
  // buka posisi" -- BUKAN badge/mode terpisah). 1 label GENERIK buat 2 varian (TP Tetap/Trailing)
  // -- detail MEKANISME EXIT (yang beda antar varian) itu tugas CLOSE_REASON_LABEL (CB_TRAIL/CB_TP/
  // CB_SL di bawah), bukan diulang di sini.
  channel_breakout: 'Channel Breakout -- harga breakout terkonfirmasi dari channel konsolidasi candle 5-menit',
  // Varian BEARISH (25 Sep 2026, unifikasi desain pesan Sniper+Ranger+Ninja -- Sniper punya sinyal
  // short window-bear yang sebelumnya pakai teks lokal sendiri di sniperOrderLog.js PATTERN_EXPLAIN,
  // dipindah ke sini biar 1 sumber dipakai semua caller, bukan duplikat).
  flag_bear: 'Chart Pattern (Bear Flag) -- breakout tiang+bendera turun terkonfirmasi',
  pennant_bear: 'Chart Pattern (Bearish Pennant) -- breakout tiang+segitiga turun terkonfirmasi',
  wedge_rising: 'Chart Pattern (Rising Wedge) -- breakout wedge naik terkonfirmasi (pembalikan turun)',
  fvg_bounce_bear: 'FVG Bounce (bearish) -- harga ditolak dari Fair Value Gap (zona resistance), deket zona (gak nge-chase)',
};
function patternReason(mode) { return PATTERN_REASON_LABEL[mode] || patternTag(mode); }

// Harga LIKUIDASI (14 Agu 2026, permintaan Olan: "ada liquidated dimana" -- awalnya CUMA di pesan
// Sniper/sniperOrderLog.js, 25 Sep 2026 dipindah ke sini biar Ranger/Ninja kebagian juga lewat
// formatAutoOpen, unifikasi "1 desain terbaik" permintaan Olan) -- BEDA dari SL walau sering
// deket/sama: margin abis kalau harga gerak 100/leverage% lawan posisi. SL biasanya kena DULUAN
// (floor(leverage) di calculator.js ngasih buffer kecil), tapi titik likuidasi sesungguhnya tetap
// ditampilkan terpisah, jangan disamain sama SL biar gak nyesatin.
function liquidationPrice(entryPrice, leverage, direction) {
  if (!leverage || !entryPrice) return null;
  const distPct = 100 / leverage;
  return direction === 'sell' ? entryPrice * (1 + distPct / 100) : entryPrice * (1 - distPct / 100);
}

// Kode close-reason internal (nyopetAutoTrader.js) -> teks manusia, dipakai baris "Alasan:" pas
// nutup posisi OTOMATIS (bukan manual Olan -- itu pakai teks yang DIA TULIS SENDIRI, lihat caller).
const CLOSE_REASON_LABEL = {
  SL: 'Stop Loss kena', SL_BREAKEVEN: 'SL breakeven kena (abis partial TP tahap 1)',
  TRAIL: 'Trend patah (trailing SMA)', OFFLINE: 'Kelikuidasi/tertutup pas eksekutor offline, baru kesinkron sekarang',
  // (5 Sep 2026, Fed Dovish Grid) -- TP/SL di sini beda dari chart-pattern (agregat % modal dari
  // basket, bukan harga tunggal) tapi teksnya sengaja tetap simpel/sama gaya biar konsisten dibaca.
  TP: 'Take Profit agregat kena', TIMEOUT_GRID: 'Hold maksimal 7 hari kesentuh, tutup basket',
  REVERSAL: 'Sinyal balik arah (hawkish) muncul, tutup duluan biar aman',
  // (13 Sep 2026, permintaan Olan: "saat window bull habis jangan long lagi, tutup walau rugi..
  // takut kena bom bear" / "saat window bear habis jangan short, tutup walau rugi.. takut kena
  // tiang ijo") -- window regime ganti, posisi yang lagi kebuka jadi ARAH SALAH buat rezim baru,
  // ditutup PAKSA walau rugi drpd nekat nunggu SL asli kena di kondisi yang udah berubah total.
  WINDOW_FLIP: 'Window rezim ganti (bull<->bear), posisi ini jadi arah salah -- ditutup paksa demi keamanan (walau rugi)',
  // ninjaTrader.js (23 Sep 2026, permintaan Olan: "alasan buka trailing alasan tutup,
  // mode nyopet") -- kode CB_ (prefix Channel Breakout) biar gak ketuker sama SL/TRAIL/TP Nyopet
  // lama yang mekanismenya beda (SMA trail vs trailing-% channel, dll).
  CB_SL: 'Stop Loss kena -- breakout ternyata gagal lanjut (fakeout)',
  CB_TP: 'Target Profit tercapai (1:1 R:R dari lebar channel)',
  // 🐛 FIX 26 Sep 2026 (Olan: "cek anomali pesan trailing boleh kok") -- SEBELUMNYA teks ini
  // SELALU bilang "sempat untung", padahal trailing invalidation bisa juga kena di level AWAL
  // (belum pernah sempat ratchet naik/turun sama sekali, kalau harga langsung lawan arah dari
  // entry) -- posisi kayak gitu BISA TUTUP RUGI tanpa pernah "sempat untung" beneran, teks lama
  // jadi salah/menyesatkan buat kasus itu. Sekarang netral -- gak nebak status untung/rugi (✅/❌
  // + angka PnL di baris atasnya udah cukup buat itu), cuma jelasin MEKANISME apa yang kena.
  CB_TRAIL: 'Trailing stop kena -- harga nyentuh level yang otomatis nyesuain sejak entry (ratchet cuma ke arah untung)',
};

function _isManual(pos) { return pos.mode === 'manual' || pos.patternType === 'manual'; }

// Badge exchange TERPUSAT (25 Sep 2026, sebelumnya tiap file define sendiri-sendiri lokal --
// ninjaTrader.js/positionReconciler.js -- sekarang SATU sumber dipakai Sniper/Ranger/
// Ninja biar warnanya konsisten kalau ada exchange baru nanti). File LAMA yang udah punya versi
// lokal sendiri (positionReconciler.js) SENGAJA gak diubah (resiko regresi kecil, gak worth-nya
// buat perubahan kosmetik doang di file yang udah jalan).
const EXCHANGE_BADGE = { binance: '🟨 Binance', mexc: '🔷 MEXC', bingx: '🟣 BingX', bitget: '🟢 Bitget' };

// Nama+emoji sistem (25 Sep 2026, permintaan Olan: rename biar konsisten -- Sniper harian tetap
// "Sniper", Nyopet 4-jam jadi "Ranger" (Sniper tapi timeframe lebih rendah, sinyal masih agak
// jarang), Channel Breakout 5-menit jadi "Ninja" (gesit, super sering -- ambil alih nama & badge
// 🥷 yang tadinya dipakai Nyopet). Default TETAP NYOPET/🥷 buat backward-compat -- caller LAMA yang
// belum sempat update systemLabel-nya gak berubah pesannya sama sekali.
const SYSTEM_LABEL = {
  SNIPER: { emoji: '🎯', name: 'SNIPER' },
  RANGER: { emoji: '🏹', name: 'RANGER' },
  NINJA: { emoji: '🥷', name: 'NINJA' },
};

// (12 Sep 2026, permintaan Olan: "Manual (Olan) / Auto (Kaela)" -- badge auto sekarang eksplisit
// nyebut "Kaela" juga, sejajar sama MANUAL_BADGE "Manual (Olan)" di bawah.
// `exchangeBadge` (23 Sep 2026, permintaan Olan: "badge exchange juga dipake di pesan buka
// tutup" -- setelah Channel Breakout pindah ke BingX sementara Sniper/Nyopet tetap Binance/MEXC,
// shareholder butuh liat sekilas exchange mana dari pesan auto, PERSIS alasan exchangeBadge udah
// dipake di pesan manual/positionReconciler.js) -- OPSIONAL, undefined -> badge PERSIS sama
// kayak sebelumnya (caller Sniper/Nyopet lama gak perlu diubah).
// `system` (25 Sep 2026) -- OPSIONAL, default {emoji:'🥷',name:'NYOPET'} (backward-compat) --
// caller BARU (nyopetAutoTrader.js/ninjaTrader.js/sniperOrderLog.js) oper
// SYSTEM_LABEL.RANGER/NINJA/SNIPER eksplisit.
function _rangerBadge(pos, isDemo, exchangeBadge, system = { emoji: '🥷', name: 'NYOPET' }) {
  return `${system.emoji} ${system.name} · ${_isManual(pos) ? 'Manual Olan' : 'Kaela'} ${pos.assetLabel || 'BTC'}${isDemo ? ' (Demo)' : ''}${exchangeBadge ? ' · ' + exchangeBadge : ''}`;
}

// (5 Sep 2026, permintaan Olan: "nilai investasi juga ada dalam kurung rupiah.. lalu rapikan
// lagi semua pesan trading ini karena buat WhatsApp") -- 3 template di bawah (Buka/Partial/Tutup)
// DIRAPIKAN bareng: *bold* WhatsApp di bagian yang paling penting buat di-skim cepat di grup rame
// (aksi/label baris pertama, arah LONG/SHORT, angka PnL final) -- field lain TETAP polos biar gak
// kebanyakan bold (kontras ilang kalau semua ditebelin). `idrRate` null/gagal -> fmtUsdWithIdr
// sendiri fallback USD doang, gak pernah gugurin pesan gara-gara kurs gagal kebaca.
// (13 Sep 2026, permintaan Olan: "tiru [app Binance] tapi ga persis, per baris gitu biar gak
// tumpukan" -- screenshot app Binance-nya 1 metrik = 1 baris jelas, beda dari sini yang tadinya
// numpuk "TP1: X · SL: Y" di 1 baris) -- TP dan SL SEKARANG baris terpisah, gampang di-skim.
// `todaysPnl` (13 Sep 2026, permintaan Olan: "pesan tambah posisi perlu diikuti pnl hari ini..
// buat semua ya jangan ini aja") -- Buka Posisi SEKARANG ikut kasih gambaran besar hari itu, SAMA
// kayak Partial/Tutup yang udah duluan punya baris ini. Taro PALING BAWAH (abis smartMoneyLine)
// biar urutan baca tetap: apa yang kejadian -> alasan/konteks pattern -> baru gambaran hari ini.
// `pos.patternType || pos.mode` (25 Sep 2026, unifikasi desain) -- Ranger/Ninja set `pos.mode`
// SAMA PERSIS dengan patternType (lihat rangerAutoTrader.js), tapi Sniper punya `mode` yang artinya
// BEDA (kategori kasar 'sniper'/'fvg', bukan patternType) -- patternType ASLI-nya field terpisah.
// Prioritasin patternType kalau ada, biar caller manapun (Sniper termasuk) dapet alasan yang BENER.
function formatAutoOpen(pos, now, dxyLine, isDemo, idrRate, smartMoneyLine, todaysPnl, exchangeBadge, system) {
  const dirLabel = pos.direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const alasan = _isManual(pos) ? (pos.manualReason || 'Manual Olan (gak diisi alasan)') : patternReason(pos.patternType || pos.mode);
  const liqPrice = liquidationPrice(pos.entryPrice, pos.leverage, pos.direction);
  return `${_rangerBadge(pos, isDemo, exchangeBadge, system)} ${shortId(pos.id, pos.signalId)} — *Buka Posisi*
${dirLabel} @ ${fmtUsd(pos.entryPrice)}

TP1: ${pos.tp != null ? fmtUsd(pos.tp) : '(trailing, ngikutin harga terbaik yang dicapai)'}
SL: ${fmtUsd(pos.sl)}${liqPrice != null ? `\nLikuidasi: ${fmtUsd(liqPrice)}` : ''}
Margin: ${fmtUsdWithIdr(pos.marginUsd, idrRate)} (${pos.leverage}x)
Nilai Investasi: ${fmtUsdWithIdr(pos.nilaiPosisi, idrRate)}
Alasan: ${alasan}${dxyLine ? '\n' + dxyLine : ''}${smartMoneyLine ? '\n' + smartMoneyLine : ''}${_todaysPnlLine(todaysPnl, idrRate)}

🔗 ${KAELA_ACCESS_URL}`;
}

// (5 Sep 2026, method baru "Fed Dovish Grid") -- notif TIAP KALI nambah layer stacking (basket
// masih floating, BUKAN posisi baru/tutup posisi). `pos.layers` = jumlah layer SETELAH ditambah.
// `todaysPnl` -- lihat catatan di formatAutoOpen di atas, alasan sama persis.
function formatAutoAddLayer(pos, now, isDemo, idrRate, todaysPnl, exchangeBadge, system) {
  return `${_rangerBadge(pos, isDemo, exchangeBadge, system)} ${shortId(pos.id, pos.signalId)} — *Nambah Posisi* (Layer ${pos.layers})
🟢 *LONG* rata-rata baru @ ${fmtUsd(pos.entryPrice)}

Margin total: ${fmtUsdWithIdr(pos.marginUsd, idrRate)} (${pos.leverage}x)
Nilai Investasi: ${fmtUsdWithIdr(pos.nilaiPosisi, idrRate)}${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: Harga bergerak lawan arah, nyicil sesuai rencana stacking (masih dalam batas SL agregat)

🔗 ${KAELA_ACCESS_URL}`;
}

// Tahap 1 (30 Agu 2026, Nyopet v2 -- exit 2-tahap sama kayak Sniper) -- separuh posisi diamankan,
// SL sisa geser breakeven, posisi TETAP floating (belum ditutup penuh).
// `pos.trailSmaLen` (25 Sep 2026, unifikasi desain -- opsional) -- Sniper ngasih tau PERSIS SMA
// berapa hari dipakai buat trail sisa posisi + harga breakeven eksaknya (lebih lengkap dari teks
// generik). Ranger/Ninja gak ngirim field ini -- fallback ke teks generik APA ADANYA, gak berubah.
function formatAutoPartial(pos, now, isDemo, idrRate, todaysPnl, exchangeBadge, system) {
  const sign = pos.realizedPnlUsd >= 0 ? '+' : '';
  const detailLine = (pos.entryPrice != null && pos.trailSmaLen)
    ? `SL sisa digeser ke BREAKEVEN (${fmtUsd(pos.entryPrice)}) -- gak bisa rugi lagi dari sini. Sisa posisi di-trail SMA${pos.trailSmaLen} sampai momentum patah.`
    : 'SL sisa digeser breakeven, separuh posisi di-trail.';
  return `${_rangerBadge(pos, isDemo, exchangeBadge, system)} ${shortId(pos.id, pos.signalId)} — *Partial TP Diamankan*
🟡 Tahap 1: *${sign}${fmtUsdWithIdr(pos.realizedPnlUsd, idrRate)}*${_todaysPnlLine(todaysPnl, idrRate)}

${detailLine}

🔗 ${KAELA_ACCESS_URL}`;
}

// `alasanText` (3 Sep 2026) -- WAJIB dioper caller (nyopetAutoTrader.js), sumbernya beda
// tergantung KENAPA ditutup: kode close-reason (SL/TRAIL/dst, lewat CLOSE_REASON_LABEL) buat
// otomatis, teks yang Olan TULIS SENDIRI buat manual -- fungsi ini gak nebak-nebak sendiri.
// 23 Sep 2026, permintaan Olan ("tutup posisi sertakan winrate dan akumulasi profit", dipakai
// PERTAMA di Channel Breakout, SEKARANG disamain ke Nyopet chart-pattern/FVG juga) -- helper
// SATU sumber (bukan duplikat 2x di ninjaTrader.js DAN nyopetAutoTrader.js). Caller
// nyuntik ke output formatAutoClosed via .replace() pas link, lihat contoh pemakaian di 2 file itu.
function formatWinRateLines(stats, label, idrRate) {
  const total = stats.wins + stats.losses;
  const pct = total > 0 ? (stats.wins / total * 100) : 0;
  return `Win rate ${label}: ${stats.wins}/${total} (${pct.toFixed(1)}%)\n`
    + `Akumulasi profit ${label}: ${stats.totalPnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(stats.totalPnlUsd, idrRate)}\n\n`;
}

// `trade.feeUsd` (26 Sep 2026, permintaan Olan "aku mau fee trading tampil juga, biar ketemu net
// trading" -- MASTER_RULE_DYNAMIC_CANDLE_INVALIDATION Bagian 3-5+22, "Prompt Awal Backtest Wajib"
// v3.4: "Tampilkan gross vs net berdampingan") -- OPSIONAL, caller kirim fee ROUND-TRIP (entry+exit,
// fallback 0.10% per Bagian 4 kalau fee real exchange gak kebaca -- lihat masterRuleTrailingInvalidation.js
// FALLBACK_FEE_PERCENT). Kalau gak dikirim, baris PnL TETAP APA ADANYA (backward-compat, caller
// lama -- Ranger/Sniper yang belum sempat dikasih nilaiPosisi di titik tutup -- gak berubah pesannya
// sama sekali). Status ✅/❌ pakai PnL BERSIH (setelah fee) kalau ada, biar jujur -- trade yang
// gross untung tapi abis fee jadi rugi HARUS keliatan ❌, bukan ✅ yang menyesatkan.
function formatAutoClosed(trade, now, isDemo, alasanText, idrRate, todaysPnl, exchangeBadge, system) {
  const hasFee = trade.feeUsd != null;
  const netPnl = hasFee ? trade.pnlUsd - trade.feeUsd : trade.pnlUsd;
  const won = netPnl >= 0;
  const dirLabel = trade.direction === 'long' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const grossSign = trade.pnlUsd >= 0 ? '+' : '';
  const pctLine = trade.pnlPct !== undefined && trade.pnlPct !== null ? ` (${grossSign}${trade.pnlPct.toFixed(1)}%)` : '';
  const pnlBlock = hasFee
    ? `PnL Kotor: ${grossSign}${fmtUsdWithIdr(trade.pnlUsd, idrRate)}${pctLine}\nFee (round-trip): -${fmtUsdWithIdr(trade.feeUsd, idrRate)}\nPnL Bersih: *${netPnl >= 0 ? '+' : ''}${fmtUsdWithIdr(netPnl, idrRate)}*`
    : `PnL: *${grossSign}${fmtUsdWithIdr(trade.pnlUsd, idrRate)}${pctLine}*`;
  return `${_rangerBadge(trade, isDemo, exchangeBadge, system)} ${shortId(trade.id, trade.signalId)} — *Tutup Posisi*
${won ? '✅' : '❌'} ${dirLabel} ${fmtUsd(trade.entryPrice)} → ${fmtUsd(trade.exitPrice)}

${pnlBlock}${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: ${alasanText || '-'}

🔗 ${KAELA_ACCESS_URL}`;
}

// (12 Sep 2026, BUG NYATA ketemu+fix -- Olan: "posisi ngarang dia buat", dibuktikan cross-check
// ke income history Binance ASLI) -- KHUSUS posisi `mode==='unknown'` (hasil AUTO-ADOPT) yang
// closePosition() gak berani hitung mundur exitPrice/PnL-nya lagi (lihat komentar closePosition,
// nyopetAutoTrader.js -- posisi kayak gini SANGAT RAWAN kecampur manual trading Olan langsung,
// hasil hitungannya kebukti ngarang). Pesan ini JUJUR ngaku gak tau angkanya drpd nyebar data
// palsu -- beda TOTAL dari formatAutoClosed (yang SELALU asumsi exitPrice/pnlUsd itu angka nyata).
// 13 Sep 2026, kritik Olan ("perbaiki dulu ini") atas pesan #937603 -- kalimat LAMA nuduh
// "kemungkinan besar disentuh trading manual langsung" sbg SATU-SATUNYA dugaan, padahal per
// histori bug nyata di titik adopsi (nyopetAutoTrader.js, insiden 3/8/12 Sep 2026), penyebab yang
// SAMA MUNGKINNYA (bahkan lebih sering kejadian di histori proyek ini) adalah MESIN EKSEKUTOR
// PINDAH LEADER (`multi-account-state/` SENGAJA gak disinkron git -- data personal, lihat
// .gitignore -- jadi journal lokal mesin BARU "lupa total" posisi yang aslinya dibuka mesin LAMA,
// padahal itu 100% posisi Kaela sendiri, BUKAN manual Olan). Nuduh "manual" doang di sini BISA
// bikin Olan ngerasa disalahin buat kesalahan yang sebenarnya bukan aksinya -- gak jujur/adil
// kalau sistem sendiri gak tau pasti mana dari 2 kemungkinan ini yang beneran kejadian.
function formatAutoClosedUntracked({ id, direction, assetLabel, entryPrice }, isDemo) {
  const dirLabel = direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
  return `${roleOpener('DRAKE', 'ada posisi Nyopet yang gak ke-track')}

🥷 NYOPET ${assetLabel || 'BTC'}${isDemo ? ' (Demo)' : ''} ${shortId(id)} — *Tutup Posisi (gak ke-track)*
⚠️ ${dirLabel} @ ${fmtUsd(entryPrice)} -- posisi ini sempat kedetect hidup di exchange tapi journal Kaela sendiri gak pernah beneran nyatet buka-nya, sekarang udah gak ada lagi. Kaela GAK BISA mastiin kenapa dari sini -- 2 kemungkinan yang SAMA-SAMA masuk akal: (1) disentuh trading manual langsung di exchange, ATAU (2) mesin eksekutor sempat pindah (data posisi ini memang sengaja gak disinkron antar-mesin) sehingga posisi Kaela sendiri "kelupaan" jurnalnya -- BUKAN berarti ini otomatis manual.

Harga tutup & PnL SENGAJA gak dihitung di sini biar gak nyebar angka ngarang -- kalau ini manual, angka akuratnya udah dilaporin terpisah lewat pesan 🙋 MANUAL. Kalau bukan (kemungkinan #2), cek langsung riwayat exchange buat angka pastinya.

🔗 ${KAELA_ACCESS_URL}

— Kaela`;
}

// ============ Manual di luar sistem (positionReconciler.js) -- (5 Sep 2026, permintaan Olan:
// "semua pesan broadcast trading perlu disamakan semua kerangkanya") ============
// SEBELUMNYA punya template SENDIRI (beda struktur, beda fmtUsd lokal) dari formatAutoOpen/dst di
// atas -- sekarang DISATUKAN ke sini (badge, bold, urutan field, fmtUsd/fmtUsdWithIdr) SAMA PERSIS
// gayanya, cuma badge sumbernya beda ("🙋 MANUAL (luar sistem)" + badge exchange) biar shareholder
// tetap bisa bedain "kedetect di exchange" vs "posisi bot/manual lewat web" (KEPUTUSAN SADAR,
// bukan kebetulan belum diseragamin -- exchange gak ngasih tau ALASAN posisi ini, beda dari semua
// method lain yang SELALU punya alasan tercatat).
// (12 Sep 2026, permintaan Olan: "Manual (Olan) / Auto (Kaela)... hapus tulisan diluar sistem,
// biar ringkas") -- versi lama "MANUAL (luar sistem)" DIPENDEKIN, badge sekarang eksplisit nyebut
// SIAPA yang trading (Olan), sejajar sama badge auto (🎯 SNIPER/🥷 NYOPET yang notabene "Kaela").
const MANUAL_BADGE = '🙋 Manual (Olan)';
// (12 Sep 2026, permintaan Olan: "alasan yang manual ga usah kepanjangan.. cukup alasan open
// posisi manual") -- DIPENDEKIN dari versi lama yang jelasin detail kenapa (exchange gak ngasih
// tau alasannya, dst) -- sekarang cukup label singkat, konsisten sama RANGER_MODE_LABEL_WEB.manual
// di kaela-render.js.
const MANUAL_ALASAN = 'Posisi manual (dibuka langsung di exchange)';

// `todaysPnl` (13 Sep 2026, permintaan Olan: "pesan tambah posisi perlu diikuti pnl hari ini..
// buat semua ya jangan ini aja") -- Buka/Nambah Posisi SEKARANG ikut nunjukin gambaran besar hari
// itu, SAMA kayak Tutup/Kurangin/Balik Arah yang UDAH lebih dulu punya baris ini (lihat komentar
// panjang `_todaysPnlLine` di bawah -- alasan asalnya sama: 1 angka doang bisa nyesatin tanpa
// konteks total). `null` -> baris diilangin, JANGAN nampilin $0 yang kesannya beneran impas.
function formatManualOpen({ exchangeBadge, symbol, direction, entryPrice, leverage, marginUsd, nilaiPosisi, todaysPnl }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Buka Posisi*
${dirLabel} @ ${fmtUsd(entryPrice)}

Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

// 19 Sep 2026, permintaan Olan setelah insiden FOMC ("trading 100% ku serahkan ke Kaela...
// posisi non-Kaela boleh auto-close") -- BEDA dari formatManualOpen di atas (yang cuma LAPOR):
// ini dipakai KHUSUS pas positionReconciler.js BENERAN nutup paksa posisi manual yang kedetek
// (dikonfirmasi PASTI bukan order Kaela lewat cek clientOrderId/externalOid ke exchange
// langsung -- lihat wasLastEntryOrderByKaela di binanceExecutor.js/mexcExecutor.js -- BUKAN
// dari asumsi/jurnal lokal doang). `closePnlUsd` = PnL dari auto-close ITU SENDIRI (biasanya
// kecil/dekat entry, ditutup SEGERA begitu kedetek, beda dari PnL akhir kalau dibiarin sampai
// Olan tutup sendiri).
// `closePnlUsd` NULL (bukan 0) kalau gagal kebaca (mis. MEXC, `realizedPnlSince` cuma dukung
// Binance) -- jujur bilang "cek riwayat exchange langsung", JANGAN pura-pura $0 (kesannya
// beneran impas, padahal cuma gak kebaca -- prinsip sama kayak `_todaysPnlLine` di file ini).
function formatManualOpenAutoClosed({ exchangeBadge, symbol, direction, entryPrice, closePrice, leverage, marginUsd, nilaiPosisi, closePnlUsd }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = closePnlUsd == null
    ? 'PnL auto-close: gak kebaca otomatis -- cek riwayat exchange langsung.'
    : `PnL auto-close: *${closePnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(closePnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Buka Posisi TERDETEKSI, LANGSUNG DITUTUP OTOMATIS*
${dirLabel} @ ${fmtUsd(entryPrice)} → ditutup @ ${fmtUsd(closePrice)}

Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}
${pnlLine}
Alasan: Kebijakan Olan (19 Sep 2026) -- SEMUA trading 100% lewat Kaela, posisi non-Kaela otomatis ditutup begitu kedetek. Dipastikan PASTI bukan order Kaela lewat cek langsung ke exchange (bukan tebakan).

🔗 ${KAELA_ACCESS_URL}`;
}

// (12 Sep 2026, permintaan Olan: "jadi pertanyaan di grup.. kok minus terus.. padahal di riwayat
// aku surplus.. tapi ga ketauan.. apa di followup total pnl today?") -- pesan PnL per-transaksi
// (fee tiap flip cepat sering bikin angka KECIL MINUS, lihat komentar formatManualFlip) gak ngasih
// gambaran besarnya -- baris ini nyelipin TOTAL PnL symbol itu HARI INI biar member langsung liat
// konteks, bukan nyimpulkan "rugi terus" dari 1 transaksi kecil doang. `null` (gagal sync/gak ada
// data) -> baris DIILANGIN total, JANGAN nampilin "Rp0"/"$0" yang kesannya beneran nol.
function _todaysPnlLine(todaysPnl, idrRate) {
  if (todaysPnl == null) return '';
  const sign = todaysPnl >= 0 ? '+' : '';
  return `\n📊 Total PnL hari ini: ${sign}${fmtUsdWithIdr(todaysPnl, idrRate)}`;
}

function formatManualClose({ exchangeBadge, symbol, direction, prevEntryPrice, pnlUsd, todaysPnl }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL belum kebaca otomatis -- cek manual di exchange.'
    : `PnL: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Tutup Posisi*
${dirLabel} @ ${fmtUsd(prevEntryPrice)} → ditutup

${pnlLine}${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

// `todaysPnl` -- lihat catatan di formatManualOpen di atas, alasan sama persis.
function formatManualAdd({ exchangeBadge, symbol, direction, entryPrice, prevEntryPrice, leverage, marginUsd, nilaiPosisi, todaysPnl }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Nambah Posisi*
${dirLabel} rata-rata baru @ ${fmtUsd(entryPrice)} (sebelumnya ${fmtUsd(prevEntryPrice)})

Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

// (12 Sep 2026, permintaan Olan: "pesan long short manual dibuat lebih baik") -- `marginUsd`/
// `nilaiPosisi` BARU, buat konsistensi sama Open/Add/Flip: "sisa @ harga" doang gak ngasih
// gambaran BESARNYA posisi yang masih kebuka setelah dikurangin, sekarang eksplisit ditulis.
function formatManualReduce({ exchangeBadge, symbol, direction, entryPrice, marginUsd, nilaiPosisi, pnlUsd, todaysPnl }, idrRate) {
  const dirLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL bagian ini belum kebaca otomatis -- cek manual di exchange.'
    : `PnL bagian yang ditutup: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Kurangin Posisi*
${dirLabel} sisa @ ${fmtUsd(entryPrice)}

${pnlLine}${_todaysPnlLine(todaysPnl, idrRate)}
Sisa Margin: ${fmtUsdWithIdr(marginUsd, idrRate)}
Sisa Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

// (12 Sep 2026, permintaan Olan: "nilai posisi ketika balik arah juga tetep di sertakan kayak pas
// open long/short") -- `marginUsd`/`nilaiPosisi` DULU gak diterima fungsi ini sama sekali (padahal
// positionReconciler.js SEBENARNYA udah ngitung marginUsd buat posisi baru hasil flip, cuma gak
// dioper ke pesan) -- sekarang SAMA kelengkapannya kayak formatManualOpen/formatManualAdd.
function formatManualFlip({ exchangeBadge, symbol, prevDirection, direction, entryPrice, leverage, marginUsd, nilaiPosisi, pnlUsd, todaysPnl }, idrRate) {
  const oldLabel = prevDirection === 'buy' ? '🟢 LONG' : '🔴 SHORT';
  const newLabel = direction === 'buy' ? '🟢 *LONG*' : '🔴 *SHORT*';
  const pnlLine = pnlUsd === null
    ? '⚠️ PnL posisi lama belum kebaca otomatis -- cek manual di exchange.'
    : `PnL posisi lama: *${pnlUsd >= 0 ? '+' : ''}${fmtUsdWithIdr(pnlUsd, idrRate)}*`;
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Balik Arah*
${oldLabel} → ${newLabel} @ ${fmtUsd(entryPrice)}

${pnlLine}${_todaysPnlLine(todaysPnl, idrRate)}
Margin: ${fmtUsdWithIdr(marginUsd, idrRate)} (${leverage || '-'}x)
Nilai Investasi: ${fmtUsdWithIdr(nilaiPosisi, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

// (12 Sep 2026, BUG NYATA ketemu -- Olan nanya: "kalo aku long short long short terus.. dan aku
// menutup total, berapa lama total akumulasi PnL akan dihitung?") -- positionReconciler.js MURNI
// diff 2 snapshot posisi (cek terakhir vs sekarang) -- kalau serangkaian trading manual (flip
// berkali-kali, atau buka-lalu-tutup penuh) semuanya kelar DALAM SATU window ~15 menit dan net
// posisi-nya balik SAMA kayak snapshot sebelumnya (termasuk 0->0), diff-nya NOL -- gak ada
// MANUAL OPEN/CLOSE/ADD/REDUCE/FLIP manapun yang ke-trigger, PnL beneran dari SELURUH rangkaian
// itu HILANG TOTAL, gak pernah dilaporin. Pesan ini nutup celah itu -- ketauan dari income
// history (bukan diff posisi), makanya gak ada 1 "arah"/"harga entry" tunggal buat ditampilin
// (bisa aja beberapa round-trip beda arah dalam 1 window), cukup laporan TOTAL PnL window ini.
function formatHiddenActivity({ exchangeBadge, symbol, pnlUsd, stillOpen, todaysPnl }, idrRate) {
  const sign = pnlUsd >= 0 ? '+' : '';
  return `${MANUAL_BADGE} · ${exchangeBadge} ${symbol} — *Aktivitas Tersembunyi*
⚠️ Posisi net ${stillOpen ? 'gak berubah' : 'balik ke KOSONG'} dari cek terakhir (~15 menit lalu), TAPI kedetect ada trading beneran di antaranya (kemungkinan buka-tutup/balik arah cepat beberapa kali).

PnL total window ini: *${sign}${fmtUsdWithIdr(pnlUsd, idrRate)}*${_todaysPnlLine(todaysPnl, idrRate)}
Alasan: ${MANUAL_ALASAN}

🔗 ${KAELA_ACCESS_URL}`;
}

module.exports = {
  formatSignal, formatBroken, formatAutoOpen, formatAutoPartial, formatAutoClosed, formatAutoClosedUntracked, formatAutoAddLayer,
  formatManualOpen, formatManualOpenAutoClosed, formatManualClose, formatManualAdd, formatManualReduce, formatManualFlip, formatHiddenActivity,
  COINGLASS_LINK, KALKULATOR_LINK, KAELA_ACCESS_URL, CLOSE_REASON_LABEL,
  // 3 Sep 2026 -- diexpose biar sniperMultiAccount.js/positionReconciler.js bisa REUSE (desain
  // pesan terpadu, 1 sumber format/helper, gak duplikat fmtUsd/shortId versi masing-masing file).
  fmtUsd, shortId, fmtUsdWithIdr, formatWinRateLines, liquidationPrice,
  // 12 Sep 2026 -- diexpose biar sniperOrderLog.js (Sniper Club REAL Olan sendiri) bisa reuse SAMA
  // baris "PnL hari ini", bukan reimplementasi/format beda sendiri.
  todaysPnlLine: _todaysPnlLine,
  // 25 Sep 2026 -- badge exchange + nama sistem TERPUSAT (lihat komentar deklarasi masing-masing).
  EXCHANGE_BADGE, SYSTEM_LABEL,
};
