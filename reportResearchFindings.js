// Relay otomatis temuan riset Kaela cloud researcher ke grup Wibowo Hedgefund (31 Agu 2026, ide Olan
// "otomatisasi apa lagi" -- nutup celah manual: sebelumnya Kaela lokal harus DICEK MANUAL tiap
// kali mau tau progress riset cloud, sekarang siklus lokal/VPS yang ngecek sendiri tiap 15 menit.
//
// Cara kerja: baca entri PALING ATAS di "## Temuan Terbaru" RESEARCH-LOG.md (riset cloud nulis
// entri baru di situ + commit+push tiap kali kelar). Bandingin sama state (heading entri
// terakhir yang UDAH dilaporin, disimpen di research-log-state.json -- state file BIASA yang
// ikut ke-commit+push kayak sniper-orders.json dkk, jadi lokal & VPS otomatis SAMA statusnya
// abis git pull, gak perlu koordinasi tambahan/dobel kirim).
//
// SENGAJA skrip terpisah (pola sama kayak reportCycleErrors.js) -- gagal WA gak boleh gagalin
// cycle utama. Dipanggil run-local-executor.ps1/run-vultr-executor.sh di ujung siklus.
const fs = require('fs');
const path = require('path');
// 15 Sep 2026 (permintaan eksplisit Olan di chat) -- pindah dari DM pribadi (kaela.notifyMember
// ke MASTER_NOMOR) ke grup "Wibowo Hedgefund" langsung, pakai SATU titik resmi kirim ke grup itu
// (wibowoNotify.js -- ikut cek toggle Silent Trade + antrean retry yang udah ada, JANGAN kirim
// lewat fonnte.js polos di sini biar gak ada 2 jalur beda buat 1 grup).
const { sendWhatsAppToWibowo } = require('./wibowoNotify');

const LOG_PATH = path.join(__dirname, 'RESEARCH-LOG.md');
const STATE_PATH = path.join(__dirname, 'research-log-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { lastReportedHeading: null }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// Ambil entri PALING ATAS di section "## Temuan Terbaru" -- heading "### ..." pertama setelah
// section itu, isinya sampai "---" atau heading "### " berikutnya (mana yang duluan ketemu).
function parseLatestEntry(markdown) {
  const sectionIdx = markdown.indexOf('## Temuan Terbaru');
  if (sectionIdx === -1) return null;
  const afterSection = markdown.slice(sectionIdx);
  const headingMatch = afterSection.match(/^### .+$/m);
  if (!headingMatch) return null;
  const heading = headingMatch[0].trim();
  const bodyStart = headingMatch.index + heading.length;
  const rest = afterSection.slice(bodyStart);
  const endMatch = rest.match(/\n---|\n### /);
  const body = (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
  return { heading, body };
}

function extractField(body, label) {
  const re = new RegExp(`\\*\\*${label}:?\\*\\*\\s*([^\\n]+(?:\\n(?!\\*\\*)[^\\n]+)*)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

async function main() {
  if (!fs.existsSync(LOG_PATH)) return;
  const markdown = fs.readFileSync(LOG_PATH, 'utf8');
  const entry = parseLatestEntry(markdown);
  if (!entry) return;

  const state = loadState();
  if (state.lastReportedHeading === entry.heading) {
    console.log('[ReportResearchFindings] Gak ada temuan baru (udah dilaporin sebelumnya).');
    return;
  }

  const kesimpulan = extractField(entry.body, 'Kesimpulan') || '(gak ada ringkasan kesimpulan, cek RESEARCH-LOG.md langsung)';
  const statusImpl = extractField(entry.body, 'Status implementasi') || '';

  const title = entry.heading.replace(/^###\s*/, '');
  // TTD role (13 Sep 2026, "semua otomatisnya pesan kita update") -- domain Prism (Data QA)
  // PAS banget: isinya verifikasi statistik (breakdown tahun/split-era/sensitivitas). Lihat
  // SYSTEM-MAP.md "Tim Kaela".
  const msg = `🔬 *Kaela Researcher -- Temuan Baru*\n\n*${title}*\n\n*Kesimpulan:* ${kesimpulan}` +
    (statusImpl ? `\n*Status:* ${statusImpl}` : '') +
    `\n\nDetail lengkap (breakdown per tahun, split-era, sensitivitas parameter) ada di RESEARCH-LOG.md di repo.` +
    `\n\n— Kaela\n   (laporan: 🔬 Prism · Data QA)`;

  const r = await sendWhatsAppToWibowo(msg);
  if (r && (r.ok || r.skipped)) {
    // `skipped` (Silent Trade lagi OFF disengaja) TETAP dianggap "berhasil diproses" -- BUKAN
    // gagal kirim, cuma sengaja senyap (sama semantik kayak posisi buka/tutup). Kalau checkFailed
    // (GAS hiccup), wibowoNotify.js SENDIRI yang udah antre pesan ini -- jangan majuin state di
    // sini, biar next cycle nyoba ngirim lagi (bukan ke-skip selamanya).
    if (!r.checkFailed) {
      console.log(r.skipped ? '[ReportResearchFindings] Temuan baru di-skip (Silent Trade OFF, disengaja).' : '[ReportResearchFindings] Temuan baru berhasil dikirim ke grup Wibowo Hedgefund.');
      state.lastReportedHeading = entry.heading;
      saveState(state);
    } else {
      console.log('[ReportResearchFindings] GAS gagal cek toggle -- pesan diantre wibowoNotify.js, state belum diupdate.');
    }
  } else {
    console.log('[ReportResearchFindings] Gagal kirim WA (coba lagi siklus berikutnya, state belum diupdate).');
  }
}

main().catch((e) => console.log('[ReportResearchFindings] ERROR:', e.message)).finally(() => process.exit(0));
