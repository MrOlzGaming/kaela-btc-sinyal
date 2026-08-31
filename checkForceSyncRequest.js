// checkForceSyncRequest.js (31 Agu 2026, permintaan Olan: "tombol yang bisa memaksa tarik data
// terbaru gak nunggu 15 menit") -- jadwal SENDIRI, TERPISAH dari run-local-executor.ps1/
// run-vultr-executor.sh (jalan tiap ~1 menit, JAUH lebih rapat), TAPI cuma ngecek 1 flag murah
// (Script Property GAS) -- kalau kosong, langsung selesai (hampir gak ada biaya). Kalau ADA
// permintaan (owner klik tombol "Minta Sinkron Sekarang" di tab Developer Kaela Access), jalanin
// runBalanceReports() doang (BUKAN full cycle) -- cukup buat update saldo real yang dipakai
// hitungan pool/saham, TANPA resiko dobel-eksekusi order (itu tetap murni jadwal 15 menit biasa).
//
// KENAPA GAK BISA BENERAN INSTAN: GAS gak bisa manggil Binance/MEXC langsung (server Google
// diblokir geografis, lihat catatan BinanceAdmin.gs) -- SATU-SATUNYA yang bisa nyampe Binance/MEXC
// ya komputer/VPS ini. Jadwal ~1 menit ini SUDAH pendekatan paling cepat yang bisa dicapai tanpa
// ubah arsitektur besar (misal jadiin proses yang jalan terus-menerus, bukan dijadwal).
const kaela = require('./kaelaProTraderClient');
const { runBalanceReports } = require('./multiAccountExecutor');

async function main() {
  const r = await kaela.checkAndClearForceSyncRequest();
  if (!r.requested) {
    console.log('[CheckForceSync] Gak ada permintaan sinkron.');
    return;
  }
  console.log(`[CheckForceSync] Ada permintaan sinkron (diminta ${r.requestedAt}) -- jalanin sekarang.`);
  await runBalanceReports();
  console.log('[CheckForceSync] Selesai.');
}

main().catch((e) => {
  console.error('ERROR checkForceSyncRequest.js:', e.message);
  process.exit(1);
});
