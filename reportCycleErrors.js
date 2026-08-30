// reportCycleErrors.js -- CLI kecil (30 Agu 2026, permintaan Olan: "japri aku kalo ada error..
// biar aku bisa segera perbaiki dengan Kaela di Claude"). Dipanggil run-local-executor.ps1 /
// run-vultr-executor.sh di UJUNG tiap siklus, argv[2]=machineId, argv[3]=baris2 log yang match
// ERROR/GAGAL cycle ini (udah di-dedup+dipotong caller). Dedup+cooldown PER BARIS beneran ada di
// sisi GAS (Watchdog.gs), bukan di sini -- ini cuma transport tipis. SENGAJA skrip terpisah
// (bukan ditaro di localLiveExecutor.js dkk) -- kalau GAS lagi down, ini GAGAL SENDIRI (try/catch,
// exit 0 selalu) tanpa ikut gagalin cycle utama.
const kaela = require('./kaelaProTraderClient');

async function main() {
  const machineId = process.argv[2];
  const errorsText = process.argv[3] || '';
  if (!machineId || !errorsText.trim()) return;
  // BUG BAHAYA ketemu 30 Agu 2026 (Olan lapor "spam" -- pesan WA numpuk makin banyak tiap siklus):
  // baris log INI SENDIRI (tag "[ReportCycleErrors]" + kata "error") ke-scan balik sama grep
  // ERROR/GAGAL di CYCLE BERIKUTNYA (run-*-executor.sh/.ps1) -- laporan sukses dibaca ulang
  // sebagai "error baru", dilaporin lagi, bikin log baris baru, di-scan lagi... feedback loop
  // (10 -> 13 -> makin banyak tiap siklus, PERSIS pola yang dilaporin Olan). Fix: kata "error"/
  // "gagal" WAJIB gak pernah muncul di baris log sukses manapun di file ini.
  const r = await kaela.reportCycleErrors(machineId, errorsText);
  if (r.ok) console.log(`[LaporTemuanBerkala] ${r.newCount || 0} temuan baru dikirim ke Olan.`);
}

main().finally(() => process.exit(0));
