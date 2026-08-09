// Jalankan tiap 5 menit: node priceAlertMonitor.js
// Deteksi pergerakan HARGA BTC mendadak -- beda dari Whale Alert (mantau transaksi on-chain),
// ini murni mantau angka harga bergerak drastis dalam waktu singkat.
//
// Ambang batas (bukan tebakan, dihitung dari statistik historis BTC kita sendiri, 11 tahun candle
// harian -- lihat KNOWLEDGE/metodologi-analisa-teknikal.md): persentil-90 pergerakan harian
// sepanjang sejarah BTC = ~5,3% (artinya cuma 10% hari paling volatile yang segede itu) -> dibulatkan
// jadi ambang HARIAN. Ambang CEPAT (1 jam) diturunin dari itu karena rezim volatilitas 90 hari
// terakhir jauh lebih tenang dari rata-rata historis (median cuma ~1,1% vs 1,4% historis) -- gerakan
// 3% dalam 1 jam SEKARANG udah jauh di luar kebiasaan belakangan ini.
const THRESHOLD_1H_PCT = 3;
const THRESHOLD_24H_PCT = 5;
const COOLDOWN_1H_MS = 2 * 60 * 60 * 1000; // 2 jam -- cegah spam selama pergerakan masih berlangsung
const COOLDOWN_24H_MS = 6 * 60 * 60 * 1000; // 6 jam

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { WEB_URL } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

const STATE_PATH = path.join(__dirname, 'price-alert-state.json');

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { last1hAlert: null, last24hAlert: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetch24hTicker() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT');
  return res.json();
}

// Candle H1 TERAKHIR YANG SUDAH CLOSE (limit=2, ambil yang ke-0 -- yang ke-1 masih berjalan)
// dipakai sebagai "harga 1 jam lalu" -- konsisten sama pola "tunggu candle close" di proyek ini.
async function fetch1hAgoPrice() {
  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2');
  const raw = await res.json();
  return +raw[0][4];
}

function fmtUsd(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatAlert({ pct, fromPrice, toPrice, windowLabel }) {
  const arah = pct >= 0 ? 'NAIK' : 'TURUN';
  const emoji = pct >= 0 ? '🚀' : '📉';
  return [
    `${CATEGORY_COLOR.priceAlert.emoji} ${emoji} PERGERAKAN HARGA MENDADAK -- BTC ${arah} ${Math.abs(pct).toFixed(2)}% dalam ${windowLabel}`,
    '',
    `Dari ${fmtUsd(fromPrice)} ke ${fmtUsd(toPrice)}.`,
    '',
    '⚠️ Fakta pergerakan harga murni -- Kaela TIDAK menebak penyebab atau arah selanjutnya. Murni informasi, bukan ajakan aksi apapun.',
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

async function main() {
  const now = new Date();
  const state = loadState();

  const [ticker24h, price1hAgo] = await Promise.all([fetch24hTicker(), fetch1hAgoPrice()]);
  const currentPrice = parseFloat(ticker24h.lastPrice);
  const change24hPct = parseFloat(ticker24h.priceChangePercent);
  const change1hPct = ((currentPrice - price1hAgo) / price1hAgo) * 100;

  let sentAny = false;

  if (Math.abs(change1hPct) >= THRESHOLD_1H_PCT) {
    const cooldownOk = !state.last1hAlert || now.getTime() - new Date(state.last1hAlert).getTime() > COOLDOWN_1H_MS;
    if (cooldownOk) {
      const msg = formatAlert({ pct: change1hPct, fromPrice: price1hAgo, toPrice: currentPrice, windowLabel: '1 jam terakhir' });
      console.log(msg + '\n');
      addEntry('price-alert', msg, now);
      await sendWhatsApp(msg);
      state.last1hAlert = now.toISOString();
      sentAny = true;
    } else {
      console.log('[PriceAlert] Ambang 1 jam kelewat (' + change1hPct.toFixed(2) + '%) tapi masih cooldown, skip.');
    }
  }

  if (Math.abs(change24hPct) >= THRESHOLD_24H_PCT) {
    const cooldownOk = !state.last24hAlert || now.getTime() - new Date(state.last24hAlert).getTime() > COOLDOWN_24H_MS;
    if (cooldownOk) {
      const price24hAgo = currentPrice / (1 + change24hPct / 100);
      const msg = formatAlert({ pct: change24hPct, fromPrice: price24hAgo, toPrice: currentPrice, windowLabel: '24 jam terakhir' });
      console.log(msg + '\n');
      addEntry('price-alert', msg, now);
      await sendWhatsApp(msg);
      state.last24hAlert = now.toISOString();
      sentAny = true;
    } else {
      console.log('[PriceAlert] Ambang 24 jam kelewat (' + change24hPct.toFixed(2) + '%) tapi masih cooldown, skip.');
    }
  }

  if (!sentAny) {
    console.log(`[PriceAlert] ${now.toISOString()} -- normal (1h: ${change1hPct.toFixed(2)}%, 24h: ${change24hPct.toFixed(2)}%)`);
  }

  saveState(state);
}

main().catch((e) => {
  console.error('ERROR priceAlertMonitor.js:', e.message);
  process.exit(1);
});
