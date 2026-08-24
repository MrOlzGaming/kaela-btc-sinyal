// Dipanggil run-local-executor.ps1 DI AWAL, sebelum eksekusi apapun. Exit code 0 = mesin ini
// leader siklus ini (lanjut jalanin 4 skrip eksekutor seperti biasa), exit code 1 = standby (skip
// eksekusi total siklus ini, cuma lapor heartbeat). Lihat heartbeatCoordinator.js buat aturan
// lengkap + alasan fail-closed.
const { checkLeadership } = require('./heartbeatCoordinator');

checkLeadership()
  .then((r) => {
    console.log(`[CheckLeader] ${r.myId}: ${r.isLeader ? 'LEADER' : 'STANDBY'} -- ${r.reason}`);
    process.exit(r.isLeader ? 0 : 1);
  })
  .catch((e) => {
    // FAIL-CLOSED (lihat catatan panjang di heartbeatCoordinator.js) -- gagal cek = anggap BUKAN
    // leader, skip siklus ini. Lebih baik 1 siklus kelewat drpd risiko dobel-eksekusi.
    console.log('[CheckLeader] Gagal cek leadership, anggap STANDBY (fail-closed):', e.message);
    process.exit(1);
  });
