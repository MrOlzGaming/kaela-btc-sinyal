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

// ⚠️ KNOWN GAP (26 Sep 2026) -- fungsi ini CUMA lapor saldo, TIDAK lapor posisi terbuka BingX ke
// field `positions` (beda dari multiAccountExecutor.js yang lapor positions Binance/MEXC). Alasan:
// `positions` itu 1 array SHARED per baris (phone,mode), udah dipakai penulis LAIN (Binance+MEXC) --
// nulis balik array BARU isi cuma BingX bakal NIMPA posisi Binance/MEXC yang lagi kebuka (race
// antara 2 penulis independen atas 1 field yang sama, beda dari BingxBalance yang punya kolom
// sendiri). Akibatnya: NAV pool Wibowo Hedgefund BENAR pas Ninja lagi FLAT (dipakai buat fix bug
// market-cap $0,67 vs ~$28, lihat Pool.gs _poolTotalValueUsd), TAPI kalau lagi ada posisi Ninja
// TERBUKA, unrealized PnL-nya BELUM ikut ke-hitung sampai posisi itu ditutup (balance-nya baru
// ke-update abis settle) -- sama KELAS bug kayak Binance sebelum fix 4 Sep 2026 (BUG di atas),
// TAPI DAMPAK LEBIH KECIL (cuma window sepanjang posisi Ninja terbuka, bukan permanen). Fix proper
// (merge-array bukan overwrite) BELUM dikerjain sesi ini -- didokumentasikan jujur drpd dibiarin
// diam-diam.
async function main() {
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) {
    console.log('[ReportOlanBingxStatus] BINGX_API_KEY/SECRET kosong -- skip.');
    return;
  }
  const { createBingxClient } = bingxExecutorDefault;

  // getWalletBalance (BUKAN getAccountBalance/availableMargin) -- pelajaran LANGSUNG dari bug NAV
  // Binance 4 Sep 2026 (lihat BUG di atas + Pool.gs) -- availableMargin UNDERSTATE begitu ada
  // margin isolated lagi kekunci di posisi terbuka, wallet balance mentah yang bener buat NAV.
  const [demoBalance, realBalance] = await Promise.all([
    createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: true })
      .getWalletBalance('VST').catch((e) => { console.log('[ReportOlanBingxStatus] getWalletBalance VST gagal:', e.message); return null; }),
    createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: false })
      .getWalletBalance('USDT').catch((e) => { console.log('[ReportOlanBingxStatus] getWalletBalance USDT gagal:', e.message); return null; }),
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
