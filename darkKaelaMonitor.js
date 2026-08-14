// Dark Kaela -- monitor LIVE (jalan tiap 20 menit, lihat .github/workflows/dark-kaela-monitor.yml).
// Cek harga BTC candle jam-an TERAKHIR yang udah CLOSE terhadap zona likuiditas (darkKaelaZones.js).
// v1: MURNI INFO (keputusan final Olan: "kaela ga usah open posisi untuk nyopet") -- gak ada
// tracking posisi/P&L/bankroll sama sekali, cuma kirim WA + simpan state zona aktif biar anti-spam.

const fs = require('fs');
const path = require('path');
const { fetchCandles } = require('./technicalAnalysis');
const { detectZones, findNearestCandidate, isZoneBroken, pctDist, DEFAULT_PARAMS } = require('./darkKaelaZones');
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

  // 2. Cek deket zona baru -- SATU kandidat terdekat keseluruhan (support+resistance gabung,
  // BUKAN 2 arah independen, lihat catatan darkKaelaZones.js soal bug yang pernah ketemu).
  const zones = detectZones(candles, i);
  const nearest = findNearestCandidate(current, zones);

  if (nearest) {
    const sameZone = state.activeZone && pctDist(nearest.price, state.activeZone.price) <= DEFAULT_PARAMS.CLUSTER_TOLERANCE_PCT;
    if (!sameZone) {
      const signal = { direction: nearest.direction, zonePrice: nearest.price, zoneKind: nearest.kind, touches: nearest.touches, price: current.close };
      const msg = formatSignal(signal, now);
      console.log(msg + '\n');
      await sendWhatsAppOrDryRun(msg);
      state.activeZone = { price: nearest.price, direction: nearest.direction, zoneKind: nearest.kind, touches: nearest.touches, signaledAt: now.toISOString() };
      saveState(state);
      console.log('[DarkKaelaMonitor] Sinyal baru:', nearest.direction, '@', nearest.price);
      return;
    }
  }

  console.log('[DarkKaelaMonitor]', now.toISOString(), '-- gak ada zona baru (harga', current.close, '), skip.');
}

main().catch((e) => {
  console.error('ERROR darkKaelaMonitor.js:', e.message);
  process.exit(1);
});
