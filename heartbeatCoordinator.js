// Leader-election antar N komputer eksekutor lokal (25 Agu 2026, "2 komputer nganggur bisa jadi
// server saling backup? nyala semua tapi tetep 1 yang eksekusi" -- DIPERLUAS jadi 3 mesin: Laptop
// Olan + Komputer Prestasi Kiri + Kanan). Tujuan: cuma 1 mesin yang boleh eksekusi order real
// tiap siklus (mesin lain diem, cuma lapor "aku hidup"), biar gak dobel-eksekusi (tiap mesin
// punya folder multi-account-state/ SENDIRI-SENDIRI di lokal, gak saling tau kalau 2+ jalan
// bareng -- itu yang bikin bahaya, BUKAN soal listrik/internet).
//
// HARDENED 25 Agu 2026 (Olan tanya 3x "beneran gak bakal dobel buy?", jawaban jujurnya sebelum
// ini: "hampir pasti aman, tapi ada celah race condition SEMPIT secara teori" -- gak mau
// ngandelin "kemungkinan kecil" doang buat duit real). Versi lama: tiap mesin manggil
// reportHeartbeat() lalu getHeartbeats() TERPISAH, hitung leader sendiri2 di Node -- ada celah
// kalau 2 mesin manggil hampir bersamaan PERSIS, bisa saling gak lihat heartbeat masing2 yang
// paling baru. Fix: SEKARANG cuma 1 panggilan atomik `claimLeadership()` (Sheet.gs GAS, dibungkus
// LockService.getScriptLock()) -- GAS jamin cuma 1 eksekusi klaim yang jalan di satu waktu ACROSS
// SEMUA mesin, yang laen ANTRE (bukan race). Node di sini TINGGAL nyuruh GAS mutusin, gak hitung
// leader sendiri lagi sama sekali.
//
// FAIL-CLOSED TETAP DIPERTAHANKAN (checkLeader.js) -- kalau panggilan claimLeadership gagal
// (network/GAS down), mesin ANGGAP DIRINYA STANDBY (skip eksekusi), BUKAN sebaliknya.

const kaela = require('./kaelaProTraderClient');

function loadMachineId() {
  let secrets;
  try {
    secrets = require('./secrets');
  } catch {
    throw new Error('secrets.js gak ketemu -- MACHINE_ID wajib diisi per komputer.');
  }
  if (!secrets.MACHINE_ID) throw new Error('MACHINE_ID belum diisi di secrets.js -- WAJIB unik per komputer, cocokin sama salah satu HEARTBEAT_PRIORITY_ORDER di Sheet.gs.');
  return secrets.MACHINE_ID;
}

async function checkLeadership() {
  const myId = loadMachineId();
  const result = await kaela.claimLeadership(myId);
  return {
    isLeader: result.isLeader, myId,
    reason: result.isLeader ? `aku (${myId}) leader (klaim atomik GAS)` : `${result.leaderId} yang leader (klaim atomik GAS)`,
  };
}

module.exports = { checkLeadership };
