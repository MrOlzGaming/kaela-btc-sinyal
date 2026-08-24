// Leader-election antar N komputer eksekutor lokal (25 Agu 2026, "2 komputer nganggur bisa jadi
// server saling backup? nyala semua tapi tetep 1 yang eksekusi" -- DIPERLUAS jadi 3 mesin begitu
// ketauan ada Laptop Olan + Komputer Prestasi Kiri + Komputer Prestasi Kanan, bukan cuma 2). BUKAN
// failover otomatis yang "ambil alih beneran jalan bareng" -- ini nentuin GILIRAN: cuma 1 mesin
// yang boleh eksekusi order real tiap siklus (mesin lain diem, cuma lapor "aku hidup"), biar gak
// dobel-eksekusi (tiap mesin punya folder multi-account-state/ SENDIRI-SENDIRI di lokal, gak
// saling tau kalau 2+ jalan bareng -- itu yang bikin bahaya, BUKAN soal listrik/internet).
//
// Aturan (PRIORITY_ORDER, dikonfirmasi Olan 25 Agu 2026: "Laptop -> Kiri -> Kanan"): leader =
// mesin PERTAMA di PRIORITY_ORDER yang MASIH LAPOR HIDUP (heartbeat dalam STALE_AFTER_MINUTES
// terakhir). Deterministik -- SEMUA mesin baca heartbeat table yang SAMA dari GAS, jadi
// independen komputasi ke kesimpulan yang SAMA soal siapa leader, TANPA perlu saling koordinasi
// langsung/lock (menghindar race condition/split-brain walau 3+ mesin). Begitu mesin prioritas
// lebih tinggi balik lapor hidup, otomatis balik jadi leader -- gak ada tindakan manual.
//
// FAIL-CLOSED (PENTING, keputusan sadar buat uang real): kalau GAS/koneksi gagal pas ngecek
// leadership, mesin itu ANGGAP DIRINYA BUKAN LEADER (skip eksekusi siklus itu) -- bukan sebaliknya.
// Alasannya: kalau fail-OPEN (anggap leader pas gagal cek), 2+ mesin yang BARENGAN gak bisa
// connect ke GAS (misal GAS lagi down) bakal SEMUA eksekusi bareng -- persis skenario yang mau
// dihindari. Konsekuensinya: kalau GAS down, TIDAK ADA mesin yang eksekusi siklus itu (aman,
// cuma kelewat 1 siklus) -- jauh lebih baik drpd dobel/triple-eksekusi uang beneran.

const kaela = require('./kaelaProTraderClient');

// Urutan prioritas -- BUKAN rahasia, cuma daftar identitas, SAMA PERSIS di semua mesin (kode ini).
// Nambah mesin baru = tambah 1 baris di sini + deploy ulang kode ini ke SEMUA mesin (biar semua
// tau urutan yang sama), BUKAN cuma di mesin barunya doang.
const PRIORITY_ORDER = ['komputer-utama', 'prestasi-kiri', 'prestasi-kanan'];
const STALE_AFTER_MINUTES = 20; // ~2x cadence 15 menit, kasih jeda 1x run kelewat sebelum ambil alih

function loadMachineId() {
  let secrets;
  try {
    secrets = require('./secrets');
  } catch {
    throw new Error('secrets.js gak ketemu -- MACHINE_ID wajib diisi per komputer.');
  }
  if (!secrets.MACHINE_ID) throw new Error('MACHINE_ID belum diisi di secrets.js -- WAJIB unik per komputer, cocokin sama salah satu PRIORITY_ORDER di heartbeatCoordinator.js.');
  return secrets.MACHINE_ID;
}

async function checkLeadership() {
  const myId = loadMachineId();
  await kaela.reportHeartbeat(myId); // lapor hidup DULU, apapun hasilnya nanti

  const heartbeats = await kaela.getHeartbeats();
  const now = Date.now();
  const aliveIds = new Set(
    heartbeats
      .filter((h) => (now - new Date(h.lastSeenAt).getTime()) / 60000 < STALE_AFTER_MINUTES)
      .map((h) => h.machineId)
  );
  aliveIds.add(myId); // aku baru aja lapor barusan, pasti alive walau belum sempat kebaca balik dari GAS

  // Leader = mesin PERTAMA di PRIORITY_ORDER yang alive. Fallback ke myId kalau somehow gak ada
  // satupun mesin di PRIORITY_ORDER yang alive (edge case harusnya gak kejadian normal, tapi lebih
  // baik ADA yang eksekusi drpd sistem berhenti total gara-gara daftar prioritas ketinggalan update).
  const leaderId = PRIORITY_ORDER.find((id) => aliveIds.has(id)) || myId;
  const isLeader = leaderId === myId;

  return {
    isLeader, myId, leaderId,
    reason: isLeader ? `aku (${myId}) prioritas tertinggi yang masih hidup` : `${leaderId} masih hidup & prioritas lebih tinggi drpd aku`,
  };
}

module.exports = { checkLeadership, PRIORITY_ORDER, STALE_AFTER_MINUTES };
