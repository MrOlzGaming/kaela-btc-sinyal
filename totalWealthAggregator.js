// totalWealthAggregator.js (23 Sep 2026, permintaan Olan: "modal kepisah dompet tapi 1
// management -- kalkulator exposure harusnya ngitung pake TOTAL modal semua dompet") -- SATU
// sumber kebenaran buat "berapa total kekayaan Olan SEBENARNYA" di seluruh dompet trading,
// dipakai bareng calculator.js `hitung({exposureModal})` (leverage makin konservatif ngikut
// TOTAL, bukan per-dompet). BUKAN pengganti getAccountBalance() individual -- ini CUMA nyari
// angka buat nge-lookup BRACKET exposure, uang yang beneran dipakai tetap dari dompet masing2.
//
// ⚠️ MODE-AWARE WAJIB -- dompet demo (uang palsu testnet) dan real (uang asli) TIDAK BOLEH
// kecampur jadi 1 angka. `getTotalWealth({ real })` cuma jumlahin dompet yang STATUS-nya SAMA
// (real dijumlah sama real, demo sama demo) -- kalau dicampur, bracket exposure REAL bisa
// kebaca lebih agresif dari yang seharusnya gara2 "dibantu" saldo testnet $5rb palsu.
//
// Registry EXTENSIBLE (list, bukan hardcode 4/5 angka) -- gampang nambah/lepas dompet baru
// (channel breakout pindah ke BingX, Sniper Emas migrasi exchange, dst) tanpa ubah logic inti.

const binanceExecutorDefault = require('./binanceExecutor');
const mexcExecutorDefault = require('./mexcExecutor');
const { isTestnet: isTestnetGlobal } = require('./killSwitch');

// Tiap entry: { name, walletId (buat DEDUP -- 2 entry walletId SAMA = fisiknya 1 dompet, cuma
// dihitung SEKALI), asset, real: () => bool, getExec: () => execClient|null }.
// `getExec` return null kalau dompet itu belum ada/gak keisi (skip diam2, JANGAN throw -- biar
// robust walau ada strategi yang belum sempat setup credential).
//
// ⚠️ DEDUP WAJIB -- Channel Breakout Trailing SEKARANG numpang akun+symbol PERSIS SAMA kayak
// Sniper BTC (collision yang udah ditemuin+dicatat di memori project-kaela-channel-breakout.md,
// BELUM diberesin krn nunggu migrasi BingX). Kalau 2 entry ini dihitung TERPISAH, uang yang SAMA
// numpuk 2x di total -- `walletId` (bukan `name`) yang jadi kunci dedup di `getTotalWealth`.
function buildWalletRegistry() {
  const { loadSecrets, createBinanceClient } = binanceExecutorDefault;
  const secrets = loadSecrets();
  const globalTestnet = isTestnetGlobal(); // Sniper/Nyopet lama numpang saklar GLOBAL killSwitch.js

  return [
    {
      name: 'Nyopet BTC (Binance USDC)', walletId: 'binance:USDC', asset: 'USDC', real: () => !globalTestnet,
      getExec: () => (secrets.BINANCE_API_KEY ? createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet: globalTestnet }) : null),
    },
    {
      name: 'Sniper BTC (Binance USDT)', walletId: 'binance:USDT', asset: 'USDT', real: () => !globalTestnet,
      getExec: () => (secrets.BINANCE_API_KEY ? createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet: globalTestnet }) : null),
    },
    {
      name: 'Nyopet Emas (MEXC USDC)', walletId: 'mexc:USDC', asset: 'USDC', real: () => !globalTestnet,
      getExec: () => (secrets.MEXC_API_KEY ? mexcExecutorDefault.createMexcClient({ apiKey: secrets.MEXC_API_KEY, apiSecret: secrets.MEXC_API_SECRET }) : null),
    },
    {
      name: 'Sniper Emas (MEXC USDT)', walletId: 'mexc:USDT', asset: 'USDT', real: () => !globalTestnet,
      getExec: () => (secrets.MEXC_API_KEY ? mexcExecutorDefault.createMexcClient({ apiKey: secrets.MEXC_API_KEY, apiSecret: secrets.MEXC_API_SECRET }) : null),
    },
    // Channel Breakout (Trailing) -- SELALU demo sekarang (allowReal belum aktif). walletId SAMA
    // PERSIS 'binance:USDT' kayak Sniper BTC di atas (numpang akun+symbol yang sama, collision
    // BELUM diberesin) -- SENGAJA disamain biar dedup ke-trigger, BUKAN typo.
    {
      name: 'Channel Breakout Trailing (Binance USDT demo, NUMPANG wallet Sniper BTC)', walletId: 'binance:USDT', asset: 'USDT', real: () => false,
      getExec: () => (secrets.BINANCE_API_KEY ? createBinanceClient({ apiKey: secrets.BINANCE_API_KEY, apiSecret: secrets.BINANCE_API_SECRET, testnet: true }) : null),
    },
  ];
}

// { real: bool } -- WAJIB eksplisit, gak ada default (biar caller mikir sendiri konteksnya
// demo/real, bukan ketebak salah diam2).
async function getTotalWealth({ real }) {
  const registry = buildWalletRegistry();
  const relevant = registry.filter((w) => w.real() === real);
  const seenWalletIds = new Set(); // dedup -- 2 entry walletId SAMA = fisiknya 1 dompet
  let total = 0;
  const breakdown = [];
  for (const w of relevant) {
    if (seenWalletIds.has(w.walletId)) {
      console.log(`[TotalWealthAggregator] Skip "${w.name}" -- walletId "${w.walletId}" udah kehitung dari entry lain (dompet fisik SAMA, hindari dobel).`);
      continue;
    }
    const exec = w.getExec();
    if (!exec) { console.log(`[TotalWealthAggregator] Skip "${w.name}" -- belum ada credential.`); continue; }
    try {
      const bal = await exec.getAccountBalance(w.asset);
      total += bal;
      breakdown.push({ name: w.name, balance: bal });
      seenWalletIds.add(w.walletId);
    } catch (e) {
      console.log(`[TotalWealthAggregator] Gagal ambil saldo "${w.name}" (dilewatin, JANGAN gagalin total gara2 1 dompet error):`, e.message);
    }
  }
  return { total, breakdown };
}

module.exports = { getTotalWealth, buildWalletRegistry };

if (require.main === module) {
  (async () => {
    console.log('=== Total kekayaan DEMO (semua dompet testnet) ===');
    const demo = await getTotalWealth({ real: false });
    demo.breakdown.forEach((b) => console.log(`  ${b.name}: $${b.balance.toFixed(2)}`));
    console.log(`  TOTAL: $${demo.total.toFixed(2)}`);

    console.log('\n=== Total kekayaan REAL (semua dompet asli) ===');
    const real = await getTotalWealth({ real: true });
    real.breakdown.forEach((b) => console.log(`  ${b.name}: $${b.balance.toFixed(2)}`));
    console.log(`  TOTAL: $${real.total.toFixed(2)}`);
  })().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
