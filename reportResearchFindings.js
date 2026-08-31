// Relay otomatis temuan riset Kaela cloud researcher ke WA Olan (31 Agu 2026, ide Olan
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
const kaela = require('./kaelaProTraderClient');

const LOG_PATH = path.join(__dirname, 'RESEARCH-LOG.md');
const STATE_PATH = path.join(__dirname, 'research-log-state.json');
const MASTER_NOMOR = '6281299303888';

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
  const msg = `🔬 *Kaela Researcher -- Temuan Baru*\n\n*${title}*\n\n*Kesimpulan:* ${kesimpulan}` +
    (statusImpl ? `\n*Status:* ${statusImpl}` : '') +
    `\n\nDetail lengkap (breakdown per tahun, split-era, sensitivitas parameter) ada di RESEARCH-LOG.md di repo.`;

  const r = await kaela.notifyMember(MASTER_NOMOR, msg);
  if (r.ok) {
    console.log('[ReportResearchFindings] Temuan baru berhasil dikirim ke WA Olan.');
    state.lastReportedHeading = entry.heading;
    saveState(state);
  } else {
    console.log('[ReportResearchFindings] Gagal kirim WA (coba lagi siklus berikutnya, state belum diupdate).');
  }
}

main().catch((e) => console.log('[ReportResearchFindings] ERROR:', e.message)).finally(() => process.exit(0));
