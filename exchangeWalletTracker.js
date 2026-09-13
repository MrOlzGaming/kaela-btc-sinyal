// exchangeWalletTracker.js -- ide #3 (13 Sep 2026, "lacak wallet cold storage exchange besar yang
// udah dikenal publik"). BEDA dari whale-netflow (whaleFetch.js, nangkep TRANSAKSI individual >=300
// BTC siapapun) -- ini pantau SALDO wallet SPESIFIK dari waktu ke waktu, biar ketauan kalau
// exchange BESAR mindahin dana gede masuk/keluar cold storage (akumulasi/distribusi skala gede,
// beda sinyal dari whale-netflow yang generik).
//
// Alamat DIVERIFIKASI LANGSUNG 13 Sep 2026 via blockchain.info (bukan tebakan) -- publik +
// terdokumentasi (bitinfocharts rich-list, sumber independen) sbg cold wallet Binance terbesar:
//   1. 34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo -- 248.597 BTC (dicek: cocok, ~1,2% suplai beredar)
//   2. 3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6 -- 219.059 BTC
//   3. 3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb --  68.200 BTC
// JUJUR soal batasnya: cuma 3 alamat DIKENAL PUBLIK -- exchange kemungkinan besar punya BANYAK
// wallet lain yang gak terdokumentasi/gak dilabeli publik. Ini SAMPEL, bukan gambaran lengkap
// treasury exchange manapun.
//
// ⛔ MURNI ARSIP -- gak pernah pengaruhi sinyal/eksekusi trading apapun.

const fs = require('fs');
const path = require('path');
const { fetchWithRetry } = require('./httpRetry');

const LOG_PATH = path.join(__dirname, 'exchange-wallet-balances.json');
const SATOSHI = 100000000;

const KNOWN_WALLETS = [
  { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', label: 'Binance Cold #1' },
  { address: '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6', label: 'Binance Cold #2' },
  { address: '3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb', label: 'Binance Cold #3' },
];

async function fetchBalance(address) {
  const res = await fetchWithRetry(`https://blockchain.info/rawaddr/${address}?limit=0`);
  const data = await res.json();
  return { balanceBtc: data.final_balance / SATOSHI, nTx: data.n_tx };
}

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveLog(arr) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr, null, 2));
}

// Cap histori biar file gak numpuk tak terbatas -- ~1 snapshot/siklus 15 menit, 5000 entri per
// wallet ≈ >7 minggu histori, lebih dari cukup buat riset awal.
const MAX_ENTRIES_PER_WALLET = 5000;

async function main() {
  const log = loadLog();
  const byAddress = {};
  for (const e of log) (byAddress[e.address] = byAddress[e.address] || []).push(e);

  const notableChanges = [];
  for (const w of KNOWN_WALLETS) {
    try {
      const { balanceBtc, nTx } = await fetchBalance(w.address);
      const history = byAddress[w.address] || [];
      const prev = history.length ? history[history.length - 1] : null;
      const deltaBtc = prev ? balanceBtc - prev.balanceBtc : 0;

      log.push({ address: w.address, label: w.label, timestamp: new Date().toISOString(), balanceBtc, nTx, deltaBtc });

      // Perubahan >=50 BTC dalam 1 siklus (~15 menit) itu GEDE buat cold wallet (biasanya diam
      // berhari-hari) -- layak dicatat eksplisit di log konsol (BUKAN kirim WA, murni arsip dulu).
      if (Math.abs(deltaBtc) >= 50) {
        notableChanges.push(`${w.label}: ${deltaBtc > 0 ? '+' : ''}${deltaBtc.toFixed(2)} BTC (sekarang ${balanceBtc.toFixed(2)} BTC)`);
      }
    } catch (e) {
      console.log(`[ExchangeWalletTracker] Gagal cek ${w.label} (dilewatin):`, e.message.slice(0, 100));
    }
  }

  // Pangkas per-wallet biar gak infinite growth.
  const trimmed = [];
  const counts = {};
  for (let i = log.length - 1; i >= 0; i--) {
    const addr = log[i].address;
    counts[addr] = (counts[addr] || 0) + 1;
    if (counts[addr] <= MAX_ENTRIES_PER_WALLET) trimmed.unshift(log[i]);
  }
  saveLog(trimmed);

  if (notableChanges.length) {
    console.log('[ExchangeWalletTracker] Perubahan saldo signifikan:', notableChanges.join(' | '));
  } else {
    console.log('[ExchangeWalletTracker] OK -- gak ada perubahan signifikan di 3 wallet dikenal.');
  }
}

module.exports = { main, fetchBalance, KNOWN_WALLETS };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR exchangeWalletTracker.js:', e.message); process.exit(1); });
}
