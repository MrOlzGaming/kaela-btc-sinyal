// Deteksi arah exchange (deposit/withdrawal) via WalletExplorer.com API -- gratis, no-key.
// 12 Sep 2026, GANTI TOTAL dari daftar statis 6 alamat (permintaan Olan: "whale alert lebih
// pintar atau hapus aja... kalo masuk exchange kan ngerti wah ini bakal sale, kalo keluar
// siap-siap bull"). Versi lama HAMPIR GAK PERNAH cocok (7 hari sample nyata: 0% teridentifikasi,
// dicek langsung dari archive.json) krn cuma 6 alamat manual dikurasi dari bitinfocharts.
//
// WalletExplorer.com punya CLUSTERING JUTAAN alamat per exchange besar (dites+diverifikasi
// LANGSUNG 12 Sep 2026 via /api/1/wallet-addresses?wallet=<Nama>): Binance.com 295.029 alamat,
// Kraken.com 2.260.065, Bitstamp.net 478.474, Poloniex.com 1.083.059, Huobi.com 29.242,
// Bitfinex.com 3.999 -- total >4 JUTA alamat dikenal, vs 6 sebelumnya.
//
// ⚠️ JUJUR PERLU DIKETAHUI:
// - Exchange yang DICOBA tapi GAK ketemu di WalletExplorer (dites 12 Sep 2026): Coinbase, OKX,
//   Bybit, KuCoin, Crypto.com, Gemini, Robinhood. Kemungkinan wallet hygiene mereka lebih rapi
//   (banyak alamat kecil terpisah, gak gampang di-cluster teknik heuristik WalletExplorer) atau
//   emang gak sempat di-cluster/dilabeli. Transaksi ke/dari exchange-exchange ini TETAP muncul
//   sbg "gak teridentifikasi" -- BUKAN berarti pasti wallet pribadi biasa.
// - API ini TIDAK RESMI/gak didokumentasiin penuh (dipakai komunitas riset/forensik blockchain
//   bertahun-tahun, tapi bisa berubah/mati sewaktu-waktu tanpa pemberitahuan) -- degradasi AMAN
//   kalau gagal (fallback ke "gak teridentifikasi", SAMA kayak behavior versi lama).
// - Cache lokal (walletexplorer-cache.json) PERMANEN -- pemetaan alamat->cluster gak pernah
//   berubah, jadi alamat yang sama gak perlu di-query ulang lagi kalau udah pernah ketemu.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');

const CACHE_PATH = path.join(__dirname, 'walletexplorer-cache.json');
const API_BASE = 'https://www.walletexplorer.com/api/1';
const CALLER = 'kaela-btc-sinyal';

// wallet_id dikonfirmasi LANGSUNG 12 Sep 2026 via /api/1/wallet-addresses?wallet=<label> --
// JANGAN asal tebak/ganti tanpa verifikasi ulang yang sama.
const KNOWN_EXCHANGE_WALLETS = {
  '00000b55c1bcbc1f': 'Binance',
  '000666ab59fcf820': 'Bitfinex',
  '00001012b1848923': 'Kraken',
  '000012a55e988d91': 'Huobi',
  '00000e7158503ed8': 'Bitstamp',
  '0000059107d044d0': 'Poloniex',
};

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// null di cache = "udah pernah dicek, gak ketemu/gak dikenal" (BEDA dari undefined = "belum
// pernah dicek sama sekali") -- dua-duanya valid buat skip API call lagi.
async function lookupWalletId(address, cache) {
  if (Object.prototype.hasOwnProperty.call(cache, address)) return cache[address];
  try {
    const res = await fetchWithRetry(`${API_BASE}/address-lookup?address=${address}&caller=${CALLER}`, {}, 2, 1000);
    const data = await res.json();
    const walletId = data.found ? data.wallet_id : null;
    cache[address] = walletId;
    return walletId;
  } catch (e) {
    console.log(`[ExchangeAddresses] Gagal lookup ${address} (dilewatin, dianggap gak dikenal):`, e.message.slice(0, 100));
    return null; // GAK disimpen ke cache -- kegagalan jaringan sementara, coba lagi run berikutnya
  }
}

// Cek SEMUA input (asal) + SEMUA output (tujuan) tx, balikin arah pertama yang ketemu exchange
// dikenal. Kalau input DAN output dua-duanya exchange (transfer antar-exchange, jarang tapi
// mungkin) -- diprioritasin TO_EXCHANGE (output) krn itu yang paling relevan buat "siap-siap
// tekanan jual" (dana beneran MENDARAT di exchange, siap dijual).
async function detectExchangeDirection(tx) {
  const cache = loadCache();
  let dirty = false;

  const inputAddrs = (tx.inputs || []).map((i) => i.prev_out && i.prev_out.addr).filter(Boolean);
  const outputAddrs = (tx.out || []).map((o) => o.addr).filter(Boolean);

  let fromExchange = null;
  let toExchange = null;

  for (const addr of outputAddrs) {
    const before = Object.prototype.hasOwnProperty.call(cache, addr);
    const walletId = await lookupWalletId(addr, cache);
    if (!before) dirty = true;
    if (walletId && KNOWN_EXCHANGE_WALLETS[walletId]) { toExchange = KNOWN_EXCHANGE_WALLETS[walletId]; break; }
  }
  for (const addr of inputAddrs) {
    const before = Object.prototype.hasOwnProperty.call(cache, addr);
    const walletId = await lookupWalletId(addr, cache);
    if (!before) dirty = true;
    if (walletId && KNOWN_EXCHANGE_WALLETS[walletId]) { fromExchange = KNOWN_EXCHANGE_WALLETS[walletId]; break; }
  }

  if (dirty) saveCache(cache);

  if (toExchange) return { direction: 'TO_EXCHANGE', exchange: toExchange };
  if (fromExchange) return { direction: 'FROM_EXCHANGE', exchange: fromExchange };
  return null;
}

module.exports = { KNOWN_EXCHANGE_WALLETS, detectExchangeDirection };
