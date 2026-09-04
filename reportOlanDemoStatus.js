// reportOlanDemoStatus.js -- SATU-SATUNYA tanggung jawab: lapor status (saldo+posisi) akun Demo
// Olan SENDIRI (Sniper+Nyopet, "sistem lama" localLiveExecutor.js/sniperOrderMonitor.js/
// nyopetAutoTrader.js) ke GAS MemberStatus, biar tab "Jurnal Demo" Kaela Access kebaca.
//
// 5 Sep 2026, bug ketemu Olan ("posisi demo nyopet ga tampil di tab demo yang baru") -- root
// cause: multiAccountExecutor.js SENGAJA skip proses status demo Olan (lihat komentarnya di situ,
// "itu sistem lama, bukan tanggung jawab modul ini" -- biar gak dobel-eksekusi sama sistem lama),
// TAPI gak ada satupun modul LAIN yang ngisi kekosongan itu -- baris (6281299303888, demo) di
// sheet MemberStatus GAS gak PERNAH ada, jadi getOlanDemoJournal() selalu nemu statuses KOSONG.
//
// Fix: script KECIL TERPISAH ini, NOL logika eksekusi/trading -- MURNI baca saldo+posisi via API
// (read-only) terus lapor ke GAS, SAMA PERSIS pola recordMemberStatus yang dipakai
// multiAccountExecutor.js buat member lain. Karena gak ada write/order APAPUN ke Binance, AMAN
// dijalanin bareng sistem eksekusi manapun tanpa resiko dobel-eksekusi/rebutan -- beda total dari
// kenapa multiAccountExecutor.js sengaja skip demo Olan (itu soal EKSEKUSI, ini cuma LAPORAN).
const kaela = require('./kaelaProTraderClient');
const { createBinanceClient } = require('./binanceExecutor');

const MASTER_NOMOR = '6281299303888';

async function main() {
  const accounts = await kaela.getTradingAccounts('binance');
  const demo = accounts.find((a) => String(a.phone) === MASTER_NOMOR && a.mode === 'demo');
  if (!demo) {
    console.log('[ReportOlanDemoStatus] Gak ketemu akun demo Olan di GAS -- skip.');
    return;
  }

  const client = createBinanceClient({ apiKey: demo.apiKey, apiSecret: demo.apiSecret, testnet: true });
  const [balanceUsdt, balanceUsdc, positionsRaw] = await Promise.all([
    client.getAccountBalance('USDT'),
    client.getAccountBalance('USDC'),
    client.getAllPositions().catch((e) => { console.log('[ReportOlanDemoStatus] getAllPositions gagal:', e.message); return []; }),
  ]);
  // walletUsdt/walletUsdc (saldo mentah + PnL, BUKAN availableBalance -- lihat catatan lengkap di
  // getWalletBalance() binanceExecutor.js) -- fallback ke availableBalance kalau gagal, SAMA pola
  // kayak multiAccountExecutor.js.
  const [walletUsdt, walletUsdc] = await Promise.all([
    client.getWalletBalance('USDT').catch((e) => { console.log('[ReportOlanDemoStatus] getWalletBalance USDT gagal:', e.message); return balanceUsdt; }),
    client.getWalletBalance('USDC').catch((e) => { console.log('[ReportOlanDemoStatus] getWalletBalance USDC gagal:', e.message); return balanceUsdc; }),
  ]);

  const positions = (positionsRaw || [])
    .filter((p) => Math.abs(parseFloat(p.positionAmt)) > 0)
    .map((p) => ({
      exchange: 'binance', symbol: p.symbol, positionAmt: p.positionAmt, entryPrice: p.entryPrice,
      markPrice: p.markPrice, unRealizedProfit: p.unRealizedProfit, leverage: p.leverage,
      liquidationPrice: p.liquidationPrice, marginType: p.marginType, notional: p.notional,
    }));

  // mexcBalanceUsdt/Usdc + spotUsd/earnUsd = 0 (Olan demo Sniper/Nyopet gak nyentuh MEXC/Spot/Earn
  // sama sekali, itu semua khusus akun REAL dia buat NAV pool Wibowo Hedgefund).
  await kaela.recordMemberStatus(MASTER_NOMOR, 'demo', balanceUsdt, balanceUsdc, positions, 0, 0, walletUsdt, walletUsdc, 0, 0);
  console.log(`[ReportOlanDemoStatus] OK -- $${balanceUsdt.toFixed(2)} USDT / $${balanceUsdc.toFixed(2)} USDC (available), $${walletUsdt.toFixed(2)}/$${walletUsdc.toFixed(2)} (wallet), ${positions.length} posisi.`);
}

main().catch((e) => {
  console.error('[ReportOlanDemoStatus] ERROR:', e.message);
  process.exit(1);
});
