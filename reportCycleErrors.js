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
  const r = await kaela.reportCycleErrors(machineId, errorsText);
  if (r.ok) console.log(`[ReportCycleErrors] ${r.newCount || 0} error baru dilaporin ke Olan.`);
}

main().finally(() => process.exit(0));
