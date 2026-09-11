// smartMoneyDivergenceMonitor.js -- Jalankan tiap siklus (15 menit): node smartMoneyDivergenceMonitor.js
//
// 12 Sep 2026, permintaan Olan ("kalo long short secara duit perbandingannya aneh boleh di info?",
// lanjutan riset "mikir kayak bandar/market maker" -- lihat feedback-market-maker-mindset).
//
// Beda dari squeezeDetector.js (funding rate + Open Interest, cek tiap 4 jam) -- ini bandingin DUA
// CARA HITUNG long/short trader KAKAP (top 20% by margin balance) dari endpoint resmi Binance:
//   - topLongShortAccountRatio -- per JUMLAH AKUN (1 akun kakap kecil = 1 akun kakap gede, SAMA BOBOT)
//   - topLongShortPositionRatio -- per NILAI POSISI/$ (whale gede bobotnya lebih berat)
// Kalau DUA angka ini beda jauh (apalagi sampai KEBALIKAN arah), itu pola "gembala vs whale" --
// mayoritas akun kakap ikut 1 arah (by count), TAPI segelintir whale pasang posisi RAKSASA arah
// BERLAWANAN yang nge-outweight semuanya secara duit. Itu "makanan" yang berpotensi di-squeeze.
//
// Semua endpoint PUBLIK Binance, GRATIS, GAK BUTUH API key/akun sama sekali.
// Ini MURNI radar/pengamatan posisi, BUKAN sinyal entry -- Kaela gak buka posisi dari ini.

const fs = require('fs');
const path = require('path');
const { fetchBinancePositioning } = require('./marketSentiment');
const { fetchWithRetry } = require('./httpRetry');
const { recordSnapshot } = require('./smartMoneyResearchLog');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { WEB_URL } = require('./config');

const STATE_PATH = path.join(__dirname, 'smart-money-divergence-state.json');
const FLIP_COUNT_THRESHOLD = 55; // mayoritas jelas 1 arah (by count) kalau >= ini
const GAP_THRESHOLD_PCT = 20;    // selisih |countLongPct - dollarLongPct| >= ini dianggap "aneh" walau gak sampai kebalik total
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 jam -- data update tiap 5 menit, jangan spam tiap kondisi masih sama

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastType: null, lastAlertTime: null };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { lastType: null, lastAlertTime: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

// topLongShortAccountRatio -- top trader by JUMLAH AKUN (endpoint resmi Binance, BELUM dipakai
// modul lain -- marketSentiment.js cuma pakai versi position/$ + global by account).
async function fetchTopByAccountCount(symbol = 'BTCUSDT') {
  const res = await fetchWithRetry(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`);
  const item = (await res.json())[0];
  return { longPct: parseFloat(item.longAccount) * 100, shortPct: parseFloat(item.shortAccount) * 100 };
}

function classify(countLongPct, dollarLongPct) {
  const gap = countLongPct - dollarLongPct;
  const countMajorityLong = countLongPct >= FLIP_COUNT_THRESHOLD;
  const countMajorityShort = countLongPct <= (100 - FLIP_COUNT_THRESHOLD);
  const flipToShort = countMajorityLong && dollarLongPct < 50; // mayoritas akun LONG, tapi $ net SHORT
  const flipToLong = countMajorityShort && dollarLongPct > 50; // mayoritas akun SHORT, tapi $ net LONG
  if (flipToShort) return { type: 'flip_to_short', gap };
  if (flipToLong) return { type: 'flip_to_long', gap };
  if (Math.abs(gap) >= GAP_THRESHOLD_PCT) return { type: gap > 0 ? 'gap_long_heavy_count' : 'gap_short_heavy_count', gap };
  return { type: 'normal', gap };
}

function formatAlert({ type, countLongPct, dollarLongPct, globalLongPct, gap, price }) {
  const LABEL = {
    flip_to_short: { judul: 'MAYORITAS AKUN KAKAP LONG, TAPI DUIT NET SHORT', catatan: 'Kebanyakan akun kakap ikut LONG, TAPI segelintir whale pasang posisi SHORT RAKSASA yang nge-outweight semuanya secara duit -- retail/akun kecil yang ikut long berpotensi jadi "makanan" kalau whale ini menang.' },
    flip_to_long: { judul: 'MAYORITAS AKUN KAKAP SHORT, TAPI DUIT NET LONG', catatan: 'Kebanyakan akun kakap ikut SHORT, TAPI segelintir whale pasang posisi LONG RAKSASA yang nge-outweight semuanya secara duit -- pola kebalikan dari squeeze biasa, whale ini yang pegang kendali arah.' },
    gap_long_heavy_count: { judul: 'JUMLAH AKUN LEBIH LONG DARIPADA NILAI DUITNYA', catatan: 'Banyak akun kakap ikut LONG (mayoritas jumlah), tapi kalau ditimbang duit porsinya gak sebesar itu -- posisi long-nya lebih "ramai-ramai kecil" drpd "whale gede".' },
    gap_short_heavy_count: { judul: 'JUMLAH AKUN LEBIH SHORT DARIPADA NILAI DUITNYA', catatan: 'Banyak akun kakap ikut SHORT (mayoritas jumlah), tapi kalau ditimbang duit porsinya gak sebesar itu -- posisi short-nya lebih "ramai-ramai kecil" drpd "whale gede".' },
  }[type];
  return [
    `⬛ 🐋 KAELA — DIVERGENSI SMART MONEY (BTC)`,
    '',
    LABEL.judul,
    '',
    LABEL.catatan,
    '',
    `Harga sekarang: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    `Top trader by JUMLAH AKUN: ${countLongPct.toFixed(1)}% long / ${(100 - countLongPct).toFixed(1)}% short`,
    `Top trader by NILAI POSISI ($): ${dollarLongPct.toFixed(1)}% long / ${(100 - dollarLongPct).toFixed(1)}% short`,
    globalLongPct != null ? `Akun global (mayoritas retail): ${globalLongPct.toFixed(1)}% long` : null,
    `Selisih (jumlah akun - nilai duit): ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} poin`,
    '',
    '⚠️ Ini MURNI radar/pengamatan posisi (riset pola "mikir kayak bandar"), BUKAN sinyal entry -- Kaela gak buka posisi dari ini.',
    '',
    `🔗 ${WEB_URL}`,
  ].filter(Boolean).join('\n');
}

async function safeFetchBtcPrice() {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT');
    return parseFloat((await res.json()).price);
  } catch { return null; }
}

