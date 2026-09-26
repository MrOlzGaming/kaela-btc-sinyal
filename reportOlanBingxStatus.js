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
// BingxBalance doang (lihat komentar lengkap di kaelaProTraderClient.js kenapa), biar gak nimpa
// balanceUsdt/positions/dst yang ditulis multiAccountExecutor.js/reportOlanDemoStatus.js buat baris
// (Olan, real)/(Olan, demo) yang SAMA.
const kaela = require('./kaelaProTraderClient');
const bingxExecutorDefault = require('./bingxExecutor');
const secrets = require('./secrets');

const MASTER_NOMOR = '6281299303888';

async function main() {
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) {
    console.log('[ReportOlanBingxStatus] BINGX_API_KEY/SECRET kosong -- skip.');
    return;
  }
  const { createBingxClient } = bingxExecutorDefault;

  const [demoBalance, realBalance] = await Promise.all([
    createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: true })
      .getAccountBalance('VST').catch((e) => { console.log('[ReportOlanBingxStatus] getAccountBalance VST gagal:', e.message); return null; }),
    createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: false })
      .getAccountBalance('USDT').catch((e) => { console.log('[ReportOlanBingxStatus] getAccountBalance USDT gagal:', e.message); return null; }),
  ]);

  if (demoBalance != null) {
    await kaela.recordBingxBalance(MASTER_NOMOR, 'demo', demoBalance);
    console.log(`[ReportOlanBingxStatus] OK demo -- $${demoBalance.toFixed(2)} VST.`);
  }
  if (realBalance != null) {
    await kaela.recordBingxBalance(MASTER_NOMOR, 'real', realBalance);
    console.log(`[ReportOlanBingxStatus] OK real -- $${realBalance.toFixed(2)} USDT.`);
  }
}

main().catch((e) => {
  console.error('[ReportOlanBingxStatus] ERROR:', e.message);
  process.exit(1);
});
