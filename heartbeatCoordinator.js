// Leader-election antar 2 komputer eksekutor lokal (25 Agu 2026, "2 komputer nganggur bisa jadi
// server saling backup? nyala semua tapi tetep 1 yang eksekusi"). BUKAN failover otomatis yang
// "ambil alih beneran jalan bareng" -- ini nentuin GILIRAN: cuma 1 mesin yang boleh eksekusi order
// real tiap siklus (mesin lain diem, cuma lapor "aku hidup"), biar gak dobel-eksekusi (tiap mesin
// punya folder multi-account-state/ SENDIRI-SENDIRI di lokal, gak saling tau kalau 2-2nya jalan
// bareng -- itu yang bikin bahaya, BUKAN soal listrik/internet).
//
// Aturan: PRIMARY_MACHINE_ID selalu jadi leader SELAMA dia masih lapor hidup (heartbeat) dalam
// STALE_AFTER_MINUTES terakhir. Begitu primary kelewat >1 siklus (~20 menit, cadence run tiap 15
// menit), mesin LAIN otomatis jadi leader buat siklus itu. Primary balik lapor -> otomatis balik
// jadi leader lagi (gak perlu tindakan manual apapun).
//
// FAIL-CLOSED (PENTING, keputusan sadar buat uang real): kalau GAS/koneksi gagal pas ngecek
// leadership, mesin itu ANGGAP DIRINYA BUKAN LEADER (skip eksekusi siklus itu) -- bukan sebaliknya.
// Alasannya: kalau fail-OPEN (anggap leader pas gagal cek), 2 mesin yang BARENGAN gak bisa connect
// ke GAS (misal GAS lagi down) bakal DUA-DUANYA eksekusi bareng -- persis skenario yang mau
// dihindari. Konsekuensinya: kalau GAS down, TIDAK ADA mesin yang eksekusi siklus itu (aman,
// cuma kelewat 1 siklus) -- jauh lebih baik drpd dobel-eksekusi uang beneran.

const kaela = require('./kaelaProTraderClient');

const PRIMARY_MACHINE_ID = 'komputer-utama'; // BUKAN rahasia, cukup identitas -- SAMA persis di kedua mesin (kode ini)
const STALE_AFTER_MINUTES = 20; // ~2x cadence 15 menit, kasih jeda 1x run kelewat sebelum ambil alih

function loadMachineId() {
  let secrets;
  try {
    secrets = require('./secrets');
  } catch {
    throw new Error('secrets.js gak ketemu -- MACHINE_ID wajib diisi per komputer.');
  }
  if (!secrets.MACHINE_ID) throw new Error('MACHINE_ID belum diisi di secrets.js -- WAJIB unik per komputer (contoh: "komputer-utama" atau "laptop-cadangan").');
  return secrets.MACHINE_ID;
}

async function checkLeadership() {
  const myId = loadMachineId();
  await kaela.reportHeartbeat(myId); // lapor hidup DULU, apapun hasilnya nanti

  if (myId === PRIMARY_MACHINE_ID) {
    return { isLeader: true, myId, reason: 'aku primary yang ditunjuk' };
  }

  const heartbeats = await kaela.getHeartbeats();
  const primaryHb = heartbeats.find((h) => h.machineId === PRIMARY_MACHINE_ID);
  const now = Date.now();
  const primaryAgeMinutes = primaryHb ? (now - new Date(primaryHb.lastSeenAt).getTime()) / 60000 : Infinity;
  const primaryAlive = primaryAgeMinutes < STALE_AFTER_MINUTES;

  if (primaryAlive) {
    return { isLeader: false, myId, reason: `primary masih hidup (lapor terakhir ${primaryAgeMinutes.toFixed(1)} menit lalu)` };
  }
  return { isLeader: true, myId, reason: `primary stale (${primaryHb ? primaryAgeMinutes.toFixed(1) + ' menit lalu' : 'belum pernah lapor'}) -- aku ambil alih` };
}

module.exports = { checkLeadership, PRIMARY_MACHINE_ID, STALE_AFTER_MINUTES };
