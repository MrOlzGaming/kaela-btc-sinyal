// reportOlanBingxStatus.js -- SATU-SATUNYA tanggung jawab: lapor saldo BingX (Ninja Channel
// Breakout) Olan SENDIRI ke GAS MemberStatus, biar tab "Jurnal" Kaela Access nampilin dompet
// Ninja/BingX (permintaan Olan 26 Sep 2026: "tiap dompet dari jurnal, exchange apa, kasih nama
// itu dompet apa, sniper kah, ranger kah, ninja kah.. btc apa emas").
//
// Pola PERSIS reportOlanDemoStatus.js -- script KECIL TERPISAH, NOL logika eksekusi/trading, MURNI
// baca saldo via API (read-only) terus lapor ke GAS. Ninja beda dari Sniper/Ranger: SATU API key
// (BINGX_API_KEY) dipakai buat demo(VST) MAUPUN real (base URL beda, lihat bingxExecutor.js) --
// jadi 2 laporan (mode demo + mode real) dari SATU set kredensial, bukan 2 kredensial kayak Binance.
//
// Pakai `recordBingxBalance` (BUKAN `recordMemberStatus` biasa) -- itu partial-merge KHUSUS kolom
// BingxBalance+BingxPositions doang (lihat komentar lengkap di kaelaProTraderClient.js kenapa),
// biar gak nimpa balanceUsdt/positions/dst yang ditulis multiAccountExecutor.js/reportOlanDemoStatus.js
// buat baris (Olan, real)/(Olan, demo) yang SAMA.
//
// (27 Sep 2026) Posisi terbuka BingX SEKARANG ikut dilaporkan -- lewat kolom BARU `bingxPositions`
// TERPISAH dari `positions` (kolom lama itu TETAP cuma Binance+MEXC, gak disentuh sama sekali) --
// nutup known-gap yang sebelumnya didokumentasikan di sini (posisi Ninja lagi terbuka gak kehitung
// NAV pool sampai ditutup). ⚠️ `direction` WAJIB dari `positionSide` (LONG/SHORT), BUKAN tanda
// `positionAmt` -- BingX hedge-mode positionAmt SELALU POSITIF apapun arahnya (BUG-KAELATRADE-0040,
// pelajaran yang SAMA PERSIS dari checkAndClearStrayPosition di ninjaTrader.js).
const kaela = require('./kaelaProTraderClient');
const bingxExecutorDefault = require('./bingxExecutor');
const secrets = require('./secrets');

const MASTER_NOMOR = '6281299303888';

function normalizePositions(rawPositions) {
  return (rawPositions || []).map((p) => ({
    symbol: p.symbol,
    direction: p.positionSide === 'SHORT' ? 'sell' : 'buy',
    entryPrice: Number(p.avgPrice) || 0,
    markPrice: Number(p.markPrice) || 0,
    leverage: Number(p.leverage) || 0,
    marginUsd: Number(p.margin) || 0,
    notionalUsd: Math.abs(Number(p.positionValue) || 0),
    unrealizedPnlUsd: Number(p.unrealizedProfit) || 0,
  }));
}

async function main() {
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) {
    console.log('[ReportOlanBingxStatus] BINGX_API_KEY/SECRET kosong -- skip.');
    return;
  }
  const { createBingxClient } = bingxExecutorDefault;
  const demoClient = createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: true });
  const realClient = createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: false });

  // getWalletBalance (BUKAN getAccountBalance/availableMargin) -- pelajaran LANGSUNG dari bug NAV
  // Binance 4 Sep 2026 (lihat BUG di atas + Pool.gs) -- availableMargin UNDERSTATE begitu ada
  // margin isolated lagi kekunci di posisi terbuka, wallet balance mentah yang bener buat NAV.
  const [demoBalance, realBalance, demoPositionsRaw, realPositionsRaw] = await Promise.all([
    demoClient.getWalletBalance('VST').catch((e) => { console.log('[ReportOlanBingxStatus] getWalletBalance VST gagal:', e.message); return null; }),
    realClient.getWalletBalance('USDT').catch((e) => { console.log('[ReportOlanBingxStatus] getWalletBalance USDT gagal:', e.message); return null; }),
    demoClient.getAllPositions().catch((e) => { console.log('[ReportOlanBingxStatus] getAllPositions demo gagal:', e.message); return null; }),
    realClient.getAllPositions().catch((e) => { console.log('[ReportOlanBingxStatus] getAllPositions real gagal:', e.message); return null; }),
  ]);

  if (demoBalance != null) {
    await kaela.recordBingxBalance(MASTER_NOMOR, 'demo', demoBalance, demoPositionsRaw != null ? normalizePositions(demoPositionsRaw) : undefined);
    console.log(`[ReportOlanBingxStatus] OK demo -- $${demoBalance.toFixed(2)} VST, ${demoPositionsRaw ? demoPositionsRaw.length : '?'} posisi.`);
  }
  if (realBalance != null) {
    await kaela.recordBingxBalance(MASTER_NOMOR, 'real', realBalance, realPositionsRaw != null ? normalizePositions(realPositionsRaw) : undefined);
    console.log(`[ReportOlanBingxStatus] OK real -- $${realBalance.toFixed(2)} USDT, ${realPositionsRaw ? realPositionsRaw.length : '?'} posisi.`);
  }
}

main().catch((e) => {
  console.error('[ReportOlanBingxStatus] ERROR:', e.message);
  process.exit(1);
});
