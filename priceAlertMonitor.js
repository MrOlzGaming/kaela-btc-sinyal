// Jalankan tiap 5 menit: node priceAlertMonitor.js
// Deteksi pergerakan HARGA mendadak -- beda dari Whale Alert (mantau transaksi on-chain),
// ini murni mantau angka harga bergerak drastis dalam waktu singkat. Sekarang MULTI-ASET
// (22 Agu 2026, permintaan Olan: "pergerakan tiba tiba juga di info [Emas], mirip btc") --
// loop lewat assetConfig.js, state+cooldown terpisah PER ASET (BTC lagi bergerak liar gak
// boleh nge-block alert Emas, begitu juga sebaliknya).
//
// Ambang batas BTC (bukan tebakan, dihitung dari statistik historis BTC kita sendiri, 11 tahun
// candle harian -- lihat KNOWLEDGE/metodologi-analisa-teknikal.md): persentil-90 pergerakan
// harian sepanjang sejarah BTC = ~5,3% -> dibulatkan jadi ambang HARIAN. Ambang CEPAT (1 jam)
// diturunin dari itu karena rezim volatilitas 90 hari terakhir jauh lebih tenang dari rata-rata
// historis.
// Ambang XAU/Emas BEDA (lebih ketat) -- histori PAXGUSDT di Binance baru ada sejak ~Des 2025
// (kurang dari setahun), BELUM CUKUP buat hitung persentil statistik kayak BTC. Angka di bawah
// estimasi wajar dari karakter Emas SPOT umum (volatilitas harian tipikal ~1%, gerakan besar
// 2-3%) -- BUKAN backtest, ditandain jujur di pesan.
const { ASSETS } = require('./assetConfig');

const THRESHOLDS = {
  btc: { pct1h: 3, pct24h: 5, backtested: true },
  xau: { pct1h: 1.5, pct24h: 3, backtested: false },
};
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
  if (!fs.existsSync(STATE_PATH)) return {};
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  // Migrasi dari format lama (BTC doang, flat) -- 22 Agu 2026, biar state lama gak ilang begitu upgrade.
  if (s.last1hAlert !== undefined || s.last24hAlert !== undefined) {
    return { btc: { last1hAlert: s.last1hAlert || null, last24hAlert: s.last24hAlert || null } };
  }
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetch24hTicker(symbol) {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`);
  return res.json();
}

// Candle H1 TERAKHIR YANG SUDAH CLOSE (limit=2, ambil yang ke-0 -- yang ke-1 masih berjalan)
// dipakai sebagai "harga 1 jam lalu" -- konsisten sama pola "tunggu candle close" di proyek ini.
async function fetch1hAgoPrice(symbol) {
  const res = await fetchWithRetry(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=2`);
  const raw = await res.json();
  return +raw[0][4];
}

function fmtUsd(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatAlert({ assetCfg, pct, fromPrice, toPrice, windowLabel, backtested }) {
  const arah = pct >= 0 ? 'NAIK' : 'TURUN';
  const emoji = pct >= 0 ? '🚀' : '📉';
  return [
    `${CATEGORY_COLOR.priceAlert.emoji} ${emoji} PERGERAKAN HARGA MENDADAK -- ${assetCfg.emoji} ${assetCfg.label} ${arah} ${Math.abs(pct).toFixed(2)}% dalam ${windowLabel}`,
    '',
    `Dari ${fmtUsd(fromPrice)} ke ${fmtUsd(toPrice)}.`,
    '',
    backtested
      ? '⚠️ Fakta pergerakan harga murni -- Kaela TIDAK menebak penyebab atau arah selanjutnya. Murni informasi, bukan ajakan aksi apapun.'
      : '⚠️ Fakta pergerakan harga murni (ambang Emas estimasi wajar, histori data masih pendek buat statistik penuh) -- Kaela TIDAK menebak penyebab atau arah selanjutnya. Murni informasi, bukan ajakan aksi apapun.',
    '',
    `🔗 ${WEB_URL}`,
  ].join('\n');
}

async function checkAsset(assetKey, assetCfg, now, state) {
  const th = THRESHOLDS[assetKey];
  if (!state[assetKey]) state[assetKey] = { last1hAlert: null, last24hAlert: null };
  const assetState = state[assetKey];

  const [ticker24h, price1hAgo] = await Promise.all([
    fetch24hTicker(assetCfg.symbol),
    fetch1hAgoPrice(assetCfg.symbol),
  ]);
  const currentPrice = parseFloat(ticker24h.lastPrice);
  const change24hPct = parseFloat(ticker24h.priceChangePercent);
  const change1hPct = ((currentPrice - price1hAgo) / price1hAgo) * 100;

  let sentAny = false;

  if (Math.abs(change1hPct) >= th.pct1h) {
    const cooldownOk = !assetState.last1hAlert || now.getTime() - new Date(assetState.last1hAlert).getTime() > COOLDOWN_1H_MS;
    if (cooldownOk) {
      const msg = formatAlert({ assetCfg, pct: change1hPct, fromPrice: price1hAgo, toPrice: currentPrice, windowLabel: '1 jam terakhir', backtested: th.backtested });
      console.log(msg + '\n');
      addEntry('price-alert', msg, now);
      await sendWhatsApp(msg);
      assetState.last1hAlert = now.toISOString();
      sentAny = true;
    } else {
      console.log(`[PriceAlert] ${assetCfg.label} ambang 1 jam kelewat (${change1hPct.toFixed(2)}%) tapi masih cooldown, skip.`);
    }
  }

  if (Math.abs(change24hPct) >= th.pct24h) {
    const cooldownOk = !assetState.last24hAlert || now.getTime() - new Date(assetState.last24hAlert).getTime() > COOLDOWN_24H_MS;
    if (cooldownOk) {
      const price24hAgo = currentPrice / (1 + change24hPct / 100);
      const msg = formatAlert({ assetCfg, pct: change24hPct, fromPrice: price24hAgo, toPrice: currentPrice, windowLabel: '24 jam terakhir', backtested: th.backtested });
      console.log(msg + '\n');
      addEntry('price-alert', msg, now);
      await sendWhatsApp(msg);
      assetState.last24hAlert = now.toISOString();
      sentAny = true;
    } else {
      console.log(`[PriceAlert] ${assetCfg.label} ambang 24 jam kelewat (${change24hPct.toFixed(2)}%) tapi masih cooldown, skip.`);
    }
  }

  if (!sentAny) {
    console.log(`[PriceAlert] ${assetCfg.label} ${now.toISOString()} -- normal (1h: ${change1hPct.toFixed(2)}%, 24h: ${change24hPct.toFixed(2)}%)`);
  }
}

async function main() {
  const now = new Date();
  const state = loadState();

  for (const [assetKey, assetCfg] of Object.entries(ASSETS)) {
    try {
      await checkAsset(assetKey, assetCfg, now, state);
    } catch (e) {
      console.log(`[PriceAlert] ${assetCfg.label} gagal dicek (dilewatin, aset lain tetap jalan):`, e.message.slice(0, 150));
    }
  }

  saveState(state);
}

main().catch((e) => {
  console.error('ERROR priceAlertMonitor.js:', e.message);
  process.exit(1);
});