async function main() {
  const now = new Date();
  const state = loadState();

  const [topByCount, positioning, price] = await Promise.all([
    fetchTopByAccountCount('BTCUSDT'),
    fetchBinancePositioning('BTCUSDT'),
    safeFetchBtcPrice(),
  ]);

  const countLongPct = topByCount.longPct;
  const dollarLongPct = positioning.topLongPct;
  const globalLongPct = positioning.globalLongPct;

  const { type, gap } = classify(countLongPct, dollarLongPct);
  console.log(`[SmartMoneyDivergence] ${now.toISOString()} -- top by count: ${countLongPct.toFixed(1)}% long, top by $: ${dollarLongPct.toFixed(1)}% long, gap: ${gap.toFixed(1)}, type: ${type}`);

  // 12 Sep 2026 -- arsip TERUS-MENERUS (bukan cuma pas anomali) buat numpuk histori sendiri,
  // krn Binance cuma nyimpen 30 hari (lihat smartMoneyResearchLog.js). Gak pengaruhi keputusan
  // WA/cooldown di bawah -- murni riset.
  try {
    recordSnapshot({ countLongPct, dollarLongPct, globalLongPct, gap, type, btcPrice: price });
  } catch (e) {
    console.log('[SmartMoneyDivergence] Gagal catat arsip riset (dilewatin, gak fatal):', e.message);
  }

  if (type === 'normal') {
    if (state.lastType) console.log('[SmartMoneyDivergence] Kondisi udah normal lagi, reset state.');
    saveState({ lastType: null, lastAlertTime: null });
    return;
  }

  const cooldownOk = state.lastType !== type || !state.lastAlertTime || now.getTime() - new Date(state.lastAlertTime).getTime() > COOLDOWN_MS;
  if (!cooldownOk) {
    console.log(`[SmartMoneyDivergence] ${type} masih sama & masih cooldown, skip kirim.`);
    return;
  }

  const msg = formatAlert({ type, countLongPct, dollarLongPct, globalLongPct, gap, price: price || 0 });
  console.log(msg + '\n');
  addEntry('smart-money-divergence', msg, now);
  await sendWhatsApp(msg);
  saveState({ lastType: type, lastAlertTime: now.toISOString() });
}

module.exports = { main, classify, fetchTopByAccountCount };

if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR smartMoneyDivergenceMonitor.js:', e.message);
    process.exit(1);
  });
}
