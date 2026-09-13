// minerWalletTracker.js -- tahap 2 riset miner-outflow (13 Sep 2026, lanjutan minerPools.js/
// minerPoolResearchLog.js). Tahap 1 cuma jawab "siapa mining berapa blok" -- BELUM bisa jawab
// "miner jual apa nggak". Tahap ini isi celah itu: begitu tau POOL yang mining suatu blok (tag
// scriptSig, minerPools.js), alamat PAYOUT (coinbase output) blok itu otomatis KETAHUAN juga --
// 100% pasti (bukan tebakan), GRATIS (numpang blok yang sama), TANPA perlu clustering heuristik
// kayak WalletExplorer (exchangeAddresses.js). Begitu 1 alamat pool ketahuan, dia TETAP jadi milik
// pool itu selamanya (pool jarang/gak pernah ganti wallet konsolidasi utama) -- makin lama numpuk,
// makin lengkap peta alamat tiap pool.
//
// KEGUNAAN: alamat yang KETAHUAN di sini dipakai whaleFetch.js buat nge-tag transaksi RAKSASA yang
// SUMBER-nya (input) salah satu alamat pool ini -- kalau tujuannya (output) exchange dikenal juga
// (exchangeAddresses.js), itu BARU sinyal "miner outflow" beneran (miner mindahin BTC ke exchange,
// potensi jual). SEBELUM itu ketauan, alamat ini HARUS lebih dulu "diperkenalkan" via minimal 1
// blok yang mining-nya kedeteksi -- jadi kayak whale-netflow, ini juga butuh numpuk histori dulu
// (gak instan, cuma dari SEKARANG ke depan, bukan bisa backfill masa lalu -- lihat riset 13 Sep
// 2026 soal kenapa backfill blockchain historis gak praktis buat proyek ini).
//
// ⛔ MURNI ARSIP+KNOWLEDGE-BASE -- gak pernah pengaruhi sinyal/eksekusi trading apapun.

const fs = require('fs');
const path = require('path');

const WALLETS_PATH = path.join(__dirname, 'miner-pool-wallets.json');

function loadWallets() {
  if (!fs.existsSync(WALLETS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(WALLETS_PATH, 'utf8')); } catch { return {}; }
}
function saveWallets(wallets) {
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(wallets, null, 2));
}

// `addresses` = [{ address, valueBtc }, ...] dari minerPools.js extractCoinbaseAddresses().
// Alamat kecil (dust/OP_RETURN sisa) TETAP direkam -- gak ada ambang minimal, biar peta selengkap
// mungkin (pool kadang split reward ke >1 output).
function recordMinerPayout(pool, addresses) {
  if (!pool || !addresses || !addresses.length) return;
  const wallets = loadWallets();
  for (const { address, valueBtc } of addresses) {
    if (!address) continue;
    if (!wallets[address]) {
      wallets[address] = { pool, firstSeenAt: new Date().toISOString(), blockCount: 0, totalReceivedBtc: 0 };
    }
    wallets[address].blockCount += 1;
    wallets[address].totalReceivedBtc += (valueBtc || 0);
    wallets[address].lastSeenAt = new Date().toISOString();
  }
  saveWallets(wallets);
}

// null = alamat ini BUKAN (belum diketahui jadi) wallet pool manapun -- BUKAN berarti pasti wallet
// biasa, sama batasan jujurnya kayak exchangeAddresses.js (daftar kita gak akan pernah 100% lengkap).
function lookupMinerWallet(address) {
  if (!address) return null;
  const wallets = loadWallets();
  return wallets[address] ? wallets[address].pool : null;
}

module.exports = { recordMinerPayout, lookupMinerWallet, loadWallets, WALLETS_PATH };
