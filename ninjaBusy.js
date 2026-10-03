// ninjaBusy.js (3 Okt 2026) -- SATU tempat cek "akun BingX lagi dipegang strategi Ninja lain gak?". Ninja Channel
// Breakout (ninjaTrader.js), Ninja MR (ninjaMrTrader.js), Ninja Exhaustion (ninjaExhaustionTrader.js) dan Ninja News
// (ninjaNewsTrader.js) semua pakai akun BingX YANG SAMA (BINGX_API_KEY) di BTC-USDT -- posisi sisi sama bakal NYATU di
// exchange. Aturan: siapa yang duluan pegang, yang lain skip. Baca journal doang (gak ada efek samping).
const fs = require('fs');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); } catch { return null; }
}

// `self` = nama strategi yang nanya (dia sendiri gak dihitung): 'cb' | 'mr' | 'exhaustion' | 'news'
function ninjaBusyReason(self) {
  if (self !== 'cb') { const j = readJson('channel-breakout-journal.json'); if (j && j.trailing && j.trailing.floating) return 'Ninja Channel Breakout floating'; }
  if (self !== 'mr') { const j = readJson('ninja-mr-exec-journal.json'); if (j && (j.pendingEntry || j.floating)) return 'Ninja MR pending/floating'; }
  if (self !== 'exhaustion') { const j = readJson('ninja-exhaustion-journal.json'); if (j && j.floating) return 'Ninja Exhaustion floating'; }
  if (self !== 'news') {
    const j = readJson('ninja-news-journal.json');
    if (j && j.floating) return 'Ninja News floating';
    // jendela news (2 menit sebelum rilis s/d detektor selesai) -- strategi lain JANGAN buka posisi baru
    if (j && j.active && j.active.until && Date.now() < j.active.until) return `Ninja News lagi jaga rilis (${j.active.label || j.active.key})`;
  }
  return null;
}

module.exports = { ninjaBusyReason };
