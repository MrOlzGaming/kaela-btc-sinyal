// Pengecekan mandiri kredensial pas startup siklus (31 Agu 2026, ide Olan "otomatisasi apa
// lagi" -- langsung nyusul dari insiden nyata hari ini: VPS kekurangan MEXC_API_KEY/SECRET
// gak ketauan sampai order Emas beneran gagal di tengah siklus, pesan errornya juga nyempil di
// antara banyak log lain. Skrip ini jalan DULUAN di awal siklus (sebelum nyopetAutoTrader.js dkk)
// -- kalau ada kredensial wajib yang kosong, langsung print baris ERROR JELAS SATU KALI per
// siklus. Sengaja gak nulis notifier sendiri -- baris "ERROR" ini otomatis ke-tangkep sama
// reportCycleErrors.js yang udah ada (scan generic ERROR/GAGAL di log, dedup+cooldown di GAS),
// gak perlu bangun jalur WA baru.
//
// "Wajib" di sini = kredensial yang DIPAKAI standalone default instance (nyopetAutoTrader.js/
// sniperLiveMonitor.js/localLiveExecutor.js jalan pakai secrets.js MESIN INI, bukan per-member).
// Member (multiAccountExecutor.js) punya kredensial SENDIRI dari GAS, di luar cakupan skrip ini.
const REQUIRED = [
  { key: 'BINANCE_API_KEY', why: 'trading BTC (Sniper+Nyopet)' },
  { key: 'BINANCE_API_SECRET', why: 'trading BTC (Sniper+Nyopet)' },
  { key: 'MEXC_API_KEY', why: 'trading Emas/PAXG (Sniper+Nyopet)' },
  { key: 'MEXC_API_SECRET', why: 'trading Emas/PAXG (Sniper+Nyopet)' },
  // 26 Sep 2026, ditambah begitu Ninja (BingX) mulai REAL -- SAMA kelas kredensial kritis kayak
  // Binance/MEXC di atas (key ini juga dipakai demo VST, tapi lebih penting lagi buat real).
  { key: 'BINGX_API_KEY', why: 'trading BTC breakout (Ninja)' },
  { key: 'BINGX_API_SECRET', why: 'trading BTC breakout (Ninja)' },
  { key: 'FONNTE_TOKEN', why: 'kirim notifikasi WA' },
];

function main() {
  let secrets;
  try {
    secrets = require('./secrets');
  } catch (e) {
    console.log(`[CheckRequiredCredentials] ERROR: secrets.js gak ketemu/gagal dibaca sama sekali di mesin ini -- semua eksekusi live bakal gagal. (${e.message})`);
    return;
  }
  const machineId = secrets.MACHINE_ID || '(MACHINE_ID gak diisi)';
  const missing = REQUIRED.filter((r) => !secrets[r.key]);
  if (missing.length === 0) {
    console.log(`[CheckRequiredCredentials] ${machineId}: semua kredensial wajib lengkap.`);
    return;
  }
  for (const m of missing) {
    console.log(`[CheckRequiredCredentials] ERROR di mesin "${machineId}": kredensial ${m.key} KOSONG di secrets.js -- ${m.why} bakal gagal terus tiap siklus sampai ini diisi.`);
  }
}

module.exports = { main };

// FIX 19 Sep 2026 (audit, lihat memori [[feedback-no-blind-require-scripts]]) -- guard
// `require.main === module` DITAMBAHIN biar aman kalau file ini ke-`require()` dari script lain
// (mis. smoke-test/syntax-check), bukan cuma dijalankan langsung via `node checkRequiredCredentials.js`.
// Saat ini TIDAK ADA file lain yang require() file ini (sudah dicek) -- ini PENCEGAHAN.
if (require.main === module) {
  main();
}
