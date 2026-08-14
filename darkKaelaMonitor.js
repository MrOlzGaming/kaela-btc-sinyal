// Dark Kaela -- monitor LIVE (jalan tiap 5 menit, lihat .github/workflows/dark-kaela-monitor.yml).
// STRUKTUR zona (support/resistance) dihitung dari candle 1 jam (14 hari lookback), tapi cek
// TOUCH beneran-nya pakai candle 5 menit -- biar sinyal keluar SEGERA pas nyentuh, bukan telat
// (fix 15 Agu 2026, lihat catatan TOUCH_INTERVAL di bawah).
// v1: MURNI INFO (keputusan final Olan: "kaela ga usah open posisi untuk nyopet") -- gak ada
// tracking posisi/P&L/bankroll sama sekali, cuma kirim WA + simpan state zona aktif biar anti-spam.

const fs = require('fs');
const path = require('path');
const { fetchCandles } = require('./technicalAnalysis');
const { detectZones, findTouchCandidate, findNearestPair, isZoneBroken, pctDist, DEFAULT_PARAMS } = require('./darkKaelaZones');
const { formatSignal, formatBroken } = require('./darkKaelaLog');
const { sendWhatsApp } = require('./fonnte');

// DRY_RUN (env var DARK_KAELA_DRY_RUN=1) -- buat verifikasi PERTAMA KALI di runner GitHub Actions
// asli TANPA beneran kirim WA ke grup (dipakai sekali doang pas aktivasi awal, 15 Agu 2026).
// Beda dari silentTest Sniper (itu per-order permanen) -- ini flag SEMENTARA level-proses,
// dicabut abis verifikasi awal kelar.
const DRY_RUN = process.env.DARK_KAELA_DRY_RUN === '1';
async function sendWhatsAppOrDryRun(msg) {
  if (DRY_RUN) {
    console.log('[DarkKaelaMonitor] DRY RUN -- gak beneran kirim WA. Pesan yang HARUSNYA terkirim:\n' + msg);
    return;
  }
  await sendWhatsApp(msg);
}

const STATE_PATH = path.join(__dirname, 'dark-kaela-state.json');
// Fetch cukup buat ZONE_WINDOW_CANDLES (14 hari = 336 candle jam-an) + buffer swing lookback.
const FETCH_CANDLES = DEFAULT_PARAMS.ZONE_WINDOW_CANDLES + 50;

// Fix 15 Agu 2026 (komplain Olan: "sinyalmu keluar setelah sentuh likuiditas tinggi lalu dah
// terbang, ketika di buy balik arah lumayan jauh") -- STRUKTUR zona (support/resistance) tetap
// dihitung dari candle 1 jam (ZONE_WINDOW_CANDLES di atas), tapi cek TOUCH-nya sekarang pakai
// candle 5 menit + cron tiap 5 menit (lihat dark-kaela-monitor.yml), bukan nunggu candle 1 jam
// close + polling 20 menit. Delay nyentuh->notifikasi turun dari ~sampai 80 menit jadi ~5 menit.
const TOUCH_INTERVAL = '5m';
const TOUCH_FETCH_CANDLES = 3; // buffer kecil kalau cron kebetulan telat/skip sekali jalan

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { activeZone: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

// DRY_RUN gak boleh nulis state -- kalau nulis, zona yang cuma "dites" bakal keanggep udah
// pernah di-alert beneran, dan run LIVE pertama abis dry-run bisa DIAM (skip) buat zona yang
// sama padahal belum pernah ada WA yang beneran terkirim. Dry-run WAJIB simulasi murni, gak
// boleh ninggalin jejak apapun di state.
function saveState(state) {
  if (DRY_RUN) {
    console.log('[DarkKaelaMonitor] DRY RUN -- state TIDAK disimpan (biar run live abis ini gak keskip).');
    return;
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  const now = new Date();
  const state = loadState();
  const candles = await fetchCandles('BTCUSDT', '1h', FETCH_CANDLES);
  const i = candles.length - 1; // candle terakhir yang udah CLOSE
  const current = candles[i];

  // 1. Cek breakout dari zona yang lagi aktif (kalau ada) -- candle WAJIB close lewat, bukan wick.
  if (state.activeZone && isZoneBroken(current, state.activeZone)) {
    const msg = formatBroken(state.activeZone, current.close, now);
    console.log(msg + '\n');
    await sendWhatsAppOrDryRun(msg);
    state.activeZone = null;
    saveState(state);
  }

  // 2. Cek TOUCH beneran (bukan cuma "deket") -- candle 5 menit, SATU kandidat terdekat kalau
  // kebetulan nyentuh >1 zona sekaligus (support+resistance gabung, BUKAN 2 arah independen,
  // lihat catatan darkKaelaZones.js soal bug yang pernah ketemu).
  const zones = detectZones(candles, i);
  const touchCandles = await fetchCandles('BTCUSDT', TOUCH_INTERVAL, TOUCH_FETCH_CANDLES);
  const latestTouchCandle = touchCandles[touchCandles.length - 1];
  const touched = findTouchCandidate(latestTouchCandle, zones);

  if (touched) {
    const sameZone = state.activeZone && pctDist(touched.price, state.activeZone.price) <= DEFAULT_PARAMS.CLUSTER_TOLERANCE_PCT;
    if (!sameZone) {
      // Konteks tambahan (permintaan Olan): jarak harga sekarang ke zona TERDEKAT di KEDUA arah,
      // bukan cuma zona yang trigger sinyal -- biar keliatan seberapa "kejepit" harganya sekarang.
      // Pakai close candle 5 menit (paling baru tersedia), BUKAN close candle 1 jam yang bisa
      // udah sampai 1 jam basi.
      const pair = findNearestPair(latestTouchCandle.close, zones);
      const signal = {
        direction: touched.direction, zonePrice: touched.price, zoneKind: touched.kind, touches: touched.touches, price: latestTouchCandle.close,
        nearestSupport: pair.support, nearestResistance: pair.resistance,
      };
      const msg = formatSignal(signal, now);
      console.log(msg + '\n');
      await sendWhatsAppOrDryRun(msg);
      state.activeZone = { price: touched.price, direction: touched.direction, zoneKind: touched.kind, touches: touched.touches, signaledAt: now.toISOString() };
      saveState(state);
      console.log('[DarkKaelaMonitor] Sinyal baru (touch):', touched.direction, '@', touched.price);
      return;
    }
  }

  console.log('[DarkKaelaMonitor]', now.toISOString(), '-- gak ada zona ke-touch (harga', latestTouchCandle.close, '), skip.');
}

main().catch((e) => {
  console.error('ERROR darkKaelaMonitor.js:', e.message);
  process.exit(1);
});
